import "server-only";
import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyManifest } from "./manifest";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const PUBLIC_PEM = publicKey.export({ type: "spki", format: "pem" }).toString();
const OTHER_PEM = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }).toString();

function manifestJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schema: 1,
    product: "MediaHub",
    version: "1.2.0",
    installer: "MediaHub-Setup-1.2.0.exe",
    sha256: "a".repeat(64),
    size: 12345,
    ...overrides,
  });
}

function signed(text: string): { bytes: Buffer; sig: string } {
  const bytes = Buffer.from(text, "utf8");
  return { bytes, sig: sign(null, bytes, privateKey).toString("base64") };
}

describe("verifyManifest", () => {
  it("accepts a good manifest", () => {
    const { bytes, sig } = signed(manifestJson());
    const manifest = verifyManifest(bytes, sig, PUBLIC_PEM, "1.2.0");
    expect(manifest.size).toBe(12345);
    expect(manifest.installer).toBe("MediaHub-Setup-1.2.0.exe");
  });

  it("rejects tampered bytes", () => {
    const { bytes, sig } = signed(manifestJson());
    const tampered = Buffer.from(bytes.toString("utf8").replace("12345", "99999"), "utf8");
    expect(() => verifyManifest(tampered, sig, PUBLIC_PEM, "1.2.0")).toThrow("signature");
  });

  it("rejects a signature from another key", () => {
    const { bytes, sig } = signed(manifestJson());
    expect(() => verifyManifest(bytes, sig, OTHER_PEM, "1.2.0")).toThrow("signature");
  });

  it("rejects a manifest for another version", () => {
    const { bytes, sig } = signed(manifestJson());
    expect(() => verifyManifest(bytes, sig, PUBLIC_PEM, "1.3.0")).toThrow("not 1.3.0");
  });

  it("rejects an unexpected installer name", () => {
    const { bytes, sig } = signed(manifestJson({ installer: "evil.exe" }));
    expect(() => verifyManifest(bytes, sig, PUBLIC_PEM, "1.2.0")).toThrow("unexpected installer");
  });

  it("rejects bad JSON and an invalid manifest shape", () => {
    const badJson = signed("{not json");
    expect(() => verifyManifest(badJson.bytes, badJson.sig, PUBLIC_PEM, "1.2.0")).toThrow();
    const badHash = signed(manifestJson({ sha256: "XYZ" }));
    expect(() => verifyManifest(badHash.bytes, badHash.sig, PUBLIC_PEM, "1.2.0")).toThrow();
  });
});
