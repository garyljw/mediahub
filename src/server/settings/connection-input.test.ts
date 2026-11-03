import "server-only";
import { describe, expect, it } from "vitest";
import { normalizeArrUrl, parseConnectionInput, resolveApiKey } from "./connection-input";

const KEY = "fake-api-key-0123456789ab"; // 25 characters, not a real key

describe("normalizeArrUrl", () => {
  it("accepts http and https", () => {
    expect(normalizeArrUrl("http://192.168.1.10:7878")).toEqual({ ok: true, url: "http://192.168.1.10:7878" });
    expect(normalizeArrUrl("https://radarr.example.test")).toEqual({ ok: true, url: "https://radarr.example.test" });
  });

  it("rejects other protocols", () => {
    for (const raw of ["ftp://host", "javascript:alert(1)", "file:///etc/passwd"]) {
      expect(normalizeArrUrl(raw)).toEqual({ ok: false, message: "The address must start with http:// or https://." });
    }
  });

  it("rejects a missing scheme or anything that is not a URL", () => {
    expect(normalizeArrUrl("192.168.1.10:7878")).toMatchObject({ ok: false });
    expect(normalizeArrUrl("not a url")).toMatchObject({ ok: false });
  });

  it("rejects credentials in the address", () => {
    const expected = { ok: false, message: "Leave the username and password out of the address." };
    expect(normalizeArrUrl("http://user@host:7878")).toEqual(expected);
    expect(normalizeArrUrl("http://user:pass@host:7878")).toEqual(expected);
  });

  it("rejects a query string or fragment, even an empty one", () => {
    const expected = { ok: false, message: "Leave out the ? and # part of the address." };
    expect(normalizeArrUrl("http://host:7878/?apikey=x")).toEqual(expected);
    expect(normalizeArrUrl("http://host:7878/#top")).toEqual(expected);
    expect(normalizeArrUrl("http://host:7878/?")).toEqual(expected);
  });

  it("removes trailing slashes", () => {
    expect(normalizeArrUrl("http://host:7878/")).toEqual({ ok: true, url: "http://host:7878" });
    expect(normalizeArrUrl("http://host:7878//")).toEqual({ ok: true, url: "http://host:7878" });
  });

  it("keeps a base path, without its trailing slash", () => {
    expect(normalizeArrUrl("http://host:7878/radarr")).toEqual({ ok: true, url: "http://host:7878/radarr" });
    expect(normalizeArrUrl("http://host:7878/radarr/")).toEqual({ ok: true, url: "http://host:7878/radarr" });
  });
});

describe("parseConnectionInput", () => {
  const base = { app: "radarr", url: "http://host:7878", apiKey: KEY };

  it("returns the app, normalised URL and key", () => {
    expect(parseConnectionInput({ ...base, url: "  http://host:7878/radarr/  " })).toEqual({
      ok: true,
      value: { app: "radarr", url: "http://host:7878/radarr", apiKey: KEY },
    });
  });

  it("treats a blank key as not given", () => {
    expect(parseConnectionInput({ ...base, apiKey: "   " })).toMatchObject({ ok: true, value: { apiKey: undefined } });
    expect(parseConnectionInput({ app: "sonarr", url: "http://host:8989" })).toMatchObject({
      ok: true,
      value: { app: "sonarr", apiKey: undefined },
    });
  });

  it("rejects an unknown app, unknown fields, and bad key characters or lengths", () => {
    const invalid = { ok: false, message: "Check the address and API key." };
    expect(parseConnectionInput({ ...base, app: "lidarr" })).toEqual(invalid);
    expect(parseConnectionInput({ ...base, extra: 1 })).toEqual(invalid);
    expect(parseConnectionInput({ ...base, apiKey: "short" })).toEqual(invalid);
    expect(parseConnectionInput({ ...base, apiKey: "x".repeat(129) })).toEqual(invalid);
    expect(parseConnectionInput({ ...base, apiKey: `${KEY}!` })).toEqual(invalid);
    expect(parseConnectionInput({ ...base, url: "" })).toEqual(invalid);
    expect(parseConnectionInput({ ...base, url: "x".repeat(2049) })).toEqual(invalid);
    expect(parseConnectionInput(null)).toEqual(invalid);
  });

  it("passes URL problems through with their own message", () => {
    expect(parseConnectionInput({ ...base, url: "ftp://host" })).toEqual({
      ok: false,
      message: "The address must start with http:// or https://.",
    });
  });
});

describe("resolveApiKey", () => {
  const stored = { url: "http://host:7878", apiKey: "stored-key-0123456789abcd" };

  it("uses a typed key over anything stored", () => {
    expect(resolveApiKey({ apiKey: KEY, url: "http://elsewhere:9999", stored })).toEqual({ ok: true, apiKey: KEY });
  });

  it("keeps the stored key for the same origin", () => {
    expect(resolveApiKey({ apiKey: undefined, url: "http://host:7878", stored })).toEqual({
      ok: true,
      apiKey: stored.apiKey,
    });
  });

  it("requires the key again for a different host", () => {
    expect(resolveApiKey({ apiKey: undefined, url: "http://other:7878", stored })).toEqual({
      ok: false,
      message: "Enter the API key again. It's needed when the address changes.",
    });
  });

  it("requires the key again for a different port", () => {
    expect(resolveApiKey({ apiKey: undefined, url: "http://host:7879", stored })).toMatchObject({ ok: false });
  });

  it("requires the key again for a different scheme", () => {
    expect(resolveApiKey({ apiKey: undefined, url: "https://host:7878", stored })).toMatchObject({ ok: false });
  });

  it("keeps the stored key when only the base path changes", () => {
    expect(resolveApiKey({ apiKey: undefined, url: "http://host:7878/radarr", stored })).toEqual({
      ok: true,
      apiKey: stored.apiKey,
    });
  });

  it("asks for a key when nothing is stored", () => {
    expect(resolveApiKey({ apiKey: undefined, url: "http://host:7878", stored: null })).toEqual({
      ok: false,
      message: "Enter the API key.",
    });
  });
});
