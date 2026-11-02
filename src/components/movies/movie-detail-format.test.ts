import { describe, expect, it } from "vitest";
import { directorsLine, metaLine, ratingsLine } from "./movie-detail-format";

describe("ratingsLine", () => {
  it("shows IMDb to one decimal and TMDB as a whole percent", () => {
    expect(ratingsLine({ imdb: 7.1, tmdb: 6.8 })).toBe("IMDb 7.1 · TMDB 68%");
    expect(ratingsLine({ imdb: 8, tmdb: 7.25 })).toBe("IMDb 8.0 · TMDB 73%");
  });

  it("leaves out a missing rating", () => {
    expect(ratingsLine({ imdb: null, tmdb: 6.8 })).toBe("TMDB 68%");
    expect(ratingsLine({ imdb: 7.1, tmdb: null })).toBe("IMDb 7.1");
  });

  it("returns null when neither rating is there", () => {
    expect(ratingsLine({ imdb: null, tmdb: null })).toBeNull();
  });
});

describe("metaLine", () => {
  it("joins certification, runtime and genres with a middle dot", () => {
    expect(metaLine({ certification: "PG-13", runtime: 125, genres: ["Drama", "Thriller"] })).toBe(
      "PG-13 · 2h 5m · Drama, Thriller",
    );
  });

  it("leaves out each missing part", () => {
    expect(metaLine({ certification: null, runtime: 45, genres: [] })).toBe("45m");
    expect(metaLine({ certification: "R", runtime: null, genres: ["Horror"] })).toBe("R · Horror");
  });

  it("returns null when nothing is there, and treats a zero runtime as missing", () => {
    expect(metaLine({ certification: null, runtime: null, genres: [] })).toBeNull();
    expect(metaLine({ certification: null, runtime: 0, genres: [] })).toBeNull();
  });
});

describe("directorsLine", () => {
  it("names the directors", () => {
    expect(directorsLine(["Marcus Hale", "Iris Quell"])).toBe("Directed by Marcus Hale, Iris Quell");
  });

  it("returns null with no directors", () => {
    expect(directorsLine([])).toBeNull();
  });
});
