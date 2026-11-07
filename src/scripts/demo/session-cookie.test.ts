import { describe, expect, it } from "vitest";
// better-call's own signing, which Better Auth uses to write the session cookie. Not exported from its index, so the
// file is imported directly. The file ships no type declarations, hence the expect-error.
// @ts-expect-error better-call's internal crypto module has no type declarations
import { signCookieValue } from "../../../node_modules/better-call/dist/crypto.mjs";
import { demoDatabaseProblem, signedSessionCookieValue } from "../../../scripts/demo/session-cookie";

const REPO = "/Users/example/repo";

describe("signedSessionCookieValue", () => {
  it("matches better-call's signCookieValue for the same token and secret", async () => {
    const token = "sample-token-AbC123_xyz";
    const secret = "demo-only-auth-secret-not-for-real-use-0123456789";
    expect(signedSessionCookieValue(token, secret)).toBe(await signCookieValue(token, secret));
  });

  it("matches better-call for a token whose signature needs URL encoding", async () => {
    const token = "t";
    const secret = "another-secret-value-that-is-long-enough-0000";
    const value = signedSessionCookieValue(token, secret);
    expect(value).toBe(await signCookieValue(token, secret));
    expect(value).toContain("%");
  });
});

describe("demoDatabaseProblem", () => {
  it("allows a file inside demo/", () => {
    expect(demoDatabaseProblem("demo/mediahub.db", REPO)).toBeNull();
    expect(demoDatabaseProblem(`${REPO}/demo/mediahub.db`, REPO)).toBeNull();
  });

  it("refuses data/, the demo folder itself, parents and absolute paths outside demo/", () => {
    expect(demoDatabaseProblem("data/mediahub.db", REPO)).not.toBeNull();
    expect(demoDatabaseProblem("./data/mediahub.db", REPO)).not.toBeNull();
    expect(demoDatabaseProblem("demo", REPO)).not.toBeNull();
    expect(demoDatabaseProblem("demo/../data/mediahub.db", REPO)).not.toBeNull();
    expect(demoDatabaseProblem("../mediahub.db", REPO)).not.toBeNull();
    expect(demoDatabaseProblem("/tmp/mediahub.db", REPO)).not.toBeNull();
    expect(demoDatabaseProblem(undefined, REPO)).not.toBeNull();
  });
});
