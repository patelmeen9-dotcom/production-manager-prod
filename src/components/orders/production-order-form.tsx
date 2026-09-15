"use client";

import { useMemo, useState } from "react";
import { createProductionOrderAction } from "@/lib/orders/actions";
import { ActionForm, FormFull, FormGrid } from "@/components/masters/action-form";
import { Label } from "@/components/ui/label";
import { TextField } from "@/components/masters/fields";
import { Button } from "@/components/ui/button";

type Option = { id: string; name: string; code?: string };
type CategoryOption = { id: string; code: string; name: string; isActive: boolean };
type CategoryDef = {
  id: string;
  name: string;
  code: string;
  inputType: "OPEN_TEXT" | "DROPDOWN";
  choiceMode: "SINGLE" | "MULTI" | null;
  options: CategoryOption[];
};
type ProductOption = Option & {
  categoryIds: string[];
};
type MappingProcess = {
  processId: string;
  processCode: string;
  processName: string;
  sequence: number;
};

type LineProcess = MappingProcess & { expectedDays: string };

/** Order-level material (entered once for the whole order). */
type MaterialDraft = {
  key: string;
  name: string;
  totalQuantity: string;
  quantityReceived: string;
};

/** A line's answer for one category: free text (OPEN_TEXT) or selected option ids (DROPDOWN). */
type CategoryValueDraft = {
  text: string;
  optionIds: string[];
};

type LineDraft = {
  key: string;
  productId: string;
  quantity: string;
  remarks: string;
  /** Category answers per mapped category id. Purely descriptive — never affects quantity. */
  categoryValues: Record<string, CategoryValueDraft>;
  processes: LineProcess[];
};

function newMaterial(): MaterialDraft {
  return {
    key: `mat-${Math.random().toString(36).slice(2, 9)}`,
    name: "",
    totalQuantity: "",
    quantityReceived: "0",
  };
}

function newLine(): LineDraft {
  return {
    key: `line-${Math.random().toString(36).slice(2, 10)}`,
    productId: "",
    quantity: "",
    remarks: "",
    categoryValues: {},
    processes: [],
  };
}

function parseQty(value: string | undefined): number {
  const qty = Number(value);
  return Number.isFinite(qty) && qty > 0 ? qty : 0;
}

