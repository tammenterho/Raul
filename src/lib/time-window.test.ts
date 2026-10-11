import { describe, expect, it } from "vitest";
import {
  createHelsinkiTimeWindow,
  FUTURE_HOUR_OFFSETS,
  currentHourAnchor,
} from "./time-window";

describe("Helsinki time window", () => {
  it("starts from the current hour and keeps earlier hours out of range", () => {
    const now = Date.parse("2026-10-11T20:42:00Z");
    const anchor = currentHourAnchor(now);

    expect(anchor).toBe(Date.parse("2026-10-11T20:00:00Z"));
    expect(createHelsinkiTimeWindow(anchor, 0)).toMatchObject({ weekday: 0, hour: 23 });
  });

  it("moves weekday forward when the rolling window crosses midnight", () => {
    const window = createHelsinkiTimeWindow(
      Date.parse("2026-10-11T20:00:00Z"),
      1,
    );

    expect(window).toMatchObject({ weekday: 1, hour: 0 });
    expect(window.startLabel).toContain("ma");
  });

  it("allows only the next 24 hourly slots", () => {
    expect(FUTURE_HOUR_OFFSETS).toBe(23);
    expect(() => createHelsinkiTimeWindow(Date.now(), 24)).toThrow(RangeError);
  });
});