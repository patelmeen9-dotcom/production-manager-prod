"use server";

import { revalidatePath } from "next/cache";
import { DateInputType, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { uniqueConstraintMessage } from "@/lib/db-errors";
import { requireMasterWriter } from "@/lib/masters/auth";
import { requireGrantedPlant } from "@/lib/plants/access";
import { parseDateOnly, resolveDueDate, resolveEffectiveStartDate } from "@/lib/orders/date-rules";
import { writeAuditLog } from "@/lib/audit/write";
import {
  orderLineQuantityEditSchema,
  productionOrderSafeEditSchema,
  productionOrderSchema,
} from "@/lib/validation/orders";
import { redirectAfterSave } from "@/lib/forms/redirect";
import { rethrowNextNavigation } from "@/lib/forms/navigation";
import type { FormState } from "@/lib/masters/actions";
import {
  detectFileType,
  isAllowedFile,
  saveOrderAttachment,
  deleteAttachmentFile,
} from "@/lib/orders/attachments";

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB

function optionalInt(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseLinesJson(formData: FormData) {
  const raw = String(formData.get("linesJson") ?? "[]");
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeLineDetails(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    lineId: string;
    categorySelections: {
      productCategoryId: string;
      textValue?: string;
      optionIds: string[];
    }[];
    materials: {
      name: string;
      totalQuantity: number;
      quantityReceived: number;
    }[];
  },
) {
  for (const selection of input.categorySelections) {
    const created = await tx.productionOrderLineCategorySelection.create({
      data: {
        organizationId: input.organizationId,
        productionOrderLineId: input.lineId,
        productCategoryId: selection.productCategoryId,
        textValue: selection.textValue?.trim() || null,
      },
    });
    if (selection.optionIds.length > 0) {
      await tx.productionOrderLineCategoryOption.createMany({
        data: selection.optionIds.map((categoryOptionId) => ({
          selectionId: created.id,
          categoryOptionId,
        })),
      });
    }
  }

  for (const material of input.materials) {
    await tx.productionOrderLineMaterial.create({
      data: {
        organizationId: input.organizationId,
        productionOrderLineId: input.lineId,
        name: material.name.trim(),
        totalQuantity: material.totalQuantity,
        quantityReceived: material.quantityReceived,
      },
    });
  }
}

export async function createProductionOrderAction(_prev: FormState, formData: FormData): Promise<FormState> {
  let successMessage = "";
  try {
    const context = await requireMasterWriter();
    const specialActivityIds = formData.getAll("specialActivityIds").map(String).filter(Boolean);
    const lines = parseLinesJson(formData);
    if (!lines) {
      return { error: "Invalid order lines payload." };
    }
    // Parse order-level materials (separate from lines)
    let orderMaterials: { name: string; totalQuantity: number; quantityReceived: number }[] = [];
    try {
      const raw = String(formData.get("materialsJson") ?? "[]");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        orderMaterials = parsed;
      }
    } catch {
      // ignore parse errors; materials are optional
    }
    const parsed = productionOrderSchema.safeParse({
      clientId: formData.get("clientId"),
      orderNumber: formData.get("orderNumber"),
      plantId: formData.get("plantId"),
      lines,
      orderDate: formData.get("orderDate"),
      startDateType: formData.get("startDateType"),
      startDate: formData.get("startDate") ?? "",
      startDays: formData.get("startDays") ?? "",
      dueDateType: formData.get("dueDateType"),
      dueDate: formData.get("dueDate") ?? "",
      dueDays: formData.get("dueDays") ?? "",
      priority: formData.get("priority"),
      remarks: formData.get("remarks") ?? "",
      specialActivitiesRequested: formData.get("specialActivitiesRequested") === "on",
      specialActivityIds,
    });
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Invalid order." };
    }

    await requireGrantedPlant(context, parsed.data.plantId);

    if (parsed.data.specialActivitiesRequested && parsed.data.specialActivityIds.length === 0) {
      return { error: "Select at least one special activity, or turn off special activities." };
    }
    if (!parsed.data.specialActivitiesRequested && parsed.data.specialActivityIds.length > 0) {
      return { error: "Clear special activity selections when special activities are not requested." };
    }

    const productIds = [...new Set(parsed.data.lines.map((line) => line.productId))];
    const [client, products, activities] = await Promise.all([
      prisma.client.findFirst({
        where: { id: parsed.data.clientId, organizationId: context.organizationId, isActive: true },
      }),
      prisma.product.findMany({
        where: { organizationId: context.organizationId, isActive: true, id: { in: productIds } },
        include: { categoryAssignments: true },
      }),
      parsed.data.specialActivityIds.length > 0
        ? prisma.specialActivity.findMany({
          where: {
            organizationId: context.organizationId,
            isActive: true,
            id: { in: parsed.data.specialActivityIds },
          },
        })
        : Promise.resolve([]),
    ]);

    if (!client) {
      return { error: "Client not found in this organization." };
    }
    if (products.length !== productIds.length) {
      return { error: "One or more products are invalid for this organization." };
    }
    if (activities.length !== parsed.data.specialActivityIds.length) {
      return { error: "One or more special activities are invalid for this organization." };
    }

    const productById = new Map(products.map((product) => [product.id, product]));
    for (const [index, line] of parsed.data.lines.entries()) {
      const product = productById.get(line.productId);
      const allowed = new Set(product?.categoryAssignments.map((row) => row.productCategoryId) ?? []);
      for (const selection of line.categorySelections) {
        if (!allowed.has(selection.productCategoryId)) {
          return { error: `Line ${index + 1}: category is not assigned to the selected product.` };
        }
      }
    }

    const totalQuantity = parsed.data.lines.reduce((sum, line) => sum + line.quantity, 0);
    const primaryProductId = parsed.data.lines[0]!.productId;

    const orderDate = parseDateOnly(parsed.data.orderDate);
    const startDateType = parsed.data.startDateType as DateInputType;
    const dueDateType = parsed.data.dueDateType as DateInputType;
    const startDate = parsed.data.startDate ? parseDateOnly(parsed.data.startDate) : null;
    const dueDate = parsed.data.dueDate ? parseDateOnly(parsed.data.dueDate) : null;
    const startDays = optionalInt(parsed.data.startDays);
    const dueDays = optionalInt(parsed.data.dueDays);
    const effectiveStartDate = resolveEffectiveStartDate({
      orderDate,
      startDateType,
      startDate,
      startDays,
    });
    const resolvedDueDate = resolveDueDate({
      orderDate,
      effectiveStartDate,
      dueDateType,
      dueDate,
      dueDays,
    });
    const usesDueDays = dueDateType === DateInputType.DAYS_FROM_ORDER || dueDateType === DateInputType.DAYS_FROM_START;

    const order = await prisma.$transaction(async (tx) => {
      const created = await tx.productionOrder.create({
        data: {
          organizationId: context.organizationId,
          plantId: parsed.data.plantId,
          clientId: client.id,
          productId: primaryProductId,
          createdByUserId: context.userId,
          orderNumber: parsed.data.orderNumber.trim(),
          quantity: totalQuantity,
          orderDate,
          startDateType,
          startDate: startDateType === DateInputType.FIXED_DATE ? startDate : null,
          startDays: startDateType === DateInputType.DAYS_FROM_ORDER ? startDays : null,
          effectiveStartDate,
          dueDateType,
          dueDate: dueDateType === DateInputType.FIXED_DATE ? dueDate : null,
          dueDays: usesDueDays ? dueDays : null,
          resolvedDueDate,
          priority: parsed.data.priority,
          remarks: parsed.data.remarks || null,
          specialActivitiesRequested: parsed.data.specialActivitiesRequested,
        },
      });

      for (const [index, line] of parsed.data.lines.entries()) {
        const createdLine = await tx.productionOrderLine.create({
          data: {
            organizationId: context.organizationId,
            productionOrderId: created.id,
            productId: line.productId,
            quantity: line.quantity,
            remarks: line.remarks?.trim() || null,
            lineNumber: index + 1,
          },
        });

        const processRows = [];
        for (const [processIndex, process] of line.processes.entries()) {
          const row = await tx.productionOrderProcess.create({
            data: {
              organizationId: context.organizationId,
              productionOrderId: created.id,
              productionOrderLineId: createdLine.id,
              processId: process.processId,
              processName: process.processName,
              processCode: process.processCode,
              sequence: processIndex + 1,
              plannedQuantity: line.quantity,
              expectedDays:
                process.expectedDays === "" || process.expectedDays == null
                  ? null
                  : Number(process.expectedDays),
            },
          });
          processRows.push(row);
        }

        await writeLineDetails(tx, {
          organizationId: context.organizationId,
          lineId: createdLine.id,
          categorySelections: line.categorySelections,
          // Per-line materials payload is empty; order-level materials are written to first line below
          materials: [],
        });

        // Attach order-level materials to the first line
        if (index === 0 && orderMaterials.length > 0) {
          for (const material of orderMaterials) {
            if (!material.name?.trim() || !material.totalQuantity || material.totalQuantity <= 0) continue;
            await tx.productionOrderLineMaterial.create({
              data: {
                organizationId: context.organizationId,
                productionOrderLineId: createdLine.id,
                name: material.name.trim(),
                totalQuantity: material.totalQuantity,
                quantityReceived: material.quantityReceived ?? 0,
              },
            });
          }
        }
      }

      if (activities.length > 0) {
        await tx.productionOrderSpecialActivity.createMany({
          data: activities.map((activity) => ({
            organizationId: context.organizationId,
            productionOrderId: created.id,
            specialActivityId: activity.id,
          })),
        });
      }

      return created;
    });

    // Save an optional file attachment submitted alongside the order.
    const attachmentFile = formData.get("attachment") as File | null;
    if (attachmentFile && attachmentFile.size > 0) {
      if (!isAllowedFile(attachmentFile.name, attachmentFile.type)) {
        return { error: "Attachment: only .xlsx and .pdf files are allowed." };
      }
      if (attachmentFile.size > MAX_FILE_SIZE_BYTES) {
        return { error: "Attachment file too large. Maximum allowed size is 20 MB." };
      }
      const fileType = detectFileType(attachmentFile.name, attachmentFile.type);
      if (fileType) {
        const buffer = Buffer.from(await attachmentFile.arrayBuffer());
        const storagePath = await saveOrderAttachment(order.id, attachmentFile.name, buffer);
        await prisma.productionOrderAttachment.create({
          data: {
            organizationId: context.organizationId,
            productionOrderId: order.id,
            fileName: attachmentFile.name,
            fileType,
            storagePath,
            fileSizeBytes: attachmentFile.size,
          },
        });
      }
    }

    revalidatePath("/orders");
    await writeAuditLog({
      organizationId: context.organizationId,
      userId: context.userId,
      action: "CREATE",
      entityType: "ProductionOrder",
      entityId: order.id,
      newValue: {
        orderNumber: order.orderNumber,
        quantity: order.quantity,
        lineCount: parsed.data.lines.length,
      },
    });
    successMessage = `Order ${order.orderNumber} created with ${parsed.data.lines.length} line(s).`;
  } catch (error) {
    rethrowNextNavigation(error);
    return {
      error: uniqueConstraintMessage(error, error instanceof AppError ? error.message : "Could not create order."),
    };
  }

  redirectAfterSave("/orders", successMessage);
}

