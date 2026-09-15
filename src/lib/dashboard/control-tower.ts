/**
 * Production Control Tower evaluations.
 * Reuses incremental entry cumulation, material usage helpers, and org delay thresholds.
 * Process schedule uses Order expectedDays (calendar) + Process Master unitsPerDay (capacity).
 */
import { addUtcDays, formatDateOnly } from "@/lib/orders/date-rules";
import { evaluateMaterialUsage, type MaterialUsage } from "@/lib/orders/materials";
import { utcDayDiff } from "@/lib/production/dates";

export type ProcessTowerStatus =
  | "NOT_APPLICABLE"
  | "NOT_STARTED"
  | "ON_TRACK"
  | "GETTING_DELAYED"
  | "DELAYED"
  | "COMPLETED"
  | "COMPLETED_LATE";

export type OrderTowerStatus =
  | "NOT_STARTED"
  | "IN_PRODUCTION"
  | "AT_RISK"
  | "DELAYED"
  | "COMPLETED"
  | "CANCELLED"
  | "ON_HOLD";

export type DatedEntry = {
  orderProcessId: string;
  quantity: number;
  entryDate: Date;
};

export type ProcessTowerInput = {
  id: string;
  sequence: number;
  processName: string;
  processCode: string;
  plannedQuantity: number;
  expectedDays: number | null;
  /** Process Master capacity (units per calendar day). */
  unitsPerDay: number | null;
};

export type ProcessTowerState = {
  orderProcessId: string;
  sequence: number;
  processName: string;
  processCode: string;
  requiredQuantity: number;
  cumulative: number;
  remaining: number;
  /** Units finished prior stage but not this one (or not yet released from order qty for P1). */
  sitting: number;
  startDate: Date | null;
  plannedStartDate: Date | null;
  expectedDays: number | null;
  unitsPerDay: number | null;
  expectedCompletionDate: Date | null;
  actualCompletionDate: Date | null;
  expectedProgressQty: number;
  actualProgressQty: number;
  productionRatePerDay: number | null;
  projectedCompletionDate: Date | null;
  scheduleVarianceDays: number | null;
  status: ProcessTowerStatus;
};

export type LineTowerState = {
  lineId: string;
  productName: string;
  /** Product name plus optional category answers for display. */
  productLabel: string;
  quantity: number;
  processes: ProcessTowerState[];
  completedQuantity: number;
  remainingQuantity: number;
  progressPercent: number;
  currentProcessName: string | null;
};

export type OrderMaterialRisk = MaterialUsage & {
  lineId: string;
  productName: string;
};

export type OrderTowerState = {
  orderId: string;
  orderNumber: string;
  clientName: string;
  plantName: string;
  quantity: number;
  dueDate: Date;
  effectiveStartDate: Date;
  lifecycleStatus: string;
  completedQuantity: number;
  remainingQuantity: number;
  progressPercent: number;
  currentProcessName: string | null;
  /** Projected completion of the final applicable process. */
  projectedCompletionDate: Date | null;
  orderStatus: OrderTowerStatus;
  materialRisk: boolean;
  materials: OrderMaterialRisk[];
  lines: LineTowerState[];
  daysToDue: number;
};

export function processTowerStatusLabel(status: ProcessTowerStatus): string {
  switch (status) {
    case "NOT_APPLICABLE":
      return "Not Applicable";
    case "NOT_STARTED":
      return "Not Started";
    case "ON_TRACK":
      return "In Progress";
    case "GETTING_DELAYED":
      return "Getting Delayed";
    case "DELAYED":
      return "Delayed";
    case "COMPLETED":
      return "Completed";
    case "COMPLETED_LATE":
      return "Completed Late";
  }
}

export function orderTowerStatusLabel(status: OrderTowerStatus): string {
  switch (status) {
    case "NOT_STARTED":
      return "Not Started";
    case "IN_PRODUCTION":
      return "In Production / On Track";
    case "AT_RISK":
      return "At Risk";
    case "DELAYED":
      return "Delayed";
    case "COMPLETED":
      return "Completed";
    case "CANCELLED":
      return "Cancelled";
    case "ON_HOLD":
      return "On Hold";
  }
}

