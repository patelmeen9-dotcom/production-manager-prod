import { describe, expect, it } from "vitest";
import { sortEntryListRows, type EntryListRow } from "@/lib/production/entry-list";

function row(partial: Partial<EntryListRow> & Pick<EntryListRow, "id" | "productionOrderId" | "sequence">): EntryListRow {
  return {
    entryDate: new Date("2026-10-01T00:00:00.000Z"),
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
    quantity: 1,
    orderNumber: "A",
    clientWorkOrderNumber: null,
    processName: "P",
    createdByName: "U",
    ...partial,
  };
}

describe("sortEntryListRows", () => {
  it("puts the last process first within an order, then date for the same process", () => {
    const rows = sortEntryListRows(
      [
        row({
          id: "frame-old",
          productionOrderId: "o1",
          orderNumber: "SO-1",
          sequence: 1,
          processName: "Framing",
          entryDate: new Date("2026-10-02T00:00:00.000Z"),
        }),
        row({
          id: "beat-new",
          productionOrderId: "o1",
          orderNumber: "SO-1",
          sequence: 2,
          processName: "Beating",
          entryDate: new Date("2026-10-03T00:00:00.000Z"),
        }),
        row({
          id: "beat-old",
          productionOrderId: "o1",
          orderNumber: "SO-1",
          sequence: 2,
          processName: "Beating",
          entryDate: new Date("2026-10-01T00:00:00.000Z"),
        }),
      ],
      "process",
    );
    expect(rows.map((item) => item.id)).toEqual(["beat-new", "beat-old", "frame-old"]);
  });
});
