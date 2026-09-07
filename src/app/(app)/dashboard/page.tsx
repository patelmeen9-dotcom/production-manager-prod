import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Clock, Factory, Package, TrendingUp } from "lucide-react";
import { requireTenantContext } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { loadPlantScope } from "@/lib/plants/access";
import { plantIdsForQuery } from "@/lib/plants/scope";
import { addUtcDays, formatDateOnly, parseDateOnly } from "@/lib/orders/date-rules";
import { formatOrderLineLabel } from "@/lib/orders/line-label";
import { parseOrganizationSettings } from "@/lib/organization-settings";
import {
  aggregateMaterialRisk,
  aggregateProcessBottlenecks,
  buildClientOrderVolumeTable,
  buildDailyProductionTrend,
  countOrderStatuses,
  evaluateOrderTower,
  formatVolumeCell,
  ORDER_TOWER_SEVERITY,
  orderTowerStatusLabel,
  type DatedEntry,
  type OrderTowerState,
} from "@/lib/dashboard/control-tower";
import {
  buildDashboardQuery,
  matchesTowerStatusGroup,
  parseStatusGroup,
  type StatusGroup,
} from "@/lib/dashboard/status-groups";
import { BottleneckChart, DailyTrendChart } from "@/components/dashboard/charts";
import { LiveTrackingTable, type LiveOrderRow } from "@/components/dashboard/live-tracking";

export const metadata: Metadata = { title: "Production Control Tower" };

function todayUtc() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function KpiCard(props: {
  label: string;
  value: number;
  sub: string;
  tone: "delayed" | "warn" | "good" | "neutral" | "accent";
  href: string;
  active: boolean;
  viewAllHref: string;
  icon: React.ReactNode;
}) {
  const toneBorder = {
    delayed: "border-l-delayed",
    warn: "border-l-warn",
    good: "border-l-on-time",
    neutral: "border-l-line-strong",
    accent: "border-l-accent",
  }[props.tone];

  return (
    <div
      className={`min-w-[140px] flex-1 rounded border border-line border-l-[3px] bg-panel p-4 ${toneBorder} ${props.active ? "ring-2 ring-ring" : ""
        }`}
    >
      <Link href={props.href} className="block">
        <div className="mb-2 flex items-start justify-between gap-2">
          <p className="text-xs font-medium text-ink-soft">{props.label}</p>
          <span className="text-ink-soft">{props.icon}</span>
        </div>
        <p className="font-mono text-[28px] font-semibold leading-none text-ink">{props.value}</p>
        <p className="mt-1.5 text-[11.5px] text-ink-soft">{props.sub}</p>
        <p className="mt-2 text-[11px] text-accent">{props.active ? "Click to clear filter" : "Filter live tracking"}</p>
      </Link>
      <Link href={props.viewAllHref} className="mt-2 inline-block text-[11px] font-medium text-accent hover:underline">
        View all →
      </Link>
    </div>
  );
}

