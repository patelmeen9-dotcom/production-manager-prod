import type { Metadata } from "next";
import Link from "next/link";
import { requireTenantContext } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { loadPlantScope } from "@/lib/plants/access";
import { canManageMasters, plantIdsForQuery } from "@/lib/plants/scope";
import { formatDateOnly } from "@/lib/orders/date-rules";
import {
  lifecycleListLabel,
  orderListDateFilter,
  orderListLifecycleFilter,
  parseOrderListDateField,
  parseOrderListStatus,
} from "@/lib/orders/list-filters";
import { toPageParams } from "@/lib/pagination";
import { Pager } from "@/components/ui/pager";
import { SavedBanner } from "@/components/ui/saved-banner";
import { ExportLink } from "@/components/orders/export-link";

export const metadata: Metadata = { title: "Orders" };

export default async function OrdersPage({
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
  const manage = canManageMasters(context.role);
  const { scope } = await loadPlantScope(context);
  const plantFilter = plantIdsForQuery(scope);
  const { page, pageSize, skip } = toPageParams({ page: params.page });
  const status = parseOrderListStatus(get("status"));
  const dateField = parseOrderListDateField(get("dateField"));
  const from = get("from") ?? "";
  const to = get("to") ?? "";

  if (plantFilter && plantFilter.length === 0) {
    return (
      <main className="mx-auto max-w-6xl space-y-4">
        <h1 className="text-[22px] font-bold tracking-tight text-ink">Production orders</h1>
        <p className="text-sm text-ink-soft">No plant access is assigned to this user.</p>
      </main>
    );
  }

  const where = {
    organizationId: context.organizationId,
    ...(plantFilter ? { plantId: { in: plantFilter } } : {}),
    ...orderListLifecycleFilter(status),
    ...orderListDateFilter({ field: dateField, from: from || undefined, to: to || undefined }),
  };

  const currentQuery = {
    status,
    dateField: dateField !== "orderDate" ? dateField : undefined,
    from: from || undefined,
    to: to || undefined,
  };

  const [totalCount, orders] = await Promise.all([
    prisma.productionOrder.count({ where }),
    prisma.productionOrder.findMany({
      where,
      select: {
        id: true,
        orderNumber: true,
        clientWorkOrderNumber: true,
        quantity: true,
        orderDate: true,
        productionDate: true,
        dispatchDate: true,
        resolvedDueDate: true,
        lifecycleStatus: true,
        client: { select: { name: true } },
        product: { select: { name: true } },
        plant: { select: { name: true } },
        lines: {
          select: {
            quantity: true,
            product: { select: { name: true } },
          },
          orderBy: { lineNumber: "asc" },
        },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
    }),
  ]);

  const selectClass =
    "rounded-md border border-line-strong bg-input px-2.5 py-2 text-[12.5px] text-ink outline-none focus:ring-2 focus:ring-ring";

  return (
    <main className="mx-auto max-w-6xl space-y-4 pb-12">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight text-ink">Production orders</h1>
          <p className="text-[12px] text-ink-soft">{totalCount} order{totalCount === 1 ? "" : "s"} in current filter</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ExportLink href="/api/orders/export" label="Export orders" />
          {manage ? (
            <Link
              className="inline-flex items-center rounded-md bg-sky-600 px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-sky-500"
              href="/orders/new"
            >
              New order
            </Link>
          ) : null}
        </div>
      </div>
      <SavedBanner message={params.saved} />

      <form className="grid gap-3 rounded border border-line bg-panel p-4 sm:grid-cols-2 lg:grid-cols-6" method="get">
        <select name="status" defaultValue={status ?? ""} className={selectClass}>
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="in_production">In production</option>
          <option value="completed">Completed</option>
        </select>
        <select name="dateField" defaultValue={dateField} className={selectClass}>
          <option value="orderDate">Order date</option>
          <option value="productionDate">Production date</option>
          <option value="dispatchDate">Dispatch date</option>
          <option value="dueDate">Due date</option>
        </select>
        <label className="text-[11px] text-ink-soft">
          From
          <input type="date" name="from" defaultValue={from} className={`mt-1 block w-full ${selectClass}`} />
        </label>
        <label className="text-[11px] text-ink-soft">
          To
          <input type="date" name="to" defaultValue={to} className={`mt-1 block w-full ${selectClass}`} />
        </label>
        <button type="submit" className="self-end rounded-md bg-sky-600 px-3 py-2 text-[12.5px] font-medium text-white hover:bg-sky-500">
          Apply filters
        </button>
        <Link href="/orders" className="self-end text-[12.5px] text-accent hover:underline">
          Clear
        </Link>
      </form>

      <section className="overflow-hidden rounded border border-line bg-panel">
        {orders.length === 0 ? (
          <p className="p-4 text-sm text-ink-faint">No orders match the current filters.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-[13px]">
              <thead className="border-b border-line bg-panel-muted text-[10.5px] font-semibold uppercase tracking-wide text-ink-soft">
                <tr>
                  <th className="px-3 py-2.5">Our order</th>
                  <th className="px-3 py-2.5">Client WO</th>
                  <th className="px-3 py-2.5">Client</th>
                  <th className="px-3 py-2.5">Plant</th>
                  <th className="px-3 py-2.5">Products</th>
                  <th className="px-3 py-2.5 text-right">Qty</th>
                  <th className="px-3 py-2.5">Order date</th>
                  <th className="px-3 py-2.5">Production</th>
                  <th className="px-3 py-2.5">Dispatch</th>
                  <th className="px-3 py-2.5">Due</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id} className="border-b border-line last:border-0 hover:bg-panel-muted/60">
                    <td className="px-3 py-2.5">
                      <Link className="font-mono font-semibold text-accent hover:underline" href={`/orders/${order.id}`}>
                        {order.orderNumber}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-ink-soft">{order.clientWorkOrderNumber ?? "—"}</td>
                    <td className="px-3 py-2.5 text-ink">{order.client.name}</td>
                    <td className="px-3 py-2.5 text-ink-soft">{order.plant.name}</td>
                    <td className="max-w-[280px] truncate px-3 py-2.5 text-ink-soft">
                      {order.lines.length > 0
                        ? order.lines.map((line) => `${line.product.name}×${line.quantity}`).join(", ")
                        : order.product.name}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-ink">{order.quantity}</td>
                    <td className="px-3 py-2.5 font-mono text-ink-soft">{formatDateOnly(order.orderDate)}</td>
                    <td className="px-3 py-2.5 font-mono text-ink-soft">
                      {order.productionDate ? formatDateOnly(order.productionDate) : "—"}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-ink-soft">
                      {order.dispatchDate ? formatDateOnly(order.dispatchDate) : "—"}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-ink-soft">{formatDateOnly(order.resolvedDueDate)}</td>
                    <td className="px-3 py-2.5">
                      <span className="rounded bg-panel-muted px-2 py-0.5 text-[11.5px] text-ink-soft">
                        {lifecycleListLabel(order.lifecycleStatus)}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="flex justify-end gap-3">
                        {manage ? (
                          <Link className="text-[12.5px] text-accent hover:underline" href={`/orders/${order.id}/edit`}>
                            Edit
                          </Link>
                        ) : null}
                        <Link className="text-[12.5px] text-accent hover:underline" href={`/orders/${order.id}`}>
                          View
                        </Link>
                        <Link
                          className="text-[12.5px] text-accent hover:underline"
                          href={`/api/orders/${order.id}/export`}
                        >
                          Export
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <Pager basePath="/orders" page={page} pageSize={pageSize} totalCount={totalCount} currentQuery={currentQuery} />
    </main>
  );
}