export const ORDER_TOWER_SEVERITY: Record<OrderTowerStatus, number> = {
  DELAYED: 0,
  AT_RISK: 1,
  NOT_STARTED: 2,
  IN_PRODUCTION: 3,
  COMPLETED: 4,
  ON_HOLD: 5,
  CANCELLED: 6,
};

/**
 * Evaluate every process on one order product line.
 * Progress is cumulative units on that process, never an average of stage %.
 *
 * Expected duration = required ÷ Process Master units/day (when capacity exists).
 * Expected end = actual start + expected duration.
 * Projected end = remaining ÷ actual production rate so far.
 */
export function evaluateLineProcesses(input: {
  lineQuantity: number;
  effectiveStartDate: Date;
  processes: ProcessTowerInput[];
  entries: DatedEntry[];
  asOfDate: Date;
  gettingDelayedLeadDays: number;
}): ProcessTowerState[] {
  const sorted = [...input.processes].sort((a, b) => a.sequence - b.sequence);
  const byProcess = new Map<string, DatedEntry[]>();
  for (const entry of input.entries) {
    const list = byProcess.get(entry.orderProcessId) ?? [];
    list.push(entry);
    byProcess.set(entry.orderProcessId, list);
  }

  let plannedCursor = input.effectiveStartDate;
  const states: ProcessTowerState[] = [];

  for (const process of sorted) {
    const required = process.plannedQuantity;
    if (required <= 0) {
      states.push(naProcess(process));
      continue;
    }

    const processEntries = [...(byProcess.get(process.id) ?? [])].sort(
      (a, b) => a.entryDate.getTime() - b.entryDate.getTime(),
    );
    const cumulative = processEntries.reduce((sum, row) => sum + row.quantity, 0);
    const remaining = Math.max(0, required - cumulative);
    const startDate = processEntries[0]?.entryDate ?? null;
    const actualCompletionDate =
      cumulative >= required ? findCompletionDate(processEntries, required) : null;

    const durationDays = resolveExpectedProcessDays(required, process.unitsPerDay, process.expectedDays);
    const plannedStartDate = plannedCursor;
    // Expected end is anchored to actual start only (not a planned placeholder).
    const expectedCompletionDate =
      startDate && durationDays ? addUtcDays(startDate, durationDays) : null;

    if (durationDays) {
      plannedCursor = addUtcDays(plannedStartDate, durationDays);
    }

    const productionRatePerDay = rateSinceStart({
      cumulative,
      startDate,
      asOfDate: input.asOfDate,
      completed: cumulative >= required,
      completionDate: actualCompletionDate,
    });

    const expectedProgressQty = computeExpectedProgressQty({
      required,
      startDate,
      plannedStartDate: startDate,
      durationDays,
      unitsPerDay: process.unitsPerDay,
      asOfDate: input.asOfDate,
      cumulative,
    });

    const projectedCompletionDate = projectCompletion({
      remaining,
      asOfDate: input.asOfDate,
      productionRatePerDay,
      completed: cumulative >= required,
      actualCompletionDate,
    });

    const scheduleVarianceDays = computeScheduleVariance({
      expectedCompletionDate,
      actualCompletionDate,
      projectedCompletionDate,
      asOfDate: input.asOfDate,
      completed: cumulative >= required,
    });

    const status = resolveProcessStatus({
      required,
      cumulative,
      startDate,
      expectedCompletionDate,
      actualCompletionDate,
      projectedCompletionDate,
      asOfDate: input.asOfDate,
    });

    states.push({
      orderProcessId: process.id,
      sequence: process.sequence,
      processName: process.processName,
      processCode: process.processCode,
      requiredQuantity: required,
      cumulative,
      remaining,
      sitting: 0,
      startDate,
      plannedStartDate,
      expectedDays: durationDays,
      unitsPerDay: process.unitsPerDay,
      expectedCompletionDate,
      actualCompletionDate,
      expectedProgressQty,
      actualProgressQty: cumulative,
      productionRatePerDay,
      projectedCompletionDate,
      scheduleVarianceDays,
      status,
    });
  }

  // Units waiting between stages: previous cumulative − current cumulative (≥ 0).
  for (let index = 0; index < states.length; index++) {
    const stage = states[index]!;
    if (stage.status === "NOT_APPLICABLE") {
      continue;
    }
    if (index === 0) {
      stage.sitting = 0;
      continue;
    }
    const prev = states[index - 1]!;
    stage.sitting = Math.max(0, prev.cumulative - stage.cumulative);
  }

  return states;
}

