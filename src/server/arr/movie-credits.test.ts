import "server-only";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { components as RadarrComponents } from "./generated/radarr";
import creditsFixture from "./__fixtures__/radarr-credits.json";
import { ArrRequestError } from "./request";

type CreditResource = RadarrComponents["schemas"]["CreditResource"];

const credits = creditsFixture as CreditResource[];

const { FAKE_KEY, fakeEnv } = vi.hoisted(() => {
  const key = "fake-api-key-0123456789abcdefghi"; // 32 chars, not a real secret
  return {
    FAKE_KEY: key,
    fakeEnv: {
      RADARR_URL: "http://radarr.test:7878",
      RADARR_API_KEY: key,
      SONARR_URL: "http://sonarr.test:8989",
      SONARR_API_KEY: key,
    },
  };
});

vi.mock("@/server/env", () => ({
  env: () => fakeEnv,
}));

import { getMovieCredits, toMovieCredits } from "./movie-credits";

describe("toMovieCredits", () => {
  const result = toMovieCredits(credits);

  it("keeps only the cast entries, sorted by order, with the headshot file name as the photo", () => {
    expect(result.cast.map((member) => member.name)).toEqual([
      "Owen Arden",
      "Lena Vance",
      "Priya Lusk",
      "Tomas Reyne",
      "Nadia Kells",
      "Sam Teodor",
    ]);
    expect(result.cast.find((member) => member.id === 319)).toEqual({
      id: 319,
      name: "Lena Vance",
      character: "Ilse Marrow",
      photo: "cDyZLf8ddz0EgoUjpv4jjzy7qxA.jpg",
    });
  });

  it("gives no photo for a cast member with no images", () => {
    expect(result.cast.find((member) => member.id === 320)).toMatchObject({ photo: null, character: "Dock Foreman" });
  });

  it("gives no photo for a headshot on another host, or for an http:// URL", () => {
    expect(result.cast.find((member) => member.id === 321)?.photo).toBeNull();
    expect(result.cast.find((member) => member.id === 322)?.photo).toBeNull();
  });

  it("gives a null character when Radarr sends none", () => {
    expect(result.cast.find((member) => member.id === 323)?.character).toBeNull();
  });

  it("returns only the id, name, character and photo for each cast member", () => {
    for (const member of result.cast) {
      expect(Object.keys(member).sort()).toEqual(["character", "id", "name", "photo"]);
    }
  });

  it("lists each director once, in order, and leaves out other crew", () => {
    expect(result.directors).toEqual(["Marcus Hale", "Iris Quell"]);
  });

  it("caps the cast at 20 and the directors at 3", () => {
    const many: CreditResource[] = [];
    for (let i = 0; i < 25; i += 1) {
      many.push({ id: 1000 + i, personName: `Cast ${i}`, order: 24 - i, type: "cast" });
    }
    for (let i = 0; i < 5; i += 1) {
      many.push({ id: 2000 + i, personName: `Director ${i}`, job: "Director", type: "crew" });
    }
    const capped = toMovieCredits(many);
    expect(capped.cast).toHaveLength(20);
    expect(capped.cast[0]?.name).toBe("Cast 24");
    expect(capped.directors).toEqual(["Director 0", "Director 1", "Director 2"]);
  });

  it("skips cast entries with no numeric id or no name, and an entry with no order sorts last", () => {
    const odd: CreditResource[] = [
      { id: 1, personName: "No Order", type: "cast" },
      { personName: "No Id", order: 0, type: "cast" },
      { id: 3, personName: "   ", order: 0, type: "cast" },
      { id: 4, personName: "Has Order", order: 9, type: "cast" },
    ];
    expect(toMovieCredits(odd).cast.map((member) => member.name)).toEqual(["Has Order", "No Order"]);
  });

  it("returns empty lists for no credits", () => {
    expect(toMovieCredits([])).toEqual({ cast: [], directors: [] });
  });
});

describe("getMovieCredits", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  it("requests the credits for the movie id with the key in a header and not in the URL", async () => {
    fetchMock.mockResolvedValue(json(credits));

    const result = await getMovieCredits(42);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const req = fetchMock.mock.calls[0]?.[0] as Request;
    const url = new URL(req.url);
    expect(url.pathname).toBe("/api/v3/credit");
    expect(url.searchParams.get("movieId")).toBe("42");
    expect(req.headers.get("X-Api-Key")).toBe(FAKE_KEY);
    expect(req.url).not.toContain("apikey");
    expect(req.url).not.toContain(FAKE_KEY);
    expect(result).toEqual(toMovieCredits(credits));
  });

  it("fails as an invalid response when Radarr sends something other than a list", async () => {
    fetchMock.mockResolvedValue(json({ message: "not a list" }));

    const error = await getMovieCredits(42).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ArrRequestError);
    expect((error as ArrRequestError).kind).toBe("invalid");
    expect((error as ArrRequestError).message).toBe("Radarr credits response was not a list");
  });

  it("maps a Radarr HTTP failure to a safe ArrRequestError", async () => {
    fetchMock.mockResolvedValue(new Response(`boom ${FAKE_KEY} at http://radarr.test:7878`, { status: 500 }));

    const error = await getMovieCredits(42).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ArrRequestError);
    expect((error as ArrRequestError).message).toBe("Radarr credits request failed: HTTP 500");
    expect((error as ArrRequestError).message).not.toContain(FAKE_KEY);
  });
});
