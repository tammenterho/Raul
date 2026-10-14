import { describe, expect, it } from "vitest";
import {
  createHelsinkiTimeWindow,
  currentTimeAnchor,
  FUTURE_HOUR_OFFSETS,
  helsinkiMinuteOfWeek,
  isWithinWindow,
} from "./time-window";

describe("Helsinki time window", () => {
  it("centers the window on the current time rounded to 5 minutes", () => {
    const now = Date.parse("2026-10-11T10:11:00Z");
    const anchor = currentTimeAnchor(now);

    expect(anchor).toBe(Date.parse("2026-10-11T10:10:00Z"));
    const window = createHelsinkiTimeWindow(anchor, 0);
    expect(window.startLabel).toContain("12.40");
    expect(window.endLabel).toContain("13.40");
  });

  it("computes the Helsinki minute of the week", () => {
    // Sunday 2026-10-11 13:10 Helsinki (UTC+3)
    expect(helsinkiMinuteOfWeek(Date.parse("2026-10-11T10:10:00Z"))).toBe(13 * 60 + 10);
    // Monday 00:15 Helsinki
    expect(helsinkiMinuteOfWeek(Date.parse("2026-10-11T21:15:00Z"))).toBe(1440 + 15);
  });

  it("matches sightings within 30 minutes and wraps around the week", () => {
    expect(isWithinWindow(13 * 60, 13 * 60 + 30)).toBe(true);
    expect(isWithinWindow(13 * 60, 13 * 60 + 31)).toBe(false);
    expect(isWithinWindow(10079, 10)).toBe(true);
  });

  it("allows only the next 24 hourly slots", () => {
    expect(FUTURE_HOUR_OFFSETS).toBe(23);
    expect(() => createHelsinkiTimeWindow(Date.now(), 24)).toThrow(RangeError);
  });
});
