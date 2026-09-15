import { buildLineTable, type LineForTable } from "@/lib/orders/line-table";

export function csvEscape(value: string | number | null | undefined): string {
  const text = value == null ? "" : String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return `${rows.map((row) => row.map(csvEscape).join(",")).join("\r\n")}\r\n`;
}

export type OrderExportLine = LineForTable;

export type OrderExportRecord = {
  orderNumber: string;
  clientName: string;
  plantName: string;
  quantity: number;
  orderDate: string;
  startDate: string;
  dueDate: string;
  lifecycleStatus: string;
  remarks?: string | null;
  lines: OrderExportLine[];
};

export function buildOrderLinesCsv(input: {
  orders: OrderExportRecord[];
  includeOrderColumns: boolean;
}): string {
  const allLines = input.orders.flatMap((order) => order.lines);
  const columns = buildLineTable(allLines).columns;
  const header = [
    ...(input.includeOrderColumns
      ? ["Order", "Client", "Plant", "Order date", "Start", "Due", "Status"]
      : []),
    "Product",
    ...columns.map((column) => column.name),
    "Quantity",
  ];

  const rows: (string | number | null)[][] = [header];
  for (const order of input.orders) {
    const table = buildLineTable(order.lines);
    if (table.rows.length === 0 && input.includeOrderColumns) {
      rows.push([
        order.orderNumber,
        order.clientName,
        order.plantName,
        order.orderDate,
        order.startDate,
        order.dueDate,
        order.lifecycleStatus,
        "-",
        ...columns.map(() => "-"),
        order.quantity,
      ]);
      continue;
    }
    for (const row of table.rows) {
      rows.push([
        ...(input.includeOrderColumns
          ? [
            order.orderNumber,
            order.clientName,
            order.plantName,
            order.orderDate,
            order.startDate,
            order.dueDate,
            order.lifecycleStatus,
          ]
          : []),
        row.productName,
        ...columns.map((column) => row.categoryValues[column.id] ?? "-"),
        row.quantity,
      ]);
    }
    if (!input.includeOrderColumns) {
      rows.push(["Total order quantity", ...columns.map(() => ""), table.orderTotal]);
    }
  }
  return toCsv(rows);
}

export function buildSingleOrderCsv(order: OrderExportRecord): string {
  const summary = toCsv([
    ["Order", order.orderNumber],
    ["Client", order.clientName],
    ["Plant", order.plantName],
    ["Order date", order.orderDate],
    ["Production start", order.startDate],
    ["Due date", order.dueDate],
    ["Total quantity", order.quantity],
    ["Status", order.lifecycleStatus],
    ["Remarks", order.remarks?.trim() || "-"],
    [],
  ]);
  const lines = buildOrderLinesCsv({ orders: [order], includeOrderColumns: false });
  return `${summary}${lines}`;
}
