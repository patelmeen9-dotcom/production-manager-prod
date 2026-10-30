import { AppError } from "@/lib/errors";

export type DispatchScope = { kind: "line"; lineId: string } | { kind: "order" };

export type DispatchProcessSnapshot = {
  id: string;
  sequence: number;
  plannedQuantity: number;
};

export type DispatchLineSnapshot = {
  id: string;
  quantity: number;
  processes: DispatchProcessSnapshot[];
};

export type ProductionQty = {
  orderProcessId: string;
  quantity: number;
};

export type ExistingDispatch = {
  quantity: number;
  productionOrderLineId: string | null;
};

export type DispatchLineMeta = {
  complete: boolean;
  finishedGoods: number;
  remaining: number;
};

export type DispatchMeta = {
  allComplete: boolean;
  finishedGoods: number;
  orderRemaining: number;
  lines: Record<string, DispatchLineMeta>;
};

function cumulativeByProcess(entries: ProductionQty[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const entry of entries) {
    map.set(entry.orderProcessId, (map.get(entry.orderProcessId) ?? 0) + entry.quantity);
  }
  return map;
}

export function lineFinishedGoods(line: DispatchLineSnapshot, entries: ProductionQty[]): number {
  const applicable = [...line.processes]
    .filter((process) => process.plannedQuantity > 0)
    .sort((a, b) => a.sequence - b.sequence);
  const last = applicable[applicable.length - 1];
  if (!last) {
    return 0;
  }
  return cumulativeByProcess(entries).get(last.id) ?? 0;
}

export function lineIsComplete(line: DispatchLineSnapshot, entries: ProductionQty[]): boolean {
  const applicable = line.processes.filter((process) => process.plannedQuantity > 0);
  if (applicable.length === 0) {
    return line.quantity === 0;
  }
  const cumulative = cumulativeByProcess(entries);
  return applicable.every((process) => (cumulative.get(process.id) ?? 0) >= process.plannedQuantity);
}

export function buildDispatchMeta(input: {
  lines: DispatchLineSnapshot[];
  productionEntries: ProductionQty[];
  existingDispatches: ExistingDispatch[];
}): DispatchMeta {
  const dispatchedTotal = input.existingDispatches.reduce((sum, row) => sum + row.quantity, 0);
  const dispatchedByLine = new Map<string, number>();
  for (const row of input.existingDispatches) {
    if (!row.productionOrderLineId) {
      continue;
    }
    dispatchedByLine.set(row.productionOrderLineId, (dispatchedByLine.get(row.productionOrderLineId) ?? 0) + row.quantity);
  }

  const lines: Record<string, DispatchLineMeta> = {};
  let finishedGoods = 0;
  let allComplete = input.lines.length > 0;
  for (const line of input.lines) {
    const complete = lineIsComplete(line, input.productionEntries);
    const fg = lineFinishedGoods(line, input.productionEntries);
    finishedGoods += fg;
    allComplete = allComplete && complete;
    lines[line.id] = {
      complete,
      finishedGoods: fg,
      remaining: 0,
    };
  }

  const orderRemaining = Math.max(0, finishedGoods - dispatchedTotal);
  for (const line of input.lines) {
    const lineDispatched = dispatchedByLine.get(line.id) ?? 0;
    const lineCap = Math.max(0, lines[line.id]!.finishedGoods - lineDispatched);
    lines[line.id]!.remaining = Math.min(lineCap, orderRemaining);
  }

  return { allComplete, finishedGoods, orderRemaining, lines };
}

export function assertValidDispatch(input: {
  quantity: number;
  lifecycleStatus: string;
  lines: DispatchLineSnapshot[];
  productionEntries: ProductionQty[];
  existingDispatches: ExistingDispatch[];
  scope: DispatchScope;
}): void {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    throw new AppError("VALIDATION", "Quantity must be a positive integer. Entries are incremental, not cumulative.", 400);
  }
  if (input.lifecycleStatus === "CANCELLED") {
    throw new AppError("VALIDATION", "Cancelled orders cannot be dispatched.", 400);
  }
  if (input.lifecycleStatus === "ON_HOLD") {
    throw new AppError("VALIDATION", "Orders on hold cannot be dispatched.", 400);
  }

  const meta = buildDispatchMeta(input);
  const scope = input.scope;
  if (scope.kind === "order") {
    if (!meta.allComplete) {
      throw new AppError("VALIDATION", "Dispatch the entire order only after every production step is complete.", 400);
    }
    if (input.quantity > meta.orderRemaining) {
      throw new AppError(
        "VALIDATION",
        `Dispatch quantity cannot exceed remaining finished goods (${meta.orderRemaining}).`,
        400,
      );
    }
    return;
  }

  const line = input.lines.find((row) => row.id === scope.lineId);
  if (!line) {
    throw new AppError("VALIDATION", "Selected product line is not on this order.", 400);
  }
  const lineMeta = meta.lines[line.id];
  if (!lineMeta?.complete) {
    throw new AppError("VALIDATION", "Dispatch this product only after all of its production steps are complete.", 400);
  }
  if (input.quantity > lineMeta.remaining) {
    throw new AppError(
      "VALIDATION",
      `Dispatch quantity cannot exceed remaining finished goods for this product (${lineMeta.remaining}).`,
      400,
    );
  }
}
