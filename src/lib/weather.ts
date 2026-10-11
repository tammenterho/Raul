import type { Coordinates } from "@/lib/sightings";

export type WeatherSnapshot = {
  temperature_c: number | null;
  precipitation_mm: number | null;
  wind_ms: number | null;
};

type OpenMeteoResponse = {
  current?: {
    temperature_2m?: number;
    precipitation?: number;
    wind_speed_10m?: number;
  };
};

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export async function fetchWeather(
  [longitude, latitude]: Coordinates,
): Promise<WeatherSnapshot> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.search = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: "temperature_2m,precipitation,wind_speed_10m",
    wind_speed_unit: "ms",
    forecast_days: "1",
  }).toString();

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) });

    if (!response.ok) {
      return { temperature_c: null, precipitation_mm: null, wind_ms: null };
    }

    const data = await response.json() as OpenMeteoResponse;
    return {
      temperature_c: finiteOrNull(data.current?.temperature_2m),
      precipitation_mm: finiteOrNull(data.current?.precipitation),
      wind_ms: finiteOrNull(data.current?.wind_speed_10m),
    };
  } catch {
    return { temperature_c: null, precipitation_mm: null, wind_ms: null };
  }
}