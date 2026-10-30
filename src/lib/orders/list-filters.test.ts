import { describe, expect, it } from "vitest";
import { parseDateOnly } from "@/lib/orders/date-rules";
import {
  orderListDateFilter,
  orderListLifecycleFilter,
  parseOrderListDateField,
  parseOrderListStatus,
} from "@/lib/orders/list-filters";

describe("order list filters", () => {
  it("maps pending / in production / completed to lifecycle statuses", () => {
    expect(parseOrderListStatus("pending")).toBe("pending");
    expect(orderListLifecycleFilter("pending")).toEqual({ lifecycleStatus: "NOT_STARTED" });
    expect(orderListLifecycleFilter("in_production")).toEqual({ lifecycleStatus: "IN_PRODUCTION" });
    expect(orderListLifecycleFilter("completed")).toEqual({ lifecycleStatus: "COMPLETED" });
    expect(orderListLifecycleFilter(undefined)).toEqual({});
  });

  it("filters by the selected date field", () => {
    expect(parseOrderListDateField("dispatchDate")).toBe("dispatchDate");
    expect(
      orderListDateFilter({ field: "productionDate", from: "2026-10-01", to: "2026-10-31" }),
    ).toEqual({
      productionDate: { gte: parseDateOnly("2026-10-01"), lte: parseDateOnly("2026-10-31") },
    });
    expect(orderListDateFilter({ field: "dueDate", from: "2026-10-01" })).toEqual({
      resolvedDueDate: { gte: parseDateOnly("2026-10-01") },
    });
  });
});
