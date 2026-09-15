import { z } from "zod";

export const orderLineCategorySelectionSchema = z.object({
  productCategoryId: z.string().min(1),
  textValue: z.string().trim().max(1000).optional().or(z.literal("")),
  optionIds: z.array(z.string().min(1)).default([]),
});

export const orderLineMaterialSchema = z.object({
  name: z.string().trim().min(1, "Material name is required.").max(160),
  /** Total qty of this material required for the whole order (user-entered). */
  totalQuantity: z.coerce.number().int().positive("Total quantity must be greater than zero."),
  quantityReceived: z.coerce.number().int().min(0, "Received quantity cannot be negative."),
});

export const orderLineProcessSchema = z.object({
  processId: z.string().min(1),
  processCode: z.string().min(1),
  processName: z.string().min(1),
  sequence: z.coerce.number().int().positive(),
  expectedDays: z.union([
    z.literal(""),
    z.coerce.number().int().positive("Expected days must be greater than zero."),
  ]).optional(),
});

export const productionOrderLineSchema = z.object({
  productId: z.string().min(1, "Product is required."),
  quantity: z.coerce.number().int().positive("Line quantity must be greater than zero."),
  remarks: z.string().trim().max(1000).optional().or(z.literal("")),
  categorySelections: z.array(orderLineCategorySelectionSchema).default([]),
  processes: z.array(orderLineProcessSchema).min(1, "Each line needs at least one process stage."),
  materials: z.array(orderLineMaterialSchema).default([]),
});

export const productionOrderSchema = z
  .object({
    clientId: z.string().min(1, "Client is required."),
    orderNumber: z.string().trim().min(1, "Order number is required.").max(80),
    plantId: z.string().min(1, "Plant is required."),
    lines: z.array(productionOrderLineSchema).min(1, "Add at least one order line."),
    orderDate: z.string().min(1, "Order date is required."),
    startDateType: z.enum(["NONE", "FIXED_DATE", "DAYS_FROM_ORDER"]),
    startDate: z.string().optional().or(z.literal("")),
    startDays: z.string().optional().or(z.literal("")),
    dueDateType: z.enum(["FIXED_DATE", "DAYS_FROM_ORDER", "DAYS_FROM_START"]),
    dueDate: z.string().optional().or(z.literal("")),
    dueDays: z.string().optional().or(z.literal("")),
    priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]),
    remarks: z.string().trim().max(1000).optional().or(z.literal("")),
    specialActivitiesRequested: z.boolean(),
    specialActivityIds: z.array(z.string().min(1)).default([]),
  })
  .superRefine((value, ctx) => {
    // Allow multiple lines with the same product (different optional category answers).
    for (const [index, line] of value.lines.entries()) {
      const codes = new Set<string>();
      for (const process of line.processes) {
        if (codes.has(process.processCode)) {
          ctx.addIssue({
            code: "custom",
            message: `Duplicate process on line ${index + 1}.`,
            path: ["lines", index, "processes"],
          });
        }
        codes.add(process.processCode);
      }
    }
  });

/** Per-line quantity edits (no-entry orders). Categories are descriptive, not quantity-bearing. */
export const orderLineQuantityEditSchema = z.object({
  lines: z
    .array(
      z.object({
        lineId: z.string().min(1),
        quantity: z.coerce.number().int().positive("Line quantity must be greater than zero."),
      }),
    )
    .min(1, "At least one order line is required."),
});

/** Safe edit: remarks + material received quantities only when production has started. */
export const productionOrderSafeEditSchema = z.object({
  remarks: z.string().trim().max(1000).optional().or(z.literal("")),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]),
  lineRemarks: z.array(
    z.object({
      lineId: z.string().min(1),
      remarks: z.string().trim().max(1000).optional().or(z.literal("")),
    }),
  ),
  materials: z.array(
    z.object({
      materialId: z.string().min(1),
      quantityReceived: z.coerce.number().int().min(0),
    }),
  ),
});
