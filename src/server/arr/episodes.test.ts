import "server-only";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArrRequestError } from "./request";

const { FAKE_KEY, fakeConnections } = vi.hoisted(() => {
  const key = "fake-api-key-0123456789abcdefghi"; // 32 chars, not a real secret
  return {
    FAKE_KEY: key,
    fakeConnections: {
      radarr: { url: "http://radarr.test:7878", apiKey: key },
      sonarr: { url: "http://sonarr.test:8989", apiKey: key },
    },
  };
});

vi.mock("@/server/settings/connections", () => ({
  getConnection: (app: "radarr" | "sonarr") => fakeConnections[app],
}));

import {
  SeasonNotFoundError,
  searchEpisode,
  searchSeason,
  setEpisodeMonitored,
  setSeasonMonitored,
} from "./episodes";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function requestAt(call: number): Request {
  return fetchMock.mock.calls[call][0] as Request;
}

async function sentBody(call: number): Promise<Record<string, unknown>> {
  return JSON.parse(await requestAt(call).text()) as Record<string, unknown>;
}

async function rejectionOf(promise: Promise<unknown>): Promise<Error> {
  return promise.then(
    () => {
      throw new Error("expected rejection");
    },
    (e: unknown) => e as Error,
  );
}

/** A series as Sonarr returns it, with fields the code must pass through untouched. */
function seriesReply() {
  return {
    id: 7,
    title: "Harbour Lights",
    monitored: true,
    seriesType: "standard",
    path: "/invented/tv/Harbour Lights",
    tags: [4],
    seasons: [
      { seasonNumber: 1, monitored: true, statistics: { episodeCount: 10 } },
      { seasonNumber: 2, monitored: false, statistics: { episodeCount: 8 } },
      { seasonNumber: 3, monitored: true },
    ],
  };
}

/** Routes the series GET and PUT to the given replies. */
function serveSeries(getReply: () => Response, putReply: () => Response = () => new Response(null, { status: 200 })) {
  fetchMock.mockImplementation(async (req: Request) => {
    const path = new URL(req.url).pathname;
    if (req.method === "GET" && path === "/api/v3/series/7") return getReply();
    if (req.method === "PUT" && path === "/api/v3/series/7") return putReply();
    throw new TypeError(`unexpected ${req.method} request to ${path}`);
  });
}

describe("setEpisodeMonitored", () => {
  it("PUTs the episode monitor endpoint with the key in a header and exactly episodeIds and monitored", async () => {
    fetchMock.mockImplementation(async () => new Response(null, { status: 200 }));

    await setEpisodeMonitored(42, false);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const req = requestAt(0);
    expect(req.method).toBe("PUT");
    expect(new URL(req.url).pathname).toBe("/api/v3/episode/monitor");
    expect(new URL(req.url).search).toBe("");
    expect(req.headers.get("X-Api-Key")).toBe(FAKE_KEY);
    expect(req.url).not.toContain(FAKE_KEY);
    expect(await sentBody(0)).toStrictEqual({ episodeIds: [42], monitored: false });
  });

  it("throws ArrRequestError on HTTP 500 without leaking the key, host or body", async () => {
    fetchMock.mockImplementation(async () => new Response(`boom ${FAKE_KEY} at http://sonarr.test:8989`, { status: 500 }));

    const error = await rejectionOf(setEpisodeMonitored(1, true));

    expect(error).toBeInstanceOf(ArrRequestError);
    expect(error.message).toBe("Sonarr episode monitor request failed: HTTP 500");
    expect(error.message).not.toContain(FAKE_KEY);
    expect(error.message).not.toContain("sonarr.test");
  });
});

