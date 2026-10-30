import type { DisplayStatus } from "@/lib/production/engine";
import type { OrderTowerStatus } from "@/lib/dashboard/control-tower";

export type StatusGroup =
  | "delayed"
  | "getting_delayed"
  | "in_production"
  | "on_time"
  | "not_started"
  | "completed"
  | "dispatched"
  | "total";

/** Maps Control Tower order statuses into filterable KPI groups. */
export const TOWER_STATUS_GROUP: Record<Exclude<StatusGroup, "total" | "on_time">, OrderTowerStatus[]> = {
  delayed: ["DELAYED"],
  getting_delayed: ["AT_RISK"],
  in_production: ["IN_PRODUCTION"],
  not_started: ["NOT_STARTED"],
  completed: ["COMPLETED"],
  dispatched: ["DISPATCHED"],
};

/** Legacy engine display-status mapping (kept for older callers). */
export const STATUS_GROUP_STATUSES: Record<Exclude<StatusGroup, "total" | "in_production" | "dispatched">, DisplayStatus[]> = {
  delayed: ["DELAYED", "START_DELAYED"],
  getting_delayed: ["GETTING_DELAYED", "START_WARNING"],
  on_time: ["ON_TIME"],
  not_started: ["NOT_STARTED"],
  completed: ["COMPLETED"],
};

export function parseStatusGroup(value: string | undefined): StatusGroup | undefined {
  if (!value) {
    return undefined;
  }
  if (
    value === "delayed" ||
    value === "getting_delayed" ||
    value === "in_production" ||
    value === "on_time" ||
    value === "not_started" ||
    value === "completed" ||
    value === "dispatched" ||
    value === "total"
  ) {
    return value;
  }
  return undefined;
}

export function matchesTowerStatusGroup(status: OrderTowerStatus, group: StatusGroup | undefined): boolean {
  if (!group || group === "total") {
    return true;
  }
  if (group === "on_time") {
    return status === "IN_PRODUCTION";
  }
  if (group === "in_production") {
    return status === "IN_PRODUCTION";
  }
  return TOWER_STATUS_GROUP[group].includes(status);
}

export function matchesStatusGroup(status: DisplayStatus, group: StatusGroup | undefined): boolean {
  if (!group || group === "total") {
    return true;
  }
  if (group === "in_production") {
    return status === "ON_TIME";
  }
  if (group === "dispatched") {
    return false;
  }
  return STATUS_GROUP_STATUSES[group].includes(status);
}

export const STATUS_SEVERITY: Record<DisplayStatus, number> = {
  DELAYED: 0,
  START_DELAYED: 1,
  GETTING_DELAYED: 2,
  START_WARNING: 3,
  NOT_STARTED: 4,
  ON_TIME: 5,
  COMPLETED: 6,
  ON_HOLD: 7,
  CANCELLED: 8,
};

export function buildDashboardQuery(
  current: Record<string, string | undefined>,
  patch: Record<string, string | undefined | null>,
): string {
  const params = new URLSearchParams();
  const merged = { ...current, ...patch };
  for (const [key, value] of Object.entries(merged)) {
    if (value) {
      params.set(key, value);
    }
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}
