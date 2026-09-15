/** Display helpers for order lines. Categories are descriptive attributes of a line, never a quantity split. */

export type CategoryColumn = {
  id: string;
  name: string;
};

export type LineCategorySelection = {
  productCategoryId?: string;
  productCategory: { id?: string; name: string };
  textValue: string | null;
  selectedOptions?: { categoryOption: { name: string } }[];
};

export type LineForTable = {
  id: string;
  lineNumber: number;
  quantity: number;
  remarks?: string | null;
  product: {
    id?: string;
    name: string;
    details?: string | null;
    categoryAssignments?: { productCategory: { id: string; name: string } }[];
  };
  categorySelections?: LineCategorySelection[];
};

export function selectionCategoryId(selection: LineCategorySelection): string | null {
  return selection.productCategoryId ?? selection.productCategory.id ?? null;
}

export function lineCategoryIds(line: LineForTable): string[] {
  const ids: string[] = [];
  for (const selection of line.categorySelections ?? []) {
    const id = selectionCategoryId(selection);
    if (id && !ids.includes(id)) {
      ids.push(id);
    }
  }
  return ids;
}

/**
 * Union of categories mapped to products on these lines, plus any categories with a
 * recorded selection. Stable sort by category name. Used as the column set for
 * displaying/exporting a line's category attribute values.
 */
export function collectCategoryColumns(lines: LineForTable[]): CategoryColumn[] {
  const map = new Map<string, string>();
  for (const line of lines) {
    for (const assignment of line.product.categoryAssignments ?? []) {
      map.set(assignment.productCategory.id, assignment.productCategory.name);
    }
    for (const selection of line.categorySelections ?? []) {
      const id = selectionCategoryId(selection);
      if (id) {
        map.set(id, selection.productCategory.name);
      }
    }
  }
  return [...map.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Human-readable value for one line's answer to one category column: the open-text
 * value, the selected dropdown option name(s) joined with ", ", or "-" if unanswered
 * or not applicable to this line's product.
 */
export function formatCategoryValue(line: LineForTable, categoryId: string): string {
  const selection = (line.categorySelections ?? []).find(
    (item) => selectionCategoryId(item) === categoryId,
  );
  if (!selection) {
    return "-";
  }
  const optionNames = (selection.selectedOptions ?? []).map((row) => row.categoryOption.name);
  if (optionNames.length > 0) {
    return optionNames.join(", ");
  }
  const text = selection.textValue?.trim();
  return text ? text : "-";
}

export type LineRow = {
  lineId: string;
  lineNumber: number;
  productId: string;
  productName: string;
  details: string | null;
  quantity: number;
  remarks: string | null;
  /** categoryId -> display value ("-" if unanswered). */
  categoryValues: Record<string, string>;
};

export type LineTable = {
  columns: CategoryColumn[];
  rows: LineRow[];
  orderTotal: number;
};

/**
 * One row per order line (never merged/split by category). Columns are the union of
 * categories relevant to these lines; each cell shows that line's recorded value for
 * the category, purely descriptive and independent of quantity.
 */
export function buildLineTable(lines: LineForTable[]): LineTable {
  const columns = collectCategoryColumns(lines);
  const rows: LineRow[] = lines.map((line) => ({
    lineId: line.id,
    lineNumber: line.lineNumber,
    productId: line.product.id ?? line.product.name,
    productName: line.product.name,
    details: line.product.details ?? null,
    quantity: line.quantity,
    remarks: line.remarks ?? null,
    categoryValues: Object.fromEntries(
      columns.map((column) => [column.id, formatCategoryValue(line, column.id)]),
    ),
  }));
  const orderTotal = lines.reduce((sum, line) => sum + line.quantity, 0);
  return { columns, rows, orderTotal };
}
