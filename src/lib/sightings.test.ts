import { describe, expect, it } from "vitest";
import {
  calculateHeading,
  isSightingStrokeLongEnough,
  parsePointLocation,
} from "./sightings";

describe("parsePointLocation", () => {
  it("parses hex EWKB returned by PostgREST", () => {
    const point = parsePointLocation("0101000020E610000010917EC371F13840486BF01A9F154E40");

    expect(point?.[0]).toBeCloseTo(24.94, 1);
    expect(point?.[1]).toBeCloseTo(60.17, 1);
  });

  it("parses WKT with and without SRID", () => {
    expect(parsePointLocation("SRID=4326;POINT(24.9 60.1)")).toEqual([24.9, 60.1]);
    expect(parsePointLocation("POINT(24.9 60.1)")).toEqual([24.9, 60.1]);
  });

  it("returns null for unsupported input", () => {
    expect(parsePointLocation("not a point")).toBeNull();
  });
});

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