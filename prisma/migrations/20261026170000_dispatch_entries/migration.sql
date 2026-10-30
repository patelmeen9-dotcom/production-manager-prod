-- Additive: dispatch marking after all production steps are complete.
CREATE TABLE "DispatchEntry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "plantId" TEXT NOT NULL,
    "productionOrderId" TEXT NOT NULL,
    "productionOrderLineId" TEXT,
    "entryDate" DATE NOT NULL,
    "quantity" INTEGER NOT NULL,
    "remarks" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DispatchEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "de_org_order_idx" ON "DispatchEntry"("organizationId", "productionOrderId");
CREATE INDEX "de_org_plant_date_idx" ON "DispatchEntry"("organizationId", "plantId", "entryDate");
CREATE INDEX "de_org_line_idx" ON "DispatchEntry"("organizationId", "productionOrderLineId");

ALTER TABLE "DispatchEntry" ADD CONSTRAINT "DispatchEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DispatchEntry" ADD CONSTRAINT "DispatchEntry_plantId_fkey" FOREIGN KEY ("plantId") REFERENCES "Plant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DispatchEntry" ADD CONSTRAINT "DispatchEntry_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "ProductionOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DispatchEntry" ADD CONSTRAINT "DispatchEntry_productionOrderLineId_fkey" FOREIGN KEY ("productionOrderLineId") REFERENCES "ProductionOrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DispatchEntry" ADD CONSTRAINT "DispatchEntry_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
