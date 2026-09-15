/**
 * Order material usage helpers.
 * Total needed = totalQuantity (user-entered for the whole order).
 * Used = sum of quantityUsed recorded across all production entries.
 * Available = quantityReceived − used.
 */

export type MaterialUsageInput = {
  name: string;
  totalQuantity: number;
  quantityReceived: number;
  /** Quantities used across individual production entries. */
  entryUsages: number[];
};

export type MaterialUsage = {
  name: string;
  totalQuantity: number;
  quantityReceived: number;
  totalNeeded: number;
  used: number;
  available: number;
  remainingToReceive: number;
  isShort: boolean;
  warning: string | null;
};

export function evaluateMaterialUsage(input: MaterialUsageInput): MaterialUsage {
  const totalNeeded = input.totalQuantity;
  const used = input.entryUsages.reduce((sum, qty) => sum + Math.max(0, qty), 0);
  const available = input.quantityReceived - used;
  const remainingToReceive = Math.max(0, totalNeeded - input.quantityReceived);
  const isShort = available < 0 || input.quantityReceived < totalNeeded;
  let warning: string | null = null;
  if (available < 0) {
    warning = `${input.name}: used ${used} exceeds received ${input.quantityReceived} (short by ${Math.abs(available)}).`;
  } else if (input.quantityReceived < totalNeeded) {
    warning = `${input.name}: received ${input.quantityReceived} of ${totalNeeded} needed (${remainingToReceive} still required).`;
  }
  return {
    name: input.name,
    totalQuantity: input.totalQuantity,
    quantityReceived: input.quantityReceived,
    totalNeeded,
    used,
    available,
    remainingToReceive,
    isShort,
    warning,
  };
}