export async function updateProductionOrderSafeAction(
  orderId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  let successMessage = "";
  try {
    const context = await requireMasterWriter();
    const lineRemarksRaw = String(formData.get("lineRemarksJson") ?? "[]");
    const materialsRaw = String(formData.get("materialsJson") ?? "[]");
    let lineRemarks;
    let materials;
    try {
      lineRemarks = JSON.parse(lineRemarksRaw);
      materials = JSON.parse(materialsRaw);
    } catch {
      return { error: "Invalid safe-edit payload." };
    }
    const parsed = productionOrderSafeEditSchema.safeParse({
      remarks: formData.get("remarks") ?? "",
      priority: formData.get("priority"),
      lineRemarks,
      materials,
    });
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Invalid order update." };
    }

    const order = await prisma.productionOrder.findFirst({
      where: { id: orderId, organizationId: context.organizationId },
      include: { productionEntries: { take: 1 }, lines: { include: { materials: true } } },
    });
    if (!order) {
      return { error: "Order not found." };
    }
    await requireGrantedPlant(context, order.plantId);

    const lineIds = new Set(order.lines.map((line) => line.id));
    const materialIds = new Set(order.lines.flatMap((line) => line.materials.map((material) => material.id)));

    await prisma.$transaction(async (tx) => {
      await tx.productionOrder.update({
        where: { id: order.id },
        data: {
          remarks: parsed.data.remarks || null,
          priority: parsed.data.priority,
        },
      });
      for (const row of parsed.data.lineRemarks) {
        if (!lineIds.has(row.lineId)) {
          continue;
        }
        await tx.productionOrderLine.update({
          where: { id: row.lineId },
          data: { remarks: row.remarks || null },
        });
      }
      for (const row of parsed.data.materials) {
        if (!materialIds.has(row.materialId)) {
          continue;
        }
        await tx.productionOrderLineMaterial.update({
          where: { id: row.materialId },
          data: { quantityReceived: row.quantityReceived },
        });
      }
    });

    revalidatePath("/orders");
    revalidatePath(`/orders/${order.id}`);
    successMessage = "Order updated (safe fields).";
  } catch (error) {
    rethrowNextNavigation(error);
    return {
      error: uniqueConstraintMessage(error, error instanceof AppError ? error.message : "Could not update order."),
    };
  }
  redirectAfterSave(`/orders/${orderId}`, successMessage);
}

