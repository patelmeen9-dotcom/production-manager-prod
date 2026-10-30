import { describe, expect, it } from "vitest";
import { parseDateOnly } from "@/lib/orders/date-rules";
import {
  buildClientOrderVolumeTable,
  evaluateLineProcesses,
  evaluateOrderTower,
  resolveExpectedProcessDays,
  resolveOrderTowerStatus,
  resolveProcessStatus,
} from "@/lib/dashboard/control-tower";

describe("resolveExpectedProcessDays", () => {
  it("uses required ÷ units/day from process master", () => {
    expect(resolveExpectedProcessDays(100, 40, 9)).toBe(3);
  });

  it("falls back to order expected days when capacity missing", () => {
    expect(resolveExpectedProcessDays(100, null, 5)).toBe(5);
  });
});

describe("resolveProcessStatus", () => {
  it("marks DELAYED after expected end while incomplete", () => {
    expect(
      resolveProcessStatus({
        required: 100,
        cumulative: 40,
        startDate: parseDateOnly("2026-09-01"),
        expectedCompletionDate: parseDateOnly("2026-09-03"),
        actualCompletionDate: null,
        projectedCompletionDate: parseDateOnly("2026-09-10"),
        asOfDate: parseDateOnly("2026-09-04"),
      }),
    ).toBe("DELAYED");
  });

  it("marks GETTING_DELAYED when projected end is after expected end before that end passes", () => {
    expect(
      resolveProcessStatus({
        required: 100,
        cumulative: 10,
        startDate: parseDateOnly("2026-09-01"),
        expectedCompletionDate: parseDateOnly("2026-09-05"),
        actualCompletionDate: null,
        projectedCompletionDate: parseDateOnly("2026-09-12"),
        asOfDate: parseDateOnly("2026-09-03"),
      }),
    ).toBe("GETTING_DELAYED");
  });

  it("marks COMPLETED_LATE when finish is after expected end", () => {
    expect(
      resolveProcessStatus({
        required: 100,
        cumulative: 100,
        startDate: parseDateOnly("2026-09-01"),
        expectedCompletionDate: parseDateOnly("2026-09-03"),
        actualCompletionDate: parseDateOnly("2026-09-05"),
        projectedCompletionDate: parseDateOnly("2026-09-05"),
        asOfDate: parseDateOnly("2026-09-05"),
      }),
    ).toBe("COMPLETED_LATE");
  });
});

describe("evaluateLineProcesses", () => {
  it("derives expected end from actual start + capacity days and WIP as prev − current", () => {
    const processes = evaluateLineProcesses({
      lineQuantity: 100,
      effectiveStartDate: parseDateOnly("2026-09-01"),
      processes: [
        {
          id: "p1",
          sequence: 1,
          processName: "P1",
          processCode: "P1",
          plannedQuantity: 100,
          expectedDays: null,
          unitsPerDay: 50,
        },
        {
          id: "p2",
          sequence: 2,
          processName: "P2",
          processCode: "P2",
          plannedQuantity: 100,
          expectedDays: null,
          unitsPerDay: 50,
        },
        {
          id: "p3",
          sequence: 3,
          processName: "P3",
          processCode: "P3",
          plannedQuantity: 100,
          expectedDays: null,
          unitsPerDay: 50,
        },
      ],
      entries: [
        { orderProcessId: "p1", quantity: 50, entryDate: parseDateOnly("2026-09-01") },
        { orderProcessId: "p1", quantity: 50, entryDate: parseDateOnly("2026-09-02") },
        { orderProcessId: "p2", quantity: 70, entryDate: parseDateOnly("2026-09-02") },
        { orderProcessId: "p3", quantity: 40, entryDate: parseDateOnly("2026-09-04") },
      ],
      asOfDate: parseDateOnly("2026-09-04"),
      gettingDelayedLeadDays: 3,
    });

    expect(processes[0]?.expectedDays).toBe(2);
    expect(processes[0]?.expectedCompletionDate).toEqual(parseDateOnly("2026-09-03"));
    expect(processes[0]?.status).toBe("COMPLETED");
    expect(processes[0]?.sitting).toBe(0);
    expect(processes[1]?.sitting).toBe(30);
    expect(processes[2]?.sitting).toBe(30);
  });
});

