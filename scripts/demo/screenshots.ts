// Screenshots of the demo for the docs (npm run demo:screenshots). run.ts --screenshots starts the fakes, the seed and
// next dev, waits for /login, then calls takeScreenshots() here and shuts everything down. Playwright drives a headless
// Chromium, the made-up library is shown, and the remote artwork (TMDB and TVDB) is drawn by art.ts, because the demo
// cannot reach those services. Nothing here is committed except the JPEGs in docs/screenshots/.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page, type Route } from "playwright";
import { artCacheDir, cachedJpeg, headshotSvg, posterSvg } from "./art";
import { remoteArtIndex, type Catalogue, type RemoteArt } from "./catalogue";

export const PLAYWRIGHT_HINT = "Run `npx playwright install chromium` once, then try again.";

/** Longest wait for any one page to settle (dev compiles a route on its first visit, which can take a while). */
const WAIT_MS = 60_000;
/** A JPEG bigger than this is saved again at a lower quality. */
const MAX_BYTES = 800 * 1024;
/** A page at most this tall (CSS px) is shot whole. Taller pages are shot at the viewport size. */
const FULL_PAGE_MAX_HEIGHT = 2400;

/** The dev indicator and the error overlay, hidden for every shot. Next puts both in a nextjs-portal element. */
const HIDE_DEV_UI_CSS = [
  "nextjs-portal",
  "[data-nextjs-toast]",
  "[data-nextjs-dev-tools-button]",
  ".dev-tools-indicator",
  "[data-nextjs-dialog-overlay]",
]
  .map((selector) => `${selector}{display:none !important}`)
  .join("");

export type ScreenshotOptions = {
  baseUrl: string;
  catalogue: Catalogue;
  /** The session cookie value, exactly as the seed wrote it (already URL-encoded). */
  session: { name: string; value: string };
  /** The repo root: docs/screenshots/ is written under it. */
  repoRoot: string;
  log: (line: string) => void;
};

type Shot = {
  file: string;
  /** The app path to open, e.g. "/". */
  path: string;
  /** Shot the whole page when it fits, else the viewport. */
  fullPage?: boolean;
  /** Runs after the page has settled, before the shot (hover, typing, scrolling). */
  prepare?: (page: Page) => Promise<void>;
};

/** Thrown with a message that names the page, so a failed wait points at the shot that broke. */
class ShotError extends Error {}