export function ProductionOrderForm(props: {
  clients: Option[];
  plants: Option[];
  products: ProductOption[];
  categories: CategoryDef[];
  specialActivities: Option[];
  /** plantId -> productId -> ordered processes from master mapping */
  mappingsByPlantProduct: Record<string, Record<string, MappingProcess[]>>;
}) {
  const [startDateType, setStartDateType] = useState("NONE");
  const [dueDateType, setDueDateType] = useState("DAYS_FROM_START");
  const [specialRequested, setSpecialRequested] = useState(false);
  const [plantId, setPlantId] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([newLine()]);
  const [materials, setMaterials] = useState<MaterialDraft[]>([]);

  const categoriesById = useMemo(
    () => new Map(props.categories.map((category) => [category.id, category])),
    [props.categories],
  );
  const productsById = useMemo(
    () => new Map(props.products.map((product) => [product.id, product])),
    [props.products],
  );

  const matrixColumns = useMemo(() => {
    const map = new Map<string, CategoryDef>();
    for (const line of lines) {
      for (const categoryId of productsById.get(line.productId)?.categoryIds ?? []) {
        const category = categoriesById.get(categoryId);
        if (category) {
          map.set(category.id, category);
        }
      }
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [lines, productsById, categoriesById]);

  function rowTotal(line: LineDraft): number {
    return parseQty(line.quantity);
  }

  const totalQuantity = lines.reduce((sum, line) => sum + rowTotal(line), 0);

  function updateLine(key: string, patch: Partial<LineDraft>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function applyProductMapping(lineKey: string, productId: string, nextPlantId = plantId) {
    const mapping = nextPlantId && productId ? (props.mappingsByPlantProduct[nextPlantId]?.[productId] ?? []) : [];
    updateLine(lineKey, {
      productId,
      processes: mapping.map((row) => ({ ...row, expectedDays: "" })),
      categoryValues: {},
    });
  }

  function updateMaterial(key: string, patch: Partial<MaterialDraft>) {
    setMaterials((current) => current.map((mat) => (mat.key === key ? { ...mat, ...patch } : mat)));
  }

  const linesJson = JSON.stringify(
    lines
      .filter((line) => line.productId && parseQty(line.quantity) > 0)
      .map((line) => {
        const product = productsById.get(line.productId);
        const categoryIds = product?.categoryIds ?? [];
        const categorySelections = categoryIds
          .map((categoryId) => {
            const category = categoriesById.get(categoryId);
            const value = line.categoryValues[categoryId];
            if (!category || !value) {
              return null;
            }
            if (category.inputType === "DROPDOWN") {
              return value.optionIds.length > 0
                ? { productCategoryId: categoryId, textValue: "", optionIds: value.optionIds }
                : null;
            }
            return value.text.trim()
              ? { productCategoryId: categoryId, textValue: value.text.trim(), optionIds: [] }
              : null;
          })
          .filter((selection): selection is { productCategoryId: string; textValue: string; optionIds: string[] } =>
            selection !== null,
          );
        return {
          productId: line.productId,
          quantity: parseQty(line.quantity),
          remarks: line.remarks,
          categorySelections,
          processes: line.processes.map((process, index) => ({
            processId: process.processId,
            processCode: process.processCode,
            processName: process.processName,
            sequence: index + 1,
            expectedDays: process.expectedDays,
          })),
          materials: [],
        };
      }),
  );

  // Order-level materials are passed separately and will be attached to the first line server-side
  const materialsJson = JSON.stringify(
    materials
      .filter((mat) => mat.name.trim() && parseQty(mat.totalQuantity) > 0)
      .map((mat) => ({
        name: mat.name.trim(),
        totalQuantity: parseQty(mat.totalQuantity),
        quantityReceived: Number(mat.quantityReceived) || 0,
      })),
  );

  return (
    <ActionForm action={createProductionOrderAction} submitLabel="Create order">
      <input type="hidden" name="linesJson" value={linesJson} />
      <input type="hidden" name="materialsJson" value={materialsJson} />
      <FormGrid cols={3}>
        <div>
          <Label htmlFor="clientId">Client</Label>
          <select id="clientId" name="clientId" required className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm">
            <option value="">Select client</option>
            {props.clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </select>
        </div>
        <TextField name="orderNumber" label="Project / order number" required />
        <div>
          <Label htmlFor="plantId">Plant</Label>
          <select
            id="plantId"
            name="plantId"
            required
            value={plantId}
            onChange={(event) => {
              const next = event.target.value;
              setPlantId(next);
              setLines((current) =>
                current.map((line) => ({
                  ...line,
                  processes:
                    line.productId && next
                      ? (props.mappingsByPlantProduct[next]?.[line.productId] ?? []).map((row) => ({
                        ...row,
                        expectedDays: "",
                      }))
                      : [],
                })),
              );
            }}
            className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm"
          >
            <option value="">Select plant</option>
            {props.plants.map((plant) => (
              <option key={plant.id} value={plant.id}>
                {plant.name}
              </option>
            ))}
          </select>
        </div>
        <TextField name="orderDate" label="Order date" type="date" required />
        <div>
          <Label htmlFor="startDateType">Production start</Label>
          <select
            id="startDateType"
            name="startDateType"
            value={startDateType}
            onChange={(event) => setStartDateType(event.target.value)}
            className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm"
          >
            <option value="NONE">Start immediately (use order date)</option>
            <option value="FIXED_DATE">Specific start date</option>
            <option value="DAYS_FROM_ORDER">Days from order date</option>
          </select>
        </div>
        {startDateType === "FIXED_DATE" ? <TextField name="startDate" label="Production start date" type="date" required /> : null}
        {startDateType === "DAYS_FROM_ORDER" ? <TextField name="startDays" label="Start after (days)" type="number" required /> : null}
        <div>
          <Label htmlFor="dueDateType">Due date method</Label>
          <select
            id="dueDateType"
            name="dueDateType"
            value={dueDateType}
            onChange={(event) => setDueDateType(event.target.value)}
            className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm"
          >
            <option value="DAYS_FROM_START">Days from production start date</option>
            <option value="FIXED_DATE">Specific due date</option>
            <option value="DAYS_FROM_ORDER">Days from order date</option>
          </select>
        </div>
        {dueDateType === "FIXED_DATE" ? <TextField name="dueDate" label="Due date" type="date" required /> : null}
        {dueDateType === "DAYS_FROM_START" || dueDateType === "DAYS_FROM_ORDER" ? (
          <TextField
            name="dueDays"
            label={dueDateType === "DAYS_FROM_START" ? "Due days from production start" : "Due days from order date"}
            type="number"
            required
          />
        ) : null}
        <div>
          <Label htmlFor="priority">Priority</Label>
          <select id="priority" name="priority" defaultValue="NORMAL" className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm">
            <option value="LOW">Low</option>
            <option value="NORMAL">Normal</option>
            <option value="HIGH">High</option>
            <option value="URGENT">Urgent</option>
          </select>
        </div>

        <FormFull>
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-medium text-white">Order lines</h2>
              <p className="text-xs text-slate-500">
                Rows are products. Enter one quantity per line. Columns are the product&apos;s mapped categories —
                fill in details (text or pick from the dropdown); they describe the line and don&apos;t affect quantity.
              </p>
            </div>
            <p className="text-sm text-slate-300">Total order qty: {totalQuantity || "—"}</p>
          </div>

          <div className="mt-3 overflow-x-auto rounded-md border border-slate-700">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-slate-700 bg-slate-900/80 text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-3 py-2">Product</th>
                  <th className="px-3 py-2 text-right">Quantity</th>
                  {matrixColumns.map((category) => (
                    <th key={category.id} className="px-3 py-2">
                      {category.name}
                    </th>
                  ))}
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => {
                  const mappedIds = new Set(productsById.get(line.productId)?.categoryIds ?? []);
                  return (
                    <tr key={line.key} className="border-b border-slate-800">
                      <td className="px-3 py-2">
                        <select
                          required
                          value={line.productId}
                          onChange={(event) => applyProductMapping(line.key, event.target.value)}
                          className="w-full min-w-[160px] rounded-md border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm"
                        >
                          <option value="">Select product</option>
                          {props.products.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          min={1}
                          required={Boolean(line.productId)}
                          value={line.quantity}
                          onChange={(event) => updateLine(line.key, { quantity: event.target.value })}
                          className="ml-auto w-24 rounded-md border border-slate-600 bg-slate-900 px-2 py-1.5 text-right text-sm"
                          placeholder="qty"
                        />
                      </td>
                      {matrixColumns.map((category) => {
                        const applicable = mappedIds.has(category.id);
                        if (!applicable) {
                          return (
                            <td key={category.id} className="px-3 py-2">
                              <span className="text-slate-500">-</span>
                            </td>
                          );
                        }
                        const value = line.categoryValues[category.id] ?? { text: "", optionIds: [] };
                        if (category.inputType === "DROPDOWN") {
                          if (category.choiceMode === "MULTI") {
                            return (
                              <td key={category.id} className="px-3 py-2">
                                <div className="flex max-h-24 min-w-[160px] flex-col gap-1 overflow-y-auto rounded-md border border-slate-600 bg-slate-900 p-2">
                                  {category.options.map((option) => (
                                    <label key={option.id} className="flex items-center gap-2 text-xs text-slate-200">
                                      <input
                                        type="checkbox"
                                        checked={value.optionIds.includes(option.id)}
                                        onChange={(event) => {
                                          const next = new Set(value.optionIds);
                                          if (event.target.checked) next.add(option.id);
                                          else next.delete(option.id);
                                          updateLine(line.key, {
                                            categoryValues: {
                                              ...line.categoryValues,
                                              [category.id]: { text: "", optionIds: [...next] },
                                            },
                                          });
                                        }}
                                      />
                                      {option.name}
                                    </label>
                                  ))}
                                </div>
                              </td>
                            );
                          }
                          return (
                            <td key={category.id} className="px-3 py-2">
                              <select
                                value={value.optionIds[0] ?? ""}
                                onChange={(event) =>
                                  updateLine(line.key, {
                                    categoryValues: {
                                      ...line.categoryValues,
                                      [category.id]: {
                                        text: "",
                                        optionIds: event.target.value ? [event.target.value] : [],
                                      },
                                    },
                                  })
                                }
                                className="w-full min-w-[140px] rounded-md border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm"
                              >
                                <option value="">—</option>
                                {category.options.map((option) => (
                                  <option key={option.id} value={option.id}>
                                    {option.name}
                                  </option>
                                ))}
                              </select>
                            </td>
                          );
                        }
                        return (
                          <td key={category.id} className="px-3 py-2">
                            <input
                              type="text"
                              value={value.text}
                              onChange={(event) =>
                                updateLine(line.key, {
                                  categoryValues: {
                                    ...line.categoryValues,
                                    [category.id]: { text: event.target.value, optionIds: [] },
                                  },
                                })
                              }
                              className="w-full min-w-[140px] rounded-md border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm"
                              placeholder="—"
                            />
                          </td>
                        );
                      })}
                      <td className="px-3 py-2">
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={lines.length === 1}
                          onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))}
                        >
                          Remove
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-slate-900/80">
                  <td className="px-3 py-2 text-xs font-semibold text-slate-200">Total order quantity</td>
                  <td className="px-3 py-2 text-right font-mono font-semibold text-white">{totalQuantity || "—"}</td>
                  {matrixColumns.map((category) => (
                    <td key={category.id} />
                  ))}
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
          <Button type="button" variant="secondary" className="mt-3" onClick={() => setLines((current) => [...current, newLine()])}>
            Add product
          </Button>

          <div className="mt-4 space-y-4">
            {lines.map((line) => {
              const lineQty = rowTotal(line);
              const product = productsById.get(line.productId);
              if (!line.productId) {
                return null;
              }
              return (
                <div key={`${line.key}-details`} className="space-y-3 rounded-md border border-slate-700 p-3">
                  <p className="text-sm font-medium text-white">
                    {product?.name ?? "Product"} · qty {lineQty || "—"}
                  </p>
                  <div>
                    <Label>Line remarks (optional)</Label>
                    <textarea
                      rows={2}
                      value={line.remarks}
                      onChange={(event) => updateLine(line.key, { remarks: event.target.value })}
                      className="mt-1 w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm"
                    />
                  </div>

                  <div>
                    <p className="text-xs font-medium text-slate-300">Process stages (inherited — editable)</p>
                    <p className="text-xs text-slate-500">
                      Expected days per stage (optional) override the process master units/day plan for timing.
                    </p>
                    {line.processes.length === 0 ? (
                      <p className="mt-1 text-xs text-amber-300">
                        {plantId && line.productId
                          ? "No plant/product mapping found. Create a mapping first."
                          : "Select plant and product to load processes."}
                      </p>
                    ) : (
                      <ol className="mt-2 space-y-2">
                        {line.processes.map((process, processIndex) => (
                          <li
                            key={`${process.processId}-${processIndex}`}
                            className="grid gap-2 rounded border border-slate-800 p-2 sm:grid-cols-[1fr_120px_auto] sm:items-end text-sm text-slate-200"
                          >
                            <span className="sm:self-center">
                              {processIndex + 1}. {process.processName} ({process.processCode})
                            </span>
                            <div>
                              <Label className="text-xs text-slate-400">Expected days</Label>
                              <input
                                type="number"
                                min={1}
                                value={process.expectedDays}
                                onChange={(event) => {
                                  const next = line.processes.map((row, index) =>
                                    index === processIndex ? { ...row, expectedDays: event.target.value } : row,
                                  );
                                  updateLine(line.key, { processes: next });
                                }}
                                className="mt-1 w-full rounded-md border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm"
                                placeholder="optional"
                              />
                            </div>
                            <div className="flex gap-1">
                              <Button
                                type="button"
                                variant="ghost"
                                disabled={processIndex === 0}
                                onClick={() => {
                                  const next = [...line.processes];
                                  const tmp = next[processIndex - 1]!;
                                  next[processIndex - 1] = next[processIndex]!;
                                  next[processIndex] = tmp;
                                  updateLine(line.key, { processes: next });
                                }}
                              >
                                Up
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                disabled={processIndex === line.processes.length - 1}
                                onClick={() => {
                                  const next = [...line.processes];
                                  const tmp = next[processIndex + 1]!;
                                  next[processIndex + 1] = next[processIndex]!;
                                  next[processIndex] = tmp;
                                  updateLine(line.key, { processes: next });
                                }}
                              >
                                Down
                              </Button>
                              <Button
                                type="button"
                                variant="secondary"
                                disabled={line.processes.length === 1}
                                onClick={() => {
                                  updateLine(line.key, {
                                    processes: line.processes.filter((_, i) => i !== processIndex),
                                  });
                                }}
                              >
                                Remove
                              </Button>
                            </div>
                          </li>
                        ))}
                      </ol>
                    )}
                    {plantId && line.productId ? (
                      <div className="mt-2">
                        <Label>Add process from mapping</Label>
                        <select
                          className="mt-1 w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm"
                          value=""
                          onChange={(event) => {
                            const code = event.target.value;
                            const source = props.mappingsByPlantProduct[plantId]?.[line.productId] ?? [];
                            const row = source.find((item) => item.processCode === code);
                            if (!row) return;
                            if (line.processes.some((process) => process.processCode === code)) return;
                            updateLine(line.key, {
                              processes: [...line.processes, { ...row, expectedDays: "" }],
                            });
                          }}
                        >
                          <option value="">Select process to add</option>
                          {(props.mappingsByPlantProduct[plantId]?.[line.productId] ?? [])
                            .filter((row) => !line.processes.some((process) => process.processCode === row.processCode))
                            .map((row) => (
                              <option key={row.processCode} value={row.processCode}>
                                {row.processName}
                              </option>
                            ))}
                        </select>
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </FormFull>

        {/* ── Order-level materials ── */}
        <FormFull>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-medium text-white">Order materials (optional)</h2>
              <p className="text-xs text-slate-500">
                Materials required for this order. Enter the total quantity needed for the entire order.
              </p>
            </div>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setMaterials((current) => [...current, newMaterial()])}
            >
              Add material
            </Button>
          </div>
          {materials.length > 0 ? (
            <div className="mt-3 space-y-2">
              {materials.map((mat) => (
                <div key={mat.key} className="grid gap-3 rounded border border-slate-700 p-3 sm:grid-cols-[1fr_160px_160px_auto]">
                  <div>
                    <Label>Material name</Label>
                    <input
                      value={mat.name}
                      onChange={(event) => updateMaterial(mat.key, { name: event.target.value })}
                      className="mt-1 w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm"
                      placeholder="e.g. Lamination sheet"
                    />
                  </div>
                  <div>
                    <Label>Total quantity required</Label>
                    <input
                      type="number"
                      min={1}
                      value={mat.totalQuantity}
                      onChange={(event) => updateMaterial(mat.key, { totalQuantity: event.target.value })}
                      className="mt-1 w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm"
                      placeholder="e.g. 500"
                    />
                  </div>
                  <div>
                    <Label>Qty received</Label>
                    <input
                      type="number"
                      min={0}
                      value={mat.quantityReceived}
                      onChange={(event) => updateMaterial(mat.key, { quantityReceived: event.target.value })}
                      className="mt-1 w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm"
                    />
                  </div>
                  <div className="flex items-end">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setMaterials((current) => current.filter((m) => m.key !== mat.key))}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </FormFull>

        <FormFull>
          <label className="flex items-center gap-2 text-sm text-slate-200">
            <input
              type="checkbox"
              name="specialActivitiesRequested"
              checked={specialRequested}
              onChange={(event) => setSpecialRequested(event.target.checked)}
            />
            Special activities requested
          </label>
        </FormFull>
        {specialRequested ? (
          <FormFull>
            <Label>Requested special activities</Label>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {props.specialActivities.map((activity) => (
                <label key={activity.id} className="flex items-center gap-2 rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-200">
                  <input type="checkbox" name="specialActivityIds" value={activity.id} />
                  {activity.name}
                </label>
              ))}
            </div>
          </FormFull>
        ) : null}
        <FormFull>
          <TextField name="remarks" label="Order remarks" />
        </FormFull>
        <FormFull>
          <div className="space-y-2">
            <div>
              <Label htmlFor="attachment">Attachment (optional)</Label>
              <p className="text-xs text-slate-500">Attach an XLSX or PDF file — max 20 MB</p>
            </div>
            <input
              id="attachment"
              type="file"
              name="attachment"
              accept=".xlsx,.pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/pdf"
              className="block w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-1.5 text-sm text-slate-200
                file:mr-3 file:rounded file:border-0 file:bg-slate-700 file:px-2 file:py-1 file:text-xs file:font-medium
                file:text-slate-200 hover:file:bg-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
        </FormFull>
      </FormGrid>
    </ActionForm>
  );
}
