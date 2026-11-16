import "server-only";

/** A usable upstream id: a positive integer. Anything else (missing, 0, negative, not a number) is null. */
export function validId(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}