export async function takeScreenshots(options: ScreenshotOptions): Promise<void> {
  const index = remoteArtIndex(options.catalogue);
  const outDir = path.join(options.repoRoot, "docs", "screenshots");
  await mkdir(outDir, { recursive: true });

  let browser: Browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    options.log(PLAYWRIGHT_HINT);
    throw new Error(`Chromium could not start (${error instanceof Error ? error.message.split("\n")[0] : "unknown error"}).`);
  }

  const shared = {
    colorScheme: "dark" as const,
    reducedMotion: "reduce" as const,
    locale: "en-GB",
    timezoneId: "Europe/London",
  };
  const cookie = { name: options.session.name, value: options.session.value, domain: "127.0.0.1", path: "/", httpOnly: true };

  try {
    const desktop = await browser.newContext({ ...shared, viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
    const phone = await browser.newContext({
      ...shared,
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    });
    for (const context of [desktop, phone]) {
      await context.addCookies([cookie]);
      await routeArtwork(context, index);
      await context.addInitScript(hideDevUiScript);
    }

    const seriesPick = pickSeries(options.catalogue);
    const moviePick = pickMovie(options.catalogue);
    const desktopShots: Shot[] = [
      { file: "home.jpg", path: "/" },
      { file: "home-hover.jpg", path: "/", prepare: hoverFourthTile },
      { file: "movie.jpg", path: `/movies/${moviePick.id}`, fullPage: true },
      { file: "series.jpg", path: `/tv/${seriesPick.id}`, fullPage: true },
      { file: "focus.jpg", path: "/focus/movies" },
      { file: "add.jpg", path: "/add", prepare: typeAddSearch },
      { file: "queue.jpg", path: "/queue" },
      { file: "calendar.jpg", path: "/calendar" },
      { file: "history.jpg", path: "/history" },
      { file: "settings.jpg", path: "/settings/connections" },
    ];
    const phoneShots: Shot[] = [
      { file: "phone-home.jpg", path: "/" },
      { file: "phone-series.jpg", path: `/tv/${seriesPick.id}`, prepare: scrollToOpenSeason },
    ];

    const warmed = new Set<string>();
    for (const shot of desktopShots) await capture(desktop, shot, options, outDir, warmed);
    for (const shot of phoneShots) await capture(phone, shot, options, outDir, warmed);
    await desktop.close();
    await phone.close();
  } finally {
    await browser.close();
  }
}

/** The movie for movie.jpg: the first downloaded movie with a cast. Chosen by the catalogue, so it never changes. */
function pickMovie(catalogue: Catalogue) {
  const movie = catalogue.radarr.movies.find(
    (candidate) => candidate.hasFile === true && (catalogue.radarr.creditsByTmdbId[candidate.tmdbId ?? 0]?.length ?? 0) > 0,
  );
  if (!movie || movie.id === undefined) throw new ShotError("the catalogue has no downloaded movie with a cast.");
  return { id: movie.id };
}

/** The series for series.jpg and phone-series.jpg: the continuing show with the most seasons. */
function pickSeries(catalogue: Catalogue) {
  const ranked = [...catalogue.sonarr.series].sort((a, b) => {
    const continuing = Number(b.status === "continuing") - Number(a.status === "continuing");
    return continuing || (b.seasons?.length ?? 0) - (a.seasons?.length ?? 0);
  });
  const show = ranked[0];
  if (!show || show.id === undefined) throw new ShotError("the catalogue has no series.");
  return { id: show.id };
}

/**
 * Fulfils every remote-artwork request the app makes with a JPEG from art.ts. Paths in the index get their own art. Any
 * other lookup-poster or headshot request gets a generic placeholder, so nothing is left to fail.
 */
async function routeArtwork(context: BrowserContext, index: Map<string, RemoteArt>): Promise<void> {
  await context.route(
    (url) =>
      url.pathname.startsWith("/api/movies/lookup-poster/") ||
      url.pathname.startsWith("/api/tv/lookup-poster/") ||
      url.pathname.startsWith("/api/movies/headshot/"),
    async (route: Route) => {
      const pathname = new URL(route.request().url()).pathname;
      const art = index.get(pathname);
      const isHeadshot = pathname.startsWith("/api/movies/headshot/");
      let svg: string;
      if (art?.kind === "headshot") svg = headshotSvg(art.name, art.seed);
      else if (art?.kind === "poster") svg = posterSvg(art.title, art.year, art.seed);
      else if (art?.kind === "season") svg = posterSvg(`Season ${art.seasonNumber}`, null, art.seed);
      else svg = isHeadshot ? headshotSvg("Demo", 0) : posterSvg("Demo Poster", null, 0);
      const body = await cachedJpeg(svg, artCacheDir());
      await route.fulfill({ status: 200, contentType: "image/jpeg", body, headers: { "cache-control": "no-store" } });
    },
  );
}

/** Hides the dev indicator and error overlay as soon as each document starts, including after client navigations. */
const hideDevUiScript = `
(() => {
  const css = ${JSON.stringify(HIDE_DEV_UI_CSS)};
  // The init script runs before <head> exists, so wait for a parent and check again on every DOM change.
  const add = () => {
    const parent = document.head || document.documentElement;
    if (!parent || document.getElementById("demo-hide-dev-ui")) return;
    const style = document.createElement("style");
    style.id = "demo-hide-dev-ui";
    style.textContent = css;
    parent.appendChild(style);
  };
  add();
  document.addEventListener("DOMContentLoaded", add);
  new MutationObserver(add).observe(document, { childList: true, subtree: true });
})();
`;

async function capture(context: BrowserContext, shot: Shot, options: ScreenshotOptions, outDir: string, warmed: Set<string>): Promise<void> {
  const page = await context.newPage();
  const url = `${options.baseUrl}${shot.path}`;
  try {
    if (!warmed.has(shot.path)) {
      // The first visit makes dev compile the route. Load it once without shooting, then shoot the warm page.
      await goTo(page, url, shot.file);
      await settle(page, shot.file);
      warmed.add(shot.path);
    }
    await goTo(page, url, shot.file);
    await settle(page, shot.file);
    await assertNoErrorPage(page, shot.file);
    if (shot.prepare) {
      await shot.prepare(page);
      await settle(page, shot.file);
    }
    const fits = shot.fullPage === true && (await page.evaluate(() => document.documentElement.scrollHeight)) <= FULL_PAGE_MAX_HEIGHT;
    if (shot.fullPage === true && fits) await scrollThrough(page);
    let bytes = await page.screenshot({ type: "jpeg", quality: 85, fullPage: fits, animations: "disabled" });
    if (bytes.length > MAX_BYTES) bytes = await page.screenshot({ type: "jpeg", quality: 70, fullPage: fits, animations: "disabled" });
    const file = path.join(outDir, shot.file);
    await writeFile(file, bytes);
    options.log(`screenshots: wrote ${path.relative(options.repoRoot, file)} (${Math.round(bytes.length / 1024)} KB${fits ? ", full page" : ", viewport"})`);
  } finally {
    await page.close();
  }
}

async function goTo(page: Page, url: string, name: string): Promise<void> {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: WAIT_MS * 3 });
    await page.waitForLoadState("networkidle", { timeout: WAIT_MS });
  } catch (error) {
    throw new ShotError(`${name}: the page did not load (${url}): ${error instanceof Error ? error.message.split("\n")[0] : "unknown error"}`);
  }
}

