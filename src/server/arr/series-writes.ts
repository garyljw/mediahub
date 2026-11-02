import "server-only";

/**
 * The last write queued for each series. MediaHub runs as one Node process, so chaining on this makes writes to one
 * series from different tabs or admins run one at a time. Season toggles read the whole series and write it back,
 * so without this a series edit landing between that read and write would be overwritten (or overwrite it). (One
 * browser tab already sends its server actions one at a time; the server doesn't queue them.)
 *
 * Known gaps, accepted because each needs two writers on one series within seconds: a PUT that timed out may still
 * land after the next queued write; and a write from outside MediaHub (Sonarr's own UI) isn't queued here.
 */
const seriesWrites = new Map<number, Promise<void>>();

/** Runs `task` after every earlier queued write for this series has settled, and returns its result. */
export async function queueSeriesWrite(seriesId: number, task: () => Promise<void>): Promise<void> {
  const previous = seriesWrites.get(seriesId) ?? Promise.resolve();
  // Wait for the previous write whether it worked or not; its caller already gets its own error.
  const write = previous.catch(() => {}).then(task);
  seriesWrites.set(seriesId, write);
  try {
    await write;
  } finally {
    // Only the newest write clears the entry, so the map doesn't grow and a queued write is never dropped.
    if (seriesWrites.get(seriesId) === write) seriesWrites.delete(seriesId);
  }
}