/** required ÷ master units/day when capacity exists; else order expectedDays fallback. */
export function resolveExpectedProcessDays(
  required: number,
  unitsPerDay: number | null | undefined,
  orderExpectedDays: number | null | undefined,
): number | null {
  if (unitsPerDay != null && unitsPerDay > 0 && required > 0) {
    return Math.max(1, Math.ceil(required / unitsPerDay));
  }
  if (orderExpectedDays != null && orderExpectedDays > 0) {
    return orderExpectedDays;
  }
  return null;
}

function naProcess(process: ProcessTowerInput): ProcessTowerState {
  return {
    orderProcessId: process.id,
    sequence: process.sequence,
    processName: process.processName,
    processCode: process.processCode,
    requiredQuantity: 0,
    cumulative: 0,
    remaining: 0,
    sitting: 0,
    startDate: null,
    plannedStartDate: null,
    expectedDays: process.expectedDays,
    unitsPerDay: process.unitsPerDay,
    expectedCompletionDate: null,
    actualCompletionDate: null,
    expectedProgressQty: 0,
    actualProgressQty: 0,
    productionRatePerDay: null,
    projectedCompletionDate: null,
    scheduleVarianceDays: null,
    status: "NOT_APPLICABLE",
  };
}

function findCompletionDate(entries: DatedEntry[], required: number): Date | null {
  let cum = 0;
  for (const entry of entries) {
    cum += entry.quantity;
    if (cum >= required) {
      return entry.entryDate;
    }
  }
  return null;
}

function rateSinceStart(input: {
  cumulative: number;
  startDate: Date | null;
  asOfDate: Date;
  completed: boolean;
  completionDate: Date | null;
}): number | null {
  if (!input.startDate || input.cumulative <= 0) {
    return null;
  }
  const end = input.completed && input.completionDate ? input.completionDate : input.asOfDate;
  const days = Math.max(1, utcDayDiff(input.startDate, end) || 1);
  return input.cumulative / days;
}

/**
 * Linear expected progress across expectedDays, capped by master capacity × elapsed days.
 */
export function computeExpectedProgressQty(input: {
  required: number;
  startDate: Date | null;
  plannedStartDate: Date | null;
  durationDays: number | null;
  unitsPerDay: number | null;
  asOfDate: Date;
  cumulative: number;
}): number {
  if (input.cumulative >= input.required) {
    return input.required;
  }
  const start = input.startDate ?? input.plannedStartDate;
  if (!start || !input.durationDays || input.durationDays <= 0) {
    return 0;
  }
  if (utcDayDiff(input.asOfDate, start) > 0) {
    return 0;
  }
  const elapsed = Math.min(input.durationDays, Math.max(0, utcDayDiff(start, input.asOfDate)));
  const linear = (elapsed / input.durationDays) * input.required;
  const capacityCeiling =
    input.unitsPerDay != null && input.unitsPerDay > 0 ? elapsed * input.unitsPerDay : Number.POSITIVE_INFINITY;
  return Math.min(input.required, linear, capacityCeiling);
}

