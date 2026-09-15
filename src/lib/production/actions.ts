"use server";

import { OrderLifecycleStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { uniqueConstraintMessage } from "@/lib/db-errors";
import { writeAuditLog } from "@/lib/audit/write";
import { parseDateOnly } from "@/lib/orders/date-rules";
import { evaluateMaterialUsage } from "@/lib/orders/materials";
import { requireGrantedPlant } from "@/lib/plants/access";
import { requireProductionRecorder } from "@/lib/production/auth";
import { assertValidProductionEntry } from "@/lib/production/validate";
import { evaluateOrderLines, scopeProcessesToLine } from "@/lib/production/evaluate-lines";
import { parseOrganizationSettings } from "@/lib/organization-settings";
import { productionEntrySchema, specialActivityEntrySchema } from "@/lib/validation/production";
import { redirectAfterSave } from "@/lib/forms/redirect";
import { rethrowNextNavigation } from "@/lib/forms/navigation";
import type { FormState } from "@/lib/masters/actions";
import { z } from "zod";

const stageOrActivityEntrySchema = z.object({
  productionOrderId: z.string().min(1, "Order is required."),
  stageOrActivity: z.string().min(1, "Select a stage or special activity."),
  entryDate: z.string().min(1, "Date is required."),
  quantity: z.coerce.number().int().positive("Quantity must be greater than zero."),
  remarks: z.string().trim().max(500).optional().or(z.literal("")),
});

async function materialWarningsForOrder(organizationId: string, orderId: string): Promise<string[]> {
  const order = await prisma.productionOrder.findFirst({
    where: { id: orderId, organizationId },
    include: {
      lines: {
        include: {
          materials: {
            include: {
              entryUsages: { select: { quantityUsed: true } },
            },
          },
        },
      },
    },
  });
  if (!order) {
    return [];
  }
  const warnings: string[] = [];
  for (const line of order.lines) {
    for (const material of line.materials) {
      const usage = evaluateMaterialUsage({
        name: material.name,
        totalQuantity: material.totalQuantity,
        quantityReceived: material.quantityReceived,
        entryUsages: material.entryUsages.map((u) => u.quantityUsed),
      });
      if (usage.warning) {
        warnings.push(usage.warning);
      }
    }
  }
  return warnings;
}

export async function createProductionEntryAction(_prev: FormState, formData: FormData): Promise<FormState> {
  let successMessage = "";
  let redirectPath = "/entries/new";
  try {
    const context = await requireProductionRecorder();
    const parsed = stageOrActivityEntrySchema.safeParse({
      productionOrderId: formData.get("productionOrderId"),
      stageOrActivity: formData.get("stageOrActivity"),
      entryDate: formData.get("entryDate"),
      quantity: formData.get("quantity"),
      remarks: formData.get("remarks") ?? "",
    });
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Invalid entry." };
    }

    const [kind, selectedId] = parsed.data.stageOrActivity.split(":");
    if ((kind !== "process" && kind !== "activity") || !selectedId) {
      return { error: "Select a valid stage or special activity." };
    }

    const order = await prisma.productionOrder.findFirst({
      where: { id: parsed.data.productionOrderId, organizationId: context.organizationId },
      include: {
        lines: {
          include: { product: { select: { name: true } } },
          orderBy: { lineNumber: "asc" },
        },
        processes: { orderBy: [{ productionOrderLineId: "asc" }, { sequence: "asc" }] },
        requestedSpecialActivities: true,
      },
    });
    if (!order) {
      return { error: "Order not found." };
    }
    await requireGrantedPlant(context, order.plantId);
    const entryDate = parseDateOnly(parsed.data.entryDate);

    if (kind === "activity") {
      if (!order.specialActivitiesRequested) {
        return { error: "This order does not have special activities requested." };
      }
      const allowed = order.requestedSpecialActivities.some((row) => row.specialActivityId === selectedId);
      if (!allowed) {
        return { error: "Selected special activity is not requested on this order." };
      }
      const activity = await prisma.specialActivity.findFirst({
        where: { id: selectedId, organizationId: context.organizationId, isActive: true },
      });
      if (!activity) {
        return { error: "Special activity not found." };
      }
      const created = await prisma.specialActivityEntry.create({
        data: {
          organizationId: context.organizationId,
          plantId: order.plantId,
          productionOrderId: order.id,
          specialActivityId: activity.id,
          orderProcessId: null,
          entryDate,
          quantity: parsed.data.quantity,
          remarks: parsed.data.remarks || null,
          createdByUserId: context.userId,
        },
      });
      await writeAuditLog({
        organizationId: context.organizationId,
        userId: context.userId,
        action: "CREATE",
        entityType: "SpecialActivityEntry",
        entityId: created.id,
        newValue: { activity: activity.code, quantity: parsed.data.quantity, orderId: order.id },
      });
      successMessage = "Special activity recorded.";
    } else {
      const existing = await prisma.productionEntry.findMany({
        where: { organizationId: context.organizationId, productionOrderId: order.id },
        select: { orderProcessId: true, quantity: true },
      });
      const scoped = scopeProcessesToLine(
        order.processes.map((process) => ({
          id: process.id,
          sequence: process.sequence,
          processName: process.processName,
          processCode: process.processCode,
          plannedQuantity: process.plannedQuantity,
          productionOrderLineId: process.productionOrderLineId,
        })),
        selectedId,
        existing,
      );
      if (scoped.processes.length === 0) {
        return { error: "The selected stage is not part of this order's process snapshot." };
      }
      assertValidProductionEntry({
        quantity: parsed.data.quantity,
        lifecycleStatus: order.lifecycleStatus,
        processes: scoped.processes,
        orderProcessId: selectedId,
        existingEntries: scoped.entries,
      });

      const organization = await prisma.organization.findFirstOrThrow({ where: { id: context.organizationId } });
      const settings = parseOrganizationSettings(organization.settings);

      await prisma.$transaction(async (tx) => {
        const created = await tx.productionEntry.create({
          data: {
            organizationId: context.organizationId,
            plantId: order.plantId,
            productionOrderId: order.id,
            orderProcessId: selectedId,
            specialActivityId: null,
            entryDate,
            quantity: parsed.data.quantity,
            remarks: parsed.data.remarks || null,
            createdByUserId: context.userId,
          },
        });

        // Save optional material usage records for this entry
        try {
          const rawUsages = String(formData.get("materialUsagesJson") ?? "[]");
          const usages: { materialId: string; quantityUsed: number }[] = JSON.parse(rawUsages);
          if (Array.isArray(usages)) {
            for (const usage of usages) {
              if (!usage.materialId || !Number.isFinite(usage.quantityUsed) || usage.quantityUsed <= 0) continue;
              await tx.productionEntryMaterialUsage.upsert({
                where: { entryId_materialId: { entryId: created.id, materialId: usage.materialId } },
                create: {
                  organizationId: context.organizationId,
                  entryId: created.id,
                  materialId: usage.materialId,
                  quantityUsed: usage.quantityUsed,
                },
                update: { quantityUsed: usage.quantityUsed },
              });
            }
          }
        } catch {
          // Material usage is optional — don't fail the entry if parsing fails
        }
        const after = await tx.productionEntry.findMany({
          where: { organizationId: context.organizationId, productionOrderId: order.id },
          select: { orderProcessId: true, quantity: true, entryDate: true },
        });
        const first = after.reduce(
          (min, row) => (min && min < row.entryDate ? min : row.entryDate),
          after[0]?.entryDate ?? null,
        );
        const evaluation = evaluateOrderLines({
          orderQuantity: order.quantity,
          effectiveStartDate: order.effectiveStartDate,
          resolvedDueDate: order.resolvedDueDate,
          lifecycleStatus: order.lifecycleStatus,
          lines: order.lines.map((line) => ({
            id: line.id,
            quantity: line.quantity,
            label: line.product.name,
            processes: order.processes
              .filter((process) => process.productionOrderLineId === line.id)
              .map((process) => ({
                id: process.id,
                sequence: process.sequence,
                processName: process.processName,
                processCode: process.processCode,
                plannedQuantity: process.plannedQuantity,
              })),
          })),
          entries: after,
          firstEntryDate: first,
          asOfDate: entryDate,
          settings,
        });
        if (order.lifecycleStatus !== OrderLifecycleStatus.CANCELLED && order.lifecycleStatus !== OrderLifecycleStatus.ON_HOLD) {
          await tx.productionOrder.update({
            where: { id: order.id },
            data: { lifecycleStatus: evaluation.derivedLifecycle },
          });
        }
        await tx.auditLog.create({
          data: {
            organizationId: context.organizationId,
            userId: context.userId,
            action: "CREATE",
            entityType: "ProductionEntry",
            entityId: created.id,
            newValue: {
              orderNumber: order.orderNumber,
              orderProcessId: selectedId,
              quantity: parsed.data.quantity,
              entryDate: parsed.data.entryDate,
            },
          },
        });
      });
      successMessage = "Production entry saved as an incremental quantity.";
    }

    const warnings = await materialWarningsForOrder(context.organizationId, order.id);
    if (warnings.length > 0) {
      successMessage = `${successMessage} Warning: ${warnings.join(" | ")}`;
    }

    revalidatePath("/orders");
    revalidatePath(`/orders/${order.id}`);
    revalidatePath("/dashboard");
    revalidatePath("/entries");
    revalidatePath("/entries/new");
    redirectPath = "/entries/new";
  } catch (error) {
    rethrowNextNavigation(error);
    return { error: uniqueConstraintMessage(error, error instanceof AppError ? error.message : "Could not save entry.") };
  }

  redirectAfterSave(redirectPath, successMessage);
}

