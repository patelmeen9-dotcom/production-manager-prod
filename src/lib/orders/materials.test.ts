import { describe, expect, it } from "vitest";
import { evaluateMaterialUsage } from "@/lib/orders/materials";

describe("material usage", () => {
  it("computes total needed from totalQuantity and usage from entryUsages", () => {
    const result = evaluateMaterialUsage({
      name: "Lamination",
      totalQuantity: 20,
      quantityReceived: 20,
      entryUsages: [10],
    });
    expect(result.totalNeeded).toBe(20);
    expect(result.used).toBe(10);
    expect(result.available).toBe(10);
    expect(result.isShort).toBe(false);
    expect(result.warning).toBeNull();
  });

  it("warns when received is below total needed", () => {
    const result = evaluateMaterialUsage({
      name: "Lamination",
      totalQuantity: 20,
      quantityReceived: 8,
      entryUsages: [0],
    });
    expect(result.isShort).toBe(true);
    expect(result.warning).toContain("received 8 of 20");
  });

  it("warns when usage exceeds received", () => {
    const result = evaluateMaterialUsage({
      name: "Lamination",
      totalQuantity: 20,
      quantityReceived: 6,
      entryUsages: [10],
    });
    expect(result.used).toBe(10);
    expect(result.available).toBe(-4);
    expect(result.isShort).toBe(true);
    expect(result.warning).toContain("exceeds received");
  });
});
