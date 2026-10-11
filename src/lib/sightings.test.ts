import { describe, expect, it } from "vitest";
import {
  calculateHeading,
  isSightingStrokeLongEnough,
} from "./sightings";

describe("calculateHeading", () => {
  it("returns zero for a northbound line", () => {
    expect(calculateHeading([24, 60], [24, 61])).toBeCloseTo(0);
  });

  it("returns 90 for an eastbound line", () => {
    expect(calculateHeading([0, 0], [1, 0])).toBeCloseTo(90);
  });

  it("normalizes a negative westbound bearing to 270 degrees", () => {
    expect(calculateHeading([0, 0], [-1, 0])).toBeCloseTo(270);
  });

  it("rejects strokes shorter than 15 meters", () => {
    expect(isSightingStrokeLongEnough([0, 0], [0.00005, 0])).toBe(false);
    expect(isSightingStrokeLongEnough([0, 0], [0.0002, 0])).toBe(true);
  });
});