function projectCompletion(input: {
  remaining: number;
  asOfDate: Date;
  productionRatePerDay: number | null;
  completed: boolean;
  actualCompletionDate: Date | null;
}): Date | null {
  if (input.completed) {
    return input.actualCompletionDate;
  }
  if (input.remaining <= 0) {
    return input.asOfDate;
  }
  const rate = input.productionRatePerDay;
  if (rate == null || rate <= 0) {
    return null;
  }
  return addUtcDays(input.asOfDate, Math.ceil(input.remaining / rate));
}

function computeScheduleVariance(input: {
  expectedCompletionDate: Date | null;
  actualCompletionDate: Date | null;
  projectedCompletionDate: Date | null;
  asOfDate: Date;
  completed: boolean;
}): number | null {
  if (!input.expectedCompletionDate) {
    return null;
  }
  const compare = input.completed
    ? input.actualCompletionDate
    : (input.projectedCompletionDate ?? input.asOfDate);
  if (!compare) {
    return null;
  }
  return utcDayDiff(input.expectedCompletionDate, compare);
}

export function resolveProcessStatus(input: {
  required: number;
  cumulative: number;
  startDate: Date | null;
  expectedCompletionDate: Date | null;
  actualCompletionDate: Date | null;
  projectedCompletionDate: Date | null;
  asOfDate: Date;
}): ProcessTowerStatus {
  if (input.required <= 0) {
    return "NOT_APPLICABLE";
  }
  if (input.cumulative >= input.required) {
    if (
      input.expectedCompletionDate &&
      input.actualCompletionDate &&
      utcDayDiff(input.expectedCompletionDate, input.actualCompletionDate) > 0
    ) {
      return "COMPLETED_LATE";
    }
    return "COMPLETED";
  }
  if (!input.startDate || input.cumulative <= 0) {
    return "NOT_STARTED";
  }
  // Delayed: today is past expected end and still incomplete.
  if (input.expectedCompletionDate && utcDayDiff(input.expectedCompletionDate, input.asOfDate) > 0) {
    return "DELAYED";
  }
  // Getting Delayed: projected finish is after expected end, but expected end has not passed yet.
  if (
    input.expectedCompletionDate &&
    input.projectedCompletionDate &&
    utcDayDiff(input.expectedCompletionDate, input.projectedCompletionDate) > 0
  ) {
    return "GETTING_DELAYED";
  }
  return "ON_TRACK";
}

