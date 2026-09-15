import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('🧹 Starting cleanup of all orders and entries...');

    // 1. Delete the deepest children first (Entries and their usages)
    console.log('Deleting material usages...');
    await prisma.productionEntryMaterialUsage.deleteMany({});

    console.log('Deleting special activity entries...');
    await prisma.specialActivityEntry.deleteMany({});

    console.log('Deleting production entries...');
    await prisma.productionEntry.deleteMany({});

    // 2. Delete line-level records
    console.log('Deleting line category options and selections...');
    await prisma.productionOrderLineCategoryOption.deleteMany({});
    await prisma.productionOrderLineCategorySelection.deleteMany({});

    console.log('Deleting line materials...');
    await prisma.productionOrderLineMaterial.deleteMany({});

    console.log('Deleting order processes...');
    await prisma.productionOrderProcess.deleteMany({});

    console.log('Deleting order lines...');
    await prisma.productionOrderLine.deleteMany({});

    // 3. Delete order-level records
    console.log('Deleting order attachments and special activities...');
    await prisma.productionOrderAttachment.deleteMany({});
    await prisma.productionOrderSpecialActivity.deleteMany({});

    console.log('Deleting production orders...');
    await prisma.productionOrder.deleteMany({});

    // OPTIONAL: Clear audit logs related to these changes (uncomment if you want a fully clean slate)
    // await prisma.auditLog.deleteMany({});

    console.log('✅ Successfully cleared all orders and entries.');
}

main()
    .catch((e) => {
        console.error('❌ Error clearing data:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });