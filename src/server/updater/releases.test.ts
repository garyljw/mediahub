import "server-only";
import { describe, expect, it } from "vitest";
import { pickRelease, releasesReplySchema, type Release } from "./releases";

const BASE = "https://github.com/garyljw/mediahub/releases/download";

function release(version: string, options: Partial<Release> = {}): Release {
  const tag = `v${version}`;
  const prefix = `${BASE}/${tag}/`;
  return {
    tag_name: tag,
    draft: false,
    assets: [
      { name: "update-manifest.json", browser_download_url: `${prefix}update-manifest.json`, size: 200 },
      { name: "update-manifest.json.sig", browser_download_url: `${prefix}update-manifest.json.sig`, size: 90 },
      { name: `MediaHub-Setup-${version}.exe`, browser_download_url: `${prefix}MediaHub-Setup-${version}.exe`, size: 1000 },
    ],
    ...options,
  };
}

describe("pickRelease", () => {
  it("returns the highest newer release", () => {
    const picked = pickRelease([release("1.1.0"), release("1.3.0"), release("1.2.0")], "1.0.0", [], false);
    expect(picked?.version).toBe("1.3.0");
    expect(picked?.installerName).toBe("MediaHub-Setup-1.3.0.exe");
  });

  it("returns null when nothing is newer", () => {
    expect(pickRelease([release("1.0.0")], "1.0.0", [], false)).toBeNull();
    expect(pickRelease([release("0.9.0")], "1.0.0", [], false)).toBeNull();
  });

  it("ignores a release candidate for a stable install", () => {
    expect(pickRelease([release("1.1.0-rc.1")], "1.0.0", [], false)).toBeNull();
  });

  it("takes a newer rc and the final for an rc install", () => {
    expect(pickRelease([release("1.1.0-rc.2")], "1.1.0-rc.1", [], false)?.version).toBe("1.1.0-rc.2");
    expect(pickRelease([release("1.1.0")], "1.1.0-rc.1", [], false)?.version).toBe("1.1.0");
  });

  it("ignores skipped versions unless manual", () => {
    expect(pickRelease([release("1.1.0")], "1.0.0", ["1.1.0"], false)).toBeNull();
    expect(pickRelease([release("1.1.0")], "1.0.0", ["1.1.0"], true)?.version).toBe("1.1.0");
  });

  it("ignores drafts and tags that are not vX.Y.Z", () => {
    expect(pickRelease([release("1.1.0", { draft: true })], "1.0.0", [], false)).toBeNull();
    expect(pickRelease([release("1.1.0", { tag_name: "v1.1.0-dev.3" })], "1.0.0", [], false)).toBeNull();
    expect(pickRelease([release("1.1.0", { tag_name: "1.1.0" })], "1.0.0", [], false)).toBeNull();
  });

  it("ignores a release missing any of its three assets", () => {
    const withoutSig = release("1.1.0", { assets: release("1.1.0").assets.slice(0, 2) });
    expect(pickRelease([withoutSig], "1.0.0", [], false)).toBeNull();
  });

  it("ignores a release with an asset URL outside its download prefix", () => {
    const base = release("1.1.0");
    const bad = {
      ...base,
      assets: base.assets.map((asset) =>
        asset.name === "MediaHub-Setup-1.1.0.exe"
          ? { ...asset, browser_download_url: "https://example.test/MediaHub-Setup-1.1.0.exe" }
          : asset,
      ),
    };
    expect(pickRelease([bad], "1.0.0", [], false)).toBeNull();
  });

  it("parses the GitHub reply and keeps only the fields it uses", () => {
    const parsed = releasesReplySchema.parse([
      { tag_name: "v1.0.0", draft: false, prerelease: false, body: "notes", assets: [] },
    ]);
    expect(parsed).toEqual([{ tag_name: "v1.0.0", draft: false, assets: [] }]);
  });
});
