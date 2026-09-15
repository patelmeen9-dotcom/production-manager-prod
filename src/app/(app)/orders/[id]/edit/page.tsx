import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMasterWriter } from "@/lib/masters/auth";
import { prisma } from "@/lib/db";
import { requireGrantedPlant } from "@/lib/plants/access";
import { formatOrderLineLabel } from "@/lib/orders/line-label";
import { ProductionOrderSafeEditForm } from "@/components/orders/production-order-safe-edit-form";
import { OrderLineQuantityEditForm } from "@/components/orders/order-line-quantity-edit-form";
import { OrderLinesTable } from "@/components/orders/order-lines-table";
import { OrderAttachmentsPanel } from "@/components/orders/order-attachments-panel";


export const metadata: Metadata = { title: "Edit order" };

export default async function EditOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const context = await requireMasterWriter();
  const { id } = await params;
  const order = await prisma.productionOrder.findFirst({
    where: { id, organizationId: context.organizationId },
    include: {
      lines: {
        include: {
          product: {
            include: {
              categoryAssignments: { include: { productCategory: { select: { id: true, name: true } } } },
            },
          },
          categorySelections: {
            include: {
              productCategory: { select: { id: true, name: true } },
              selectedOptions: { include: { categoryOption: true } },
            },
          },
          materials: true,
        },
        orderBy: { lineNumber: "asc" },
      },
      productionEntries: { take: 1, select: { id: true } },
      attachments: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!order) {
    notFound();
  }
  await requireGrantedPlant(context, order.plantId);

  const hasEntries = order.productionEntries.length > 0 || order.lifecycleStatus !== "NOT_STARTED";
  const safeForm = (
    <ProductionOrderSafeEditForm
      orderId={order.id}
      remarks={order.remarks}
      priority={order.priority}
      notice={
        hasEntries
          ? "This order already has production entries. Only remarks, priority, and material received quantities can be changed."
          : "Remarks, priority, and material received can be updated here. Use the matrix above for quantities."
      }
      lines={order.lines.map((line) => ({
        id: line.id,
        label: `Line ${line.lineNumber}: ${formatOrderLineLabel(line)}`,
        remarks: line.remarks,
      }))}
      materials={order.lines.flatMap((line) =>
        line.materials.map((material) => ({
          id: material.id,
          label: material.name,
          quantityReceived: material.quantityReceived,
          totalNeeded: material.totalQuantity,
        })),
      )}
    />
  );

  return (
    <main className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-white">Edit order {order.orderNumber}</h1>
        <Link className="text-sm text-sky-400" href={`/orders/${order.id}`}>
          Back to order
        </Link>
      </div>
      {hasEntries ? (
        <div className="space-y-3">
          <section className="overflow-hidden rounded-lg border border-slate-800">
            <div className="border-b border-slate-800 px-4 py-3">
              <h2 className="text-sm font-medium text-white">Order lines</h2>
              <p className="text-xs text-slate-500">Quantities are read-only after production has started.</p>
            </div>
            <OrderLinesTable lines={order.lines} />
          </section>
          {safeForm}
        </div>
      ) : (
        <div className="space-y-6">
          <OrderLineQuantityEditForm orderId={order.id} lines={order.lines} />
          {safeForm}
        </div>
      )}

      <section className="rounded border border-slate-700 bg-slate-900/50 px-4 py-4">
        <OrderAttachmentsPanel
          orderId={order.id}
          attachments={order.attachments.map((a) => ({
            id: a.id,
            fileName: a.fileName,
            fileType: a.fileType as "XLSX" | "PDF",
            fileSizeBytes: a.fileSizeBytes,
            createdAt: a.createdAt,
          }))}
        />
      </section>
    </main>
  );
}
