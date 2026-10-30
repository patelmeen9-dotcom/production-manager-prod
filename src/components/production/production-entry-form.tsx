"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createProductionEntryAction } from "@/lib/production/actions";
import { ActionForm, FormFull, FormGrid } from "@/components/masters/action-form";
import { Label } from "@/components/ui/label";
import { TextField } from "@/components/masters/fields";
import type { DispatchMeta } from "@/lib/production/dispatch";

export type LineStageProgress = {
  processName: string;
  sequence: number;
  cumulative: number;
  planned: number;
};

export type LineProgress = {
  lineId: string;
  productName: string;
  quantity: number;
  stages: LineStageProgress[];
};

export type EntryLineOption = {
  id: string;
  productName: string;
  /** Full label for the product select (product + categories). */
  label: string;
  /** Category detail text shown under the product select. */
  categoryDetail: string;
  quantity: number;
  stages: { value: string; label: string }[];
};

export type OrderMaterial = {
  id: string;
  name: string;
  totalQuantity: number;
};

export type EntryOrderOption = {
  id: string;
  orderNumber: string;
  clientWorkOrderNumber?: string | null;
  productionDate?: string | null;
  dispatchDate?: string | null;
};

export function ProductionEntryForm(props: {
  orders: EntryOrderOption[];
  /** Order lines (products) with category detail and their stages. */
  linesByOrder: Record<string, EntryLineOption[]>;
  /** Order-level special activities shown after a product is selected. */
  activitiesByOrder?: Record<string, { value: string; label: string }[]>;
  /** Order-level materials (if any) keyed by order id. */
  materialsByOrder?: Record<string, OrderMaterial[]>;
  /** Remaining dispatchable finished goods, once production steps are complete. */
  dispatchByOrder?: Record<string, DispatchMeta>;
  /** Cumulative process progress for the selected order. */
  progressByOrder?: Record<string, LineProgress[]>;
  defaultOrderId?: string;
  /** When editing an existing production entry. */
  entry?: {
    id: string;
    productionOrderId: string;
    orderProcessId: string;
    lineId?: string;
    entryDate: string;
    quantity: number;
    remarks: string | null;
  };
  action?: (state: { error?: string; success?: string }, formData: FormData) => Promise<{ error?: string; success?: string }>;
  submitLabel?: string;
  showBackToList?: boolean;
}) {
  const action = props.action ?? createProductionEntryAction;
  const [orderId, setOrderId] = useState(props.entry?.productionOrderId ?? props.defaultOrderId ?? "");
  const lines = useMemo(() => props.linesByOrder[orderId] ?? [], [orderId, props.linesByOrder]);
  const activities = useMemo(() => props.activitiesByOrder?.[orderId] ?? [], [orderId, props.activitiesByOrder]);
  const orderMaterials = useMemo(() => props.materialsByOrder?.[orderId] ?? [], [orderId, props.materialsByOrder]);

  const initialLineId =
    props.entry?.lineId ??
    lines.find((line) => line.stages.some((stage) => stage.value === `process:${props.entry?.orderProcessId}`))?.id ??
    "";
  const [lineId, setLineId] = useState(initialLineId);
  const [lineDropdownOpen, setLineDropdownOpen] = useState(false);
  const lineDropdownRef = useRef<HTMLDivElement>(null);
  const selectedLine = useMemo(() => lines.find((line) => line.id === lineId) ?? null, [lines, lineId]);

  // Material usage quantities: materialId -> qty string
  const [materialUsages, setMaterialUsages] = useState<Record<string, string>>({});
  const [stage, setStage] = useState(props.entry ? `process:${props.entry.orderProcessId}` : "");
  const [quantity, setQuantity] = useState(props.entry ? String(props.entry.quantity) : "");
  const [dispatchRemaining, setDispatchRemaining] = useState(false);
  const dispatchMeta = props.dispatchByOrder?.[orderId];
  const selectedOrder = useMemo(
    () => props.orders.find((order) => order.id === orderId) ?? null,
    [props.orders, orderId],
  );
  const orderProgress = props.progressByOrder?.[orderId] ?? [];
  const lineProgress = orderProgress.find((line) => line.lineId === lineId) ?? null;
  const [ourSearchOpen, setOurSearchOpen] = useState(false);
  const [woSearchOpen, setWoSearchOpen] = useState(false);
  const [ourQuery, setOurQuery] = useState("");
  const [woQuery, setWoQuery] = useState("");
  const ourSearchRef = useRef<HTMLDivElement>(null);
  const woSearchRef = useRef<HTMLDivElement>(null);

  function selectOrder(nextId: string) {
    setOrderId(nextId);
    setLineId("");
    setStage("");
    setDispatchRemaining(false);
    setMaterialUsages({});
    setOurSearchOpen(false);
    setWoSearchOpen(false);
    setOurQuery("");
    setWoQuery("");
  }

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (ourSearchRef.current && !ourSearchRef.current.contains(target)) {
        setOurSearchOpen(false);
      }
      if (woSearchRef.current && !woSearchRef.current.contains(target)) {
        setWoSearchOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!lineDropdownOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (
        lineDropdownRef.current &&
        !lineDropdownRef.current.contains(event.target as Node)
      ) {
        setLineDropdownOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [lineDropdownOpen]);

  const remainingForStage = useMemo(() => {
    if (!dispatchMeta || !stage.startsWith("dispatch:")) {
      return 0;
    }
    if (stage === "dispatch:order") {
      return dispatchMeta.orderRemaining;
    }
    const dispatchLineId = stage.slice("dispatch:".length);
    return dispatchMeta.lines[dispatchLineId]?.remaining ?? 0;
  }, [dispatchMeta, stage]);

  const stageOptions = useMemo(() => {
    if (!selectedLine) {
      return [];
    }
    const dispatchOptions: { value: string; label: string }[] = [];
    const lineMeta = dispatchMeta?.lines[selectedLine.id];
    if (lineMeta?.complete && lineMeta.remaining > 0) {
      dispatchOptions.push({
        value: `dispatch:${selectedLine.id}`,
        label: `Dispatch this product (remaining ${lineMeta.remaining})`,
      });
    }
    if (dispatchMeta?.allComplete && dispatchMeta.orderRemaining > 0) {
      dispatchOptions.push({
        value: "dispatch:order",
        label: `Dispatch remaining (entire order, ${dispatchMeta.orderRemaining})`,
      });
    }
    return [...selectedLine.stages, ...dispatchOptions, ...activities];
  }, [selectedLine, activities, dispatchMeta]);

  const isDispatch = stage.startsWith("dispatch:");
  const defaultStage = props.entry ? `process:${props.entry.orderProcessId}` : "";

  const ourOrderOptions = useMemo(() => {
    const q = ourQuery.trim().toLowerCase();
    return props.orders
      .filter((order) => !q || order.orderNumber.toLowerCase().includes(q))
      .slice(0, 40);
  }, [props.orders, ourQuery]);

  const woOrderOptions = useMemo(() => {
    const q = woQuery.trim().toLowerCase();
    return props.orders
      .filter((order) => order.clientWorkOrderNumber)
      .filter((order) => !q || (order.clientWorkOrderNumber ?? "").toLowerCase().includes(q))
      .slice(0, 40);
  }, [props.orders, woQuery]);

  // Build materialUsagesJson for form submission
  const materialUsagesJson = JSON.stringify(
    orderMaterials
      .filter((mat) => {
        const qty = Number(materialUsages[mat.id]);
        return Number.isFinite(qty) && qty > 0;
      })
      .map((mat) => ({
        materialId: mat.id,
        quantityUsed: Number(materialUsages[mat.id]),
      })),
  );

  return (
    <div className="space-y-3">
      <ActionForm action={action} submitLabel={props.submitLabel ?? "Save incremental entry"}>
        {props.entry ? <input type="hidden" name="entryId" value={props.entry.id} /> : null}
        <input type="hidden" name="materialUsagesJson" value={materialUsagesJson} />
        <FormGrid>
          <div>
            <Label htmlFor="ourOrderSearch">Our order number</Label>
            <input type="hidden" id="productionOrderId" name="productionOrderId" value={orderId} required />
            <div ref={ourSearchRef} className="relative">
              <input
                id="ourOrderSearch"
                type="text"
                autoComplete="off"
                disabled={Boolean(props.entry)}
                value={ourSearchOpen ? ourQuery : (selectedOrder?.orderNumber ?? "")}
                placeholder="Search our order number"
                onFocus={() => {
                  setOurSearchOpen(true);
                  setOurQuery("");
                }}
                onChange={(event) => {
                  setOurSearchOpen(true);
                  setOurQuery(event.target.value);
                }}
                className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm"
              />
              {ourSearchOpen && !props.entry ? (
                <div className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-slate-700 bg-slate-900 p-1 shadow-xl">
                  {ourOrderOptions.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-slate-500">No matching order.</p>
                  ) : (
                    ourOrderOptions.map((order) => (
                      <button
                        key={order.id}
                        type="button"
                        onClick={() => selectOrder(order.id)}
                        className={`w-full rounded-md px-3 py-2 text-left text-sm hover:bg-slate-800 ${
                          order.id === orderId ? "bg-slate-800" : ""
                        }`}
                      >
                        <p className="font-medium text-slate-100">{order.orderNumber}</p>
                        <p className="text-xs text-slate-400">{order.clientWorkOrderNumber || "No client WO"}</p>
                      </button>
                    ))
                  )}
                </div>
              ) : null}
            </div>
          </div>

          <div>
            <Label htmlFor="clientWoSearch">Client work order number</Label>
            <div ref={woSearchRef} className="relative">
              <input
                id="clientWoSearch"
                type="text"
                autoComplete="off"
                disabled={Boolean(props.entry)}
                value={woSearchOpen ? woQuery : (selectedOrder?.clientWorkOrderNumber ?? "")}
                placeholder="Search client work order"
                onFocus={() => {
                  setWoSearchOpen(true);
                  setWoQuery("");
                }}
                onChange={(event) => {
                  setWoSearchOpen(true);
                  setWoQuery(event.target.value);
                }}
                className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm"
              />
              {woSearchOpen && !props.entry ? (
                <div className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-slate-700 bg-slate-900 p-1 shadow-xl">
                  {woOrderOptions.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-slate-500">No matching client work order.</p>
                  ) : (
                    woOrderOptions.map((order) => (
                      <button
                        key={order.id}
                        type="button"
                        onClick={() => selectOrder(order.id)}
                        className={`w-full rounded-md px-3 py-2 text-left text-sm hover:bg-slate-800 ${
                          order.id === orderId ? "bg-slate-800" : ""
                        }`}
                      >
                        <p className="font-medium text-slate-100">{order.clientWorkOrderNumber}</p>
                        <p className="text-xs text-slate-400">Our order {order.orderNumber}</p>
                      </button>
                    ))
                  )}
                </div>
              ) : null}
            </div>
          </div>

          {selectedOrder ? (
            <FormFull>
              <div className="rounded-md border border-slate-700 bg-slate-950/60 px-3 py-2 text-xs text-slate-300">
                <p>
                  <span className="text-slate-400">Production date: </span>
                  {selectedOrder.productionDate || "—"}
                  <span className="ml-3 text-slate-400">Dispatch date: </span>
                  {selectedOrder.dispatchDate || "—"}
                </p>
                <p className="mt-2 font-semibold text-slate-200">Progress so far</p>
                {orderProgress.length === 0 ? (
                  <p className="mt-1 text-slate-500">No process snapshot on this order.</p>
                ) : (
                  <div className="mt-1 space-y-1">
                    {orderProgress.map((line) => (
                      <p key={line.lineId}>
                        <span className="text-slate-200">{line.productName}: </span>
                        {line.stages.length === 0
                          ? "no stages"
                          : line.stages
                              .map((stage) => `${stage.processName} ${stage.cumulative}/${stage.planned}`)
                              .join(" · ")}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            </FormFull>
          ) : null}

          <div>
            <Label htmlFor="orderLineId">Product / line</Label>
            <div ref={lineDropdownRef} className="relative">
  {/* Keep the real field for form submission */}
  <select
    id="orderLineId"
    name="orderLineId"
    required
    value={lineId}
    onChange={(event) => setLineId(event.target.value)}
    className="pointer-events-none absolute h-0 w-0 opacity-0"
    tabIndex={-1}
    aria-hidden="true"
  >
    <option value="">Please select</option>
    {lines.map((line) => (
      <option key={line.id} value={line.id}>
        {line.label}
      </option>
    ))}
  </select>

  <button
    type="button"
    disabled={!orderId || Boolean(props.entry)}
    onClick={() => setLineDropdownOpen((open) => !open)}
    className="flex w-full items-center justify-between rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-left text-sm"
  >
    {selectedLine ? (
      <div className="min-w-0">
        <p className="truncate font-medium text-slate-100">
          Line {lines.findIndex((line) => line.id === lineId) + 1} ·{" "}
          {selectedLine.productName}
        </p>
        <p className="mt-0.5 truncate text-xs text-slate-400">
          {selectedLine.categoryDetail}
        </p>
      </div>
    ) : (
      <span className="text-slate-400">Please select</span>
    )}

    <span className="ml-2 text-slate-400">⌄</span>
  </button>

  {lineDropdownOpen && (
    <div className="absolute z-50 mt-1 max-h-80 w-full overflow-y-auto rounded-md border border-slate-700 bg-slate-900 p-1 shadow-xl">
      {lines.map((line, index) => (
        <button
          key={line.id}
          type="button"
          onClick={() => {
            setLineId(line.id);
            setStage("");
            setDispatchRemaining(false);
            setLineDropdownOpen(false);
          }}
          className={`w-full rounded-md px-3 py-3 text-left hover:bg-slate-800 ${
            line.id === lineId ? "bg-slate-800" : ""
          }`}
        >
          <p className="font-medium text-slate-100">
            Line {index + 1} · {line.productName}
          </p>

          {line.categoryDetail ? (
            <p className="mt-1 whitespace-normal text-xs leading-5 text-slate-400">
              {line.categoryDetail}
            </p>
          ) : (
            <p className="mt-1 text-xs text-slate-500">
              No category details specified.
            </p>
          )}
        </button>
      ))}
    </div>
  )}
</div>

            {selectedLine ? (
              <div className="mt-2 rounded-md border border-slate-700 bg-slate-950/60 px-3 py-2 text-xs text-slate-300">
                <p className="font-medium text-slate-200">{selectedLine.productName}</p>
                <p className="mt-1 text-slate-100">
                  Total quantity for this product: {lineProgress?.quantity ?? selectedLine.quantity}
                </p>
                <p className="mt-1 text-slate-400">
                  {selectedLine.categoryDetail || "No category details specified for this line."}
                </p>
                {lineProgress && lineProgress.stages.length > 0 ? (
                  <p className="mt-1">
                    {lineProgress.stages
                      .map((stage) => `${stage.processName} ${stage.cumulative}/${stage.planned}`)
                      .join(" · ")}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="mt-1 text-xs text-slate-500">Select a product line to see quantity and category details.</p>
            )}
          </div>

          <div>
            <Label htmlFor="stageOrActivity">Stage or special activity</Label>
            <select
              id="stageOrActivity"
              name="stageOrActivity"
              required
              value={stage || defaultStage}
              onChange={(event) => {
                setStage(event.target.value);
                setDispatchRemaining(false);
              }}
              className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm"
              disabled={!lineId}
            >
              <option value="">Please select</option>
              {stageOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-500">
              Stages are for the selected product line. Dispatch is available after every step is complete.
            </p>
          </div>

          <div>
            <Label htmlFor="quantity">{isDispatch ? "Quantity dispatched" : "Quantity completed"}</Label>
            <input
              id="quantity"
              name="quantity"
              type="number"
              required
              min={1}
              value={dispatchRemaining ? String(remainingForStage) : quantity}
              onChange={(event) => {
                setDispatchRemaining(false);
                setQuantity(event.target.value);
              }}
              className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm"
            />
            {isDispatch ? (
              <label className="mt-2 flex items-center gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={dispatchRemaining}
                  onChange={(event) => {
                    setDispatchRemaining(event.target.checked);
                    if (event.target.checked) {
                      setQuantity(String(remainingForStage));
                    }
                  }}
                />
                Dispatch remaining ({remainingForStage})
              </label>
            ) : null}
          </div>
          <TextField
            name="entryDate"
            label="Date"
            type="date"
            required
            defaultValue={props.entry?.entryDate ?? new Date().toISOString().split("T")[0]}
          />
          <FormFull>
            <TextField name="remarks" label="Remarks" defaultValue={props.entry?.remarks ?? ""} />
          </FormFull>

          {/* ── Optional material usage for this entry ── */}
          {orderMaterials.length > 0 && !isDispatch ? (
            <FormFull>
              <div>
                <p className="text-xs font-semibold text-slate-300">
                  Material usage in this entry (optional)
                </p>
                <p className="text-xs text-slate-500">
                  Enter how much of each material was consumed during this production entry. Leave blank if none used.
                </p>
              </div>
              <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {orderMaterials.map((mat) => (
                  <div key={mat.id}>
                    <Label className="text-xs">{mat.name}</Label>
                    <p className="text-[10px] text-slate-500">Total required: {mat.totalQuantity}</p>
                    <input
                      type="number"
                      min={0}
                      value={materialUsages[mat.id] ?? ""}
                      onChange={(event) =>
                        setMaterialUsages((prev) => ({
                          ...prev,
                          [mat.id]: event.target.value,
                        }))
                      }
                      className="mt-1 w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm"
                      placeholder="qty used"
                    />
                  </div>
                ))}
              </div>
            </FormFull>
          ) : null}
        </FormGrid>
      </ActionForm>
      {props.showBackToList !== false ? (
        <p>
          <Link className="text-sm text-sky-400" href="/entries">
            Back to entry list
          </Link>
        </p>
      ) : null}
    </div>
  );
}
