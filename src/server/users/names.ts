import "server-only";

// Names are sign-in names. Two names count as the same when they normalise to the same text, so
// "Amy  Pond" and " amy pond" can't both exist.

/** Trims, collapses runs of whitespace to one space and lowercases. */
export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/** A sign-in name is non-empty after trimming and never contains "@", so it can't be mistaken for an email. */
export function isValidSignInName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length > 0 && !trimmed.includes("@");
}
