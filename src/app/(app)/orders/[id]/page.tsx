import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenantContext } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { requireGrantedPlant } from "@/lib/plants/access";
import { canManageMasters, canRecordProduction } from "@/lib/plants/scope";
import { formatDateOnly } from "@/lib/orders/date-rules";
import { evaluateMaterialUsage } from "@/lib/orders/materials";
import { evaluateOrganizationOrders } from "@/lib/production/evaluate-orders";
import { displayStatusLabel, type DisplayStatus } from "@/lib/production/engine";
import { buildEntryLinesByOrder, buildMaterialsByOrder } from "@/lib/production/entry-form-data";
import { ProductionEntryForm } from "@/components/production/production-entry-form";
import { SpecialActivityEntryForm } from "@/components/production/special-activity-entry-form";
import { SavedBanner } from "@/components/ui/saved-banner";
import { OrderLinesTable } from "@/components/orders/order-lines-table";
import { ExportLink } from "@/components/orders/export-link";
import { OrderAttachmentsPanel } from "@/components/orders/order-attachments-panel";


export const metadata: Metadata = { title: "Order" };

const STATUS_STYLE: Record<DisplayStatus, string> = {
  ON_TIME: "bg-on-time-bg text-on-time",
  GETTING_DELAYED: "bg-warn-bg text-warn",
  DELAYED: "bg-delayed-bg text-delayed",
  NOT_STARTED: "bg-accent-bg text-ink-soft",
  START_WARNING: "bg-warn-bg text-warn",
  START_DELAYED: "bg-delayed-bg text-delayed",
  COMPLETED: "bg-accent-bg text-ink-soft",
  CANCELLED: "bg-panel-muted text-ink-faint",
  ON_HOLD: "bg-panel-muted text-ink-faint",
};

function Stat(props: { label: string; value: string }) {
  return (
    <div className="rounded border border-line bg-panel-muted px-3 py-2.5">
      <p className="text-[10.5px] font-semibold uppercase tracking-wide text-ink-soft">{props.label}</p>
      <p className="mt-1 text-[13.5px] font-medium text-ink">{props.value}</p>
    </div>
  );
}

