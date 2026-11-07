import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildCatalogue } from "../../../scripts/demo/catalogue";
import { DEMO_API_KEY, DEMO_PLEX_TOKEN } from "../../../scripts/demo/config";
import { startFakeServers, type FakeServers } from "../../../scripts/demo/fake-servers";
import { EpisodeItemsSchema, SectionItemsSchema } from "../../server/plex/server";

const NOW = Date.UTC(2026, 10, 7, 12, 0, 0);
const DAY = 86_400_000;

let fakes: FakeServers;
let artDir: string;
const logged: string[] = [];

const radarr = (path: string, init: RequestInit = {}, key: string | null = DEMO_API_KEY) =>
  fetch(`http://127.0.0.1:${fakes.ports.radarr}${path}`, {
    ...init,
    headers: { ...(key === null ? {} : { "X-Api-Key": key }), ...(init.headers as Record<string, string> | undefined) },
  });
const sonarr = (path: string, init: RequestInit = {}, key: string | null = DEMO_API_KEY) =>
  fetch(`http://127.0.0.1:${fakes.ports.sonarr}${path}`, {
    ...init,
    headers: { ...(key === null ? {} : { "X-Api-Key": key }), ...(init.headers as Record<string, string> | undefined) },
  });
const plex = (path: string, token: string | null = DEMO_PLEX_TOKEN) =>
  fetch(`http://127.0.0.1:${fakes.ports.plex}${path}`, { headers: token === null ? {} : { "X-Plex-Token": token } });

beforeAll(async () => {
  artDir = mkdtempSync(path.join(tmpdir(), "demo-fake-"));
  fakes = await startFakeServers({
    catalogue: buildCatalogue(NOW),
    ports: { radarr: 0, sonarr: 0, plex: 0 },
    artDir,
    log: (line) => logged.push(line),
  });
});

afterAll(async () => {
  await fakes.close();
  rmSync(artDir, { recursive: true, force: true });
});