/**
 * Update the quantity of one or more existing order lines. Categories are descriptive
 * attributes set at creation time and are not editable here — only the quantity per
 * line changes. Lines are never created, merged, or deleted by this action.
 */
export async function updateOrderLineQuantitiesAction(
  orderId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  let successMessage = "";
  try {
    const context = await requireMasterWriter();
    let linesRaw: unknown;
    try {
      linesRaw = JSON.parse(String(formData.get("linesJson") ?? "[]"));
    } catch {
      return { error: "Invalid quantities payload." };
    }
    const parsed = orderLineQuantityEditSchema.safeParse({ lines: linesRaw });
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Invalid quantities." };
    }

    const order = await prisma.productionOrder.findFirst({
      where: { id: orderId, organizationId: context.organizationId },
      include: {
        productionEntries: { take: 1, select: { id: true } },
        lines: { select: { id: true, productId: true }, orderBy: { lineNumber: "asc" } },
      },
    });
    if (!order) {
      return { error: "Order not found." };
    }
    await requireGrantedPlant(context, order.plantId);
    if (order.productionEntries.length > 0 || order.lifecycleStatus !== "NOT_STARTED") {
      return { error: "Quantities cannot be changed after production has started." };
    }
    if (order.lines.length === 0) {
      return { error: "This order has no lines to update." };
    }

    const orderLineIds = new Set(order.lines.map((line) => line.id));
    const submittedIds = new Set<string>();
    for (const line of parsed.data.lines) {
      if (!orderLineIds.has(line.lineId)) {
        return { error: "A submitted line does not belong to this order." };
      }
      if (submittedIds.has(line.lineId)) {
        return { error: "Duplicate line in quantity update." };
      }
      submittedIds.add(line.lineId);
    }
    if (submittedIds.size !== orderLineIds.size) {
      return { error: "All order lines must have a quantity." };
    }

    await prisma.$transaction(async (tx) => {
      for (const line of parsed.data.lines) {
        await tx.productionOrderLine.update({
          where: { id: line.lineId },
          data: { quantity: line.quantity },
        });
        await tx.productionOrderProcess.updateMany({
          where: { productionOrderLineId: line.lineId },
          data: { plannedQuantity: line.quantity },
        });
      }
      const totalQuantity = parsed.data.lines.reduce((sum, line) => sum + line.quantity, 0);
      await tx.productionOrder.update({
        where: { id: order.id },
        data: { quantity: totalQuantity },
      });
    });

    revalidatePath("/orders");
    revalidatePath(`/orders/${order.id}`);
    await writeAuditLog({
      organizationId: context.organizationId,
      userId: context.userId,
      action: "UPDATE",
      entityType: "ProductionOrder",
      entityId: order.id,
      newValue: { lineQuantityUpdate: true },
    });
    successMessage = "Order line quantities updated.";
  } catch (error) {
    rethrowNextNavigation(error);
    return {
      error: uniqueConstraintMessage(error, error instanceof AppError ? error.message : "Could not update quantities."),
    };
  }
  redirectAfterSave(`/orders/${orderId}`, successMessage);
}

