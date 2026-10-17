import "server-only";

/** Every role a MediaHub user can hold. Keep in sync with the DB CHECK constraint. */
export const ROLES = ["admin", "requester"] as const;

export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}