export function evaluateOrderTower(input: {
  orderId: string;
  orderNumber: string;
  clientName: string;
  plantName: string;
  quantity: number;
  dueDate: Date;
  effectiveStartDate: Date;
  lifecycleStatus: string;
  asOfDate: Date;
  gettingDelayedLeadDays: number;
  lines: {
    lineId: string;
    productName: string;
    productLabel?: string;
    quantity: number;
    processes: ProcessTowerInput[];
    materials?: {
      name: string;
      totalQuantity: number;
      quantityReceived: number;
      /** Quantities used across individual production entries. */
      entryUsages: number[];
    }[];
  }[];
  entries: DatedEntry[];
}): OrderTowerState {
  const lines: LineTowerState[] = input.lines.map((line) => {
    const processIds = new Set(line.processes.map((process) => process.id));
    const processes = evaluateLineProcesses({
      lineQuantity: line.quantity,
      effectiveStartDate: input.effectiveStartDate,
      processes: line.processes,
      entries: input.entries.filter((entry) => processIds.has(entry.orderProcessId)),
      asOfDate: input.asOfDate,
      gettingDelayedLeadDays: input.gettingDelayedLeadDays,
    });
    const applicable = processes.filter((process) => process.status !== "NOT_APPLICABLE");
    const last = applicable[applicable.length - 1];
    const completedQuantity = last?.cumulative ?? 0;
    const remainingQuantity = Math.max(0, line.quantity - completedQuantity);
    const progressPercent = line.quantity === 0 ? 0 : Math.min(100, (completedQuantity / line.quantity) * 100);
    const incomplete = applicable.find((process) => process.cumulative < process.requiredQuantity);
    return {
      lineId: line.lineId,
      productName: line.productName,
      productLabel: line.productLabel?.trim() || line.productName,
      quantity: line.quantity,
      processes,
      completedQuantity,
      remainingQuantity,
      progressPercent,
      currentProcessName: incomplete?.processName ?? last?.processName ?? null,
    };
  });

  const completedQuantity = lines.reduce((sum, line) => sum + line.completedQuantity, 0);
  const remainingQuantity = Math.max(0, input.quantity - completedQuantity);
  const progressPercent =
    input.quantity === 0 ? 0 : Math.min(100, (completedQuantity / input.quantity) * 100);

  const materials: OrderMaterialRisk[] = [];
  for (const line of input.lines) {
    for (const material of line.materials ?? []) {
      const usage = evaluateMaterialUsage({
        name: material.name,
        totalQuantity: material.totalQuantity,
        quantityReceived: material.quantityReceived,
        entryUsages: material.entryUsages,
      });
      materials.push({
        ...usage,
        lineId: line.lineId,
        productName: line.productName,
      });
    }
  }
  const materialRisk = materials.some((material) => material.isShort);

  const allProcesses = lines.flatMap((line) => line.processes);
  const applicable = allProcesses.filter((process) => process.status !== "NOT_APPLICABLE");
  const productionStarted = applicable.some((process) => process.cumulative > 0);
  const fullyComplete =
    lines.length > 0 &&
    lines.every((line) => {
      const apps = line.processes.filter((process) => process.status !== "NOT_APPLICABLE");
      if (apps.length === 0) {
        return line.quantity === 0;
      }
      return apps.every((process) => process.cumulative >= process.requiredQuantity);
    });

  const incomplete = applicable.find((process) => process.cumulative < process.requiredQuantity);

  // Order projected completion = projected completion of the final applicable process (worst/latest across lines).
  const finalProjectedDates = lines
    .map((line) => {
      const apps = line.processes.filter((process) => process.status !== "NOT_APPLICABLE");
      return apps[apps.length - 1]?.projectedCompletionDate ?? null;
    })
    .filter((date): date is Date => Boolean(date));
  const projectedCompletionDate =
    finalProjectedDates.length > 0
      ? finalProjectedDates.sort((a, b) => a.getTime() - b.getTime()).at(-1)!
      : null;

  const orderStatus = resolveOrderTowerStatus({
    lifecycleStatus: input.lifecycleStatus,
    productionStarted,
    fullyComplete,
    dueDate: input.dueDate,
    asOfDate: input.asOfDate,
    remainingQuantity,
    projectedCompletionDate,
    processes: applicable,
  });

  return {
    orderId: input.orderId,
    orderNumber: input.orderNumber,
    clientName: input.clientName,
    plantName: input.plantName,
    quantity: input.quantity,
    dueDate: input.dueDate,
    effectiveStartDate: input.effectiveStartDate,
    lifecycleStatus: input.lifecycleStatus,
    completedQuantity,
    remainingQuantity,
    progressPercent,
    currentProcessName: fullyComplete
      ? (applicable[applicable.length - 1]?.processName ?? null)
      : (incomplete?.processName ?? null),
    projectedCompletionDate,
    orderStatus,
    materialRisk,
    materials,
    lines,
    daysToDue: utcDayDiff(input.asOfDate, input.dueDate),
  };
}

