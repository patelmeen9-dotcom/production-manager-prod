export type EntryListSort = "date" | "process";

export type EntryListRow = {
  id: string;
  entryDate: Date;
  createdAt: Date;
  quantity: number;
  productionOrderId: string;
  orderNumber: string;
  clientWorkOrderNumber: string | null;
  processName: string;
  sequence: number;
  createdByName: string;
};

export function parseEntryListSort(value: string | undefined): EntryListSort {
  return value === "process" ? "process" : "date";
}

export function sortEntryListRows(rows: EntryListRow[], sort: EntryListSort): EntryListRow[] {
  if (sort === "date") {
    return [...rows].sort((a, b) => {
      const date = b.entryDate.getTime() - a.entryDate.getTime();
      if (date !== 0) {
        return date;
      }
      return b.createdAt.getTime() - a.createdAt.getTime();
    });
  }

  const groupLatest = new Map<string, number>();
  for (const row of rows) {
    const stamp = row.entryDate.getTime();
    groupLatest.set(row.productionOrderId, Math.max(groupLatest.get(row.productionOrderId) ?? 0, stamp));
  }

  return [...rows].sort((a, b) => {
    const group = (groupLatest.get(b.productionOrderId) ?? 0) - (groupLatest.get(a.productionOrderId) ?? 0);
    if (group !== 0) {
      return group;
    }
    const order = a.orderNumber.localeCompare(b.orderNumber);
    if (a.productionOrderId !== b.productionOrderId && order !== 0) {
      return order;
    }
    const sequence = b.sequence - a.sequence;
    if (sequence !== 0) {
      return sequence;
    }
    const date = b.entryDate.getTime() - a.entryDate.getTime();
    if (date !== 0) {
      return date;
    }
    return b.createdAt.getTime() - a.createdAt.getTime();
  });
}