export async function updateProductionEntryAction(entryId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  let successMessage = "";
  try {
    const context = await requireProductionRecorder();
    const parsed = stageOrActivityEntrySchema.safeParse({
      productionOrderId: formData.get("productionOrderId"),
      stageOrActivity: formData.get("stageOrActivity"),
      entryDate: formData.get("entryDate"),
      quantity: formData.get("quantity"),
      remarks: formData.get("remarks") ?? "",
    });
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Invalid entry." };
    }
    const [kind, selectedId] = parsed.data.stageOrActivity.split(":");
    if (kind !== "process" || !selectedId) {
      return { error: "Editing supports process stages only. Create a new special-activity entry instead." };
    }

    const existingEntry = await prisma.productionEntry.findFirst({
      where: { id: entryId, organizationId: context.organizationId },
    });
    if (!existingEntry) {
      return { error: "Entry not found." };
    }

    const order = await prisma.productionOrder.findFirst({
      where: { id: parsed.data.productionOrderId, organizationId: context.organizationId },
      include: {
        lines: { include: { product: { select: { name: true } } } },
        processes: { orderBy: [{ productionOrderLineId: "asc" }, { sequence: "asc" }] },
      },
    });
    if (!order || existingEntry.productionOrderId !== order.id) {
      return { error: "Order not found." };
    }
    await requireGrantedPlant(context, order.plantId);

    const otherEntries = await prisma.productionEntry.findMany({
      where: {
        organizationId: context.organizationId,
        productionOrderId: order.id,
        NOT: { id: entryId },
      },
      select: { orderProcessId: true, quantity: true },
    });
    const scoped = scopeProcessesToLine(
      order.processes.map((process) => ({
        id: process.id,
        sequence: process.sequence,
        processName: process.processName,
        processCode: process.processCode,
        plannedQuantity: process.plannedQuantity,
        productionOrderLineId: process.productionOrderLineId,
      })),
      selectedId,
      otherEntries,
    );
    if (scoped.processes.length === 0) {
      return { error: "The selected stage is not part of this order's process snapshot." };
    }
    assertValidProductionEntry({
      quantity: parsed.data.quantity,
      lifecycleStatus: order.lifecycleStatus,
      processes: scoped.processes,
      orderProcessId: selectedId,
      existingEntries: scoped.entries,
    });

    await prisma.productionEntry.update({
      where: { id: entryId },
      data: {
        orderProcessId: selectedId,
        entryDate: parseDateOnly(parsed.data.entryDate),
        quantity: parsed.data.quantity,
        remarks: parsed.data.remarks || null,
        specialActivityId: null,
      },
    });

    const warnings = await materialWarningsForOrder(context.organizationId, order.id);
    successMessage = "Production entry updated.";
    if (warnings.length > 0) {
      successMessage = `${successMessage} Warning: ${warnings.join(" | ")}`;
    }

    revalidatePath("/entries");
    revalidatePath(`/entries/${entryId}/edit`);
    revalidatePath(`/orders/${order.id}`);
    revalidatePath("/dashboard");
  } catch (error) {
    rethrowNextNavigation(error);
    return { error: uniqueConstraintMessage(error, error instanceof AppError ? error.message : "Could not update entry.") };
  }
  redirectAfterSave(`/entries/${entryId}/edit`, successMessage);
}

