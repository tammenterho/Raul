const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const ANCHOR_STEP_MS = 5 * MINUTE_MS;

export const FUTURE_HOUR_OFFSETS = 23;
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
  hourOffset: number,
): HelsinkiTimeWindow {
  if (!Number.isFinite(anchorMs) || !Number.isInteger(hourOffset)) {
    throw new RangeError("Time window requires a finite anchor and integer offset.");
  }

  if (hourOffset < 0 || hourOffset > FUTURE_HOUR_OFFSETS) {
    throw new RangeError(`Hour offset must be between 0 and ${FUTURE_HOUR_OFFSETS}.`);
  }

  const center = anchorMs + hourOffset * HOUR_MS;
  const halfMs = WINDOW_HALF_MINUTES * MINUTE_MS;

  return {
    minuteOfWeek: helsinkiMinuteOfWeek(center),
    startLabel: slotFormatter.format(new Date(center - halfMs)),
    endLabel: slotFormatter.format(new Date(center + halfMs)),
  };
}
