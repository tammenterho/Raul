import bearing from "@turf/bearing";
import distance from "@turf/distance";
import { point } from "@turf/helpers";

export type Coordinates = [number, number];
export const MIN_SIGHTING_DISTANCE_METERS = 15;

export function calculateHeading(start: Coordinates, end: Coordinates): number {
  return (bearing(start, end) + 360) % 360;
}

export function isSightingStrokeLongEnough(
  start: Coordinates,
  end: Coordinates,
): boolean {
  return distance(point(start), point(end), { units: "meters" }) >=
    MIN_SIGHTING_DISTANCE_METERS;
}