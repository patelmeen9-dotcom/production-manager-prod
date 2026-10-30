"use client";

import { updateProductionOrderSafeAction } from "@/lib/orders/actions";
import { ActionForm, FormFull, FormGrid } from "@/components/masters/action-form";
import { Label } from "@/components/ui/label";
import { TextField } from "@/components/masters/fields";

export function ProductionOrderSafeEditForm(props: {
  orderId: string;
  remarks: string | null;
  clientWorkOrderNumber: string | null;
  productionDate: string;
  dispatchDate: string;
  priority: string;
  lines: { id: string; label: string; remarks: string | null }[];
  materials: { id: string; label: string; quantityReceived: number; totalNeeded: number }[];
  notice: string;
}) {
  const action = updateProductionOrderSafeAction.bind(null, props.orderId);
  const lineRemarksJson = JSON.stringify(
    props.lines.map((line) => ({
      lineId: line.id,
      remarks: line.remarks ?? "",
    })),
  );

  return (
    <ActionForm action={action} submitLabel="Save safe edits">
      <input type="hidden" name="lineRemarksJson" id="lineRemarksJson" value={lineRemarksJson} />
      <p className="text-sm text-amber-200">{props.notice}</p>
      <FormGrid>
        <div>
          <Label htmlFor="priority">Priority</Label>
          <select
            id="priority"
            name="priority"
            defaultValue={props.priority}
            className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm"
          >
            <option value="LOW">Low</option>
            <option value="NORMAL">Normal</option>
            <option value="HIGH">High</option>
            <option value="URGENT">Urgent</option>
          </select>
        </div>
        <TextField name="clientWorkOrderNumber" label="Client work order number" defaultValue={props.clientWorkOrderNumber ?? ""} />
        <TextField name="productionDate" label="Production date" type="date" defaultValue={props.productionDate} />
        <TextField name="dispatchDate" label="Dispatch date" type="date" defaultValue={props.dispatchDate} />
        <FormFull>
          <TextField name="remarks" label="Order remarks" defaultValue={props.remarks ?? ""} />
        </FormFull>
        <FormFull>
          <h2 className="text-sm font-medium text-white">Line remarks</h2>
          <div className="mt-2 space-y-2">
            {props.lines.map((line) => (
              <div key={line.id}>
                <Label>{line.label}</Label>
                <textarea
                  name={`lineRemark-${line.id}`}
                  defaultValue={line.remarks ?? ""}
                  rows={2}
                  className="mt-1 w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm"
                  onChange={(event) => {
                    const hidden = document.getElementById("lineRemarksJson") as HTMLInputElement | null;
                    if (!hidden) return;
                    const current = JSON.parse(hidden.value) as { lineId: string; remarks: string }[];
                    hidden.value = JSON.stringify(
                      current.map((row) => (row.lineId === line.id ? { ...row, remarks: event.target.value } : row)),
                    );
                  }}
                />
              </div>
            ))}
          </div>
        </FormFull>
        <FormFull>
          <h2 className="text-sm font-medium text-white">Material received</h2>
          <input
            type="hidden"
            name="materialsJson"
            id="materialsJson"
            value={JSON.stringify(
              props.materials.map((material) => ({
                materialId: material.id,
                quantityReceived: material.quantityReceived,
              })),
            )}
          />
          <div className="mt-2 space-y-2">
            {props.materials.map((material) => (
              <div key={material.id} className="grid gap-2 sm:grid-cols-2">
                <p className="text-sm text-slate-300">
                  {material.label} (needed {material.totalNeeded})
                </p>
                <input
                  type="number"
                  min={0}
                  defaultValue={material.quantityReceived}
                  className="rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm"
                  onChange={(event) => {
                    const hidden = document.getElementById("materialsJson") as HTMLInputElement | null;
                    if (!hidden) return;
                    const current = JSON.parse(hidden.value) as { materialId: string; quantityReceived: number }[];
                    hidden.value = JSON.stringify(
                      current.map((row) =>
                        row.materialId === material.id
                          ? { ...row, quantityReceived: Number(event.target.value) || 0 }
                          : row,
                      ),
                    );
                  }}
                />
              </div>
            ))}
            {props.materials.length === 0 ? <p className="text-sm text-slate-500">No materials on this order.</p> : null}
          </div>
        </FormFull>
      </FormGrid>
    </ActionForm>
  );
}
