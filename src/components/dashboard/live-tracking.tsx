"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  orderTowerStatusLabel,
  processTowerStatusLabel,
  type OrderTowerStatus,
  type ProcessTowerStatus,
} from "@/lib/dashboard/control-tower";

export type LiveProcessRow = {
  processName: string;
  processCode: string;
  cumulative: number;
  required: number;
  remaining: number;
  sitting: number;
  startDate: string | null;
  expectedEnd: string | null;
  actualEnd: string | null;
  status: ProcessTowerStatus;
};

export type LiveLineRow = {
  lineId: string;
  productName: string;
  quantity: number;
  progressPercent: number;
  processes: LiveProcessRow[];
};

export type LiveOrderRow = {
  id: string;
  orderNumber: string;
  clientWorkOrderNumber: string | null;
  clientName: string;
  productName: string;
  plantName: string;
  quantity: number;
  completedQuantity: number;
  remainingQuantity: number;
  dispatchedQuantity: number;
  progressPercent: number;
  currentStageName: string | null;
  dueDate: string;
  daysToDue: number;
  expectedCompletion: string | null;
  status: OrderTowerStatus;
  materialRisk: boolean;
  lines: LiveLineRow[];
};

const ORDER_STATUS_STYLE: Record<OrderTowerStatus, string> = {
  IN_PRODUCTION: "bg-on-time-bg text-on-time",
  AT_RISK: "bg-warn-bg text-warn",
  DELAYED: "bg-delayed-bg text-delayed",
  NOT_STARTED: "bg-accent-bg text-ink-soft",
  COMPLETED: "bg-accent-bg text-ink-soft",
  DISPATCHED: "bg-on-time-bg text-on-time",
  CANCELLED: "bg-panel-muted text-ink-faint",
  ON_HOLD: "bg-panel-muted text-ink-faint",
};

const PROCESS_STATUS_STYLE: Record<ProcessTowerStatus, string> = {
  ON_TRACK: "text-on-time",
  GETTING_DELAYED: "text-warn",
  DELAYED: "text-delayed",
  COMPLETED: "text-ink-soft",
  COMPLETED_LATE: "text-warn",
  NOT_STARTED: "text-ink-soft",
  NOT_APPLICABLE: "text-ink-faint",
};

function DueLabel({ days }: { days: number }) {
  if (days < 0) {
    return <span className="font-mono text-delayed">{Math.abs(days)}d over</span>;
  }
  if (days === 0) {
    return <span className="font-mono text-warn">Due today</span>;
  }
  return <span className="font-mono text-ink">{days}d left</span>;
}

function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max === 0 ? 0 : Math.min(100, (value / max) * 100);
  return (
    <div className="h-2 flex-1 overflow-hidden rounded-sm bg-line">
      <div className="h-full rounded-sm bg-on-time" style={{ width: `${pct}%` }} />
    </div>
  );
}

function ProcessDetail({ process }: { process: LiveProcessRow }) {
  if (process.status === "NOT_APPLICABLE") {
    return (
      <div className="rounded border border-line px-3 py-2 text-[12px] text-ink-faint">
        {process.processName} — Not Applicable (skipped)
      </div>
    );
  }
  return (
    <div className="space-y-1.5 rounded border border-line px-3 py-2">
      <div className="flex items-center gap-3">
        <div className="w-28 shrink-0 text-xs font-medium text-ink">{process.processName}</div>
        <ProgressBar value={process.cumulative} max={process.required} />
        <div className="w-24 shrink-0 font-mono text-[11px] text-ink-soft">
          {process.cumulative}/{process.required}
        </div>
        <span className={`shrink-0 text-[11.5px] font-semibold ${PROCESS_STATUS_STYLE[process.status]}`}>
          {processTowerStatusLabel(process.status)}
        </span>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 pl-0 text-[11px] text-ink-soft sm:pl-[7.5rem]">
        <span>Start: {process.startDate ?? "—"}</span>
        <span>Expected End: {process.expectedEnd ?? "—"}</span>
        <span>Actual End: {process.actualEnd ?? "—"}</span>
        <span>Remaining: {process.remaining}</span>
        {process.sitting > 0 ? <span>Waiting: {process.sitting}</span> : null}
      </div>
    </div>
  );
}