export function resolveOrderTowerStatus(input: {
  lifecycleStatus: string;
  productionStarted: boolean;
  fullyComplete: boolean;
  dueDate: Date;
  asOfDate: Date;
  remainingQuantity: number;
  projectedCompletionDate: Date | null;
  processes: ProcessTowerState[];
}): OrderTowerStatus {
  if (input.lifecycleStatus === "CANCELLED") {
    return "CANCELLED";
  }
  if (input.lifecycleStatus === "ON_HOLD") {
    return "ON_HOLD";
  }
  if (input.fullyComplete) {
    return "COMPLETED";
  }
  if (!input.productionStarted) {
    return "NOT_STARTED";
  }
  // Delayed: today past order due date and still incomplete.
  if (utcDayDiff(input.dueDate, input.asOfDate) > 0 && input.remainingQuantity > 0) {
    return "DELAYED";
  }
  const processRisk = input.processes.some(
    (process) => process.status === "GETTING_DELAYED" || process.status === "DELAYED",
  );
  const projectedMissesDue =
    input.projectedCompletionDate != null &&
    utcDayDiff(input.dueDate, input.projectedCompletionDate) > 0;
  // At Risk: projected order completion after due, or process-level delay/risk, while due not yet passed.
  if (projectedMissesDue || processRisk) {
    return "AT_RISK";
  }
  // In Production / On Track: projected on/before due and no process-level delay/risk.
  return "IN_PRODUCTION";
}

export type ProcessBottleneckRow = {
  processCode: string;
  processName: string;
  ordersAtProcess: number;
  unitsSitting: number;
  unitsInProgress: number;
  unitsRemaining: number;
};

/** Where units are waiting / currently being worked, by process code. */
export function aggregateProcessBottlenecks(orders: OrderTowerState[]): ProcessBottleneckRow[] {
  const map = new Map<string, ProcessBottleneckRow & { orderIds: Set<string> }>();
  for (const order of orders) {
    if (order.orderStatus === "CANCELLED" || order.orderStatus === "COMPLETED") {
      continue;
    }
    for (const line of order.lines) {
      for (const process of line.processes) {
        if (process.status === "NOT_APPLICABLE") {
          continue;
        }
        // Count order at every process where required quantity is not yet completed.
        if (process.cumulative >= process.requiredQuantity) {
          continue;
        }
        const current = map.get(process.processCode) ?? {
          processCode: process.processCode,
          processName: process.processName,
          ordersAtProcess: 0,
          unitsSitting: 0,
          unitsInProgress: 0,
          unitsRemaining: 0,
          orderIds: new Set<string>(),
        };
        current.orderIds.add(order.orderId);
        current.unitsSitting += process.sitting;
        if (process.cumulative > 0 && process.remaining > 0) {
          current.unitsInProgress += process.cumulative;
        }
        current.unitsRemaining += process.remaining;
        map.set(process.processCode, current);
      }
    }
  }
  return [...map.values()]
    .map((row) => ({
      processCode: row.processCode,
      processName: row.processName,
      ordersAtProcess: row.orderIds.size,
      unitsSitting: row.unitsSitting,
      unitsInProgress: row.unitsInProgress,
      unitsRemaining: row.unitsRemaining,
    }))
    .sort((a, b) => b.unitsSitting - a.unitsSitting || b.unitsRemaining - a.unitsRemaining);
}

export type MaterialRiskSummary = {
  name: string;
  totalNeeded: number;
  quantityReceived: number;
  used: number;
  available: number;
  affectedOrders: number;
  affectedProducts: number;
  /** Orders that are short on this material. */
  shortOrders: { orderId: string; orderNumber: string }[];
};

export function aggregateMaterialRisk(orders: OrderTowerState[]): MaterialRiskSummary[] {
  const map = new Map<
    string,
    MaterialRiskSummary & {
      orderIds: Set<string>;
      productKeys: Set<string>;
      orderById: Map<string, string>;
    }
  >();
  for (const order of orders) {
    for (const material of order.materials) {
      if (!material.isShort) {
        continue;
      }
      const current = map.get(material.name) ?? {
        name: material.name,
        totalNeeded: 0,
        quantityReceived: 0,
        used: 0,
        available: 0,
        affectedOrders: 0,
        affectedProducts: 0,
        shortOrders: [],
        orderIds: new Set<string>(),
        productKeys: new Set<string>(),
        orderById: new Map<string, string>(),
      };
      current.totalNeeded += material.totalNeeded;
      current.quantityReceived += material.quantityReceived;
      current.used += material.used;
      current.available += material.available;
      current.orderIds.add(order.orderId);
      current.orderById.set(order.orderId, order.orderNumber);
      current.productKeys.add(`${order.orderId}:${material.lineId}`);
      map.set(material.name, current);
    }
  }
  return [...map.values()]
    .map((row) => ({
      name: row.name,
      totalNeeded: row.totalNeeded,
      quantityReceived: row.quantityReceived,
      used: row.used,
      available: row.available,
      affectedOrders: row.orderIds.size,
      affectedProducts: row.productKeys.size,
      shortOrders: [...row.orderIds]
        .map((orderId) => ({ orderId, orderNumber: row.orderById.get(orderId) ?? orderId }))
        .sort((a, b) => a.orderNumber.localeCompare(b.orderNumber)),
    }))
    .sort((a, b) => a.available - b.available || b.affectedOrders - a.affectedOrders);
}

