import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { Role } from "@prisma/client";
import { authConfig } from "@/lib/auth/auth.config";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { loginSchema } from "@/lib/validation/auth";

declare module "next-auth" {
  interface User {
    role: Role;
    organizationId: string | null;
  }

  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      role: Role;
      organizationId: string | null;
      emailVerified: Date | null;
    };
  }
}

function readRole(value: unknown): Role {
  if (typeof value === "string" && (Object.values(Role) as string[]).includes(value)) {
    return value as Role;
  }
  return Role.VIEWER;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) {
          return null;
        }

        const email = parsed.data.email.toLowerCase();
        const user = await prisma.user.findUnique({
          where: { email },
        });

        if (!user || !user.isActive) {
          logger.warn("login_failed", { email, reason: "unknown_or_inactive" });
          return null;
        }

        if (user.role !== Role.SUPER_ADMIN && !user.organizationId) {
          logger.warn("login_failed", { email, reason: "tenant_user_missing_organization" });
          return null;
        }

        const passwordOk = await bcrypt.compare(parsed.data.password, user.passwordHash);
        if (!passwordOk) {
          logger.warn("login_failed", { email, reason: "invalid_password" });
          return null;
        }

        logger.info("login_success", { userId: user.id, organizationId: user.organizationId, role: user.role });

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          organizationId: user.organizationId,
        };
      },
    }),
  ],
  callbacks: {
    /**
     * Populate the JWT at sign-in and revalidate from the DB at most once every
     * TOKEN_REVALIDATION_SECONDS seconds (default 5 min).
     *
     * THE PREVIOUS BUG: this callback called prisma.user.findUnique on EVERY
     * request (middleware, page renders, API routes). With Neon Serverless the
     * first WebSocket connection takes ~16 s. That delay caused Auth.js to time
     * out, wipe token.sub, and the middleware then saw the user as logged-out →
     * redirect to /login → cookie still present → redirect to /dashboard → loop.
     *
     * THE FIX: only hit the DB when (a) this is a fresh sign-in (user arg is
     * present) or (b) the revalidation TTL has expired. All other calls return
     * the already-signed JWT claims instantly with no DB round-trip.
     */
    async jwt({ token, user, trigger }) {
      const TOKEN_REVALIDATION_SECONDS = 5 * 60; // 5 minutes

      // ── Fresh sign-in: populate token from the authorize() return value ──────
      if (user?.id) {
        token.sub = user.id;
        token.userId = user.id;
        token.role = (user as { role: Role }).role;
        token.organizationId = (user as { organizationId: string | null }).organizationId;
        token.email = user.email ?? undefined;
        token.name = user.name ?? undefined;
        token.tokenRefreshedAt = Math.floor(Date.now() / 1000);
        return token;
      }

      // ── No user id in token → unauthenticated, nothing to do ────────────────
      const userId =
        (typeof token.userId === "string" && token.userId) ||
        (typeof token.sub === "string" && token.sub) ||
        "";
      if (!userId) {
        return token;
      }

      // ── Decide whether the revalidation TTL has expired ──────────────────────
      const lastRefresh =
        typeof token.tokenRefreshedAt === "number" ? token.tokenRefreshedAt : 0;
      const secondsSinceRefresh = Math.floor(Date.now() / 1000) - lastRefresh;
      const needsRevalidation =
        trigger === "update" || secondsSinceRefresh >= TOKEN_REVALIDATION_SECONDS;

      if (!needsRevalidation) {
        // TTL still valid — return cached claims, zero DB calls.
        return token;
      }

      // ── Revalidation: confirm the user still exists and is active ────────────
      //
      // IMPORTANT: wrap in try/catch. If the DB is cold-starting (Neon ~16 s)
      // and the query throws or times out, we must NOT propagate the error.
      // An uncaught error here causes Auth.js to return a null session from
      // auth(), which makes the app layout redirect to /login. But the edge
      // middleware still sees the intact signed cookie and redirects /login
      // back to /dashboard — producing an infinite redirect loop.
      // On any DB error we return the existing cached claims unchanged so the
      // user stays logged in, and schedule a retry in 30 seconds.
      let dbUser: {
        id: string;
        email: string;
        name: string;
        role: Role;
        organizationId: string | null;
        isActive: boolean;
      } | null = null;

      try {
        dbUser = await prisma.user.findUnique({
          where: { id: userId },
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            organizationId: true,
            isActive: true,
          },
        });
      } catch (err) {
        logger.warn("jwt_revalidation_db_error", { userId, err });
        // Preserve the current session — retry revalidation in 30 seconds.
        token.tokenRefreshedAt =
          Math.floor(Date.now() / 1000) - TOKEN_REVALIDATION_SECONDS + 30;
        return token;
      }

      if (!dbUser || !dbUser.isActive) {
        // User deleted or deactivated — invalidate the token so middleware
        // redirects them to /login on the next request.
        token.sub = undefined;
        token.userId = "";
        token.role = Role.VIEWER;
        token.organizationId = null;
        token.email = undefined;
        token.name = undefined;
        token.tokenRefreshedAt = undefined;
        return token;
      }

      token.sub = dbUser.id;
      token.userId = dbUser.id;
      token.role = dbUser.role;
      token.organizationId = dbUser.organizationId;
      token.email = dbUser.email;
      token.name = dbUser.name;
      token.tokenRefreshedAt = Math.floor(Date.now() / 1000);
      return token;
    },
    async session({ session, token }) {
      const userId =
        (typeof token.userId === "string" && token.userId) ||
        (typeof token.sub === "string" && token.sub) ||
        "";
      if (!userId) {
        return session;
      }

      session.user = {
        id: userId,
        email: typeof token.email === "string" ? token.email : "",
        name: typeof token.name === "string" ? token.name : "",
        role: readRole(token.role),
        organizationId: typeof token.organizationId === "string" ? token.organizationId : null,
        emailVerified: null,
      };

      return session;
    },
  },
});
