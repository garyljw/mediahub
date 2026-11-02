import { describe, expect, it } from "vitest";
import { isActive, navItemsFor, NAV_ITEMS } from "./nav";

const labels = (items: { label: string }[]) => items.map((item) => item.label);

describe("navItemsFor", () => {
  it("hides adminOnly items from a requester", () => {
    const items = navItemsFor(false);
    expect(labels(items)).toEqual(["Home", "Movies", "TV", "Calendar", "Queue", "History"]);
    expect(items.some((item) => item.adminOnly)).toBe(false);
  });

  it("shows every item to an admin, in order", () => {
    expect(labels(navItemsFor(true))).toEqual(["Home", "Movies", "TV", "Calendar", "Queue", "History", "Settings"]);
    expect(navItemsFor(true)).toEqual(NAV_ITEMS);
  });
});

describe("isActive", () => {
  it("matches an exact path", () => {
    expect(isActive("/movies", "/movies")).toBe(true);
  });

  it("matches a child route", () => {
    expect(isActive("/movies/123", "/movies")).toBe(true);
  });

  it("does not match a sibling that only shares a prefix", () => {
    expect(isActive("/moviesx", "/movies")).toBe(false);
  });

  it("does not match an unrelated path", () => {
    expect(isActive("/tv", "/movies")).toBe(false);
  });

  it("matches Home only on the exact root path", () => {
    expect(isActive("/", "/")).toBe(true);
    expect(isActive("/movies", "/")).toBe(false);
    expect(isActive("/movies/123", "/")).toBe(false);
  });
});