export async function createSpecialActivityEntryAction(_prev: FormState, formData: FormData): Promise<FormState> {
  let successMessage = "";
  let listPath = "/orders";
  try {
    const context = await requireProductionRecorder();
    const parsed = specialActivityEntrySchema.safeParse({
      productionOrderId: formData.get("productionOrderId"),
      specialActivityId: formData.get("specialActivityId"),
      orderProcessId: formData.get("orderProcessId") ?? "",
      entryDate: formData.get("entryDate"),
      quantity: formData.get("quantity"),
      remarks: formData.get("remarks") ?? "",
    });
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Invalid activity entry." };
    }
    if (parsed.data.quantity <= 0) {
      return { error: "Quantity must be greater than zero." };
    }

    const order = await prisma.productionOrder.findFirst({
      where: { id: parsed.data.productionOrderId, organizationId: context.organizationId },
      include: { processes: true, requestedSpecialActivities: true },
    });
    if (!order) {
      return { error: "Order not found." };
    }
    await requireGrantedPlant(context, order.plantId);

    if (!order.specialActivitiesRequested || order.requestedSpecialActivities.length === 0) {
      return { error: "This order does not request special activities." };
    }
    const requested = order.requestedSpecialActivities.some((row) => row.specialActivityId === parsed.data.specialActivityId);
    if (!requested) {
      return { error: "Activity must be one of the special activities requested on this order." };
    }

    const activity = await prisma.specialActivity.findFirst({
      where: { id: parsed.data.specialActivityId, organizationId: context.organizationId, isActive: true },
    });
    if (!activity) {
      return { error: "Special activity not found." };
    }

    const relatedProcess = parsed.data.orderProcessId
      ? order.processes.find((process) => process.id === parsed.data.orderProcessId)
      : null;
    if (parsed.data.orderProcessId && !relatedProcess) {
      return { error: "Related stage is not part of this order." };
    }

    const created = await prisma.specialActivityEntry.create({
      data: {
        organizationId: context.organizationId,
        plantId: order.plantId,
        productionOrderId: order.id,
        specialActivityId: activity.id,
        orderProcessId: relatedProcess?.id ?? null,
        entryDate: parseDateOnly(parsed.data.entryDate),
        quantity: parsed.data.quantity,
        remarks: parsed.data.remarks || null,
        createdByUserId: context.userId,
      },
    });

    await writeAuditLog({
      organizationId: context.organizationId,
      userId: context.userId,
      action: "CREATE",
      entityType: "SpecialActivityEntry",
      entityId: created.id,
      newValue: { activity: activity.code, quantity: parsed.data.quantity, orderId: order.id },
      reason: "Special/rework activity recorded without changing production history.",
    });

    revalidatePath(`/orders/${order.id}`);
    revalidatePath("/entries");
    listPath = `/orders/${order.id}`;
    successMessage = "Special activity recorded. Original production entries were not changed.";
  } catch (error) {
    rethrowNextNavigation(error);
    return { error: uniqueConstraintMessage(error, error instanceof AppError ? error.message : "Could not save activity.") };
  }

  redirectAfterSave(listPath, successMessage);
}

// Keep schema import used for legacy paths.
void productionEntrySchema;
