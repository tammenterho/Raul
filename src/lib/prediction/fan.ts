import type { Coordinates } from "@/lib/sightings";

export const WALKING_SPEED_MPS = 1.3;
export const MAX_PREDICTION_MINUTES = 10;
export const FAN_HALF_ANGLE_DEGREES = 35;

const EARTH_RADIUS_METERS = 6_371_008.8;
const FAN_ARC_STEPS = 14;

export type FanFeature = {
  type: "Feature";
  properties: {
    minutes: number;
    heading: number;
  };
  geometry: {
    type: "Polygon";
    coordinates: Coordinates[][];
  };
};

function destination(
  [longitude, latitude]: Coordinates,
  bearingDegrees: number,
  distanceMeters: number,
): Coordinates {
  const angularDistance = distanceMeters / EARTH_RADIUS_METERS;
  const bearingRadians = bearingDegrees * Math.PI / 180;
  const latitudeRadians = latitude * Math.PI / 180;
  const longitudeRadians = longitude * Math.PI / 180;

  const destinationLatitude = Math.asin(
    Math.sin(latitudeRadians) * Math.cos(angularDistance) +
    Math.cos(latitudeRadians) * Math.sin(angularDistance) * Math.cos(bearingRadians),
  );
  const destinationLongitude = longitudeRadians + Math.atan2(
    Math.sin(bearingRadians) * Math.sin(angularDistance) * Math.cos(latitudeRadians),
    Math.cos(angularDistance) - Math.sin(latitudeRadians) * Math.sin(destinationLatitude),
  );
  const longitudeDegrees = (destinationLongitude * 180 / Math.PI + 540) % 360 - 180;

  return [longitudeDegrees, destinationLatitude * 180 / Math.PI];
}

export function createPredictionFan(
  start: Coordinates,
  heading: number,
  minutes: number,
): FanFeature {
  if (!Number.isFinite(heading)) {
    throw new RangeError("Heading must be a finite number.");
  }
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_PREDICTION_MINUTES) {
    throw new RangeError(`Minutes must be an integer between 1 and ${MAX_PREDICTION_MINUTES}.`);
  }

  const normalizedHeading = ((heading % 360) + 360) % 360;
  const distanceMeters = minutes * 60 * WALKING_SPEED_MPS;
  const arc: Coordinates[] = [];

  for (let step = 0; step <= FAN_ARC_STEPS; step += 1) {
    const bearing = normalizedHeading - FAN_HALF_ANGLE_DEGREES +
      2 * FAN_HALF_ANGLE_DEGREES * step / FAN_ARC_STEPS;
    arc.push(destination(start, bearing, distanceMeters));
  }

  return {
    type: "Feature",
    properties: { minutes, heading: normalizedHeading },
    geometry: {
      type: "Polygon",
      coordinates: [[start, ...arc, start]],
    },
  };
}