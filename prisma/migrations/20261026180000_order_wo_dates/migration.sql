-- Additive optional order references and informational dates.
ALTER TABLE "ProductionOrder" ADD COLUMN "clientWorkOrderNumber" TEXT;
ALTER TABLE "ProductionOrder" ADD COLUMN "productionDate" DATE;
ALTER TABLE "ProductionOrder" ADD COLUMN "dispatchDate" DATE;

CREATE INDEX "ProductionOrder_org_productionDate_idx" ON "ProductionOrder"("organizationId", "productionDate");
CREATE INDEX "ProductionOrder_org_dispatchDate_idx" ON "ProductionOrder"("organizationId", "dispatchDate");