function toLiveRow(order: OrderTowerState): LiveOrderRow {
  return {
    id: order.orderId,
    orderNumber: order.orderNumber,
    clientName: order.clientName,
    productName: order.lines.map((line) => line.productName).join(", ") || "—",
    plantName: order.plantName,
    quantity: order.quantity,
    completedQuantity: order.completedQuantity,
    remainingQuantity: order.remainingQuantity,
    progressPercent: order.progressPercent,
    currentStageName: order.currentProcessName,
    dueDate: formatDateOnly(order.dueDate),
    daysToDue: order.daysToDue,
    expectedCompletion: order.projectedCompletionDate
      ? formatDateOnly(order.projectedCompletionDate)
      : null,
    status: order.orderStatus,
    materialRisk: order.materialRisk,
    lines: order.lines.map((line) => ({
      lineId: line.lineId,
      productName: line.productName,
      quantity: line.quantity,
      progressPercent: line.progressPercent,
      processes: line.processes.map((process) => ({
        processName: process.processName,
        processCode: process.processCode,
        cumulative: process.cumulative,
        required: process.requiredQuantity,
        remaining: process.remaining,
        sitting: process.sitting,
        startDate: process.startDate ? formatDateOnly(process.startDate) : null,
        expectedEnd: process.expectedCompletionDate ? formatDateOnly(process.expectedCompletionDate) : null,
        actualEnd: process.actualCompletionDate ? formatDateOnly(process.actualCompletionDate) : null,
        status: process.status,
      })),
    })),
  };
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireTenantContext();
  const params = await searchParams;
  const get = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const { scope, plants } = await loadPlantScope(context);
  const scopedPlantIds = plantIdsForQuery(scope);
  if (scopedPlantIds && scopedPlantIds.length === 0) {
    return <p className="text-sm text-ink-soft">No plant access is assigned to this user.</p>;
  }

  const requestedPlant = get("plantId");
  const plantIds =
    requestedPlant && (!scopedPlantIds || scopedPlantIds.includes(requestedPlant))
      ? [requestedPlant]
      : scopedPlantIds;

  const clientId = get("clientId") || undefined;
  const productId = get("productId") || undefined;
  const orderId = get("orderId") || undefined;
  const statusGroup = parseStatusGroup(get("statusGroup"));
  const asOf = todayUtc();
  const from = get("from") ? parseDateOnly(get("from")!) : addUtcDays(asOf, -6);
  const to = get("to") ? parseDateOnly(get("to")!) : asOf;

  const currentQuery: Record<string, string | undefined> = {
    plantId: requestedPlant,
    clientId,
    productId,
    orderId,
    from: formatDateOnly(from),
    to: formatDateOnly(to),
    statusGroup: statusGroup && statusGroup !== "total" ? statusGroup : undefined,
  };

  const [clients, products, orders, organization] = await Promise.all([
    prisma.client.findMany({
      where: { organizationId: context.organizationId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.product.findMany({
      where: { organizationId: context.organizationId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.productionOrder.findMany({
      where: {
        organizationId: context.organizationId,
        ...(plantIds ? { plantId: { in: plantIds } } : {}),
        ...(clientId ? { clientId } : {}),
        ...(productId ? { lines: { some: { productId } } } : {}),
        ...(orderId ? { id: orderId } : {}),
      },
      select: {
        id: true,
        orderNumber: true,
        quantity: true,
        orderDate: true,
        effectiveStartDate: true,
        resolvedDueDate: true,
        lifecycleStatus: true,
        client: { select: { name: true } },
        plant: { select: { name: true } },
        lines: {
          select: {
            id: true,
            lineNumber: true,
            quantity: true,
            product: { select: { name: true } },
            categorySelections: {
              select: {
                textValue: true,
                productCategory: { select: { name: true } },
                selectedOptions: {
                  select: { categoryOption: { select: { name: true } } },
                },
              },
            },
            materials: {
              select: {
                name: true,
                quantityPerUnit: true,
                quantityReceived: true,
                stages: { select: { orderProcessId: true } },
              },
            },
          },
          orderBy: { lineNumber: "asc" },
        },
        processes: {
          select: {
            id: true,
            sequence: true,
            processName: true,
            processCode: true,
            plannedQuantity: true,
            expectedDays: true,
            processId: true,
            productionOrderLineId: true,
          },
          orderBy: [{ productionOrderLineId: "asc" }, { sequence: "asc" }],
        },
      },
      orderBy: { resolvedDueDate: "asc" },
      take: 200,
    }),
    prisma.organization.findFirst({
      where: { id: context.organizationId },
      select: { name: true, settings: true },
    }),
  ]);

  const settings = parseOrganizationSettings(organization?.settings);
  const orderIds = orders.map((order) => order.id);

  const [entries, masterProcesses] = await Promise.all([
    orderIds.length === 0
      ? Promise.resolve([])
      : prisma.productionEntry.findMany({
        where: { organizationId: context.organizationId, productionOrderId: { in: orderIds } },
        select: {
          productionOrderId: true,
          orderProcessId: true,
          quantity: true,
          entryDate: true,
        },
        orderBy: [{ entryDate: "asc" }, { createdAt: "asc" }],
      }),
    prisma.process.findMany({
      where: { organizationId: context.organizationId },
      select: { id: true, unitsPerDay: true },
    }),
  ]);

  const unitsByProcessId = new Map(masterProcesses.map((process) => [process.id, process.unitsPerDay]));
  const entriesByOrder = new Map<string, DatedEntry[]>();
  for (const entry of entries) {
    const list = entriesByOrder.get(entry.productionOrderId) ?? [];
    list.push({
      orderProcessId: entry.orderProcessId,
      quantity: entry.quantity,
      entryDate: entry.entryDate,
    });
    entriesByOrder.set(entry.productionOrderId, list);
  }

  const towerOrders: OrderTowerState[] = orders.map((order) => {
    const processesByLine = new Map<string, typeof order.processes>();
    for (const process of order.processes) {
      const lineId = process.productionOrderLineId;
      const list = processesByLine.get(lineId) ?? [];
      list.push(process);
      processesByLine.set(lineId, list);
    }

    return evaluateOrderTower({
      orderId: order.id,
      orderNumber: order.orderNumber,
      clientName: order.client.name,
      plantName: order.plant.name,
      quantity: order.quantity,
      dueDate: order.resolvedDueDate,
      effectiveStartDate: order.effectiveStartDate,
      lifecycleStatus: order.lifecycleStatus,
      asOfDate: asOf,
      gettingDelayedLeadDays: settings.gettingDelayedLeadDays,
      lines: order.lines.map((line) => ({
        lineId: line.id,
        productName: formatOrderLineLabel(line),
        quantity: line.quantity,
        processes: (processesByLine.get(line.id) ?? []).map((process) => ({
          id: process.id,
          sequence: process.sequence,
          processName: process.processName,
          processCode: process.processCode,
          plannedQuantity: process.plannedQuantity,
          expectedDays: process.expectedDays,
          unitsPerDay: process.processId ? (unitsByProcessId.get(process.processId) ?? null) : null,
        })),
        materials: line.materials.map((material) => ({
          name: material.name,
          quantityPerUnit: material.quantityPerUnit,
          quantityReceived: material.quantityReceived,
          orderProcessIds: material.stages.map((stage) => stage.orderProcessId),
        })),
      })),
      entries: entriesByOrder.get(order.id) ?? [],
    });
  });

  const kpiCounts = countOrderStatuses(towerOrders);
  const bottlenecks = aggregateProcessBottlenecks(towerOrders);
  const materialRisks = aggregateMaterialRisk(towerOrders);
  const clientVolume = buildClientOrderVolumeTable({
    from,
    to,
    orders: orders.map((order) => ({
      clientName: order.client.name,
      orderDate: order.orderDate,
      quantity: order.quantity,
    })),
  });

  const processIdToMeta = new Map(
    towerOrders.flatMap((order) =>
      order.lines.flatMap((line) =>
        line.processes.map((process) => [
          process.orderProcessId,
          { processCode: process.processCode, processName: process.processName },
        ] as const),
      ),
    ),
  );

  const processWindows = towerOrders.flatMap((order) =>
    order.lines.flatMap((line) =>
      line.processes
        .filter(
          (process) =>
            process.status !== "NOT_APPLICABLE" &&
            process.startDate &&
            process.expectedDays != null &&
            process.expectedDays > 0,
        )
        .map((process) => ({
          processCode: process.processCode,
          processName: process.processName,
          startDate: process.startDate!,
          expectedDays: process.expectedDays!,
          unitsPerDay: process.unitsPerDay,
          requiredQuantity: process.requiredQuantity,
        })),
    ),
  );

  const trendEntries = entries
    .filter((entry) => entry.entryDate >= from && entry.entryDate <= to)
    .map((entry) => {
      const meta = processIdToMeta.get(entry.orderProcessId);
      return {
        processCode: meta?.processCode ?? "UNKNOWN",
        quantity: entry.quantity,
        entryDate: entry.entryDate,
      };
    });
  const dailyTrend = buildDailyProductionTrend({
    from,
    to,
    entries: trendEntries,
    processWindows,
  });

  const attentionOrders = towerOrders
    .filter(
      (order) =>
        order.orderStatus === "DELAYED" ||
        order.orderStatus === "AT_RISK" ||
        order.materialRisk,
    )
    .sort((a, b) => {
      const materialBoost = (order: OrderTowerState) => (order.materialRisk ? -0.5 : 0);
      const severity =
        ORDER_TOWER_SEVERITY[a.orderStatus] +
        materialBoost(a) -
        (ORDER_TOWER_SEVERITY[b.orderStatus] + materialBoost(b));
      if (severity !== 0) {
        return severity;
      }
      return a.dueDate.getTime() - b.dueDate.getTime();
    });

  const live = towerOrders
    .filter((order) => matchesTowerStatusGroup(order.orderStatus, statusGroup))
    .sort((a, b) => {
      const severity = ORDER_TOWER_SEVERITY[a.orderStatus] - ORDER_TOWER_SEVERITY[b.orderStatus];
      if (severity !== 0) {
        return severity;
      }
      return a.dueDate.getTime() - b.dueDate.getTime();
    });

  const liveRows = live.map(toLiveRow);

  function kpiHref(group: StatusGroup) {
    const next = statusGroup === group ? null : group === "total" ? null : group;
    return `/dashboard${buildDashboardQuery(currentQuery, { statusGroup: next })}`;
  }

  const visiblePlants = plants.filter((plant) => !scopedPlantIds || scopedPlantIds.includes(plant.id));
  const selectClass =
    "rounded-md border border-line-strong bg-input px-2.5 py-2 text-[12.5px] text-ink outline-none focus:ring-2 focus:ring-ring";

  return (
    <main className="mx-auto max-w-6xl space-y-5 pb-12">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11.5px] font-medium text-ink-soft">{organization?.name ?? "Organization"}</p>
          <h1 className="text-[22px] font-bold tracking-tight text-ink">Production Control Tower</h1>
          <p className="mt-1 text-[12px] text-ink-soft">
            Operational view of schedule risk, process bottlenecks, WIP, and material shortages.
          </p>
        </div>
        <p className="font-mono text-[11.5px] text-ink-soft">{formatDateOnly(asOf)}</p>
      </div>

      <section className="flex flex-wrap gap-2.5">
        <KpiCard
          label="Total Orders"
          value={kpiCounts.total}
          sub="in current filter"
          tone="accent"
          icon={<TrendingUp size={15} />}
          href={kpiHref("total")}
          active={!statusGroup || statusGroup === "total"}
          viewAllHref="/orders"
        />
        <KpiCard
          label="Not Started"
          value={kpiCounts.notStarted}
          sub="no production yet"
          tone="neutral"
          icon={<Factory size={15} />}
          href={kpiHref("not_started")}
          active={statusGroup === "not_started"}
          viewAllHref="/orders"
        />
        <KpiCard
          label="In Production"
          value={kpiCounts.inProduction}
          sub="on track vs due"
          tone="good"
          icon={<CheckCircle2 size={15} />}
          href={kpiHref("in_production")}
          active={statusGroup === "in_production" || statusGroup === "on_time"}
          viewAllHref="/orders"
        />
        <KpiCard
          label="At Risk"
          value={kpiCounts.atRisk}
          sub="likely to miss schedule"
          tone="warn"
          icon={<Clock size={15} />}
          href={kpiHref("getting_delayed")}
          active={statusGroup === "getting_delayed"}
          viewAllHref="/orders"
        />
        <KpiCard
          label="Delayed"
          value={kpiCounts.delayed}
          sub="past expected / due"
          tone="delayed"
          icon={<AlertTriangle size={15} />}
          href={kpiHref("delayed")}
          active={statusGroup === "delayed"}
          viewAllHref="/orders"
        />
        <KpiCard
          label="Completed"
          value={kpiCounts.completed}
          sub="all processes done"
          tone="neutral"
          icon={<CheckCircle2 size={15} />}
          href={kpiHref("completed")}
          active={statusGroup === "completed"}
          viewAllHref="/orders"
        />
      </section>

      <form className="grid gap-3 rounded border border-line bg-panel p-4 sm:grid-cols-4" method="get">
        {statusGroup ? <input type="hidden" name="statusGroup" value={statusGroup} /> : null}
        <select name="plantId" defaultValue={requestedPlant ?? ""} className={selectClass}>
          <option value="">All permitted plants</option>
          {visiblePlants.map((plant) => (
            <option key={plant.id} value={plant.id}>
              {plant.name}
            </option>
          ))}
        </select>
        <select name="clientId" defaultValue={clientId ?? ""} className={selectClass}>
          <option value="">All clients</option>
          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name}
            </option>
          ))}
        </select>
        <select name="productId" defaultValue={productId ?? ""} className={selectClass}>
          <option value="">All products</option>
          {products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.name}
            </option>
          ))}
        </select>
        <select name="orderId" defaultValue={orderId ?? ""} className={selectClass}>
          <option value="">All orders</option>
          {orders.map((order) => (
            <option key={order.id} value={order.id}>
              {order.orderNumber}
            </option>
          ))}
        </select>
        <input type="date" name="from" defaultValue={formatDateOnly(from)} className={selectClass} />
        <input type="date" name="to" defaultValue={formatDateOnly(to)} className={selectClass} />
        <button type="submit" className="rounded-md bg-sky-600 px-3 py-2 text-sm text-white hover:bg-sky-500">
          Apply filters
        </button>
      </form>

      <section className="grid gap-3 md:grid-cols-2">
        <div className="rounded border border-line bg-panel p-4">
          <h2 className="text-[13px] font-semibold text-ink">Client order volume</h2>
          <p className="mb-3 text-[11px] text-ink-soft">
            Orders by client using order date in {formatDateOnly(from)} → {formatDateOnly(to)}
            {clientVolume.columns.some((column) => column.kind === "week")
              ? " (weekly buckets)"
              : " (monthly buckets)"}
            . Cells show order count (total qty).
          </p>
          {clientVolume.rows.length === 0 ? (
            <p className="text-sm text-ink-faint">No orders with order date in this range.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-[12.5px]">
                <thead className="border-b border-line text-[10.5px] uppercase tracking-wide text-ink-soft">
                  <tr>
                    <th className="px-2 py-2 font-semibold">Client</th>
                    {clientVolume.columns.map((column) => (
                      <th key={column.key} className="px-2 py-2 text-right font-semibold">
                        {column.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {clientVolume.rows.map((row) => (
                    <tr key={row.clientName} className="border-b border-line">
                      <td className="px-2 py-2 text-ink">{row.clientName}</td>
                      {clientVolume.columns.map((column) => (
                        <td key={column.key} className="px-2 py-2 text-right font-mono text-ink-soft">
                          {formatVolumeCell(row.counts[column.key] ?? 0, row.quantities[column.key] ?? 0)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="rounded border border-line bg-panel p-4">
          <h2 className="text-[13px] font-semibold text-ink">Material risk</h2>
          <p className="mb-3 text-[11px] text-ink-soft">
            Separate from production delay — available &lt; required (received vs needed/used)
          </p>
          {materialRisks.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-ink-faint">
              <Package size={14} /> No material shortages in the current filter.
            </p>
          ) : (
            <ul className="space-y-2">
              {materialRisks.map((material) => (
                <li key={material.name} className="rounded border border-warn/40 bg-warn-bg/40 px-3 py-2 text-[12.5px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-ink">{material.name}</span>
                    <span className="font-mono text-warn">avail {material.available}</span>
                  </div>
                  <p className="mt-1 text-[11px] text-ink-soft">
                    Needed {material.totalNeeded} · received {material.quantityReceived} · used {material.used}
                  </p>
                  <p className="mt-1 text-[11px] text-ink">
                    Short on:{" "}
                    {material.shortOrders.map((order, index) => (
                      <span key={order.orderId}>
                        {index > 0 ? ", " : null}
                        <Link className="font-mono text-accent hover:underline" href={`/orders/${order.orderId}`}>
                          {order.orderNumber}
                        </Link>
                      </span>
                    ))}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        <div className="rounded border border-line bg-panel p-4">
          <h2 className="text-[13px] font-semibold text-ink">Production by process</h2>
          <p className="mb-2 text-[11px] text-ink-soft">
            Orders counted at every incomplete process; units waiting = previous cumulative − current
          </p>
          <BottleneckChart
            data={bottlenecks.map((row) => ({
              processName: row.processName,
              ordersAtProcess: row.ordersAtProcess,
              unitsSitting: row.unitsSitting,
            }))}
          />
        </div>
        <div className="rounded border border-line bg-panel p-4">
          <h2 className="text-[13px] font-semibold text-ink">Daily production trend</h2>
          <p className="mb-2 text-[11px] text-ink-soft">
            {formatDateOnly(from)} → {formatDateOnly(to)} — process-wise actual vs expected (solid = actual, dashed =
            expected)
          </p>
          <DailyTrendChart data={dailyTrend.points} processes={dailyTrend.processes} />
        </div>
      </section>

      <section className="overflow-hidden rounded border border-line bg-panel">
        <div className="border-b border-line px-4 py-3">
          <h2 className="text-[13px] font-semibold text-ink">Orders requiring attention</h2>
          <p className="text-[11px] text-ink-soft">At risk, delayed, and material-risk orders first</p>
        </div>
        {attentionOrders.length === 0 ? (
          <p className="p-4 text-sm text-ink-faint">No orders currently need attention.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-[12.5px]">
              <thead className="border-b border-line text-[10.5px] uppercase tracking-wide text-ink-soft">
                <tr>
                  <th className="px-3 py-2 font-semibold">Order</th>
                  <th className="px-3 py-2 font-semibold">Client</th>
                  <th className="px-3 py-2 font-semibold">Qty</th>
                  <th className="px-3 py-2 font-semibold">Prod %</th>
                  <th className="px-3 py-2 font-semibold">Due</th>
                  <th className="px-3 py-2 font-semibold">Days</th>
                  <th className="px-3 py-2 font-semibold">Process</th>
                  <th className="px-3 py-2 font-semibold">Schedule</th>
                  <th className="px-3 py-2 font-semibold">Material</th>
                </tr>
              </thead>
              <tbody>
                {attentionOrders.map((order) => (
                  <tr key={order.orderId} className="border-b border-line">
                    <td className="px-3 py-2">
                      <Link className="font-mono font-semibold text-accent hover:underline" href={`/orders/${order.orderId}`}>
                        {order.orderNumber}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-ink">{order.clientName}</td>
                    <td className="px-3 py-2 font-mono text-ink-soft">{order.quantity}</td>
                    <td className="px-3 py-2 font-mono text-ink-soft">{order.progressPercent.toFixed(0)}%</td>
                    <td className="px-3 py-2 font-mono text-ink-soft">{formatDateOnly(order.dueDate)}</td>
                    <td className="px-3 py-2 font-mono">
                      {order.daysToDue < 0 ? (
                        <span className="text-delayed">{Math.abs(order.daysToDue)}d over</span>
                      ) : (
                        <span className="text-ink-soft">{order.daysToDue}d left</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-ink-soft">{order.currentProcessName ?? "—"}</td>
                    <td className="px-3 py-2 font-medium text-ink">{orderTowerStatusLabel(order.orderStatus)}</td>
                    <td className="px-3 py-2">
                      {order.materialRisk ? (
                        <span className="font-medium text-warn">Short</span>
                      ) : (
                        <span className="text-ink-faint">OK</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded border border-line bg-panel">
        <div className="border-b border-line px-4 py-3">
          <h2 className="text-[13px] font-semibold text-ink">Live order tracking</h2>
          <p className="text-[11px] text-ink-soft">
            Expand an order for each product and process: progress, start, expected end, actual end, remaining, and
            status. Finished-goods % is last-stage units — not an average of process percentages.
          </p>
        </div>
        <LiveTrackingTable rows={liveRows} />
      </section>
    </main>
  );
}
