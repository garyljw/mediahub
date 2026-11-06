// Returns the error digest (a server-side error id) when the value is an Error
// carrying a non-empty string digest. Anything else returns null, so callers
// never render the message or stack of an error.
export function errorDigest(error: unknown): string | null {
  if (error instanceof Error && "digest" in error && typeof error.digest === "string" && error.digest !== "") {
    return error.digest;
  }
  return null;
}
