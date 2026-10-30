/** Unique fallback when "Our order number" is left blank. */
export function generateOrderNumber(now = new Date()): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `PO-${year}${month}${day}-${suffix}`;
}
