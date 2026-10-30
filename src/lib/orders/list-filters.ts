import type { OrderLifecycleStatus, Prisma } from "@prisma/client";
import { parseDateOnly } from "@/lib/orders/date-rules";

export type OrderListStatus = "pending" | "in_production" | "completed";
export type OrderListDateField = "orderDate" | "dueDate" | "productionDate" | "dispatchDate";

const STATUS_TO_LIFECYCLE: Record<OrderListStatus, OrderLifecycleStatus> = {
  pending: "NOT_STARTED",
  in_production: "IN_PRODUCTION",
  completed: "COMPLETED",
};

export function parseOrderListStatus(value: string | undefined): OrderListStatus | undefined {
  if (value === "pending" || value === "in_production" || value === "completed") {
    return value;
  }
  return undefined;
}

export function parseOrderListDateField(value: string | undefined): OrderListDateField {
  if (value === "dueDate" || value === "productionDate" || value === "dispatchDate" || value === "orderDate") {
    return value;
  }
  return "orderDate";
}

export function orderListLifecycleFilter(status: OrderListStatus | undefined): Prisma.ProductionOrderWhereInput {
  if (!status) {
    return {};
  }
  return { lifecycleStatus: STATUS_TO_LIFECYCLE[status] };
}

function tryParseDate(value: string | undefined): Date | undefined {
  if (!value) {
    return undefined;
  }
  try {
    return parseDateOnly(value);
  } catch {
    return undefined;
  }
}

export function orderListDateFilter(input: {
  field: OrderListDateField;
  from?: string;
  to?: string;
}): Prisma.ProductionOrderWhereInput {
  const from = tryParseDate(input.from);
  const to = tryParseDate(input.to);
  if (!from && !to) {
    return {};
  }
  const range: { gte?: Date; lte?: Date } = {};
  if (from) {
    range.gte = from;
  }
  if (to) {
    range.lte = to;
  }
  const column =
    input.field === "dueDate"
      ? "resolvedDueDate"
      : input.field === "productionDate"
        ? "productionDate"
        : input.field === "dispatchDate"
          ? "dispatchDate"
          : "orderDate";
  return { [column]: range };
}

export function lifecycleListLabel(status: string): string {
  switch (status) {
    case "NOT_STARTED":
      return "Pending";
    case "IN_PRODUCTION":
      return "In production";
    case "COMPLETED":
      return "Completed";
    default:
      return status.replaceAll("_", " ");
  }
}
