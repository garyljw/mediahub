// Synthetic artwork for the demo stack: SVG templates for posters, backdrops and cast headshots, and the JPEG renders
// the fake Radarr and Sonarr serve. Every title and name is invented. Rendered JPEGs are cached under demo/art/, keyed
// by a hash of the SVG, so restarts are quick. Only this file and fake-servers.ts use sharp, and only through the
// dynamic import below.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/** Escapes text for XML: &, <, >, double and single quotes. Every piece of text in the SVGs goes through this. */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Neon pairs: [from, to] for the title gradient, plus an accent colour. Picked by seed so posters differ. */
const NEON_PALETTES: { from: string; to: string; accent: string }[] = [
  { from: "#ff3b5c", to: "#8a2be2", accent: "#ffb3c1" },
  { from: "#ff7a18", to: "#e0245e", accent: "#ffd9a8" },
  { from: "#00e5ff", to: "#7b2ff7", accent: "#b8f4ff" },
  { from: "#ffd166", to: "#ef476f", accent: "#fff1c4" },
  { from: "#2ee6a6", to: "#3a86ff", accent: "#c7ffe9" },
  { from: "#ff4fd8", to: "#5b2aff", accent: "#ffd1f4" },
];
const BACKGROUND = "#0b1030";

function paletteFor(seed: number) {
  return NEON_PALETTES[Math.abs(seed) % NEON_PALETTES.length];
}

/** Splits a title into lines of at most `maxChars`, breaking between words. A single long word stays whole. */
export function wrapTitle(title: string, maxChars: number): string[] {
  const words = title.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line === "" ? word : `${line} ${word}`;
    if (next.length > maxChars && line !== "") {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line !== "") lines.push(line);
  return lines.slice(0, 5);
}

/** Font size that keeps the longest line inside `width` (a bold sans is about 0.6em per character). */
function fitFontSize(lines: string[], width: number, max: number): number {
  const longest = Math.max(1, ...lines.map((line) => line.length));
  return Math.max(28, Math.min(max, Math.floor(width / (0.6 * longest))));
}

function shapes(seed: number, width: number, height: number, accent: string): string {
  // Geometric shapes in the corners. Their positions come from the seed.
  const a = (seed * 37) % 100;
  const b = (seed * 61) % 100;
  return [
    `<circle cx="${Math.round((width * (60 + (a % 30))) / 100)}" cy="${Math.round((height * (12 + (b % 18))) / 100)}" r="${Math.round(width * 0.22)}" fill="${accent}" opacity="0.12"/>`,
    `<rect x="${Math.round(width * 0.05)}" y="${Math.round(height * 0.62)}" width="${Math.round(width * 0.9)}" height="4" fill="${accent}" opacity="0.5"/>`,
    `<polygon points="0,${height} ${Math.round(width * 0.35)},${height} 0,${Math.round(height * 0.7)}" fill="${accent}" opacity="0.08"/>`,
  ].join("");
}

/** A 500x750 poster: midnight background, neon gradient title, the year above the foot (MediaHub draws its watched banner along the bottom). */
export function posterSvg(title: string, year: number | null, seed: number): string {
  const width = 500;
  const height = 750;
  const palette = paletteFor(seed);
  const lines = wrapTitle(title, 12);
  const size = fitFontSize(lines, 420, 92);
  const lineHeight = Math.round(size * 1.05);
  const startY = Math.round(height * 0.42 - ((lines.length - 1) * lineHeight) / 2);
  const tspans = lines
    .map((line, i) => `<tspan x="250" y="${startY + i * lineHeight}">${escapeXml(line)}</tspan>`)
    .join("");
  const yearText = year === null ? "" : escapeXml(String(year));
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    "<defs>",
    `<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${palette.from}"/><stop offset="1" stop-color="${palette.to}"/></linearGradient>`,
    "</defs>",
    `<rect width="${width}" height="${height}" fill="${BACKGROUND}"/>`,
    shapes(seed, width, height, palette.accent),
    `<text font-family="Helvetica, Arial, sans-serif" font-weight="900" font-size="${size}" text-anchor="middle" fill="url(#g)">${tspans}</text>`,
    `<text x="250" y="${height - 150}" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="36" text-anchor="middle" fill="${palette.accent}" letter-spacing="6">${yearText}</text>`,
    "</svg>",
  ].join("");
}

