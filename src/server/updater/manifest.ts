import "server-only";
import { createPublicKey, verify } from "node:crypto";
import { z } from "zod";
import { isValidVersion } from "./version";

/** Largest installer the updater will download (500 MB). */
export const MAX_INSTALLER_BYTES = 500 * 1024 * 1024;

export const manifestSchema = z.object({
  schema: z.literal(1),
  product: z.literal("MediaHub"),
  version: z.string().refine(isValidVersion, "not a MediaHub version"),
  installer: z.string(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  size: z.number().int().positive().max(MAX_INSTALLER_BYTES),
});

export type Manifest = z.infer<typeof manifestSchema>;

/**
 * Checks the Ed25519 signature over the exact manifest bytes, then parses the manifest.
 * Throws on a bad signature, bad JSON, a wrong version or a wrong installer name.
 */
export function verifyManifest(
  manifestBytes: Buffer,
  sigBase64: string,
  publicKeyPem: string,
  expectedVersion: string,
): Manifest {
  let signatureValid = false;
  try {
    const key = createPublicKey(publicKeyPem);
    const signature = Buffer.from(sigBase64.trim(), "base64");
    signatureValid = verify(null, manifestBytes, key, signature);
  } catch {
    signatureValid = false;
  }
  if (!signatureValid) throw new Error("The update manifest signature is not valid.");

  const manifest = manifestSchema.parse(JSON.parse(manifestBytes.toString("utf8")));
  if (manifest.version !== expectedVersion) {
    throw new Error(`The update manifest is for ${manifest.version}, not ${expectedVersion}.`);
  }
  if (manifest.installer !== `MediaHub-Setup-${manifest.version}.exe`) {
    throw new Error("The update manifest names an unexpected installer.");
  }
  return manifest;
}