/**
 * Waits until the page is still: every visible image has loaded, no region is busy, and the layout has had 500 ms more.
 * A wait that runs past WAIT_MS throws, and the message names the shot.
 */
async function settle(page: Page, name: string): Promise<void> {
  await waitUntil(name, "every visible image to load", () =>
    page.evaluate(() => {
      const visible = [...document.images].filter((img) => {
        const box = img.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && box.bottom > 0 && box.top < window.innerHeight && box.right > 0 && box.left < window.innerWidth;
      });
      return visible.every((img) => img.complete && img.naturalWidth > 0);
    }),
  );
  await waitUntil(name, "busy regions to finish", () => page.evaluate(() => document.querySelector('[aria-busy="true"]') === null));
  await page.waitForTimeout(500);
}

/** Polls a predicate every 200 ms until it is true. Throws a ShotError naming the shot when WAIT_MS passes first. */
async function waitUntil(name: string, what: string, check: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    if (await check()) return;
    if (Date.now() > deadline) throw new ShotError(`${name}: timed out waiting for ${what}.`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

async function assertNoErrorPage(page: Page, name: string): Promise<void> {
  const text = await page.evaluate(() => document.body?.innerText ?? "");
  if (/Application error|Internal Server Error|This page could not be found/i.test(text)) {
    throw new ShotError(`${name}: the page shows an error.`);
  }
}

/** Scrolls the whole page once so lazy-loaded posters are fetched before a full-page shot, then back to the top. */
async function scrollThrough(page: Page): Promise<void> {
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < height; y += 800) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(120);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
}

/** Rests the pointer on the fourth Home tile (index 3, away from the left edge) until its hover card has opened (the card waits 500 ms). */
async function hoverFourthTile(page: Page): Promise<void> {
  const tile = page.locator("[data-peek-key]").nth(3);
  await tile.scrollIntoViewIfNeeded();
  await tile.hover();
  await waitUntil("home-hover.jpg", "the hover card", () => page.evaluate(() => document.querySelector(".animate-peek-in") !== null));
  await page.waitForTimeout(700);
}

/** Types a search that matches many titles ("the" is in most of the made-up ones) and waits for the results. */
async function typeAddSearch(page: Page): Promise<void> {
  await page.getByPlaceholder("Search movies and TV to add").fill("the");
  await waitUntil("add.jpg", "search results", () =>
    // Count result rows, not Add buttons: titles already in the library show an "In library" badge instead.
    page.evaluate(() => document.querySelectorAll("main ul.divide-y > li").length >= 3),
  );
}

/** Scrolls the phone series page so the open season's episode cards fill the screen. */
async function scrollToOpenSeason(page: Page): Promise<void> {
  await page.evaluate(() => {
    const open = document.querySelector("details[open]");
    if (open) open.scrollIntoView({ block: "start" });
  });
}