/** A 1280x720 backdrop: the title large across the middle, the same palette as the poster. */
export function backdropSvg(title: string, seed: number): string {
  const width = 1280;
  const height = 720;
  const palette = paletteFor(seed);
  const lines = wrapTitle(title, 22);
  const size = fitFontSize(lines, 1100, 150);
  const lineHeight = Math.round(size * 1.05);
  const startY = Math.round(height * 0.5 - ((lines.length - 1) * lineHeight) / 2);
  const tspans = lines
    .map((line, i) => `<tspan x="640" y="${startY + i * lineHeight}">${escapeXml(line)}</tspan>`)
    .join("");
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    "<defs>",
    `<linearGradient id="g" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${palette.from}"/><stop offset="1" stop-color="${palette.to}"/></linearGradient>`,
    "</defs>",
    `<rect width="${width}" height="${height}" fill="${BACKGROUND}"/>`,
    shapes(seed, width, height, palette.accent),
    `<text font-family="Helvetica, Arial, sans-serif" font-weight="900" font-size="${size}" text-anchor="middle" fill="url(#g)">${tspans}</text>`,
    "</svg>",
  ].join("");
}

/**
 * A 300x450 cast headshot: a silhouette on a neon gradient, with the name at the foot. The demo's fake servers do
 * not serve these, because the app fetches cast photos from TMDB. The template is here for completeness.
 */
export function headshotSvg(name: string, seed: number): string {
  const width = 300;
  const height = 450;
  const palette = paletteFor(seed);
  const lines = wrapTitle(name, 14);
  const size = fitFontSize(lines, 260, 34);
  const tspans = lines.map((line, i) => `<tspan x="150" y="${height - 60 + i * 36}">${escapeXml(line)}</tspan>`).join("");
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    "<defs>",
    `<linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${palette.from}"/><stop offset="1" stop-color="${palette.to}"/></linearGradient>`,
    "</defs>",
    `<rect width="${width}" height="${height}" fill="${BACKGROUND}"/>`,
    `<circle cx="150" cy="170" r="72" fill="url(#g)"/>`,
    `<path d="M40,450 C40,300 110,270 150,270 C190,270 260,300 260,450 Z" fill="url(#g)" opacity="0.85"/>`,
    `<text font-family="Helvetica, Arial, sans-serif" font-weight="800" font-size="${size}" text-anchor="middle" fill="${palette.accent}">${tspans}</text>`,
    "</svg>",
  ].join("");
}

/** The folder for cached JPEG renders: demo/art under the repo root (the folder npm run demo runs from). */
export function artCacheDir(): string {
  return path.join(process.cwd(), "demo", "art");
}

/** Renders an SVG to a 82-quality JPEG with sharp. sharp is loaded here only, so importing this module is cheap. */
export async function renderJpeg(svg: string): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  return sharp(Buffer.from(svg)).jpeg({ quality: 82 }).toBuffer();
}

/**
 * The JPEG for an SVG, from the disk cache when it is already there. The file name is a SHA-256 of the SVG text, so
 * a changed template or title renders again. A write failure is ignored: the render is still returned.
 */
export async function cachedJpeg(svg: string, dir: string = artCacheDir()): Promise<Buffer> {
  const name = `${createHash("sha256").update(svg).digest("hex")}.jpg`;
  const file = path.join(dir, name);
  try {
    return await readFile(file);
  } catch {
    // Not cached yet. Render below.
  }
  const jpeg = await renderJpeg(svg);
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(file, jpeg);
  } catch {
    // The cache is only a speed-up. A failed write costs a re-render next time.
  }
  return jpeg;
}
