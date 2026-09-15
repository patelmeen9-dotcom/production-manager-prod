import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireTenantContext } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { requireGrantedPlant } from "@/lib/plants/access";
import { canRecordProduction } from "@/lib/plants/scope";
import { formatDateOnly } from "@/lib/orders/date-rules";
import { buildEntryLinesByOrder, buildMaterialsByOrder } from "@/lib/production/entry-form-data";
import { updateProductionEntryAction } from "@/lib/production/actions";
import { ProductionEntryForm } from "@/components/production/production-entry-form";
import { SavedBanner } from "@/components/ui/saved-banner";

export const metadata: Metadata = { title: "Edit production entry" };

export default async function EditEntryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireTenantContext();
  if (!canRecordProduction(context.role)) {
    return <p className="text-sm text-slate-400">Viewers cannot edit production.</p>;
  }
  const { id } = await params;
  const query = await searchParams;
  const entry = await prisma.productionEntry.findFirst({
    where: { id, organizationId: context.organizationId },
    include: {
      orderProcess: { select: { productionOrderLineId: true } },
      productionOrder: {
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
      },
    },
  });
  if (!entry) {
    notFound();
  }
  await requireGrantedPlant(context, entry.plantId);
  const order = entry.productionOrder;
  const linesByOrder = buildEntryLinesByOrder([order]);
  const materialsByOrder = buildMaterialsByOrder([
    {
      id: order.id,
      materials: order.lines.flatMap((line) => line.materials),
    },
  ]);

  return (
    <main className="mx-auto max-w-5xl space-y-4">
      <h1 className="text-2xl font-semibold text-white">Edit production entry</h1>
      <SavedBanner message={query.saved} />
      <ProductionEntryForm
        orders={[{ id: order.id, orderNumber: order.orderNumber }]}
        linesByOrder={linesByOrder}
        materialsByOrder={materialsByOrder}
        entry={{
          id: entry.id,
          productionOrderId: order.id,
          orderProcessId: entry.orderProcessId,
          lineId: entry.orderProcess.productionOrderLineId,
          entryDate: formatDateOnly(entry.entryDate),
          quantity: entry.quantity,
          remarks: entry.remarks,
        }}
        action={updateProductionEntryAction.bind(null, entry.id)}
        submitLabel="Save entry changes"
        showBackToList
      />
    </main>
  );
}
