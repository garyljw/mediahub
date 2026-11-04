import "server-only";
import { z } from "zod";
import { compareVersions, isPrerelease, isValidVersion } from "./version";

/** GitHub list-releases reply, keeping only the fields the updater uses. */
export const releasesReplySchema = z.array(
  z.object({
    tag_name: z.string(),
    draft: z.boolean(),
    assets: z.array(
      z.object({
        name: z.string(),
        browser_download_url: z.string(),
        size: z.number().int().nonnegative(),
      }),
    ),
  }),
);

export type Release = z.infer<typeof releasesReplySchema>[number];

export interface PickedRelease {
  version: string;
  manifestUrl: string;
  sigUrl: string;
  installerUrl: string;
  installerName: string;
}

const TAG_PATTERN = /^v(\d+\.\d+\.\d+(?:-rc\.\d+)?)$/;
const RELEASE_URL_PREFIX = "https://github.com/garyljw/mediahub/releases/download/";
const MANIFEST_NAME = "update-manifest.json";
const SIG_NAME = "update-manifest.json.sig";

/**
 * The highest release that can be installed over `installedVersion`, or null.
 * A pre-release is offered only to a pre-release install. `skipped` versions are ignored unless `manual`.
 */
export function pickRelease(
  releases: Release[],
  installedVersion: string,
  skipped: string[],
  manual: boolean,
): PickedRelease | null {
  const candidates: PickedRelease[] = [];
  for (const release of releases) {
    if (release.draft) continue;
    const tag = TAG_PATTERN.exec(release.tag_name);
    if (!tag) continue;
    const version = tag[1];
    if (!isValidVersion(version)) continue;
    if (compareVersions(version, installedVersion) <= 0) continue;
    if (isPrerelease(version) && !isPrerelease(installedVersion)) continue;
    if (!manual && skipped.includes(version)) continue;

    const prefix = `${RELEASE_URL_PREFIX}v${version}/`;
    const installerName = `MediaHub-Setup-${version}.exe`;
    const manifest = release.assets.find((asset) => asset.name === MANIFEST_NAME);
    const sig = release.assets.find((asset) => asset.name === SIG_NAME);
    const installer = release.assets.find((asset) => asset.name === installerName);
    if (!manifest || !sig || !installer) continue;

    const urls = [manifest, sig, installer].map((asset) => asset.browser_download_url);
    // Any asset from anywhere else makes the whole release unusable.
    if (!urls.every((url) => url.startsWith(prefix))) continue;

    candidates.push({
      version,
      manifestUrl: manifest.browser_download_url,
      sigUrl: sig.browser_download_url,
      installerUrl: installer.browser_download_url,
      installerName,
    });
  }
  candidates.sort((a, b) => compareVersions(b.version, a.version));
  return candidates[0] ?? null;
}
