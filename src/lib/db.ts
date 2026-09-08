import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import { PrismaClient } from "@prisma/client";

// `ws` optionally loads the native `bufferutil` addon for faster frame
// masking. On Vercel's serverless build/runtime, that native binary can
// fail to load correctly (missing .node file after Next.js standalone
// file-tracing, or a build-host/runtime-host mismatch) — `ws` swallows the
// require() error but ends up with a broken `mask`/`unmask` export, which
// crashes with "b.mask is not a function" deep inside ws's send path the
// first time a WebSocket frame is sent. Setting WS_NO_BUFFER_UTIL before
// `ws` is imported forces it to use its pure-JS (de)masking implementation,
// which is slightly slower but always correct and has no native dependency.
process.env.WS_NO_BUFFER_UTIL = "1";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ws = require("ws");

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

neonConfig.webSocketConstructor = ws;

function isNeonHost(url: string): boolean {
  try {
    const host = new URL(url.replace(/^postgres(ql)?:/, "http:")).hostname;
    return host.endsWith("neon.tech") || host.endsWith("neon.build");
  } catch {
    return url.includes("neon.tech") || url.includes("neon.build");
  }
}

function createPrismaClient(): PrismaClient {
  const log: Array<"error" | "warn"> =
    process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"];
  const url = process.env.DATABASE_URL;

  if (url && isNeonHost(url)) {
    const adapter = new PrismaNeon({ connectionString: url, max: 1 });
    return new PrismaClient({ adapter, log });
  }

  return new PrismaClient({ log });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();
globalForPrisma.prisma = prisma;