// ---------------------------------------------------------------------------
// Attachment actions
// ---------------------------------------------------------------------------

/**
 * Upload one attachment (XLSX or PDF) to an existing production order.
 * Bound to orderId before being passed to a form action.
 */
export async function uploadOrderAttachmentAction(
  orderId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const context = await requireMasterWriter();

    const order = await prisma.productionOrder.findFirst({
      where: { id: orderId, organizationId: context.organizationId },
    });
    if (!order) {
      return { error: "Order not found." };
    }
    await requireGrantedPlant(context, order.plantId);

    const file = formData.get("attachment") as File | null;
    if (!file || file.size === 0) {
      return { error: "No file selected." };
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return { error: `File too large. Maximum allowed size is 20 MB.` };
    }
    if (!isAllowedFile(file.name, file.type)) {
      return { error: "Only .xlsx and .pdf files are allowed." };
    }

    const fileType = detectFileType(file.name, file.type);
    if (!fileType) {
      return { error: "Unsupported file type. Only XLSX and PDF are allowed." };
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const storagePath = await saveOrderAttachment(order.id, file.name, buffer);

    await prisma.productionOrderAttachment.create({
      data: {
        organizationId: context.organizationId,
        productionOrderId: order.id,
        fileName: file.name,
        fileType,
        storagePath,
        fileSizeBytes: file.size,
      },
    });

    revalidatePath(`/orders/${orderId}`);
    return { success: `"${file.name}" uploaded successfully.` };
  } catch (error) {
    rethrowNextNavigation(error);
    return { error: error instanceof AppError ? error.message : "Could not upload file." };
  }
}

/**
 * Delete an attachment record and its physical file.
 * Bound to attachmentId before being passed to a form action.
 */
export async function deleteOrderAttachmentAction(
  attachmentId: string,
  _prev: FormState, // eslint-disable-line @typescript-eslint/no-unused-vars
  _formData: FormData, // eslint-disable-line @typescript-eslint/no-unused-vars
): Promise<FormState> {
  let orderId = "";
  try {
    const context = await requireMasterWriter();

    const attachment = await prisma.productionOrderAttachment.findFirst({
      where: { id: attachmentId, organizationId: context.organizationId },
      include: { productionOrder: { select: { plantId: true, id: true } } },
    });
    if (!attachment) {
      return { error: "Attachment not found." };
    }
    await requireGrantedPlant(context, attachment.productionOrder.plantId);
    orderId = attachment.productionOrder.id;

    await prisma.productionOrderAttachment.delete({ where: { id: attachmentId } });
    await deleteAttachmentFile(attachment.storagePath);

    revalidatePath(`/orders/${orderId}`);
    return { success: "Attachment deleted." };
  } catch (error) {
    rethrowNextNavigation(error);
    return { error: error instanceof AppError ? error.message : "Could not delete attachment." };
  }
}
