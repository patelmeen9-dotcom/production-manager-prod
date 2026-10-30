import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { assertValidDispatch, buildDispatchMeta } from "@/lib/production/dispatch";

const p1 = { id: "p1", sequence: 1, plannedQuantity: 100 };
const p2 = { id: "p2", sequence: 2, plannedQuantity: 100 };
const line = { id: "line-a", quantity: 100, processes: [p1, p2] };

describe("buildDispatchMeta", () => {
  it("computes remaining finished goods after partial dispatch", () => {
    const meta = buildDispatchMeta({
      lines: [line],
      productionEntries: [
        { orderProcessId: "p1", quantity: 100 },
        { orderProcessId: "p2", quantity: 100 },
      ],
      existingDispatches: [{ quantity: 40, productionOrderLineId: "line-a" }],
    });
    expect(meta.allComplete).toBe(true);
    expect(meta.orderRemaining).toBe(60);
    expect(meta.lines["line-a"]?.remaining).toBe(60);
  });

  it("lets an order-level dispatch consume remaining across lines", () => {
    const lineB = { id: "line-b", quantity: 50, processes: [{ id: "p3", sequence: 1, plannedQuantity: 50 }] };
    const meta = buildDispatchMeta({
      lines: [line, lineB],
      productionEntries: [
        { orderProcessId: "p1", quantity: 100 },
        { orderProcessId: "p2", quantity: 100 },
        { orderProcessId: "p3", quantity: 50 },
      ],
      existingDispatches: [{ quantity: 120, productionOrderLineId: null }],
    });
    expect(meta.orderRemaining).toBe(30);
    expect(meta.lines["line-a"]?.remaining).toBe(30);
    expect(meta.lines["line-b"]?.remaining).toBe(30);
  });
});

describe("assertValidDispatch", () => {
  it("rejects dispatch before all steps are complete", () => {
    expect(() =>
      assertValidDispatch({
        quantity: 10,
        lifecycleStatus: "IN_PRODUCTION",
        lines: [line],
        productionEntries: [{ orderProcessId: "p1", quantity: 100 }],
        existingDispatches: [],
        scope: { kind: "line", lineId: "line-a" },
      }),
    ).toThrow(AppError);
  });

  it("accepts a line dispatch of remaining finished goods", () => {
    expect(() =>
      assertValidDispatch({
        quantity: 100,
        lifecycleStatus: "COMPLETED",
        lines: [line],
        productionEntries: [
          { orderProcessId: "p1", quantity: 100 },
          { orderProcessId: "p2", quantity: 100 },
        ],
        existingDispatches: [],
        scope: { kind: "line", lineId: "line-a" },
      }),
    ).not.toThrow();
  });

  it("rejects quantity above remaining", () => {
    expect(() =>
      assertValidDispatch({
        quantity: 61,
        lifecycleStatus: "COMPLETED",
        lines: [line],
        productionEntries: [
          { orderProcessId: "p1", quantity: 100 },
          { orderProcessId: "p2", quantity: 100 },
        ],
        existingDispatches: [{ quantity: 40, productionOrderLineId: null }],
        scope: { kind: "order" },
      }),
    ).toThrow(/remaining finished goods \(60\)/);
  });
});