export type DailyTrendPoint = Record<string, string | number> & { date: string };

export type ProcessTrendMeta = {
  processCode: string;
  processName: string;
};

/**
 * Process-wise daily actual vs expected.
 * Actual = incremental entries that day for each process.
 * Expected = capacity (units/day) for each process whose active window covers the day.
 */
export function buildDailyProductionTrend(input: {
  from: Date;
  to: Date;
  entries: { processCode: string; quantity: number; entryDate: Date }[];
  processWindows: {
    processCode: string;
    processName: string;
    startDate: Date;
    expectedDays: number;
    unitsPerDay: number | null;
    requiredQuantity: number;
  }[];
}): { points: DailyTrendPoint[]; processes: ProcessTrendMeta[] } {
  const processMap = new Map<string, string>();
  for (const window of input.processWindows) {
    processMap.set(window.processCode, window.processName);
  }
  for (const entry of input.entries) {
    if (!processMap.has(entry.processCode)) {
      processMap.set(entry.processCode, entry.processCode);
    }
  }
  const processes = [...processMap.entries()]
    .map(([processCode, processName]) => ({ processCode, processName }))
    .sort((a, b) => a.processName.localeCompare(b.processName));

  const points: DailyTrendPoint[] = [];
  let cursor = input.from;
  while (utcDayDiff(cursor, input.to) >= 0) {
    const key = formatDateOnly(cursor);
    const point: DailyTrendPoint = { date: key };
    for (const process of processes) {
      const actual = input.entries
        .filter(
          (entry) => entry.processCode === process.processCode && formatDateOnly(entry.entryDate) === key,
        )
        .reduce((sum, entry) => sum + entry.quantity, 0);
      let expected = 0;
      for (const window of input.processWindows) {
        if (window.processCode !== process.processCode) {
          continue;
        }
        const end = addUtcDays(window.startDate, window.expectedDays);
        if (utcDayDiff(cursor, window.startDate) >= 0 && utcDayDiff(end, cursor) > 0) {
          const daily =
            window.unitsPerDay != null && window.unitsPerDay > 0
              ? window.unitsPerDay
              : window.requiredQuantity / window.expectedDays;
          expected += daily;
        }
      }
      point[`${process.processCode}__actual`] = actual;
      point[`${process.processCode}__expected`] = Math.round(expected * 10) / 10;
    }
    points.push(point);
    cursor = addUtcDays(cursor, 1);
  }
  return { points, processes };
}

export type ClientVolumeColumn =
  | { key: string; label: string; kind: "week"; week: number }
  | { key: string; label: string; kind: "month"; year: number; month: number }
  | { key: "total"; label: "Total"; kind: "total" };

export type ClientVolumeRow = {
  clientName: string;
  counts: Record<string, number>;
  quantities: Record<string, number>;
  total: number;
  totalQuantity: number;
};

function weekOfMonth(date: Date): number {
  return Math.min(5, Math.ceil(date.getUTCDate() / 7));
}

