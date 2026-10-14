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

const WKT_POINT = /POINT\s*\(\s*(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s+(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)/i;

// PostgREST palauttaa geography::text-arvon heksamuotoisena EWKB:nä, ei WKT:nä.
export function parsePointLocation(location: string): Coordinates | null {
  const wkt = location.match(WKT_POINT);
  let coordinates: Coordinates | null = null;

  if (wkt) {
    coordinates = [Number(wkt[1]), Number(wkt[2])];
  } else if (/^(?:[0-9a-f]{2})+$/i.test(location) && location.length >= 42) {
    const bytes = Uint8Array.from(
      location.match(/../g)!.map((byte) => parseInt(byte, 16)),
    );
    const view = new DataView(bytes.buffer);
    const littleEndian = bytes[0] === 1;
    const type = view.getUint32(1, littleEndian);
    const hasSrid = (type & 0x20000000) !== 0;
    const offset = 5 + (hasSrid ? 4 : 0);

    if ((type & 0xff) === 1 && bytes.length >= offset + 16) {
      coordinates = [
        view.getFloat64(offset, littleEndian),
        view.getFloat64(offset + 8, littleEndian),
      ];
    }
  }

  return coordinates?.every(Number.isFinite) ? coordinates : null;
}