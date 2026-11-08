// Next calls register() once when the server starts. The replace-import worker needs Node APIs (timers, SQLite), so it
// starts only on the Node.js runtime, never on the edge runtime.
export async function register() {
  // NEXT_RUNTIME is set by Next itself, not configuration, so it is read directly (as scripts/demo/run.ts does).
  // eslint-disable-next-line no-restricted-properties
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startReplaceImportTimer } = await import("@/server/replace/auto-import");
    startReplaceImportTimer();
  }
}