function sameCalendarMonth(from: Date, to: Date): boolean {
  return from.getUTCFullYear() === to.getUTCFullYear() && from.getUTCMonth() === to.getUTCMonth();
}

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Client-wise order counts by order date in the selected range.
 * Same calendar month → W1–W5 + Total; multi-month → Jan… + Total.
 * Each cell is order count; quantities are tracked separately for "n (qty)" display.
 */
export function buildClientOrderVolumeTable(input: {
  from: Date;
  to: Date;
  orders: { clientName: string; orderDate: Date; quantity: number }[];
}): { columns: ClientVolumeColumn[]; rows: ClientVolumeRow[] } {
  const inRange = input.orders.filter(
    (order) => utcDayDiff(input.from, order.orderDate) >= 0 && utcDayDiff(order.orderDate, input.to) >= 0,
  );

  let columns: ClientVolumeColumn[];
  if (sameCalendarMonth(input.from, input.to)) {
    columns = [1, 2, 3, 4, 5].map((week) => ({
      key: `W${week}`,
      label: `W${week}`,
      kind: "week" as const,
      week,
    }));
  } else {
    const monthKeys = new Map<string, ClientVolumeColumn>();
    let cursor = new Date(Date.UTC(input.from.getUTCFullYear(), input.from.getUTCMonth(), 1));
    const endMonth = new Date(Date.UTC(input.to.getUTCFullYear(), input.to.getUTCMonth(), 1));
    while (cursor.getTime() <= endMonth.getTime()) {
      const year = cursor.getUTCFullYear();
      const month = cursor.getUTCMonth();
      const key = `${year}-${month}`;
      monthKeys.set(key, {
        key,
        label: MONTH_LABELS[month]!,
        kind: "month",
        year,
        month,
      });
      cursor = new Date(Date.UTC(year, month + 1, 1));
    }
    columns = [...monthKeys.values()];
  }
  columns = [...columns, { key: "total", label: "Total", kind: "total" }];

  const byClient = new Map<string, ClientVolumeRow>();
  for (const order of inRange) {
    const row = byClient.get(order.clientName) ?? {
      clientName: order.clientName,
      counts: Object.fromEntries(columns.map((column) => [column.key, 0])),
      quantities: Object.fromEntries(columns.map((column) => [column.key, 0])),
      total: 0,
      totalQuantity: 0,
    };
    let bucketKey = "total";
    if (sameCalendarMonth(input.from, input.to)) {
      bucketKey = `W${weekOfMonth(order.orderDate)}`;
    } else {
      bucketKey = `${order.orderDate.getUTCFullYear()}-${order.orderDate.getUTCMonth()}`;
    }
    row.counts[bucketKey] = (row.counts[bucketKey] ?? 0) + 1;
    row.quantities[bucketKey] = (row.quantities[bucketKey] ?? 0) + order.quantity;
    row.counts.total = (row.counts.total ?? 0) + 1;
    row.quantities.total = (row.quantities.total ?? 0) + order.quantity;
    row.total += 1;
    row.totalQuantity += order.quantity;
    byClient.set(order.clientName, row);
  }

  const rows = [...byClient.values()].sort((a, b) => b.total - a.total || a.clientName.localeCompare(b.clientName));
  return { columns, rows };
}

/** Format "3 (450)" for volume cells. */
export function formatVolumeCell(count: number, quantity: number): string {
  if (count <= 0) {
    return "0";
  }
  return `${count} (${quantity})`;
}

export function countOrderStatuses(orders: OrderTowerState[]) {
  const counts = {
    total: orders.length,
    notStarted: 0,
    inProduction: 0,
    atRisk: 0,
    delayed: 0,
    completed: 0,
  };
  for (const order of orders) {
    switch (order.orderStatus) {
      case "NOT_STARTED":
        counts.notStarted += 1;
        break;
      case "IN_PRODUCTION":
        counts.inProduction += 1;
        break;
      case "AT_RISK":
        counts.atRisk += 1;
        break;
      case "DELAYED":
        counts.delayed += 1;
        break;
      case "COMPLETED":
        counts.completed += 1;
        break;
      default:
        break;
    }
  }
  return counts;
}