describe("resolveOrderTowerStatus", () => {
  it("marks DELAYED only when due date has passed", () => {
    expect(
      resolveOrderTowerStatus({
        lifecycleStatus: "IN_PRODUCTION",
        productionStarted: true,
        fullyComplete: false,
        dueDate: parseDateOnly("2026-09-01"),
        asOfDate: parseDateOnly("2026-09-04"),
        remainingQuantity: 10,
        projectedCompletionDate: parseDateOnly("2026-09-10"),
        processes: [],
      }),
    ).toBe("DELAYED");
  });

  it("marks AT_RISK when projected completion is after due date", () => {
    expect(
      resolveOrderTowerStatus({
        lifecycleStatus: "IN_PRODUCTION",
        productionStarted: true,
        fullyComplete: false,
        dueDate: parseDateOnly("2026-09-10"),
        asOfDate: parseDateOnly("2026-09-04"),
        remainingQuantity: 10,
        projectedCompletionDate: parseDateOnly("2026-09-15"),
        processes: [],
      }),
    ).toBe("AT_RISK");
  });

  it("marks IN_PRODUCTION when projected on or before due with no process risk", () => {
    expect(
      resolveOrderTowerStatus({
        lifecycleStatus: "IN_PRODUCTION",
        productionStarted: true,
        fullyComplete: false,
        dueDate: parseDateOnly("2026-09-20"),
        asOfDate: parseDateOnly("2026-09-04"),
        remainingQuantity: 10,
        projectedCompletionDate: parseDateOnly("2026-09-12"),
        processes: [],
      }),
    ).toBe("IN_PRODUCTION");
  });

  it("marks DISPATCHED when production is complete and full quantity is dispatched", () => {
    expect(
      resolveOrderTowerStatus({
        lifecycleStatus: "COMPLETED",
        productionStarted: true,
        fullyComplete: true,
        dispatchedQuantity: 100,
        orderQuantity: 100,
        dueDate: parseDateOnly("2026-09-20"),
        asOfDate: parseDateOnly("2026-09-04"),
        remainingQuantity: 0,
        projectedCompletionDate: parseDateOnly("2026-09-04"),
        processes: [],
      }),
    ).toBe("DISPATCHED");
  });
});

describe("evaluateOrderTower", () => {
  it("uses finished-goods progress and final-process projected completion", () => {
    const order = evaluateOrderTower({
      orderId: "o1",
      orderNumber: "SO-1",
      clientName: "Acme",
      plantName: "Plant A",
      quantity: 100,
      dueDate: parseDateOnly("2026-09-30"),
      effectiveStartDate: parseDateOnly("2026-09-01"),
      lifecycleStatus: "IN_PRODUCTION",
      asOfDate: parseDateOnly("2026-09-04"),
      gettingDelayedLeadDays: 3,
      lines: [
        {
          lineId: "l1",
          productName: "Door",
          quantity: 100,
          processes: [
            {
              id: "p1",
              sequence: 1,
              processName: "P1",
              processCode: "P1",
              plannedQuantity: 100,
              expectedDays: null,
              unitsPerDay: 100,
            },
            {
              id: "p2",
              sequence: 2,
              processName: "P2",
              processCode: "P2",
              plannedQuantity: 100,
              expectedDays: null,
              unitsPerDay: 100,
            },
          ],
        },
      ],
      entries: [
        { orderProcessId: "p1", quantity: 100, entryDate: parseDateOnly("2026-09-01") },
        { orderProcessId: "p2", quantity: 40, entryDate: parseDateOnly("2026-09-02") },
      ],
    });

    expect(order.completedQuantity).toBe(40);
    expect(order.progressPercent).toBe(40);
    expect(order.projectedCompletionDate).toEqual(parseDateOnly("2026-09-07"));
  });
});

describe("buildClientOrderVolumeTable", () => {
  it("buckets same-month orders into W1–W5 with quantities", () => {
    const table = buildClientOrderVolumeTable({
      from: parseDateOnly("2026-09-01"),
      to: parseDateOnly("2026-09-30"),
      orders: [
        { clientName: "Acme", orderDate: parseDateOnly("2026-09-02"), quantity: 100 },
        { clientName: "Acme", orderDate: parseDateOnly("2026-09-10"), quantity: 50 },
        { clientName: "Beta", orderDate: parseDateOnly("2026-09-29"), quantity: 200 },
      ],
    });
    expect(table.columns.map((column) => column.label)).toEqual(["W1", "W2", "W3", "W4", "W5", "Total"]);
    const acme = table.rows.find((row) => row.clientName === "Acme");
    expect(acme?.counts.W1).toBe(1);
    expect(acme?.quantities.W1).toBe(100);
    expect(acme?.counts.W2).toBe(1);
    expect(acme?.quantities.total).toBe(150);
    expect(table.rows.find((row) => row.clientName === "Beta")?.counts.W5).toBe(1);
  });
});