export default async function OrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireTenantContext();
  const { id } = await params;
  const query = await searchParams;
  const order = await prisma.productionOrder.findFirst({
    where: { id, organizationId: context.organizationId },
    include: {
      client: true,
      product: true,
      plant: true,
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
              selectedOptions: { include: { categoryOption: { select: { name: true } } } },
            },
          },
          materials: {
            include: {
              entryUsages: { select: { quantityUsed: true } },
            },
          },
        },
        orderBy: { lineNumber: "asc" },
      },
      processes: {
        include: {
          orderLine: { include: { product: { select: { name: true } } } },
        },
        orderBy: [{ productionOrderLineId: "asc" }, { sequence: "asc" }],
      },
      requestedSpecialActivities: { include: { specialActivity: true } },
      productionEntries: {
        include: {
          createdBy: { select: { name: true } },
          orderProcess: {
            include: { orderLine: { include: { product: { select: { name: true } } } } },
          },
          specialActivity: true,
          materialUsages: {
            include: { material: { select: { name: true } } },
          },
        },
        orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }],
        take: 50,
      },
      specialActivityEntries: {
        include: { specialActivity: true, createdBy: { select: { name: true } } },
        orderBy: { entryDate: "desc" },
        take: 20,
      },
      attachments: {
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!order) {
    notFound();
  }
  await requireGrantedPlant(context, order.plantId);

  const asOf = new Date();
  const evaluations = await evaluateOrganizationOrders({
    organizationId: context.organizationId,
    orders: [
      {
        ...order,
        lines: order.lines.map((line) => ({
          id: line.id,
          quantity: line.quantity,
          product: line.product,
        })),
      },
    ],
    asOfDate: asOf,
  });
  const evaluation = evaluations.get(order.id);

  const requestedActivities = order.requestedSpecialActivities.map((row) => ({
    id: row.specialActivity.id,
    name: row.specialActivity.name,
  }));
  const manage = canManageMasters(context.role);
  const status = evaluation?.displayStatus ?? "NOT_STARTED";

  // Collect all order-level materials (stored on lines, treated as order-scoped)
  const allMaterials = order.lines.flatMap((line) => line.materials);

  const materialRows = allMaterials.map((material) => {
    const usage = evaluateMaterialUsage({
      name: material.name,
      totalQuantity: material.totalQuantity,
      quantityReceived: material.quantityReceived,
      entryUsages: material.entryUsages.map((u) => u.quantityUsed),
    });
    return { material, usage };
  });
  const materialWarnings = materialRows.map((row) => row.usage.warning).filter((warning): warning is string => Boolean(warning));

  return (
    <main className="mx-auto max-w-6xl space-y-5 pb-12">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link className="text-[12px] text-accent hover:underline" href="/orders">
            ← Orders
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className="text-[22px] font-bold tracking-tight text-ink">{order.orderNumber}</h1>
            <span className={`inline-flex rounded px-2 py-0.5 text-[11.5px] font-semibold ${STATUS_STYLE[status]}`}>
              {displayStatusLabel(status)}
            </span>
          </div>
          <p className="mt-1 text-sm text-ink-soft">
            {order.client.name} · {order.plant.name}
            {order.priority !== "NORMAL" ? ` · ${order.priority}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ExportLink href={`/api/orders/${order.id}/export`} label="Export order" />
          {manage ? (
            <Link
              className="inline-flex items-center rounded-md bg-sky-600 px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-sky-500"
              href={`/orders/${order.id}/edit`}
            >
              Edit order
            </Link>
          ) : null}
        </div>
      </div>

      <SavedBanner message={query.saved} />

      {materialWarnings.length > 0 ? (
        <section className="rounded-lg border border-warn/50 bg-warn-bg/40 p-4 text-sm text-warn">
          <p className="font-medium">Material warnings</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {materialWarnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total quantity" value={String(order.quantity)} />
        <Stat label="Order date" value={formatDateOnly(order.orderDate)} />
        <Stat label="Production start" value={formatDateOnly(order.effectiveStartDate)} />
        <Stat label="Due date" value={formatDateOnly(order.resolvedDueDate)} />
        <Stat
          label="Finished goods"
          value={evaluation ? `${evaluation.completedQuantity} / ${order.quantity}` : "—"}
        />
        <Stat label="Pending" value={evaluation ? String(evaluation.remainingQuantity) : "—"} />
        <Stat label="Progress" value={evaluation ? `${evaluation.progressPercent.toFixed(1)}%` : "—"} />
        <Stat label="Current stage" value={evaluation?.currentStageName ?? "—"} />
      </section>

      <section className="overflow-hidden rounded border border-line bg-panel">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div>
            <h2 className="text-[13px] font-semibold text-ink">Order lines</h2>
            <p className="text-[11px] text-ink-soft">
              Rows are products. Columns are mapped categories. Each cell is quantity for that combination, or -.
            </p>
          </div>
        </div>
        <OrderLinesTable lines={order.lines} />
      </section>

      {order.remarks ? (
        <section className="rounded border border-line bg-panel px-4 py-3 text-sm text-ink-soft">
          <span className="font-semibold text-ink">Remarks: </span>
          {order.remarks}
        </section>
      ) : null}

      {materialRows.length > 0 ? (
        <section className="overflow-hidden rounded border border-line bg-panel">
          <div className="border-b border-line px-4 py-3">
            <h2 className="text-[13px] font-semibold text-ink">Materials</h2>
            <p className="text-[11px] text-ink-soft">Order-level material requirements and usage.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-[13px]">
              <thead className="border-b border-line bg-panel-muted text-[10.5px] font-semibold uppercase tracking-wide text-ink-soft">
                <tr>
                  <th className="px-3 py-2.5">Material</th>
                  <th className="px-3 py-2.5 text-right">Total required</th>
                  <th className="px-3 py-2.5 text-right">Received</th>
                  <th className="px-3 py-2.5 text-right">Used</th>
                  <th className="px-3 py-2.5 text-right">Available</th>
                </tr>
              </thead>
              <tbody>
                {materialRows.map(({ material, usage }) => (
                  <tr key={material.id} className="border-b border-line last:border-0">
                    <td className="px-3 py-2.5 text-ink">{material.name}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-ink-soft">{usage.totalNeeded}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-ink-soft">{material.quantityReceived}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-ink-soft">{usage.used}</td>
                    <td className={`px-3 py-2.5 text-right font-mono ${usage.isShort ? "text-warn" : "text-ink-soft"}`}>
                      {usage.available}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="overflow-hidden rounded border border-line bg-panel">
        <div className="border-b border-line px-4 py-3">
          <h2 className="text-[13px] font-semibold text-ink">Process snapshot</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-[13px]">
            <thead className="border-b border-line bg-panel-muted text-[10.5px] font-semibold uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="px-3 py-2.5">Product</th>
                <th className="px-3 py-2.5">Process</th>
                <th className="px-3 py-2.5 text-right">Progress</th>
                <th className="px-3 py-2.5">Plan</th>
              </tr>
            </thead>
            <tbody>
              {(evaluation?.stages ?? order.processes).map((step) => {
                const lineLabel =
                  "orderLine" in step && step.orderLine ? step.orderLine.product.name : "";
                const progress =
                  "cumulative" in step
                    ? `${step.cumulative} / ${step.plannedQuantity} (${step.percentComplete.toFixed(0)}%)`
                    : `planned ${step.plannedQuantity}`;
                const plan = [
                  "expectedDays" in step && step.expectedDays != null
                    ? `${step.expectedDays} expected day${step.expectedDays === 1 ? "" : "s"}`
                    : null,
                  "unitsPerDay" in step && step.unitsPerDay != null ? `${step.unitsPerDay}/day` : null,
                ]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <tr key={step.id} className="border-b border-line last:border-0">
                    <td className="px-3 py-2.5 text-ink">{lineLabel || "—"}</td>
                    <td className="px-3 py-2.5 text-ink">{"processName" in step ? step.processName : ""}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-ink-soft">{progress}</td>
                    <td className="px-3 py-2.5 text-ink-soft">{plan || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded border border-line bg-panel px-4 py-3 text-sm text-ink-soft">
        <span className="font-semibold text-ink">Special activities: </span>
        {order.specialActivitiesRequested
          ? requestedActivities.map((activity) => activity.name).join(", ") || "Yes"
          : "None requested"}
        <span className="ml-3 text-ink-faint">Stored lifecycle: {order.lifecycleStatus}</span>
      </section>

      <section className="overflow-hidden rounded border border-line bg-panel">
        <div className="border-b border-line px-4 py-3">
          <h2 className="text-[13px] font-semibold text-ink">Production history</h2>
        </div>
        {order.productionEntries.length === 0 ? (
          <p className="p-4 text-sm text-ink-faint">No production entries yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-[13px]">
              <thead className="border-b border-line bg-panel-muted text-[10.5px] font-semibold uppercase tracking-wide text-ink-soft">
                <tr>
                  <th className="px-3 py-2.5">Date</th>
                  <th className="px-3 py-2.5">Product</th>
                  <th className="px-3 py-2.5">Stage</th>
                  <th className="px-3 py-2.5">Special activity</th>
                  <th className="px-3 py-2.5 text-right">Qty</th>
                  {allMaterials.length > 0 ? <th className="px-3 py-2.5">Material used</th> : null}
                  <th className="px-3 py-2.5">User</th>
                </tr>
              </thead>
              <tbody>
                {order.productionEntries.map((entry) => (
                  <tr key={entry.id} className="border-b border-line last:border-0">
                    <td className="px-3 py-2.5 font-mono text-ink-soft">{formatDateOnly(entry.entryDate)}</td>
                    <td className="px-3 py-2.5 text-ink">{entry.orderProcess.orderLine?.product.name ?? "—"}</td>
                    <td className="px-3 py-2.5 text-ink">{entry.orderProcess.processName}</td>
                    <td className="px-3 py-2.5 text-ink-soft">{entry.specialActivity?.name ?? "—"}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-ink">{entry.quantity}</td>
                    {allMaterials.length > 0 ? (
                      <td className="px-3 py-2.5 text-ink-soft">
                        {entry.materialUsages.length > 0
                          ? entry.materialUsages
                              .map((mu) => `${mu.material.name}: ${mu.quantityUsed}`)
                              .join(", ")
                          : "—"}
                      </td>
                    ) : null}
                    <td className="px-3 py-2.5 text-ink-soft">{entry.createdBy.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {canRecordProduction(context.role) ? (
        <section className="space-y-4 rounded border border-line bg-panel p-4">
          <h2 className="text-[13px] font-semibold text-ink">Add incremental production</h2>
          <ProductionEntryForm
            defaultOrderId={order.id}
            orders={[{ id: order.id, orderNumber: order.orderNumber }]}
            linesByOrder={buildEntryLinesByOrder([
              {
                id: order.id,
                lines: order.lines.map((line) => ({
                  ...line,
                  processes: order.processes.filter((process) => process.productionOrderLineId === line.id),
                })),
              },
            ])}
            activitiesByOrder={{
              [order.id]: requestedActivities.map((activity) => ({
                value: `activity:${activity.id}`,
                label: activity.name,
              })),
            }}
            materialsByOrder={buildMaterialsByOrder([
              {
                id: order.id,
                materials: allMaterials.map((m) => ({
                  id: m.id,
                  name: m.name,
                  totalQuantity: m.totalQuantity,
                })),
              },
            ])}
            showBackToList={false}
          />
          <h2 className="text-[13px] font-semibold text-ink">Special activity / rework (legacy form)</h2>
          <p className="text-[11px] text-ink-faint">
            Prefer the combined stage dropdown above. This form remains for related-stage rework notes.
          </p>
          <SpecialActivityEntryForm
            orderId={order.id}
            activities={requestedActivities}
            processes={order.processes.map((process) => ({
              id: process.id,
              label: `${process.orderLine.product.name} · ${process.processName}`,
            }))}
          />
        </section>
      ) : null}

      {order.specialActivityEntries.length > 0 ? (
        <section className="rounded border border-line bg-panel px-4 py-3">
          <h2 className="text-[13px] font-semibold text-ink">Special activity history</h2>
          <ul className="mt-2 space-y-1 text-sm text-ink-soft">
            {order.specialActivityEntries.map((entry) => (
              <li key={entry.id}>
                {formatDateOnly(entry.entryDate)} · {entry.specialActivity.name} · {entry.quantity} · {entry.createdBy.name}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="rounded border border-line bg-panel px-4 py-4">
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
