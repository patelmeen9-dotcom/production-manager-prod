import type { Metadata } from "next";
import { requireTenantContext } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { loadPlantScope } from "@/lib/plants/access";
import { canRecordProduction, plantIdsForQuery } from "@/lib/plants/scope";
import { buildEntryLinesByOrder, buildMaterialsByOrder } from "@/lib/production/entry-form-data";
import { ProductionEntryForm } from "@/components/production/production-entry-form";
import { SavedBanner } from "@/components/ui/saved-banner";

export const metadata: Metadata = { title: "Production entry" };

export default async function NewEntryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireTenantContext();
  const params = await searchParams;
  if (!canRecordProduction(context.role)) {
    return <p className="text-sm text-slate-400">Viewers cannot record production.</p>;
  }
  const { scope } = await loadPlantScope(context);
  const plantFilter = plantIdsForQuery(scope);
  if (plantFilter && plantFilter.length === 0) {
    return <p className="text-sm text-slate-400">No plant access.</p>;
  }

  const orders = await prisma.productionOrder.findMany({
    where: {
      organizationId: context.organizationId,
      lifecycleStatus: { notIn: ["CANCELLED"] },
      ...(plantFilter ? { plantId: { in: plantFilter } } : {}),
    },
    include: {
      lines: {
        include: {
          product: { select: { name: true } },
          categorySelections: {
            include: {
              productCategory: { select: { name: true } },
              selectedOptions: { include: { categoryOption: { select: { name: true } } } },
            },
          },
          processes: {
            select: { id: true, sequence: true, processName: true },
            orderBy: { sequence: "asc" },
          },
          materials: {
            select: { id: true, name: true, totalQuantity: true },
          },
        },
        orderBy: { lineNumber: "asc" },
      },
      requestedSpecialActivities: { include: { specialActivity: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const linesByOrder = buildEntryLinesByOrder(orders);
  const materialsByOrder = buildMaterialsByOrder(
    orders.map((order) => ({
      id: order.id,
      materials: order.lines.flatMap((line) => line.materials),
    })),
  );
  const activitiesByOrder = Object.fromEntries(
    orders.map((order) => [
      order.id,
      order.specialActivitiesRequested
        ? order.requestedSpecialActivities.map((row) => ({
            value: `activity:${row.specialActivity.id}`,
            label: row.specialActivity.name,
          }))
        : [],
    ]),
  );

  return (
    <main className="mx-auto max-w-5xl space-y-4">
      <h1 className="text-2xl font-semibold text-white">Daily production entry</h1>
      <SavedBanner message={params.saved} />
      <ProductionEntryForm
        orders={orders.map((order) => ({ id: order.id, orderNumber: order.orderNumber }))}
        linesByOrder={linesByOrder}
        activitiesByOrder={activitiesByOrder}
        materialsByOrder={materialsByOrder}
        showBackToList
      />
    </main>
  );
}
