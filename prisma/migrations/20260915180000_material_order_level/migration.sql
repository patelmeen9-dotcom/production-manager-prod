-- Migration: material_order_level
-- 1. Add totalQuantity with a default, then remove the default
-- 2. Drop the old quantityPerUnit column
-- 3. Drop the ProductionOrderLineMaterialStage table
-- 4. Create ProductionEntryMaterialUsage table

-- Step 1: Add totalQuantity column with a temporary default so existing rows are satisfied
ALTER TABLE "ProductionOrderLineMaterial" ADD COLUMN "totalQuantity" INTEGER NOT NULL DEFAULT 1;

-- Step 2: Drop the default constraint now that rows are backfilled
ALTER TABLE "ProductionOrderLineMaterial" ALTER COLUMN "totalQuantity" DROP DEFAULT;

-- Step 3: Drop the old quantityPerUnit column
ALTER TABLE "ProductionOrderLineMaterial" DROP COLUMN "quantityPerUnit";

-- Step 4: Drop the material stage linking table entirely
DROP TABLE IF EXISTS "ProductionOrderLineMaterialStage";

-- Step 5: Create the new per-entry material usage table
CREATE TABLE "ProductionEntryMaterialUsage" (
    "id"             TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "entryId"        TEXT NOT NULL,
    "materialId"     TEXT NOT NULL,
    "quantityUsed"   INTEGER NOT NULL,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionEntryMaterialUsage_pkey" PRIMARY KEY ("id")
);

-- Step 6: Unique constraint (one usage record per entry per material)
CREATE UNIQUE INDEX "ProductionEntryMaterialUsage_entryId_materialId_key"
    ON "ProductionEntryMaterialUsage"("entryId", "materialId");

-- Step 7: Indexes
CREATE INDEX "ProductionEntryMaterialUsage_organizationId_entryId_idx"
    ON "ProductionEntryMaterialUsage"("organizationId", "entryId");

CREATE INDEX "ProductionEntryMaterialUsage_organizationId_materialId_idx"
    ON "ProductionEntryMaterialUsage"("organizationId", "materialId");

-- Step 8: Foreign keys
ALTER TABLE "ProductionEntryMaterialUsage"
    ADD CONSTRAINT "ProductionEntryMaterialUsage_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProductionEntryMaterialUsage"
    ADD CONSTRAINT "ProductionEntryMaterialUsage_entryId_fkey"
    FOREIGN KEY ("entryId") REFERENCES "ProductionEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductionEntryMaterialUsage"
    ADD CONSTRAINT "ProductionEntryMaterialUsage_materialId_fkey"
    FOREIGN KEY ("materialId") REFERENCES "ProductionOrderLineMaterial"("id") ON DELETE CASCADE ON UPDATE CASCADE;
