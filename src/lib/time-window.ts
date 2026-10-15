const MINUTE_MS = 60 * 1000;
const HALF_HOUR_MS = 30 * MINUTE_MS;
const ANCHOR_STEP_MS = 5 * MINUTE_MS;

export const MIN_HALF_HOUR_OFFSET = -4;
export const MAX_HALF_HOUR_OFFSET = 46;
export const WINDOW_HALF_MINUTES = 30;
export const MINUTES_PER_WEEK = 7 * 24 * 60;

const WEEKDAY_NUMBERS: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const slotFormatter = new Intl.DateTimeFormat("fi-FI", {
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "Europe/Helsinki",
});

const weekPartsFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "Europe/Helsinki",
});

export type HelsinkiTimeWindow = {
  centerMs: number;
  minuteOfWeek: number;
  startLabel: string;
  endLabel: string;
};

export function helsinkiMinuteOfWeek(timeMs: number): number {
  const parts = weekPartsFormatter.formatToParts(new Date(timeMs));
  const weekday = WEEKDAY_NUMBERS[parts.find((part) => part.type === "weekday")?.value ?? ""] ?? 0;
  const hour = Number(parts.find((part) => part.type === "hour")?.value) % 24;
  const minute = Number(parts.find((part) => part.type === "minute")?.value);

  return weekday * 1440 + (Number.isFinite(hour) ? hour : 0) * 60 + (Number.isFinite(minute) ? minute : 0);
}

export function isWithinWindow(sightingMinuteOfWeek: number, centerMinuteOfWeek: number): boolean {
  const distance = Math.abs(sightingMinuteOfWeek - centerMinuteOfWeek);
  return Math.min(distance, MINUTES_PER_WEEK - distance) <= WINDOW_HALF_MINUTES;
}

export function currentTimeAnchor(nowMs: number): number {
  if (!Number.isFinite(nowMs)) {
    throw new RangeError("Current time must be a finite timestamp.");
  }

  return Math.round(nowMs / ANCHOR_STEP_MS) * ANCHOR_STEP_MS;
}

export function createHelsinkiTimeWindow(
  anchorMs: number,
  halfHourOffset: number,
): HelsinkiTimeWindow {
  if (!Number.isFinite(anchorMs) || !Number.isInteger(halfHourOffset)) {
    throw new RangeError("Time window requires a finite anchor and integer half-hour offset.");
  }

  if (halfHourOffset < MIN_HALF_HOUR_OFFSET || halfHourOffset > MAX_HALF_HOUR_OFFSET) {
    throw new RangeError(
      `Half-hour offset must be between ${MIN_HALF_HOUR_OFFSET} and ${MAX_HALF_HOUR_OFFSET}.`,
    );
  }

  const center = anchorMs + halfHourOffset * HALF_HOUR_MS;
  const halfMs = WINDOW_HALF_MINUTES * MINUTE_MS;

  return {
    centerMs: center,
    minuteOfWeek: helsinkiMinuteOfWeek(center),
    startLabel: slotFormatter.format(new Date(center - halfMs)),
    endLabel: slotFormatter.format(new Date(center + halfMs)),
  };
}