describe("setSeasonMonitored", () => {
  it("GETs the series, then PUTs it back with only the target season changed and every other field kept", async () => {
    serveSeries(() => json(seriesReply()));

    await setSeasonMonitored(7, 2, true);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const get = requestAt(0);
    expect(get.method).toBe("GET");
    expect(new URL(get.url).pathname).toBe("/api/v3/series/7");
    expect(new URL(get.url).search).toBe("");
    expect(get.headers.get("X-Api-Key")).toBe(FAKE_KEY);

    const put = requestAt(1);
    expect(put.method).toBe("PUT");
    expect(new URL(put.url).pathname).toBe("/api/v3/series/7");
    expect(new URL(put.url).search).toBe("");
    expect(put.headers.get("X-Api-Key")).toBe(FAKE_KEY);
    expect(put.url).not.toContain(FAKE_KEY);

    const expected = seriesReply();
    expected.seasons[1] = { ...expected.seasons[1], monitored: true };
    expect(await sentBody(1)).toStrictEqual(expected);
  });

  it("runs two toggles on one series one after the other, so the second GET sees the first PUT", async () => {
    // A tiny in-memory Sonarr: the GET returns whatever the last PUT stored.
    let stored = seriesReply();
    fetchMock.mockImplementation(async (req: Request) => {
      if (req.method === "GET") return json(stored);
      stored = JSON.parse(await req.text()) as ReturnType<typeof seriesReply>;
      return new Response(null, { status: 200 });
    });

    await Promise.all([setSeasonMonitored(7, 2, true), setSeasonMonitored(7, 3, false)]);

    expect(fetchMock.mock.calls.map(([req]) => (req as Request).method)).toEqual(["GET", "PUT", "GET", "PUT"]);
    expect(stored.seasons.map((season) => season.monitored)).toEqual([true, true, false]);
  });

  it("still runs a queued toggle after the one before it failed", async () => {
    let calls = 0;
    serveSeries(() => (++calls === 1 ? new Response("down", { status: 500 }) : json(seriesReply())));

    const [first, second] = await Promise.allSettled([setSeasonMonitored(7, 2, true), setSeasonMonitored(7, 1, false)]);

    expect(first.status).toBe("rejected");
    expect(second.status).toBe("fulfilled");
  });

  it("calls onSend only once the PUT is about to go out", async () => {
    const onSend = vi.fn();
    serveSeries(() => new Response("down", { status: 500 }));
    await rejectionOf(setSeasonMonitored(7, 2, true, onSend));
    expect(onSend).not.toHaveBeenCalled();

    // At the moment onSend runs, only the GET has gone out: the PUT comes after it.
    fetchMock.mockReset();
    serveSeries(() => json(seriesReply()));
    onSend.mockImplementation(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await setSeasonMonitored(7, 2, true, onSend);
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("never sends moveFiles, and sends nothing from the browser except the boolean", async () => {
    serveSeries(() => json(seriesReply()));

    await setSeasonMonitored(7, 1, false);

    expect(new URL(requestAt(1).url).searchParams.has("moveFiles")).toBe(false);
    const body = await sentBody(1);
    expect(body.seasons).toEqual([
      { seasonNumber: 1, monitored: false, statistics: { episodeCount: 10 } },
      { seasonNumber: 2, monitored: false, statistics: { episodeCount: 8 } },
      { seasonNumber: 3, monitored: true },
    ]);
  });

  it("throws SeasonNotFoundError and sends no PUT when the season number is not in the list", async () => {
    serveSeries(() => json(seriesReply()));

    const error = await rejectionOf(setSeasonMonitored(7, 9, true));

    expect(error).toBeInstanceOf(SeasonNotFoundError);
    expect(error.name).toBe("SeasonNotFoundError");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestAt(0).method).toBe("GET");
  });

  it("treats a series with no season list as having no seasons", async () => {
    serveSeries(() => json({ id: 7, title: "Bare", monitored: true }));

    await expect(setSeasonMonitored(7, 1, true)).rejects.toBeInstanceOf(SeasonNotFoundError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws SeasonNotFoundError on a 404 for the series and sends no PUT", async () => {
    serveSeries(() => new Response("missing", { status: 404 }));

    const error = await rejectionOf(setSeasonMonitored(7, 1, true));

    expect(error).toBeInstanceOf(SeasonNotFoundError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rethrows a non-404 failure on the series GET as ArrRequestError, without a PUT", async () => {
    serveSeries(() => new Response(`boom ${FAKE_KEY} at http://sonarr.test:8989`, { status: 500 }));

    const error = await rejectionOf(setSeasonMonitored(7, 1, true));

    expect(error).toBeInstanceOf(ArrRequestError);
    expect(error.message).toBe("Sonarr series request failed: HTTP 500");
    expect(error.message).not.toContain(FAKE_KEY);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws ArrRequestError on a failed PUT without leaking the key, host or body", async () => {
    serveSeries(
      () => json(seriesReply()),
      () => new Response(`boom ${FAKE_KEY} at http://sonarr.test:8989`, { status: 500 }),
    );

    const error = await rejectionOf(setSeasonMonitored(7, 2, true));

    expect(error).toBeInstanceOf(ArrRequestError);
    expect(error.message).toBe("Sonarr series update request failed: HTTP 500");
    expect(error.message).not.toContain(FAKE_KEY);
    expect(error.message).not.toContain("sonarr.test");
  });
});

describe("searchSeason", () => {
  it("POSTs the SeasonSearch command with the key in a header and exactly name, seriesId and seasonNumber", async () => {
    fetchMock.mockImplementation(async () => Response.json({ id: 1, name: "SeasonSearch" }));

    await searchSeason(7, 2);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const req = requestAt(0);
    expect(req.method).toBe("POST");
    expect(new URL(req.url).pathname).toBe("/api/v3/command");
    expect(new URL(req.url).search).toBe("");
    expect(req.headers.get("X-Api-Key")).toBe(FAKE_KEY);
    expect(req.url).not.toContain(FAKE_KEY);
    expect(await sentBody(0)).toStrictEqual({ name: "SeasonSearch", seriesId: 7, seasonNumber: 2 });
  });

  it("throws ArrRequestError on HTTP 500 without leaking the key, host or body", async () => {
    fetchMock.mockImplementation(async () => new Response(`boom ${FAKE_KEY} at http://sonarr.test:8989`, { status: 500 }));

    const error = await rejectionOf(searchSeason(7, 2));

    expect(error).toBeInstanceOf(ArrRequestError);
    expect(error.message).toBe("Sonarr season search command request failed: HTTP 500");
    expect(error.message).not.toContain(FAKE_KEY);
    expect(error.message).not.toContain("sonarr.test");
  });
});

describe("searchEpisode", () => {
  it("POSTs the EpisodeSearch command with the key in a header and exactly name and episodeIds", async () => {
    fetchMock.mockImplementation(async () => Response.json({ id: 1, name: "EpisodeSearch" }));

    await searchEpisode(55);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const req = requestAt(0);
    expect(req.method).toBe("POST");
    expect(new URL(req.url).pathname).toBe("/api/v3/command");
    expect(new URL(req.url).search).toBe("");
    expect(req.headers.get("X-Api-Key")).toBe(FAKE_KEY);
    expect(req.url).not.toContain(FAKE_KEY);
    expect(await sentBody(0)).toStrictEqual({ name: "EpisodeSearch", episodeIds: [55] });
  });

  it("throws ArrRequestError on HTTP 500 without leaking the key, host or body", async () => {
    fetchMock.mockImplementation(async () => new Response(`boom ${FAKE_KEY} at http://sonarr.test:8989`, { status: 500 }));

    const error = await rejectionOf(searchEpisode(55));

    expect(error).toBeInstanceOf(ArrRequestError);
    expect(error.message).toBe("Sonarr episode search command request failed: HTTP 500");
    expect(error.message).not.toContain(FAKE_KEY);
    expect(error.message).not.toContain("sonarr.test");
  });
});
