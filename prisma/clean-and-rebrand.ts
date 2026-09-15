/**
 * clean-and-rebrand.ts
 *
 * Wipes all transactional/master data while keeping:
 *   - Organizations
 *   - Plants
 *   - Users (with updated emails → @sankalpdoors.com)
 *   - UserPlantAccess
 *
 * Run with:
 *   npx tsx prisma/clean-and-rebrand.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("=== Starting clean & rebrand ===\n");

  // ------------------------------------------------------------------
  // 1. Show current state
  // ------------------------------------------------------------------
  const orgs = await prisma.organization.findMany({ orderBy: { name: "asc" } });
  const plants = await prisma.plant.findMany({ orderBy: { name: "asc" } });
  const users = await prisma.user.findMany({ orderBy: { role: "asc" } });

  console.log("Current organizations:");
  orgs.forEach((o) => console.log(`  [${o.id}] ${o.name} (${o.slug})`));

  console.log("\nCurrent plants:");
  plants.forEach((p) => console.log(`  [${p.id}] ${p.name} — orgId ${p.organizationId}`));

  console.log("\nCurrent users:");
  users.forEach((u) =>
    console.log(`  ${u.email.padEnd(44)} role=${u.role}  orgId=${u.organizationId ?? "none"}`),
  );

  // ------------------------------------------------------------------
  // 2. Delete all transactional / master data in dependency order
  // ------------------------------------------------------------------
  console.log("\nDeleting transactional and master data...");

  const del_attachments = await prisma.productionOrderAttachment.deleteMany();
  console.log(`  productionOrderAttachment           deleted: ${del_attachments.count}`);

  const del_saEntries = await prisma.specialActivityEntry.deleteMany();
  console.log(`  specialActivityEntry                deleted: ${del_saEntries.count}`);

  const del_prodEntries = await prisma.productionEntry.deleteMany();
  console.log(`  productionEntry                     deleted: ${del_prodEntries.count}`);

  const del_matUsages = await prisma.productionEntryMaterialUsage.deleteMany();
  console.log(`  productionEntryMaterialUsage        deleted: ${del_matUsages.count}`);

  const del_mats = await prisma.productionOrderLineMaterial.deleteMany();
  console.log(`  productionOrderLineMaterial         deleted: ${del_mats.count}`);

  const del_catOpts = await prisma.productionOrderLineCategoryOption.deleteMany();
  console.log(`  productionOrderLineCategoryOption   deleted: ${del_catOpts.count}`);

  const del_catSels = await prisma.productionOrderLineCategorySelection.deleteMany();
  console.log(`  productionOrderLineCategorySelection deleted: ${del_catSels.count}`);

  const del_specActs = await prisma.productionOrderSpecialActivity.deleteMany();
  console.log(`  productionOrderSpecialActivity      deleted: ${del_specActs.count}`);

  const del_orderProcs = await prisma.productionOrderProcess.deleteMany();
  console.log(`  productionOrderProcess              deleted: ${del_orderProcs.count}`);

  const del_lines = await prisma.productionOrderLine.deleteMany();
  console.log(`  productionOrderLine                 deleted: ${del_lines.count}`);

  const del_orders = await prisma.productionOrder.deleteMany();
  console.log(`  productionOrder                     deleted: ${del_orders.count}`);

  const del_mappings = await prisma.plantProductProcessMapping.deleteMany();
  console.log(`  plantProductProcessMapping          deleted: ${del_mappings.count}`);

  const del_catAssign = await prisma.productCategoryAssignment.deleteMany();
  console.log(`  productCategoryAssignment           deleted: ${del_catAssign.count}`);

  const del_catOptions = await prisma.productCategoryOption.deleteMany();
  console.log(`  productCategoryOption               deleted: ${del_catOptions.count}`);

  const del_categories = await prisma.productCategory.deleteMany();
  console.log(`  productCategory                     deleted: ${del_categories.count}`);

  const del_processes = await prisma.process.deleteMany();
  console.log(`  process                             deleted: ${del_processes.count}`);

  const del_specActivities = await prisma.specialActivity.deleteMany();
  console.log(`  specialActivity                     deleted: ${del_specActivities.count}`);

  const del_products = await prisma.product.deleteMany();
  console.log(`  product                             deleted: ${del_products.count}`);

  const del_clients = await prisma.client.deleteMany();
  console.log(`  client                              deleted: ${del_clients.count}`);

  const del_importJobs = await prisma.importJob.deleteMany();
  console.log(`  importJob                           deleted: ${del_importJobs.count}`);

  const del_auditLogs = await prisma.auditLog.deleteMany();
  console.log(`  auditLog                            deleted: ${del_auditLogs.count}`);

  // ------------------------------------------------------------------
  // 3. Update user emails to @sankalpdoors.com
  //
  //    Strategy:
  //    a) First move every user to a guaranteed-unique temp email to
  //       avoid unique-constraint collisions.
  //    b) Then assign the final clean email.
  //
  //    Role → prefix mapping:
  //      SUPER_ADMIN          → superadmin
  //      ORGANIZATION_ADMIN   → admin
  //      PRODUCTION_MANAGER   → manager
  //      PRODUCTION_OPERATOR  → operator
  //      VIEWER               → viewer
  //
  //    If multiple users share the same role, they get admin2, admin3, etc.
  // ------------------------------------------------------------------
  console.log("\nUpdating user emails → @sankalpdoors.com ...");

  const freshUsers = await prisma.user.findMany({ orderBy: { role: "asc" } });

  // Step a: move to temp emails to free up the target names
  for (const user of freshUsers) {
    await prisma.user.update({
      where: { id: user.id },
      data: { email: `tmp_${user.id}@sankalpdoors.com` },
    });
  }

  // Step b: assign final emails
  const rolePrefix: Record<string, string> = {
    SUPER_ADMIN: "superadmin",
    ORGANIZATION_ADMIN: "admin",
    PRODUCTION_MANAGER: "manager",
    PRODUCTION_OPERATOR: "operator",
    VIEWER: "viewer",
  };

  const roleCount: Record<string, number> = {};

  for (const user of freshUsers) {
    const base = rolePrefix[user.role] ?? user.role.toLowerCase();
    roleCount[base] = (roleCount[base] ?? 0) + 1;
    const count = roleCount[base];
    const prefix = count === 1 ? base : `${base}${count}`;
    const newEmail = `${prefix}@sankalpdoors.com`;

    await prisma.user.update({
      where: { id: user.id },
      data: { email: newEmail },
    });

    console.log(`  ${user.email.padEnd(44)} → ${newEmail}  (${user.role})`);
  }

  // ------------------------------------------------------------------
  // 4. Final summary
  // ------------------------------------------------------------------
  console.log("\n=== Final state ===");

  const finalOrgs = await prisma.organization.findMany({ orderBy: { name: "asc" } });
  const finalPlants = await prisma.plant.findMany({ orderBy: { name: "asc" } });
  const finalUsers = await prisma.user.findMany({ orderBy: { role: "asc" } });

  console.log(`\nOrganizations kept (${finalOrgs.length}):`);
  finalOrgs.forEach((o) => console.log(`  ${o.name}  (slug: ${o.slug})`));

  console.log(`\nPlants kept (${finalPlants.length}):`);
  finalPlants.forEach((p) => console.log(`  ${p.name}  (${p.location ?? "—"})`));

  console.log(`\nUsers kept (${finalUsers.length}):`);
  finalUsers.forEach((u) =>
    console.log(`  ${u.email.padEnd(44)} role=${u.role}`),
  );

  console.log("\n✅  Database cleaned and rebranded. Ready for production use.\n");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
