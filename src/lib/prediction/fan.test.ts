import bearing from "@turf/bearing";
import distance from "@turf/distance";
import { point } from "@turf/helpers";
import { describe, expect, it } from "vitest";
import { createPredictionFan, WALKING_SPEED_MPS } from "./fan";

describe("createPredictionFan", () => {
  it("creates a closed polygon at the walking-speed distance", () => {
    const start: [number, number] = [24.9384, 60.1699];
    const fan = createPredictionFan(start, 90, 2);
    const ring = fan.geometry.coordinates[0];

    expect(fan.geometry.type).toBe("Polygon");
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    expect(distance(point(start), point(ring[1]), { units: "meters" }))
      .toBeCloseTo(2 * 60 * WALKING_SPEED_MPS, 0);
  });

  it("spans 70 degrees around the normalized heading", () => {
    const start: [number, number] = [0, 0];
    const fan = createPredictionFan(start, 370, 1);
    const ring = fan.geometry.coordinates[0];
    const leftBearing = (bearing(point(start), point(ring[1])) + 360) % 360;
    const rightBearing = (bearing(point(start), point(ring[ring.length - 2])) + 360) % 360;

    expect(fan.properties.heading).toBe(10);
    expect(leftBearing).toBeCloseTo(335, 0);
    expect(rightBearing).toBeCloseTo(45, 0);
  });

  it("rejects prediction durations outside one to ten minutes", () => {
    expect(() => createPredictionFan([0, 0], 0, 0)).toThrow(RangeError);
    expect(() => createPredictionFan([0, 0], 0, 11)).toThrow(RangeError);
  });
});