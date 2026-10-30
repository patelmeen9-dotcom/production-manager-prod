import { describe, expect, it } from "vitest";
import { buildProgressByOrder } from "@/lib/production/entry-form-data";

describe("buildProgressByOrder", () => {
  it("sums incremental entries per process on each line", () => {
    const progress = buildProgressByOrder([
      {
        id: "o1",
        lines: [
          {
            id: "line-a",
            quantity: 50,
            product: { name: "Door" },
            processes: [
              { id: "p-frame", sequence: 1, processName: "Framing", plannedQuantity: 50 },
              { id: "p-beat", sequence: 2, processName: "Beating", plannedQuantity: 50 },
            ],
          },
        ],
        productionEntries: [
          { orderProcessId: "p-frame", quantity: 6 },
          { orderProcessId: "p-frame", quantity: 4 },
          { orderProcessId: "p-beat", quantity: 5 },
        ],
      },
    ]);
    expect(progress.o1?.[0]?.quantity).toBe(50);
    expect(progress.o1?.[0]?.stages.map((stage) => `${stage.processName} ${stage.cumulative}/${stage.planned}`)).toEqual([
      "Framing 10/50",
      "Beating 5/50",
    ]);
  });
});
