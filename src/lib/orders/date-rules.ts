import { AppError } from "@/lib/errors";

export type DateInputType = "FIXED_DATE" | "DAYS_FROM_ORDER" | "DAYS_FROM_START" | "NONE";

export function parseOptionalDateOnly(value: string | undefined | null): Date | null {
  if (!value || !value.trim()) {
    return null;
  }
  return parseDateOnly(value);
}

export function parseDateOnly(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) {
    throw new AppError("VALIDATION", "Enter a valid date.", 400);
  }
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (Number.isNaN(date.getTime())) {
    throw new AppError("VALIDATION", "Enter a valid date.", 400);
  }
  return date;
}

export function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function resolveEffectiveStartDate(input: {
  orderDate: Date;
  startDateType: DateInputType;
  startDate?: Date | null;
  startDays?: number | null;
}): Date {
  if (input.startDateType === "NONE") {
    return input.orderDate;
  }
  if (input.startDateType === "FIXED_DATE") {
    if (!input.startDate) {
      throw new AppError("VALIDATION", "A production start date is required when using a fixed start date.", 400);
    }
    return input.startDate;
  }
  if (input.startDateType === "DAYS_FROM_START") {
    throw new AppError("VALIDATION", "DAYS_FROM_START applies only to due dates.", 400);
  }
  if (input.startDays == null || input.startDays < 0) {
    throw new AppError("VALIDATION", "Enter the number of days from the order date for production start.", 400);
  }
  return addUtcDays(input.orderDate, input.startDays);
}

/**
 * Due date resolution.
 * DAYS_FROM_START (default for new orders): Effective Start Date + dueDays.
 * DAYS_FROM_ORDER: Order Date + dueDays (legacy / explicit choice).
 * FIXED_DATE: supplied due date.
 */
export function resolveDueDate(input: {
  orderDate: Date;
  effectiveStartDate: Date;
  dueDateType: DateInputType;
  dueDate?: Date | null;
  dueDays?: number | null;
}): Date {
  if (input.dueDateType === "NONE") {
    throw new AppError("VALIDATION", "Due date is required.", 400);
  }
  if (input.dueDateType === "FIXED_DATE") {
    if (!input.dueDate) {
      throw new AppError("VALIDATION", "Select a due date.", 400);
    }
    return input.dueDate;
  }
  if (input.dueDays == null || input.dueDays < 1) {
    throw new AppError(
      "VALIDATION",
      input.dueDateType === "DAYS_FROM_START"
        ? "Enter the number of days from the production start date for the due date."
        : "Enter the number of days from the order date for the due date.",
      400,
    );
  }
  if (input.dueDateType === "DAYS_FROM_START") {
    return addUtcDays(input.effectiveStartDate, input.dueDays);
  }
  return addUtcDays(input.orderDate, input.dueDays);
}
