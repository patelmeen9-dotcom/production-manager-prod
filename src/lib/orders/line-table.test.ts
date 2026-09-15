import { describe, expect, it } from "vitest";
import { buildLineTable, formatCategoryValue } from "@/lib/orders/line-table";

describe("order line display table", () => {
  it("keeps one row per line and shows each line's own category values, independent of quantity", () => {
    const table = buildLineTable([
      {
        id: "l1",
        lineNumber: 1,
        quantity: 40,
        product: {
          id: "door",
          name: "Door",
          categoryAssignments: [
            { productCategory: { id: "cat-fill", name: "FILLER" } },
            { productCategory: { id: "cat-thick", name: "THICKNESS" } },
          ],
        },
        categorySelections: [
          {
            productCategoryId: "cat-fill",
            productCategory: { id: "cat-fill", name: "FILLER" },
            textValue: "Honeycomb",
          },
          {
            productCategoryId: "cat-thick",
            productCategory: { id: "cat-thick", name: "THICKNESS" },
            textValue: "35mm",
          },
        ],
      },
      {
        id: "l2",
        lineNumber: 2,
        quantity: 20,
        product: {
          id: "door",
          name: "Door",
          categoryAssignments: [
            { productCategory: { id: "cat-fill", name: "FILLER" } },
            { productCategory: { id: "cat-thick", name: "THICKNESS" } },
          ],
        },
        categorySelections: [
          {
            productCategoryId: "cat-fill",
            productCategory: { id: "cat-fill", name: "FILLER" },
            textValue: "Solid",
          },
        ],
      },
    ]);

    expect(table.columns.map((column) => column.name)).toEqual(["FILLER", "THICKNESS"]);
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0]!.quantity).toBe(40);
    expect(table.rows[0]!.categoryValues["cat-fill"]).toBe("Honeycomb");
    expect(table.rows[0]!.categoryValues["cat-thick"]).toBe("35mm");
    expect(table.rows[1]!.quantity).toBe(20);
    expect(table.rows[1]!.categoryValues["cat-fill"]).toBe("Solid");
    expect(table.rows[1]!.categoryValues["cat-thick"]).toBe("-");
    expect(table.orderTotal).toBe(60);
  });

  it("joins multiple selected dropdown options for a category value", () => {
    const line = {
      id: "l1",
      lineNumber: 1,
      quantity: 5,
      product: { id: "door", name: "Door", categoryAssignments: [] },
      categorySelections: [
        {
          productCategoryId: "cat-features",
          productCategory: { id: "cat-features", name: "ADD_FEATURES" },
          textValue: null,
          selectedOptions: [
            { categoryOption: { name: "Vision Panel" } },
            { categoryOption: { name: "Louvers" } },
          ],
        },
      ],
    };
    expect(formatCategoryValue(line, "cat-features")).toBe("Vision Panel, Louvers");
  });

  it("returns a dash for an unanswered or inapplicable category", () => {
    const line = {
      id: "l1",
      lineNumber: 1,
      quantity: 12,
      product: { id: "panel", name: "Panel", categoryAssignments: [] },
      categorySelections: [],
    };
    expect(formatCategoryValue(line, "cat-anything")).toBe("-");
  });

  it("does not let quantity depend on category answers", () => {
    const table = buildLineTable([
      {
        id: "l1",
        lineNumber: 1,
        quantity: 208,
        product: { id: "door", name: "Door", categoryAssignments: [] },
        categorySelections: [],
      },
    ]);
    expect(table.orderTotal).toBe(208);
    expect(table.rows[0]!.quantity).toBe(208);
  });
});
