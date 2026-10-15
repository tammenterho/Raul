import { describe, expect, it } from "vitest";
import {
  createHelsinkiTimeWindow,
  currentTimeAnchor,
  MAX_HALF_HOUR_OFFSET,
  MIN_HALF_HOUR_OFFSET,
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

  it("allows half-hour slots from two hours ago through 23 hours ahead", () => {
    const anchor = Date.parse("2026-10-11T10:10:00Z");

    expect(MIN_HALF_HOUR_OFFSET).toBe(-4);
    expect(MAX_HALF_HOUR_OFFSET).toBe(46);
    expect(createHelsinkiTimeWindow(anchor, -1).centerMs).toBe(anchor - 30 * 60 * 1000);
    expect(createHelsinkiTimeWindow(anchor, -4).centerMs).toBe(anchor - 2 * 60 * 60 * 1000);
    expect(createHelsinkiTimeWindow(anchor, -4).startLabel).toContain("10.40");
    expect(createHelsinkiTimeWindow(anchor, 1).startLabel).toContain("13.10");
    expect(() => createHelsinkiTimeWindow(anchor, -5)).toThrow(RangeError);
    expect(() => createHelsinkiTimeWindow(anchor, 47)).toThrow(RangeError);
  });
});
