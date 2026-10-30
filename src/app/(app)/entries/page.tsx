import type { Metadata } from "next";
import Link from "next/link";
import { requireTenantContext } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { loadPlantScope } from "@/lib/plants/access";
import { canRecordProduction, plantIdsForQuery } from "@/lib/plants/scope";
import { formatDateOnly, parseOptionalDateOnly } from "@/lib/orders/date-rules";
import { parseEntryListSort, sortEntryListRows } from "@/lib/production/entry-list";
import { toPageParams } from "@/lib/pagination";
import { Pager } from "@/components/ui/pager";
import { SavedBanner } from "@/components/ui/saved-banner";

export const metadata: Metadata = { title: "Production entries" };

export default async function EntriesPage({
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
  const { scope } = await loadPlantScope(context);
  const plantFilter = plantIdsForQuery(scope);
  const { page, pageSize, skip } = toPageParams({ page: params.page });
  const from = parseOptionalDateOnly(get("from"));
  const to = parseOptionalDateOnly(get("to"));
  const orderId = get("orderId") || undefined;
  const sort = parseEntryListSort(get("sort"));

  if (plantFilter && plantFilter.length === 0) {
    return <p className="text-sm text-slate-400">No plant access.</p>;
  }

  const where = {
    organizationId: context.organizationId,
    ...(plantFilter ? { plantId: { in: plantFilter } } : {}),
    ...(orderId ? { productionOrderId: orderId } : {}),
    ...(from || to
      ? {
          entryDate: {
            ...(from ? { gte: from } : {}),
            ...(to ? { lte: to } : {}),
          },
        }
      : {}),
  };

  const currentQuery = {
    from: get("from"),
    to: get("to"),
    orderId,
    sort: sort === "process" ? "process" : undefined,
  };
  const canEdit = canRecordProduction(context.role);

  const [totalCount, orderOptions, matchedEntries, dispatchEntries] = await Promise.all([
    prisma.productionEntry.count({ where }),
    prisma.productionOrder.findMany({
      where: {
        organizationId: context.organizationId,
        ...(plantFilter ? { plantId: { in: plantFilter } } : {}),
      },
      select: { id: true, orderNumber: true, clientWorkOrderNumber: true },
      orderBy: { createdAt: "desc" },
      take: 300,
    }),
    sort === "process"
      ? prisma.productionEntry.findMany({
          where,
          select: {
            id: true,
            entryDate: true,
            createdAt: true,
            quantity: true,
            productionOrderId: true,
            productionOrder: { select: { orderNumber: true, clientWorkOrderNumber: true } },
            orderProcess: { select: { processName: true, sequence: true } },
            createdBy: { select: { name: true } },
          },
          take: 2000,
        })
      : prisma.productionEntry.findMany({
          where,
          select: {
            id: true,
            entryDate: true,
            createdAt: true,
            quantity: true,
            productionOrderId: true,
            productionOrder: { select: { orderNumber: true, clientWorkOrderNumber: true } },
            orderProcess: { select: { processName: true, sequence: true } },
            createdBy: { select: { name: true } },
          },
          orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }],
          skip,
          take: pageSize,
        }),
    prisma.dispatchEntry.findMany({
      where,
      select: {
        id: true,
        entryDate: true,
        quantity: true,
        productionOrder: { select: { orderNumber: true } },
        orderLine: { select: { product: { select: { name: true } } } },
        createdBy: { select: { name: true } },
      },
      orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }],
      take: pageSize,
    }),
  ]);

  const sorted =
    sort === "process"
      ? sortEntryListRows(
          matchedEntries.map((entry) => ({
            id: entry.id,
            entryDate: entry.entryDate,
            createdAt: entry.createdAt,
            quantity: entry.quantity,
            productionOrderId: entry.productionOrderId,
            orderNumber: entry.productionOrder.orderNumber,
            clientWorkOrderNumber: entry.productionOrder.clientWorkOrderNumber,
            processName: entry.orderProcess.processName,
            sequence: entry.orderProcess.sequence,
            createdByName: entry.createdBy.name,
          })),
          "process",
        )
      : matchedEntries.map((entry) => ({
          id: entry.id,
          entryDate: entry.entryDate,
          createdAt: entry.createdAt,
          quantity: entry.quantity,
          productionOrderId: entry.productionOrderId,
          orderNumber: entry.productionOrder.orderNumber,
          clientWorkOrderNumber: entry.productionOrder.clientWorkOrderNumber,
          processName: entry.orderProcess.processName,
          sequence: entry.orderProcess.sequence,
          createdByName: entry.createdBy.name,
        }));

  const paged = sort === "process" ? sorted.slice(skip, skip + pageSize) : sorted;
  const listTotal = sort === "process" ? sorted.length : totalCount;

  const groups: { orderId: string; orderNumber: string; clientWorkOrderNumber: string | null; rows: typeof paged }[] = [];
  if (sort === "process") {
    for (const row of paged) {
      const last = groups[groups.length - 1];
      if (last && last.orderId === row.productionOrderId) {
        last.rows.push(row);
      } else {
        groups.push({
          orderId: row.productionOrderId,
          orderNumber: row.orderNumber,
          clientWorkOrderNumber: row.clientWorkOrderNumber,
          rows: [row],
        });
      }
    }
  }

  return (
    <main className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-white">Production entries</h1>
        {canEdit ? (
          <Link className="text-sm text-sky-400" href="/entries/new">
            New entry
          </Link>
        ) : null}
      </div>
      <SavedBanner message={get("saved")} />
      <form className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-800 p-3" method="get">
        <label className="text-xs text-slate-400">
          Order
          <select
            name="orderId"
            defaultValue={orderId ?? ""}
            className="mt-1 block rounded-md border border-slate-600 bg-slate-900 px-2 py-2 text-sm text-white"
          >
            <option value="">All orders</option>
            {orderOptions.map((order) => (
              <option key={order.id} value={order.id}>
                {order.orderNumber}
                {order.clientWorkOrderNumber ? ` · ${order.clientWorkOrderNumber}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-400">
          From
          <input
            type="date"
            name="from"
            defaultValue={get("from") ?? ""}
            className="mt-1 block rounded-md border border-slate-600 bg-slate-900 px-2 py-2 text-sm text-white"
          />
        </label>
        <label className="text-xs text-slate-400">
          To
          <input
            type="date"
            name="to"
            defaultValue={get("to") ?? ""}
            className="mt-1 block rounded-md border border-slate-600 bg-slate-900 px-2 py-2 text-sm text-white"
          />
        </label>
        <label className="text-xs text-slate-400">
          Sort
          <select
            name="sort"
            defaultValue={sort}
            className="mt-1 block rounded-md border border-slate-600 bg-slate-900 px-2 py-2 text-sm text-white"
          >
            <option value="date">Date (newest first)</option>
            <option value="process">Process stage (last process first)</option>
          </select>
        </label>
        <button type="submit" className="rounded-md bg-sky-600 px-3 py-2 text-sm text-white">
          Filter
        </button>
      </form>
      <p className="text-xs text-slate-500">
        Filter by order and date. Date sort is the default. Process sort groups by order, last stage first, then date
        within the same stage.
      </p>
      <table className="w-full text-left text-sm">
        <thead className="text-slate-400">
          <tr>
            <th className="p-2">Date</th>
            <th className="p-2">Our order</th>
            <th className="p-2">Client WO</th>
            <th className="p-2">Stage</th>
            <th className="p-2">Qty</th>
            <th className="p-2">User</th>
            <th className="p-2"></th>
          </tr>
        </thead>
        <tbody>
          {sort === "process"
            ? groups.flatMap((group) => [
                <tr key={`g-${group.orderId}-${group.rows[0]?.id}`} className="border-t border-slate-800 bg-slate-900/60">
                  <td className="p-2 text-xs font-semibold text-slate-300" colSpan={7}>
                    {group.orderNumber}
                    {group.clientWorkOrderNumber ? ` · Client WO ${group.clientWorkOrderNumber}` : ""}
                  </td>
                </tr>,
                ...group.rows.map((entry) => (
                  <tr key={entry.id} className="border-t border-slate-800 text-slate-200">
                    <td className="p-2">{formatDateOnly(entry.entryDate)}</td>
                    <td className="p-2">{entry.orderNumber}</td>
                    <td className="p-2">{entry.clientWorkOrderNumber ?? "—"}</td>
                    <td className="p-2">{entry.processName}</td>
                    <td className="p-2">{entry.quantity}</td>
                    <td className="p-2">{entry.createdByName}</td>
                    <td className="p-2">
                      {canEdit ? (
                        <Link className="text-sky-400" href={`/entries/${entry.id}/edit`}>
                          Edit
                        </Link>
                      ) : null}
                    </td>
                  </tr>
                )),
              ])
            : paged.map((entry) => (
                <tr key={entry.id} className="border-t border-slate-800 text-slate-200">
                  <td className="p-2">{formatDateOnly(entry.entryDate)}</td>
                  <td className="p-2">{entry.orderNumber}</td>
                  <td className="p-2">{entry.clientWorkOrderNumber ?? "—"}</td>
                  <td className="p-2">{entry.processName}</td>
                  <td className="p-2">{entry.quantity}</td>
                  <td className="p-2">{entry.createdByName}</td>
                  <td className="p-2">
                    {canEdit ? (
                      <Link className="text-sky-400" href={`/entries/${entry.id}/edit`}>
                        Edit
                      </Link>
                    ) : null}
                  </td>
                </tr>
              ))}
        </tbody>
      </table>
      <Pager
        basePath="/entries"
        page={page}
        pageSize={pageSize}
        totalCount={listTotal}
        currentQuery={currentQuery}
      />
      <h2 className="pt-4 text-lg font-semibold text-white">Dispatch entries</h2>
      {dispatchEntries.length === 0 ? (
        <p className="text-sm text-slate-400">No dispatch recorded in this date range.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="text-slate-400">
            <tr>
              <th className="p-2">Date</th>
              <th className="p-2">Order</th>
              <th className="p-2">Scope</th>
              <th className="p-2">Qty</th>
              <th className="p-2">User</th>
            </tr>
          </thead>
          <tbody>
            {dispatchEntries.map((entry) => (
              <tr key={entry.id} className="border-t border-slate-800 text-slate-200">
                <td className="p-2">{formatDateOnly(entry.entryDate)}</td>
                <td className="p-2">{entry.productionOrder.orderNumber}</td>
                <td className="p-2">{entry.orderLine?.product.name ?? "Entire order"}</td>
                <td className="p-2">{entry.quantity}</td>
                <td className="p-2">{entry.createdBy.name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