export function LiveTrackingTable(props: { rows: LiveOrderRow[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (props.rows.length === 0) {
    return <p className="p-4 text-sm text-ink-faint">No orders match the current filters.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[980px]">
        <div className="grid grid-cols-[20px_100px_90px_1.1fr_1fr_70px_110px_80px_150px] gap-3 border-b border-line px-3.5 py-2 text-[10.5px] font-semibold tracking-wide text-ink-soft">
          <span />
          <span>Order</span>
          <span>Client WO</span>
          <span>Client</span>
          <span>Product</span>
          <span>Qty</span>
          <span>Progress</span>
          <span>Due</span>
          <span>Status</span>
        </div>
        {props.rows.map((row) => {
          const expanded = expandedId === row.id;
          const flagged = row.status === "DELAYED" || row.status === "AT_RISK" || row.materialRisk;
          return (
            <div key={row.id} className={`border-b border-line ${flagged ? "bg-delayed-bg/40" : ""}`}>
              <button
                type="button"
                className="grid w-full grid-cols-[20px_100px_90px_1.1fr_1fr_70px_110px_80px_150px] items-center gap-3 px-3.5 py-2.5 text-left text-[13px] hover:bg-panel-muted"
                onClick={() => setExpandedId(expanded ? null : row.id)}
              >
                <span className="text-ink-soft">
                  {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                </span>
                <Link
                  href={`/orders/${row.id}`}
                  className="font-mono font-semibold text-accent hover:underline"
                  onClick={(event) => event.stopPropagation()}
                >
                  {row.orderNumber}
                </Link>
                <span className="truncate font-mono text-[12px] text-ink-soft">{row.clientWorkOrderNumber || "—"}</span>
                <span className="truncate text-ink">{row.clientName}</span>
                <span className="truncate text-ink-soft">{row.productName}</span>
                <span className="font-mono text-ink-soft">{row.quantity}</span>
                <span>
                  <div className="mb-1 text-[11px] text-ink-soft">{row.progressPercent.toFixed(0)}% done</div>
                  <div className="h-1 overflow-hidden rounded-sm bg-line">
                    <div className="h-full bg-on-time" style={{ width: `${row.progressPercent}%` }} />
                  </div>
                </span>
                <DueLabel days={row.daysToDue} />
                <span className="flex flex-col items-start gap-1">
                  <span
                    className={`inline-flex w-fit rounded px-2 py-0.5 text-[11.5px] font-semibold ${ORDER_STATUS_STYLE[row.status]}`}
                  >
                    {orderTowerStatusLabel(row.status)}
                  </span>
                  {row.materialRisk ? (
                    <span className="text-[10.5px] font-medium text-warn">Material risk</span>
                  ) : null}
                </span>
              </button>
              {expanded ? (
                <div className="space-y-4 bg-panel-muted px-3.5 pb-4 pl-11 pt-1">
                  <div className="flex flex-wrap gap-x-8 gap-y-1 text-[11.5px] text-ink-soft">
                    <span>
                      <span className="font-semibold text-ink">Plant: </span>
                      {row.plantName}
                    </span>
                    <span>
                      <span className="font-semibold text-ink">Due date: </span>
                      {row.dueDate}
                    </span>
                    <span>
                      <span className="font-semibold text-ink">Current process: </span>
                      {row.currentStageName ?? "—"}
                    </span>
                    <span>
                      <span className="font-semibold text-ink">Projected completion: </span>
                      {row.expectedCompletion ?? "Not enough rate data"}
                    </span>
                    <span>
                      <span className="font-semibold text-ink">Done / pending: </span>
                      {row.completedQuantity} / {row.remainingQuantity}
                    </span>
                    <span>
                      <span className="font-semibold text-ink">Dispatched: </span>
                      {row.dispatchedQuantity}
                    </span>
                  </div>
                  {row.lines.map((line) => (
                    <div key={line.lineId} className="space-y-2">
                      <p className="text-xs font-semibold text-ink">
                        {line.productName} · qty {line.quantity} · {line.progressPercent.toFixed(0)}% finished goods
                      </p>
                      <div className="space-y-2">
                        {line.processes.map((process) => (
                          <ProcessDetail key={`${line.lineId}-${process.processCode}`} process={process} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
