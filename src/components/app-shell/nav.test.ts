import { describe, expect, it } from "vitest";
import { isActive, navItemsFor, NAV_ITEMS, tabBarItems } from "./nav";

const labels = (items: { label: string }[]) => items.map((item) => item.label);

describe("navItemsFor", () => {
  it("hides adminOnly items from a requester", () => {
    const items = navItemsFor(false);
    expect(labels(items)).toEqual(["Home", "Movie Focus", "TV Focus", "Calendar", "Queue", "History", "Release notes"]);
    expect(items.some((item) => item.adminOnly)).toBe(false);
  });

  it("shows every item to an admin, in order", () => {
    expect(labels(navItemsFor(true))).toEqual(["Home", "Movie Focus", "TV Focus", "Calendar", "Queue", "History", "Release notes", "Settings"]);
    expect(navItemsFor(true)).toEqual(NAV_ITEMS);
  });
});

describe("tabBarItems", () => {
  it("puts Settings under More for an admin, and not for a requester", () => {
    expect(labels(tabBarItems(true).more)).toEqual(["Calendar", "History", "Release notes", "Settings"]);
    expect(labels(tabBarItems(false).more)).toEqual(["Calendar", "History", "Release notes"]);
  });

  it("orders the tabs Home, Movie Focus, TV Focus, Queue", () => {
    expect(labels(tabBarItems(true).tabs)).toEqual(["Home", "Movie Focus", "TV Focus", "Queue"]);
    expect(labels(tabBarItems(false).tabs)).toEqual(["Home", "Movie Focus", "TV Focus", "Queue"]);
  });

  it("never lists an item in both the tabs and More", () => {
    for (const isAdmin of [true, false]) {
      const { tabs, more } = tabBarItems(isAdmin);
      const hrefs = [...tabs, ...more].map((item) => item.href);
      expect(new Set(hrefs).size).toBe(hrefs.length);
      expect(hrefs.sort()).toEqual(navItemsFor(isAdmin).map((item) => item.href).sort());
    }
  });
});

describe("isActive", () => {
  it("matches an exact path", () => {
    expect(isActive("/calendar", "/calendar")).toBe(true);
  });

  it("matches a child route", () => {
    expect(isActive("/settings/users", "/settings")).toBe(true);
  });

  it("highlights Home, not Calendar, on an item page", () => {
    expect(isActive("/movies/123", "/")).toBe(true);
    expect(isActive("/movies/123", "/calendar")).toBe(false);
    expect(isActive("/tv/45", "/")).toBe(true);
    expect(isActive("/tv/45", "/calendar")).toBe(false);
  });

  it("does not match a sibling that only shares a prefix", () => {
    expect(isActive("/calendarx", "/calendar")).toBe(false);
  });

  it("does not match an unrelated path", () => {
    expect(isActive("/queue", "/calendar")).toBe(false);
  });

  it("matches Home only on the exact root path", () => {
    expect(isActive("/", "/")).toBe(true);
    expect(isActive("/queue", "/")).toBe(false);
  });
});
