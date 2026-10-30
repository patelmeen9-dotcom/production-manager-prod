import { formatCategoryDetail, formatOrderLineLabel } from "@/lib/orders/line-label";
import type { EntryLineOption, LineProgress, OrderMaterial } from "@/components/production/production-entry-form";
import { buildDispatchMeta, type DispatchMeta } from "@/lib/production/dispatch";

type LineWithCategories = {
  id: string;
  lineNumber: number;
  product: { name: string };
  categorySelections?: {
    productCategory: { name: string };
    textValue: string | null;
    selectedOptions?: { categoryOption: { name: string } }[];
  }[];
  quantity?: number;
  processes: {
    id: string;
    sequence: number;
    processName: string;
    plannedQuantity?: number;
  }[];
};

type MaterialForEntry = {
  id: string;
  name: string;
  totalQuantity: number;
};

export function buildEntryLinesByOrder(
  orders: {
    id: string;
    lines: LineWithCategories[];
  }[],
): Record<string, EntryLineOption[]> {
  return Object.fromEntries(
    orders.map((order) => [
      order.id,
      order.lines.map((line) => ({
        id: line.id,
        productName: line.product.name,
        label: formatOrderLineLabel(line),
        categoryDetail: formatCategoryDetail(line),
        quantity: line.quantity ?? 0,
        stages: line.processes.map((process) => ({
          value: `process:${process.id}`,
          label: `${process.sequence}. ${process.processName}`,
        })),
      })),
    ]),
  );
}

export function buildProgressByOrder(
  orders: {
    id: string;
    lines: {
      id: string;
      quantity: number;
      product: { name: string };
      processes: { id: string; sequence: number; processName: string; plannedQuantity: number }[];
    }[];
    productionEntries?: { orderProcessId: string; quantity: number }[];
  }[],
): Record<string, LineProgress[]> {
  return Object.fromEntries(
    orders.map((order) => {
      const cumulative = new Map<string, number>();
      for (const entry of order.productionEntries ?? []) {
        cumulative.set(entry.orderProcessId, (cumulative.get(entry.orderProcessId) ?? 0) + entry.quantity);
      }
      const lines: LineProgress[] = order.lines.map((line) => ({
        lineId: line.id,
        productName: line.product.name,
        quantity: line.quantity,
        stages: [...line.processes]
          .sort((a, b) => a.sequence - b.sequence)
          .map((process) => ({
            processName: process.processName,
            sequence: process.sequence,
            cumulative: cumulative.get(process.id) ?? 0,
            planned: process.plannedQuantity,
          })),
      }));
      return [order.id, lines];
    }),
  );
}

export function buildDispatchByOrder(
  orders: {
    id: string;
    lines: {
      id: string;
      quantity: number;
      processes: { id: string; sequence: number; plannedQuantity: number }[];
    }[];
    productionEntries?: { orderProcessId: string; quantity: number }[];
    dispatchEntries?: { quantity: number; productionOrderLineId: string | null }[];
  }[],
): Record<string, DispatchMeta> {
  return Object.fromEntries(
    orders.map((order) => [
      order.id,
      buildDispatchMeta({
        lines: order.lines.map((line) => ({
          id: line.id,
          quantity: line.quantity,
          processes: line.processes,
        })),
        productionEntries: order.productionEntries ?? [],
        existingDispatches: order.dispatchEntries ?? [],
      }),
    ]),
  );
}

export function buildMaterialsByOrder(
  orders: {
    id: string;
    /** All materials across all lines (order-level; stored on first line). */
    materials: MaterialForEntry[];
  }[],
): Record<string, OrderMaterial[]> {
  return Object.fromEntries(
    orders.map((order) => [
      order.id,
      order.materials.map((mat) => ({
        id: mat.id,
        name: mat.name,
        totalQuantity: mat.totalQuantity,
      })),
    ]),
  );
}
