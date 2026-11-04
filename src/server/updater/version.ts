import "server-only";

/**
 * Release versions: X.Y.Z, with an optional -rc.N or -dev.N pre-release tag.
 * Precedence follows semver: a pre-release sorts below its release, dev sorts below rc,
 * and numbers compare as numbers.
 */

const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-(rc|dev)\.(\d+))?$/;

const KIND_RANK: Record<"dev" | "rc", number> = { dev: 0, rc: 1 };

interface ParsedVersion {
  core: [number, number, number];
  pre: { kind: "dev" | "rc"; n: number } | null;
}

function parseVersion(version: string): ParsedVersion | null {
  const match = VERSION_PATTERN.exec(version);
  if (!match) return null;
  const pre = match[4] ? { kind: match[4] as "dev" | "rc", n: Number(match[5]) } : null;
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], pre };
}

/** True when the string is a valid MediaHub version (X.Y.Z with an optional -rc.N or -dev.N). */
export function isValidVersion(version: string): boolean {
  return parseVersion(version) !== null;
}

/** True for -rc.N and -dev.N versions. Throws on a value that isn't a valid version. */
export function isPrerelease(version: string): boolean {
  const parsed = parseVersion(version);
  if (!parsed) throw new Error("Not a MediaHub version.");
  return parsed.pre !== null;
}

/** Negative when a sorts before b, positive when after, 0 when equal. Throws on an invalid version. */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) throw new Error("Not a MediaHub version.");
  for (let i = 0; i < 3; i++) {
    const diff = left.core[i] - right.core[i];
    if (diff !== 0) return diff;
  }
  if (left.pre === null && right.pre === null) return 0;
  // A release sorts above any pre-release of the same core version.
  if (left.pre === null) return 1;
  if (right.pre === null) return -1;
  const kindDiff = KIND_RANK[left.pre.kind] - KIND_RANK[right.pre.kind];
  if (kindDiff !== 0) return kindDiff;
  return left.pre.n - right.pre.n;
}
