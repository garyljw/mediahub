import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_CRUMBS, readStep, readTrail, visit, type Crumb, type Step } from "./trail";

const HOME: Crumb = { path: "/", label: "Home" };
const crumb = (path: string, label = path): Crumb => ({ path, label });

describe("visit", () => {
  const click = (from: string, to: string) => ({ from, to });

  it.each<[string, Crumb[], Crumb, Step | null, Crumb[], Crumb[]?]>([
    ["pushes a page reached by a click from the last page", [HOME, crumb("/movies/1")], crumb("/person/9"), click("/movies/1", "/person/9"), [HOME, crumb("/movies/1"), crumb("/person/9")]],
    ["cuts back to a page already in the trail", [HOME, crumb("/movies/1"), crumb("/person/9")], crumb("/movies/1"), null, [HOME, crumb("/movies/1")]],
    ["updates the label of the page it cuts back to", [HOME, crumb("/movies/1", "Old")], crumb("/movies/1", "New"), null, [HOME, crumb("/movies/1", "New")]],
    ["starts again at the root with no click record", [HOME, crumb("/movies/1")], crumb("/movies/2"), null, [HOME, crumb("/movies/2")]],
    ["starts again at the root when the click came from another page", [HOME, crumb("/movies/1")], crumb("/movies/2"), click("/queue", "/movies/2"), [HOME, crumb("/movies/2")]],
    ["starts again at the root when the click went to another page", [HOME, crumb("/movies/1")], crumb("/movies/2"), click("/movies/1", "/movies/3"), [HOME, crumb("/movies/2")]],
    ["starts again when there is no trail", [], crumb("/movies/2"), click("/", "/movies/2"), [HOME, crumb("/movies/2")]],
    ["puts the page's parents between the root and the page when it starts again", [], crumb("/tv/3/episode/4"), null, [HOME, crumb("/tv/3"), crumb("/tv/3/episode/4")], [crumb("/tv/3")]],
  ])("%s", (_, trail, page, step, expected, parents) => {
    expect(visit(trail, page, step, HOME, parents)).toEqual(expected);
  });

  it("ends a loop A, person, B, same person, A as [root, A]", () => {
    let trail = [HOME];
    const go = (path: string, from: string) => (trail = visit(trail, crumb(path), click(from, path), HOME));
    go("/a", "/");
    go("/p", "/a");
    go("/b", "/p");
    go("/p", "/b");
    go("/a", "/p");
    expect(trail).toEqual([HOME, crumb("/a")]);
  });

  it("keeps at most MAX_CRUMBS, dropping the oldest after the root", () => {
    let trail = [HOME];
    for (let i = 1; i <= MAX_CRUMBS + 3; i++) {
      trail = visit(trail, crumb(`/t/${i}`), { from: trail.at(-1)!.path, to: `/t/${i}` }, HOME);
    }
    expect(trail).toHaveLength(MAX_CRUMBS);
    expect(trail[0]).toEqual(HOME);
    expect(trail.at(-1)).toEqual(crumb(`/t/${MAX_CRUMBS + 3}`));
    expect(trail[1]).toEqual(crumb("/t/5"));
  });
});

describe("reading storage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stub(entries: Record<string, string>) {
    vi.stubGlobal("sessionStorage", { getItem: (key: string) => entries[key] ?? null });
  }

  it.each([
    ["not JSON", "{oops"],
    ["not an array", JSON.stringify({ path: "/", label: "Home" })],
    ["a crumb with a path that isn't absolute", JSON.stringify([{ path: "movies", label: "x" }])],
    ["a crumb with an empty label", JSON.stringify([{ path: "/", label: "" }])],
    ["a list with one bad crumb", JSON.stringify([{ path: "/", label: "Home" }, 7])],
  ])("reads no trail from %s", (_, raw) => {
    stub({ "mediahub.trail": raw });
    expect(readTrail()).toEqual([]);
  });

  it("reads no click record from junk", () => {
    stub({ "mediahub.trailStep": JSON.stringify({ from: "/a", to: 3 }) });
    expect(readStep()).toBeNull();
  });

  it("reads a stored trail and click record back", () => {
    stub({ "mediahub.trail": JSON.stringify([HOME]), "mediahub.trailStep": JSON.stringify({ from: "/", to: "/a" }) });
    expect(readTrail()).toEqual([HOME]);
    expect(readStep()).toEqual({ from: "/", to: "/a" });
  });

  it("gives nothing, and does not throw, when storage throws", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("storage unavailable");
      },
    });
    expect(readTrail()).toEqual([]);
    expect(readStep()).toBeNull();
  });
});
