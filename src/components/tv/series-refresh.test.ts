import { describe, expect, it } from "vitest";
import { MAX_BULK_SERIES } from "./series-bulk";
import { MAX_REFRESH_SERIES, refreshStartedMessage } from "./series-refresh";

describe("refreshStartedMessage", () => {
  it("uses the singular for one series", () => {
    expect(refreshStartedMessage(1)).toBe("Started a refresh and scan for 1 series. Reload in a minute to see changes.");
  });

  it("uses the same word for several series", () => {
    expect(refreshStartedMessage(3)).toBe("Started a refresh and scan for 3 series. Reload in a minute to see changes.");
  });
});

describe("MAX_REFRESH_SERIES", () => {
  it("is a positive whole number", () => {
    expect(Number.isInteger(MAX_REFRESH_SERIES)).toBe(true);
    expect(MAX_REFRESH_SERIES).toBeGreaterThan(0);
  });

  it("shares the bulk limit", () => {
    expect(MAX_REFRESH_SERIES).toBe(MAX_BULK_SERIES);
  });
});
