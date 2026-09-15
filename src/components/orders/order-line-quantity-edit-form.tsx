"use client";

import { useMemo, useState } from "react";
import { updateOrderLineQuantitiesAction } from "@/lib/orders/actions";
import { ActionForm } from "@/components/masters/action-form";
import { buildLineTable, type LineForTable } from "@/lib/orders/line-table";

function parseQty(value: string): number {
    const qty = Number(value);
    return Number.isFinite(qty) && qty > 0 ? qty : 0;
}

export function OrderLineQuantityEditForm(props: { orderId: string; lines: LineForTable[] }) {
    const action = updateOrderLineQuantitiesAction.bind(null, props.orderId);
    const table = useMemo(() => buildLineTable(props.lines), [props.lines]);
    const [quantities, setQuantities] = useState<Record<string, string>>(() =>
        Object.fromEntries(table.rows.map((row) => [row.lineId, String(row.quantity)])),
    );

    const orderTotal = table.rows.reduce((sum, row) => sum + parseQty(quantities[row.lineId] ?? ""), 0);

    const linesJson = JSON.stringify(
        table.rows.map((row) => ({ lineId: row.lineId, quantity: parseQty(quantities[row.lineId] ?? "") })),
    );

    return (
        <ActionForm action={action} submitLabel="Save quantities">
            <input type="hidden" name="linesJson" value={linesJson} />
            <p className="text-sm text-slate-400">
                Edit the quantity for each line. Category details are shown for reference — to change them, edit the order
                from scratch. Production has not started, so quantities can still change.
            </p>
            <div className="mt-3 overflow-x-auto rounded-md border border-slate-700">
                <table className="min-w-full text-left text-sm">
                    <thead className="border-b border-slate-700 bg-slate-900/80 text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">
                        <tr>
                            <th className="px-3 py-2">Product</th>
                            {table.columns.map((column) => (
                                <th key={column.id} className="px-3 py-2">
                                    {column.name}
                                </th>
                            ))}
                            <th className="px-3 py-2 text-right">Quantity</th>
                        </tr>
                    </thead>
                    <tbody>
                        {table.rows.map((row) => (
                            <tr key={row.lineId} className="border-b border-slate-800">
                                <td className="px-3 py-2 font-medium text-white">
                                    Line {row.lineNumber}: {row.productName}
                                </td>
                                {table.columns.map((column) => {
                                    const value = row.categoryValues[column.id] ?? "-";
                                    return (
                                        <td key={column.id} className="px-3 py-2 text-slate-300">
                                            {value}
                                        </td>
                                    );
                                })}
                                <td className="px-3 py-2 text-right">
                                    <input
                                        type="number"
                                        min={1}
                                        required
                                        value={quantities[row.lineId] ?? ""}
                                        onChange={(event) =>
                                            setQuantities((current) => ({ ...current, [row.lineId]: event.target.value }))
                                        }
                                        className="ml-auto w-24 rounded-md border border-slate-600 bg-slate-900 px-2 py-1.5 text-right text-sm"
                                    />
                                </td>
                            </tr>
                        ))}
                    </tbody>
                    <tfoot>
                        <tr className="bg-slate-900/80">
                            <td className="px-3 py-2 text-xs font-semibold text-slate-200">Total order quantity</td>
                            {table.columns.map((column) => (
                                <td key={column.id} />
                            ))}
                            <td className="px-3 py-2 text-right font-mono font-semibold text-white">{orderTotal || "—"}</td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        </ActionForm>
    );
}
