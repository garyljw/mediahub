import { describe, expect, it } from "vitest";
import { errorDigest } from "./digest";

describe("errorDigest", () => {
  it("returns the digest of an Error that carries one", () => {
    const error = Object.assign(new Error("secret detail"), { digest: "abc123" });
    expect(errorDigest(error)).toBe("abc123");
  });

  it("returns null for a plain Error", () => {
    expect(errorDigest(new Error("boom"))).toBeNull();
  });

  it("returns null for an Error with an empty digest", () => {
    expect(errorDigest(Object.assign(new Error("boom"), { digest: "" }))).toBeNull();
  });

  it("returns null for an Error with a non-string digest", () => {
    expect(errorDigest(Object.assign(new Error("boom"), { digest: 42 }))).toBeNull();
  });

  it("returns null for values that are not Errors", () => {
    expect(errorDigest("boom")).toBeNull();
    expect(errorDigest(null)).toBeNull();
    expect(errorDigest(undefined)).toBeNull();
    expect(errorDigest({ digest: "abc123" })).toBeNull();
  });
});
