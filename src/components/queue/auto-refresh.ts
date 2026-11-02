// The Queue page's refresh loop, kept out of React so it can be tested in plain node. A refresh is requested every
// interval while the tab is visible. The next interval starts only after the previous refresh reports it is done
// (onRefreshDone), so refreshes never overlap. Nothing is scheduled while the tab is hidden. Becoming visible again
// refreshes once, unless a refresh is already running.

/** How often the Queue page refreshes while the tab is visible, counted from the end of the previous refresh. */
export const QUEUE_REFRESH_MS = 10_000;
/** If a refresh never reports done, the loop resumes after this long, so one stuck refresh can't stop the page. */
export const REFRESH_WATCHDOG_MS = 30_000;

export type AutoRefreshOptions = {
  /** Asks the page for fresh data. The caller must call onRefreshDone once that refresh has finished. */
  refresh: () => void;
  /** True while the tab is hidden. Nothing is refreshed then. */
  isHidden: () => boolean;
  /** Timers are injected so tests control time. The handle type is whatever setTimer returns. */
  setTimer: (run: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  intervalMs: number;
  watchdogMs?: number;
};

export type AutoRefresh = {
  /** Starts the interval when the tab is visible. Does nothing after stop(). */
  start: () => void;
  /** Clears all timers and never refreshes again. */
  stop: () => void;
  /** Call when the tab's visibility changes. Pauses when hidden; refreshes once on becoming visible when idle. */
  onVisibilityChange: () => void;
  /** Call when a requested refresh has finished. The next interval then starts. Ignored when none is running. */
  onRefreshDone: () => void;
};

export function createAutoRefresh(options: AutoRefreshOptions): AutoRefresh {
  const { refresh, isHidden, setTimer, clearTimer, intervalMs } = options;
  const watchdogMs = options.watchdogMs ?? REFRESH_WATCHDOG_MS;

  let interval: unknown;
  let watchdog: unknown;
  let stopped = false;
  // True while the tab is hidden, so that becoming visible again is noticed.
  let paused = false;
  // True from the moment a refresh is requested until it reports done.
  let pending = false;

  function clearInterval_() {
    if (interval !== undefined) {
      clearTimer(interval);
      interval = undefined;
    }
  }

  function clearWatchdog() {
    if (watchdog !== undefined) {
      clearTimer(watchdog);
      watchdog = undefined;
    }
  }

  function startRefresh() {
    pending = true;
    paused = false;
    watchdog = setTimer(() => {
      watchdog = undefined;
      finish();
    }, watchdogMs);
    refresh();
  }

  function finish() {
    if (!pending) return;
    pending = false;
    clearWatchdog();
    schedule();
  }

  function schedule() {
    clearInterval_();
    if (stopped || pending) return;
    if (isHidden()) {
      paused = true;
      return;
    }
    paused = false;
    interval = setTimer(() => {
      interval = undefined;
      if (isHidden()) {
        paused = true;
        return;
      }
      startRefresh();
    }, intervalMs);
  }

  return {
    start() {
      if (stopped) return;
      schedule();
    },
    stop() {
      stopped = true;
      clearInterval_();
      clearWatchdog();
    },
    onVisibilityChange() {
      if (stopped) return;
      if (isHidden()) {
        paused = true;
        clearInterval_();
        return;
      }
      if (!paused) return;
      paused = false;
      // A refresh already running schedules the next one when it finishes, so none starts here.
      if (pending) return;
      startRefresh();
    },
    onRefreshDone: finish,
  };
}
