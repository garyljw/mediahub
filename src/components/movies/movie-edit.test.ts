import { describe, expect, it } from "vitest";
import {
  MINIMUM_AVAILABILITY,
  MINIMUM_AVAILABILITY_LABELS,
  buildMovieEdit,
  isMinimumAvailability,
  type MovieFormValues,
} from "./movie-edit";

const current: MovieFormValues = { qualityProfileId: 1, monitored: true, minimumAvailability: "released" };

describe("buildMovieEdit", () => {
  it("returns null when nothing differs from the current values", () => {
    expect(buildMovieEdit(7, current, { ...current })).toBeNull();
  });

  it("sends only the quality profile when only it changed", () => {
    expect(buildMovieEdit(7, current, { ...current, qualityProfileId: 2 })).toStrictEqual({ movieId: 7, qualityProfileId: 2 });
  });

  it("sends only the monitored flag when it changed, including a change to false", () => {
    expect(buildMovieEdit(7, current, { ...current, monitored: false })).toStrictEqual({ movieId: 7, monitored: false });
  });

  it("sends only the minimum availability when it changed", () => {
    expect(buildMovieEdit(7, current, { ...current, minimumAvailability: "announced" })).toStrictEqual({
      movieId: 7,
      minimumAvailability: "announced",
    });
  });

  it("sends every changed field, and no others", () => {
    const edit = buildMovieEdit(7, current, { qualityProfileId: 2, monitored: false, minimumAvailability: "inCinemas" });

    expect(edit).toStrictEqual({ movieId: 7, qualityProfileId: 2, monitored: false, minimumAvailability: "inCinemas" });
    expect(Object.keys(edit ?? {}).sort()).toEqual(["minimumAvailability", "monitored", "movieId", "qualityProfileId"]);
  });

  it("sends a chosen minimum availability when the current one is one the form does not offer", () => {
    const unknown = { ...current, minimumAvailability: null };

    expect(buildMovieEdit(7, unknown, { ...unknown, minimumAvailability: "inCinemas" })).toStrictEqual({
      movieId: 7,
      minimumAvailability: "inCinemas",
    });
  });

  it("never sends a null minimum availability, so an unknown value is left alone", () => {
    const unknown = { ...current, minimumAvailability: null };

    expect(buildMovieEdit(7, unknown, unknown)).toBeNull();
    expect(buildMovieEdit(7, unknown, { ...unknown, qualityProfileId: 3 })).toStrictEqual({ movieId: 7, qualityProfileId: 3 });
  });

  it("uses the movie id it is given", () => {
    expect(buildMovieEdit(42, current, { ...current, monitored: false })).toStrictEqual({ movieId: 42, monitored: false });
  });
});

describe("isMinimumAvailability", () => {
  it("accepts the three values the form offers", () => {
    expect(MINIMUM_AVAILABILITY.every((value) => isMinimumAvailability(value))).toBe(true);
  });

  it("rejects the statuses the form leaves out, and anything else", () => {
    for (const value of ["tba", "deleted", "Released", "", null, undefined, 1]) {
      expect(isMinimumAvailability(value)).toBe(false);
    }
  });
});

describe("minimum availability options", () => {
  it("labels each option, in the order the form shows them", () => {
    expect(MINIMUM_AVAILABILITY.map((value) => MINIMUM_AVAILABILITY_LABELS[value])).toEqual([
      "Announced",
      "In cinemas",
      "Released",
    ]);
  });
});
