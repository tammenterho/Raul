const HOUR_MS = 60 * 60 * 1000;
export const FUTURE_HOUR_OFFSETS = 23;

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

export type HelsinkiTimeWindow = {
  weekday: number;
  hour: number;
  startLabel: string;
  endLabel: string;
};

export function currentHourAnchor(nowMs: number): number {
  if (!Number.isFinite(nowMs)) {
    throw new RangeError("Current time must be a finite timestamp.");
  }

  return Math.floor(nowMs / HOUR_MS) * HOUR_MS;
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

  const start = new Date(anchorMs + hourOffset * HOUR_MS);
  const end = new Date(start.getTime() + HOUR_MS);
  const parts = slotFormatter.formatToParts(start);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const weekdayLabel = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: "Europe/Helsinki",
  }).format(start);

  return {
    weekday: WEEKDAY_NUMBERS[weekdayLabel] ?? 0,
    hour: Number.isInteger(hour) && hour >= 0 && hour < 24 ? hour : 0,
    startLabel: slotFormatter.format(start),
    endLabel: slotFormatter.format(end),
  };
}