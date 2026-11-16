// The breadcrumb trail: the pages the user has stepped through in this tab, so a page can show how they got there.
// Client-safe: browser storage only, no imports from src/server. Which pages can appear is not listed anywhere: the
// roots are the nav items, and every other crumb is a page that renders a Breadcrumb with its own label.
import { NAV_ITEMS } from "@/components/app-shell/nav";

/** One page in the trail. `path` is a pathname (no query string); `label` is the text shown for it. */
export type Crumb = { path: string; label: string };

/**
 * The nav item with this path, as a crumb (Home when there is none), for pages whose trail starts somewhere other than
 * Home. It lives here, not in breadcrumb.tsx, because server components call it, and a function exported from a
 * "use client" file can't run on the server.
 */
export function navCrumb(href: string): Crumb {
  const item = NAV_ITEMS.find((entry) => entry.href === href) ?? NAV_ITEMS[0];
  return { path: item.href, label: item.label };
}

/** The first crumb when a page names no other: Home. */
export const DEFAULT_ROOT: Crumb = navCrumb("/");

/** A plain click from one page to another, recorded when the link is clicked. */
export type Step = { from: string; to: string };

/** The longest trail kept. The first crumb (the root) always stays; the oldest ones after it are dropped. */
export const MAX_CRUMBS = 10;

const TRAIL_KEY = "mediahub.trail";
const STEP_KEY = "mediahub.trailStep";

function isPath(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("/");
}

function parseCrumb(value: unknown): Crumb | null {
  if (typeof value !== "object" || value === null) return null;
  const { path, label } = value as Record<string, unknown>;
  if (!isPath(path) || typeof label !== "string" || label === "") return null;
  return { path, label };
}

/** A trail read from storage; anything that isn't a list of valid crumbs reads as no trail. */
function parseTrail(value: unknown): Crumb[] {
  if (!Array.isArray(value)) return [];
  const crumbs: Crumb[] = [];
  for (const item of value) {
    const crumb = parseCrumb(item);
    if (crumb === null) return [];
    crumbs.push(crumb);
  }
  return crumbs;
}

function parseStep(value: unknown): Step | null {
  if (typeof value !== "object" || value === null) return null;
  const { from, to } = value as Record<string, unknown>;
  return isPath(from) && isPath(to) ? { from, to } : null;
}

/** The stored trail, or [] when there is none, it is junk, or storage is unavailable. */
export function readTrail(): Crumb[] {
  try {
    const raw = globalThis.sessionStorage.getItem(TRAIL_KEY);
    return raw === null ? [] : parseTrail(JSON.parse(raw));
  } catch {
    return [];
  }
}

/** Saves the trail. Storage can be missing or throw (private mode), in which case nothing is remembered. */
export function writeTrail(trail: Crumb[]): void {
  try {
    globalThis.sessionStorage.setItem(TRAIL_KEY, JSON.stringify(trail));
  } catch {
    // Not remembered: the next page starts a new trail.
  }
}

/** The stored click record, or null when there is none, it is junk, or storage is unavailable. */
export function readStep(): Step | null {
  try {
    const raw = globalThis.sessionStorage.getItem(STEP_KEY);
    return raw === null ? null : parseStep(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function writeStep(step: Step): void {
  try {
    globalThis.sessionStorage.setItem(STEP_KEY, JSON.stringify(step));
  } catch {
    // Not remembered: the next page starts a new trail.
  }
}

/** Starts a new trail at `root`, when the user opens a nav page. */
export function startTrail(root: Crumb): void {
  writeTrail([root]);
}

/**
 * The trail after the user arrives on `crumb`. `step` is the last plain click recorded (or null).
 * - A page already in the trail cuts the trail just after it. That covers browser Back and Forward, a click on a crumb,
 *   and a loop (A, person, B, same person, A) which ends as [..., A] instead of growing.
 * - A click from the trail's last page to this one adds it.
 * - Anything else (address bar, new tab, a page that isn't tracked) starts again at `root`, followed by the page's own
 *   `parents` (the pages it belongs under, such as a show for one of its episodes).
 */
export function visit(trail: Crumb[], crumb: Crumb, step: Step | null, root: Crumb, parents: Crumb[] = []): Crumb[] {
  const at = trail.findIndex((entry) => entry.path === crumb.path);
  if (at !== -1) return [...trail.slice(0, at), crumb];

  const last = trail.at(-1);
  if (last !== undefined && step !== null && step.from === last.path && step.to === crumb.path) {
    const next = [...trail, crumb];
    return next.length <= MAX_CRUMBS ? next : [next[0], ...next.slice(next.length - (MAX_CRUMBS - 1))];
  }

  return crumb.path === root.path ? [crumb] : [root, ...parents, crumb];
}
