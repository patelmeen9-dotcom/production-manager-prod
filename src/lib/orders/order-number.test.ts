import { describe, expect, it } from "vitest";
import { generateOrderNumber } from "@/lib/orders/order-number";

describe("generateOrderNumber", () => {
  it("builds a unique PO-YYYYMMDD- suffix", () => {
    const value = generateOrderNumber(new Date(Date.UTC(2026, 9, 26)));
    expect(value).toMatch(/^PO-20261026-[A-Z0-9]{6}$/);
  });
});