describe("fake Radarr and Sonarr", () => {
  it("answer 401 without the demo key, on both apps", async () => {
    expect((await radarr("/api/v3/movie", {}, null)).status).toBe(401);
    expect((await radarr("/api/v3/movie", {}, "wrong-key")).status).toBe(401);
    expect((await sonarr("/api/v3/series", {}, null)).status).toBe(401);
  });

  it("list movies with the fields the library reads", async () => {
    const response = await radarr("/api/v3/movie");
    expect(response.status).toBe(200);
    const movies = (await response.json()) as Record<string, unknown>[];
    expect(Array.isArray(movies)).toBe(true);
    expect(movies.length).toBe(60);
    for (const field of ["id", "title", "year", "monitored", "hasFile", "isAvailable", "qualityProfileId", "tmdbId", "images", "added"]) {
      expect(movies[0]).toHaveProperty(field);
    }
  });

  it("list series with statistics and seasons", async () => {
    const series = (await (await sonarr("/api/v3/series")).json()) as Record<string, unknown>[];
    expect(series.length).toBe(20);
    for (const field of ["id", "title", "status", "monitored", "qualityProfileId", "tvdbId", "statistics", "seasons", "images"]) {
      expect(series[0]).toHaveProperty(field);
    }
  });

  it("answer queue details, calendar and history with the fields the pages read", async () => {
    const queue = (await (await radarr("/api/v3/queue/details?includeMovie=true")).json()) as Record<string, unknown>[];
    expect(queue.length).toBeGreaterThan(0);
    expect(queue[0]).toHaveProperty("movie");
    expect(queue[0]).toHaveProperty("sizeleft");

    const start = new Date(NOW - 7 * DAY).toISOString();
    const end = new Date(NOW + 21 * DAY).toISOString();
    const calendar = (await (await sonarr(`/api/v3/calendar?start=${start}&end=${end}&unmonitored=true&includeSeries=true`)).json()) as Record<string, unknown>[];
    expect(Array.isArray(calendar)).toBe(true);
    expect(calendar.length).toBeGreaterThan(0);
    expect(calendar[0]).toHaveProperty("airDateUtc");
    expect(calendar[0]).toHaveProperty("series");

    const history = (await (await radarr("/api/v3/history?page=1&pageSize=10&sortKey=date&sortDirection=descending&includeMovie=true")).json()) as {
      totalRecords: number;
      records: Record<string, unknown>[];
    };
    expect(history.totalRecords).toBe(20);
    expect(history.records).toHaveLength(10);
    expect(history.records[0]).toHaveProperty("eventType");
    expect(history.records[0]).toHaveProperty("date");
  });

  it("filter history by event code, with the codes from Radarr's enum", async () => {
    const grabbed = (await (await radarr("/api/v3/history?page=1&pageSize=50&eventType=1")).json()) as { records: { eventType: string }[] };
    expect(grabbed.records.length).toBeGreaterThan(0);
    expect(grabbed.records.every((record) => record.eventType === "grabbed")).toBe(true);
  });

  it("serve a JPEG poster and backdrop, and 404 for another file", async () => {
    const poster = await radarr("/api/v3/mediacover/1/poster-250.jpg");
    expect(poster.status).toBe(200);
    expect(poster.headers.get("content-type")).toBe("image/jpeg");
    const bytes = new Uint8Array(await poster.arrayBuffer());
    expect(bytes[0]).toBe(0xff);
    expect(bytes[1]).toBe(0xd8);
    expect((await radarr("/api/v3/mediacover/1/banner.jpg")).status).toBe(404);
  });

  it("let a movie be added from lookup, then show up in the library", async () => {
    const hits = (await (await radarr("/api/v3/movie/lookup?term=")).json()) as unknown[];
    expect(hits).toHaveLength(0);
    const lookup = (await (await radarr("/api/v3/movie/lookup/tmdb?tmdbId=900060")).json()) as { tmdbId: number; title: string };
    expect(lookup.tmdbId).toBe(900060);
    const added = await radarr("/api/v3/movie", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tmdbId: 900060, monitored: true, qualityProfileId: 1, rootFolderPath: "/media/movies" }),
    });
    expect(added.status).toBe(201);
    const library = (await (await radarr("/api/v3/movie?tmdbId=900060")).json()) as { title: string }[];
    expect(library).toHaveLength(1);
    expect(library[0].title).toBe(lookup.title);
  });

  it("answer 404 and log the path for an unknown path", async () => {
    logged.length = 0;
    const response = await radarr("/api/v3/not-a-real-endpoint");
    expect(response.status).toBe(404);
    expect(logged.some((line) => line.includes("/api/v3/not-a-real-endpoint"))).toBe(true);
  });
});

describe("fake Plex", () => {
  it("answers /identity without a token and names the demo server", async () => {
    const identity = (await (await plex("/identity", null)).json()) as { MediaContainer: { machineIdentifier: string } };
    expect(identity.MediaContainer.machineIdentifier).toBe("fake-server-0001");
  });

  it("refuses library calls without the demo token", async () => {
    expect((await plex("/library/sections", null)).status).toBe(401);
    expect((await plex("/library/sections", "wrong-token")).status).toBe(401);
  });

  it("returns section listings that parse with the app's section schema", async () => {
    const response = await plex(`/library/sections/1/all?includeGuids=1`);
    const items = SectionItemsSchema.parse(await response.json());
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].guids.some((guid) => guid.startsWith("tmdb://"))).toBe(true);
  });

  it("returns a show's episodes that parse with the app's episode schema", async () => {
    const sections = (await (await plex("/library/sections")).json()) as { MediaContainer: { Directory: { key: string; type: string }[] } };
    const show = sections.MediaContainer.Directory.find((section) => section.type === "show");
    expect(show).toBeDefined();
    const shows = SectionItemsSchema.parse(await (await plex(`/library/sections/${show?.key}/all?includeGuids=1`)).json());
    const firstKey = shows[0].ratingKey;
    expect(firstKey).not.toBeNull();
    const episodes = EpisodeItemsSchema.parse(await (await plex(`/library/metadata/${firstKey}/allLeaves?includeGuids=1`)).json());
    expect(episodes.length).toBeGreaterThan(0);
    expect(episodes[0].guids[0]).toMatch(/^tvdb:\/\//);
  });
});
