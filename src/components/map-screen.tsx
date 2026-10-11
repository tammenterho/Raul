"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { GeoJSONSource, Map as MapLibreMap, Marker, Popup } from "maplibre-gl";
import {
  calculateHeading,
  isSightingStrokeLongEnough,
  type Coordinates,
} from "@/lib/sightings";
import { getSupabaseClient } from "@/lib/supabase";
import { fetchWeather } from "@/lib/weather";
import { useAuth } from "@/components/auth-provider";
import {
  createHelsinkiTimeWindow,
  currentHourAnchor,
  FUTURE_HOUR_OFFSETS,
} from "@/lib/time-window";

const HELSINKI_CENTER: [number, number] = [24.9384, 60.1699];
const DRAFT_SOURCE_ID = "sighting-draft";
const OWN_SIGHTINGS_SOURCE_ID = "own-sightings";
const COMMUNITY_SIGHTINGS_SOURCE_ID = "community-sightings";
const COMMUNITY_HEATMAP_LAYER_ID = "community-sightings-heatmap";
const OWN_SIGHTINGS_HEATMAP_LAYER_ID = "own-sightings-heatmap";
const OWN_SIGHTINGS_LAYER_ID = "own-sightings-arrows";
const OWN_ARROW_IMAGE_ID = "own-sighting-arrow";

type ArrowPath = {
  id: string;
  start: Coordinates;
  end: Coordinates;
};

type SavedSighting = {
  databaseId: string;
};

type OwnSightingProperties = {
  id: string;
  seen_at: string;
  heading: number;
  temperature_c: number | null;
  precipitation_mm: number | null;
  wind_ms: number | null;
  hour: number;
  weekday: number;
};

type OwnSightingFeature = {
  type: "Feature";
  id: string;
  geometry: { type: "Point"; coordinates: Coordinates };
  properties: OwnSightingProperties;
};

type OwnSightingRow = {
  id: string;
  seen_at: string;
  location_text: string;
  heading: number | string;
  temperature_c: number | null;
  precipitation_mm: number | null;
  wind_ms: number | null;
};

type CommunityGridRow = {
  longitude: number;
  latitude: number;
  observation_count: number;
  heat_weight: number;
};

type CommunityGridFeature = {
  type: "Feature";
  id: string;
  geometry: { type: "Point"; coordinates: Coordinates };
  properties: { observation_count: number; heat_weight: number };
};

function createSightingTimeFilter(weekday: number, hour: number) {
  const filter: [
    "all",
    ["==", ["get", string], number],
    ["==", ["get", string], number],
  ] = [
    "all",
    ["==", ["get", "weekday"], weekday],
    ["==", ["get", "hour"], hour],
  ];
  return filter;
}

function parsePointText(location: string): Coordinates | null {
  const match = location.match(
    /POINT\s*\(\s*(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s+(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)/i,
  );

  if (!match) {
    return null;
  }

  const coordinates: Coordinates = [Number(match[1]), Number(match[2])];
  return coordinates.every(Number.isFinite) ? coordinates : null;
}

function createOwnSightingFeature(
  location: Coordinates,
  properties: Omit<OwnSightingProperties, "hour" | "weekday">,
): OwnSightingFeature {
  const timeWindow = createHelsinkiTimeWindow(Date.parse(properties.seen_at), 0);

  return {
    type: "Feature",
    id: properties.id,
    geometry: { type: "Point", coordinates: location },
    properties: {
      ...properties,
      hour: timeWindow.hour,
      weekday: timeWindow.weekday,
    },
  };
}

function createOwnArrowImage(map: MapLibreMap) {
  if (map.hasImage(OWN_ARROW_IMAGE_ID)) {
    return;
  }

  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d");

  if (!context) {
    return;
  }

  context.fillStyle = "#ffffff";
  context.beginPath();
  context.moveTo(32, 2);
  context.lineTo(61, 31);
  context.lineTo(40, 26);
  context.lineTo(40, 62);
  context.lineTo(24, 62);
  context.lineTo(24, 26);
  context.lineTo(3, 31);
  context.closePath();
  context.fill();
  map.addImage(OWN_ARROW_IMAGE_ID, context.getImageData(0, 0, 64, 64), {
    pixelRatio: 2,
    sdf: true,
  });
}

function setOwnSightingsData(map: MapLibreMap, features: OwnSightingFeature[]) {
  const source = map.getSource(OWN_SIGHTINGS_SOURCE_ID) as GeoJSONSource | undefined;
  source?.setData({ type: "FeatureCollection", features });
}

function createSightingPopup(
  properties: OwnSightingProperties,
  onDelete: () => Promise<void>,
): HTMLElement {
  const content = document.createElement("div");
  content.className = "own-sighting-popup";

  const time = document.createElement("p");
  time.className = "own-sighting-popup-time";
  time.textContent = new Intl.DateTimeFormat("fi-FI", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Helsinki",
  }).format(new Date(properties.seen_at));
  content.append(time);

  const weather = [
    properties.temperature_c === null
      ? null
      : `Lämpötila ${properties.temperature_c.toFixed(1)} °C`,
    properties.precipitation_mm === null
      ? null
      : `Sade ${properties.precipitation_mm.toFixed(1)} mm`,
    properties.wind_ms === null
      ? null
      : `Tuuli ${properties.wind_ms.toFixed(1)} m/s`,
  ].filter((value): value is string => value !== null);
  const weatherLine = document.createElement("p");
  weatherLine.textContent = weather.length > 0
    ? weather.join(" · ")
    : "Säätiedot eivät saatavilla";
  content.append(weatherLine);

  const deleteButton = document.createElement("button");
  deleteButton.className = "own-sighting-delete";
  deleteButton.type = "button";
  deleteButton.textContent = "Poista";
  deleteButton.addEventListener("click", async () => {
    deleteButton.disabled = true;
    deleteButton.textContent = "Poistetaan...";

    try {
      await onDelete();
    } catch (error) {
      console.error("Sighting delete failed.", error);
      deleteButton.disabled = false;
      deleteButton.textContent = "Poista";
      let errorMessage = content.querySelector(".own-sighting-delete-error");
      if (!errorMessage) {
        errorMessage = document.createElement("p");
        errorMessage.className = "own-sighting-delete-error";
        errorMessage.setAttribute("role", "alert");
        content.append(errorMessage);
      }
      errorMessage.textContent = "Havaintoa ei voitu poistaa.";
    }
  });
  content.append(deleteButton);

  return content;
}

function setMapGesturesEnabled(map: MapLibreMap, enabled: boolean) {
  const handlers = [
    map.dragPan,
    map.dragRotate,
    map.scrollZoom,
    map.boxZoom,
    map.doubleClickZoom,
    map.keyboard,
    map.touchPitch,
    map.touchZoomRotate,
  ];

  for (const handler of handlers) {
    if (enabled) {
      handler.enable();
    } else {
      handler.disable();
    }
  }
}

function createArrowFeatures(map: MapLibreMap, arrow: ArrowPath) {
  const startPoint = map.project(arrow.start);
  const endPoint = map.project(arrow.end);
  const deltaX = endPoint.x - startPoint.x;
  const deltaY = endPoint.y - startPoint.y;
  const lineLength = Math.hypot(deltaX, deltaY);
  const unitX = lineLength === 0 ? 0 : deltaX / lineLength;
  const unitY = lineLength === 0 ? 0 : deltaY / lineLength;
  const headLength = Math.min(22, lineLength * 0.45);
  const headWidth = Math.min(18, lineLength * 0.4);
  const baseX = endPoint.x - unitX * headLength;
  const baseY = endPoint.y - unitY * headLength;
  const perpendicularX = -unitY;
  const perpendicularY = unitX;
  const leftHead = map.unproject([
    baseX + perpendicularX * headWidth / 2,
    baseY + perpendicularY * headWidth / 2,
  ]);
  const rightHead = map.unproject([
    baseX - perpendicularX * headWidth / 2,
    baseY - perpendicularY * headWidth / 2,
  ]);

  return [
      {
        type: "Feature" as const,
        properties: { kind: "line" as const, arrowId: arrow.id },
        geometry: { type: "LineString" as const, coordinates: [arrow.start, arrow.end] },
      },
      {
        type: "Feature" as const,
        properties: { kind: "arrow" as const, arrowId: arrow.id },
        geometry: {
          type: "Polygon" as const,
          coordinates: [[
            arrow.end,
            [leftHead.lng, leftHead.lat],
            [rightHead.lng, rightHead.lat],
            arrow.end,
          ]],
        },
      },
  ];
}

function renderArrowLayer(map: MapLibreMap, arrows: ArrowPath[]) {
  const source = map.getSource(DRAFT_SOURCE_ID) as GeoJSONSource | undefined;
  source?.setData({
    type: "FeatureCollection",
    features: arrows.flatMap((arrow) => createArrowFeatures(map, arrow)),
  });
}

function requestUserLocation(
  mapRef: { current: MapLibreMap | null },
  maplibreRef: { current: typeof import("maplibre-gl") | null },
  markerRef: { current: Marker | null },
  setIsLocating: (isLocating: boolean) => void,
  setLocationMessage: (message: string | null) => void,
) {
  if (!navigator.geolocation) {
    setLocationMessage("Sijaintipalvelu ei ole käytettävissä.");
    return;
  }

  setIsLocating(true);
  setLocationMessage(null);

  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      const coordinates: Coordinates = [coords.longitude, coords.latitude];
      const map = mapRef.current;
      const MarkerConstructor = maplibreRef.current?.Marker;

      if (map && MarkerConstructor) {
        markerRef.current?.remove();
        markerRef.current = new MarkerConstructor({ color: "#dc5b35" })
          .setLngLat(coordinates)
          .addTo(map);
        map.flyTo({ center: coordinates, zoom: 16.5, essential: true, duration: 1200 });
      }

      setIsLocating(false);
      setLocationMessage("Sijaintisi näkyy kartalla.");
    },
    (error) => {
      setIsLocating(false);
      setLocationMessage(
        error.code === error.PERMISSION_DENIED
          ? "Salli sijainnin käyttö selaimen asetuksista."
          : error.code === error.TIMEOUT
            ? "Sijainnin haku aikakatkaistiin. Yritä uudelleen."
            : "Sijaintia ei saatu. Tarkista laitteen sijaintiasetukset.",
      );
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
  );
}

export function MapScreen() {
  const user = useAuth();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const popupRef = useRef<Popup | null>(null);
  const maplibreRef = useRef<typeof import("maplibre-gl") | null>(null);
  const [isMapLoaded, setIsMapLoaded] = useState(false);
  const [onlyOwnSightings, setOnlyOwnSightings] = useState(false);
  const [ownLayerMode, setOwnLayerMode] = useState<"arrows" | "heatmap">("arrows");
  const [ownSightings, setOwnSightings] = useState<OwnSightingFeature[]>([]);
  const [ownSightingsCount, setOwnSightingsCount] = useState<number | null>(null);
  const [timelineAnchor, setTimelineAnchor] = useState(() => currentHourAnchor(Date.now()));
  const [selectedOffset, setSelectedOffset] = useState(0);
  const [isTimePlaying, setIsTimePlaying] = useState(false);
  const [ownSightingsError, setOwnSightingsError] = useState<string | null>(null);
  const [communityGridStatus, setCommunityGridStatus] = useState<
    "loading" | "empty" | "error" | null
  >(null);
  const [isLocating, setIsLocating] = useState(false);
  const [isAddingSighting, setIsAddingSighting] = useState(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawingMessage, setDrawingMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [undoSighting, setUndoSighting] = useState<SavedSighting | null>(null);
  const [isUndoing, setIsUndoing] = useState(false);
  const [undoError, setUndoError] = useState<string | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [locationMessage, setLocationMessage] = useState<string | null>(null);
  const activePointerRef = useRef<{ pointerId: number; start: Coordinates } | null>(null);
  const isAddingSightingRef = useRef(false);
  const isSavingRef = useRef(false);
  const ownSightingsRef = useRef<OwnSightingFeature[]>([]);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoSightingRef = useRef<string | null>(null);
  const selectedTimeWindow = createHelsinkiTimeWindow(timelineAnchor, selectedOffset);
  const selectedHour = selectedTimeWindow.hour;
  const selectedWeekday = selectedTimeWindow.weekday;
  const timeFilterRef = useRef({ weekday: selectedWeekday, hour: selectedHour });

  const advanceTimeline = useEffectEvent(() => {
    if (selectedOffset >= FUTURE_HOUR_OFFSETS) {
      setIsTimePlaying(false);
      return;
    }

    setSelectedOffset(selectedOffset + 1);
  });

  const saveSighting = useEffectEvent(async (drawnSighting: ArrowPath) => {
    if (isSavingRef.current) {
      return;
    }

    isSavingRef.current = true;
    setIsSaving(true);
    setSaveError(null);
    setDrawingMessage("Tallennetaan havaintoa...");

    try {
      const weather = await fetchWeather(drawnSighting.start);
      const { data, error } = await getSupabaseClient()
        .from("sightings")
        .insert({
          location: `SRID=4326;POINT(${drawnSighting.start[0]} ${drawnSighting.start[1]})`,
          heading: calculateHeading(drawnSighting.start, drawnSighting.end),
          temperature_c: weather.temperature_c,
          precipitation_mm: weather.precipitation_mm,
          wind_ms: weather.wind_ms,
        })
        .select("id, seen_at")
        .single();

      if (error) {
        throw error;
      }

      const saved: SavedSighting = {
        databaseId: data.id,
      };
      const heading = calculateHeading(drawnSighting.start, drawnSighting.end);
      ownSightingsRef.current = [
        ...ownSightingsRef.current.filter((feature) => feature.properties.id !== data.id),
        createOwnSightingFeature(drawnSighting.start, {
          id: data.id,
          seen_at: data.seen_at,
          heading,
          temperature_c: weather.temperature_c,
          precipitation_mm: weather.precipitation_mm,
          wind_ms: weather.wind_ms,
        }),
      ];
      setOwnSightings(ownSightingsRef.current);
      setOwnSightingsCount(ownSightingsRef.current.length);
      const map = mapRef.current;
      if (map) {
        renderArrowLayer(map, []);
        setOwnSightingsData(map, ownSightingsRef.current);
      }

      if (undoTimerRef.current) {
        clearTimeout(undoTimerRef.current);
      }
      setUndoSighting(saved);
      undoSightingRef.current = saved.databaseId;
      setUndoError(null);
      setSaveError(null);
      setDrawingMessage("Vedä seuraava nuoli");
      undoTimerRef.current = setTimeout(() => {
        if (undoSightingRef.current === saved.databaseId) {
          undoSightingRef.current = null;
          setUndoSighting(null);
        }
        undoTimerRef.current = null;
      }, 5000);
    } catch (error) {
      console.error("Sighting save failed.", error);
      setSaveError("Havaintoa ei voitu tallentaa. Yritä uudelleen.");
      setDrawingMessage("Vedä seuraava nuoli");
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
    }
  });

  useEffect(() => {
    let isCancelled = false;
    let map: MapLibreMap | undefined;
    let hasLoaded = false;

    async function initializeMap() {
      const mapTilerKey = process.env.NEXT_PUBLIC_MAPTILER_KEY;

      if (!mapTilerKey) {
        setMapError("Lisää NEXT_PUBLIC_MAPTILER_KEY ympäristömuuttujiin.");
        return;
      }

      try {
        const maplibregl = await import("maplibre-gl");

        if (isCancelled || !containerRef.current) {
          return;
        }

        const workerFileName =
          process.env.NODE_ENV === "development"
            ? "maplibre-gl-worker-dev.mjs"
            : "maplibre-gl-worker.mjs";
        maplibregl.setWorkerUrl(
          `https://unpkg.com/maplibre-gl@${maplibregl.getVersion()}/dist/${workerFileName}`,
        );
        maplibreRef.current = maplibregl;
        map = new maplibregl.Map({
          container: containerRef.current,
          style: `https://api.maptiler.com/maps/streets-v2/style.json?key=${encodeURIComponent(mapTilerKey)}`,
          center: HELSINKI_CENTER,
          zoom: 15,
        });
        mapRef.current = map;
        map.addControl(
          new maplibregl.NavigationControl({ showCompass: false }),
          "bottom-right",
        );
        map.once("load", () => {
          const loadedMap = map;
          if (!loadedMap) {
            return;
          }

          loadedMap.addSource(DRAFT_SOURCE_ID, {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
          });
          loadedMap.addLayer({
            id: "sighting-draft-line",
            type: "line",
            source: DRAFT_SOURCE_ID,
            filter: ["==", ["get", "kind"], "line"],
            layout: {
              "line-cap": "round",
              "line-join": "round",
            },
            paint: {
              "line-color": "#dc5b35",
              "line-width": 4,
            },
          });
          loadedMap.addLayer({
            id: "sighting-draft-arrow",
            type: "fill",
            source: DRAFT_SOURCE_ID,
            filter: ["==", ["get", "kind"], "arrow"],
            paint: {
              "fill-color": "#dc5b35",
              "fill-outline-color": "#ffffff",
            },
          });
          createOwnArrowImage(loadedMap);
          loadedMap.addSource(OWN_SIGHTINGS_SOURCE_ID, {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
          });
          loadedMap.addSource(COMMUNITY_SIGHTINGS_SOURCE_ID, {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
          });
          loadedMap.addLayer({
            id: COMMUNITY_HEATMAP_LAYER_ID,
            type: "heatmap",
            source: COMMUNITY_SIGHTINGS_SOURCE_ID,
            paint: {
              "heatmap-weight": [
                "interpolate",
                ["linear"],
                ["get", "heat_weight"],
                0,
                0.05,
                1,
                0.25,
                5,
                0.8,
                20,
                1,
              ],
              "heatmap-intensity": [
                "interpolate",
                ["linear"],
                ["zoom"],
                5,
                0.7,
                13,
                1.8,
                17,
                2.5,
              ],
              "heatmap-radius": [
                "interpolate",
                ["linear"],
                ["zoom"],
                5,
                8,
                12,
                24,
                17,
                38,
              ],
              "heatmap-opacity": 0.76,
              "heatmap-color": [
                "interpolate",
                ["linear"],
                ["heatmap-density"],
                0,
                "rgba(63, 101, 150, 0)",
                0.2,
                "#3f6596",
                0.42,
                "#317e91",
                0.68,
                "#dfb747",
                1,
                "#d45f45",
              ],
            },
          });
          const timeFilter = createSightingTimeFilter(
            timeFilterRef.current.weekday,
            timeFilterRef.current.hour,
          );
          loadedMap.addLayer({
            id: OWN_SIGHTINGS_HEATMAP_LAYER_ID,
            type: "heatmap",
            source: OWN_SIGHTINGS_SOURCE_ID,
            filter: timeFilter,
            paint: {
              "heatmap-weight": 1,
              "heatmap-intensity": [
                "interpolate",
                ["linear"],
                ["zoom"],
                5,
                0.7,
                13,
                1.8,
                17,
                2.5,
              ],
              "heatmap-radius": [
                "interpolate",
                ["linear"],
                ["zoom"],
                5,
                8,
                12,
                24,
                17,
                38,
              ],
              "heatmap-opacity": 0.66,
              "heatmap-color": [
                "interpolate",
                ["linear"],
                ["heatmap-density"],
                0,
                "rgba(31, 107, 98, 0)",
                0.2,
                "#1f6b62",
                0.42,
                "#2f9e7c",
                0.68,
                "#7dbb5a",
                1,
                "#d8d95d",
              ],
            },
          });
          loadedMap.addLayer({
            id: OWN_SIGHTINGS_LAYER_ID,
            type: "symbol",
            source: OWN_SIGHTINGS_SOURCE_ID,
            filter: timeFilter,
            minzoom: 12,
            layout: {
              "icon-image": OWN_ARROW_IMAGE_ID,
              "icon-size": [
                "interpolate",
                ["linear"],
                ["zoom"],
                12,
                0.48,
                17,
                0.7,
              ],
              "icon-rotate": ["get", "heading"],
              "icon-rotation-alignment": "map",
              "icon-allow-overlap": true,
              "icon-ignore-placement": true,
            },
            paint: {
              "icon-color": "#18392c",
              "icon-opacity": 0.88,
              "icon-halo-color": "#ffffff",
              "icon-halo-width": 1.25,
            },
          });
          loadedMap.on("click", OWN_SIGHTINGS_LAYER_ID, (event) => {
            if (isAddingSightingRef.current) {
              return;
            }

            const raw = event.features?.[0]?.properties;
            if (!raw) return;

            const properties: OwnSightingProperties = {
              id: String(raw.id),
              seen_at: String(raw.seen_at),
              heading: Number(raw.heading),
              temperature_c: raw.temperature_c == null
                ? null
                : Number(raw.temperature_c),
              precipitation_mm: raw.precipitation_mm == null
                ? null
                : Number(raw.precipitation_mm),
              wind_ms: raw.wind_ms == null ? null : Number(raw.wind_ms),
              hour: Number(raw.hour),
              weekday: Number(raw.weekday),
            };

            popupRef.current?.remove();
            popupRef.current = new maplibregl.Popup({
              closeButton: true,
              closeOnClick: true,
              offset: 16,
              maxWidth: "300px",
            })
              .setLngLat(event.lngLat)
              .setDOMContent(createSightingPopup(
                properties,
                async () => {
                  const { error } = await getSupabaseClient()
                    .from("sightings")
                    .delete()
                    .eq("id", properties.id);

                  if (error) {
                    throw error;
                  }

                  ownSightingsRef.current = ownSightingsRef.current.filter(
                    (feature) => feature.properties.id !== properties.id,
                  );
                  setOwnSightings(ownSightingsRef.current);
                  setOwnSightingsCount(ownSightingsRef.current.length);
                  setOwnSightingsData(loadedMap, ownSightingsRef.current);

                  if (undoTimerRef.current && undoSightingRef.current === properties.id) {
                    clearTimeout(undoTimerRef.current);
                    undoTimerRef.current = null;
                    undoSightingRef.current = null;
                    setUndoSighting(null);
                  }

                  popupRef.current?.remove();
                },
              ))
              .addTo(loadedMap);
          });
          loadedMap.on("mouseenter", OWN_SIGHTINGS_LAYER_ID, () => {
            loadedMap.getCanvas().style.cursor = "pointer";
          });
          loadedMap.on("mouseleave", OWN_SIGHTINGS_LAYER_ID, () => {
            loadedMap.getCanvas().style.cursor = "";
          });
          hasLoaded = true;
          if (!isCancelled) {
            setIsMapLoaded(true);
            setMapError(null);
          }
        });
        map.on("error", () => {
          if (!hasLoaded && !isCancelled) {
            setMapError("Karttaa ei voitu ladata. Tarkista yhteys ja MapTiler-avain.");
          }
        });
      } catch (error) {
        console.error("MapLibre initialization failed.", error);
        if (!isCancelled) {
          setMapError("Karttaa ei voitu ladata. Tarkista yhteys ja MapTiler-avain.");
        }
      }
    }

    void initializeMap();

    return () => {
      isCancelled = true;
      if (undoTimerRef.current) {
        clearTimeout(undoTimerRef.current);
      }
      popupRef.current?.remove();
      popupRef.current = null;
      markerRef.current?.remove();
      markerRef.current = null;
      map?.remove();
      mapRef.current = null;
      maplibreRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!isMapLoaded) {
      return;
    }

    let isCurrent = true;

    async function loadOwnSightings() {
      try {
        const pageSize = 500;
        const rows: OwnSightingRow[] = [];

        for (let offset = 0; isCurrent; offset += pageSize) {
          const { data, error } = await getSupabaseClient()
            .from("sightings")
            .select(
              "id, seen_at, heading, temperature_c, precipitation_mm, wind_ms, location_text:location::text",
            )
            .eq("user_id", user.id)
            .order("seen_at", { ascending: false })
            .order("id", { ascending: true })
            .range(offset, offset + pageSize - 1);

          if (error) {
            throw error;
          }

          const page = data as unknown as OwnSightingRow[];
          rows.push(...page);

          if (page.length < pageSize) {
            break;
          }
        }

        if (!isCurrent) {
          return;
        }

        const features = rows.flatMap((row) => {
          const location = parsePointText(row.location_text);
          const heading = Number(row.heading);

          if (!location || !Number.isFinite(heading)) {
            return [];
          }

          return [createOwnSightingFeature(location, {
            id: row.id,
            seen_at: row.seen_at,
            heading,
            temperature_c: row.temperature_c,
            precipitation_mm: row.precipitation_mm,
            wind_ms: row.wind_ms,
          })];
        });

        const featuresById = new Map(
          features.map((feature) => [feature.properties.id, feature]),
        );
        for (const feature of ownSightingsRef.current) {
          featuresById.set(feature.properties.id, feature);
        }
        const mergedFeatures = [...featuresById.values()];

        if (!isCurrent) {
          return;
        }

        ownSightingsRef.current = mergedFeatures;
        setOwnSightings(mergedFeatures);
        setOwnSightingsCount(mergedFeatures.length);
        const map = mapRef.current;
        if (map) {
          setOwnSightingsData(map, mergedFeatures);
        }
        setOwnSightingsError(null);
      } catch (error) {
        console.error("Own sightings could not be loaded.", error);
        if (isCurrent) {
          setOwnSightingsError("Omat havainnot eivät latautuneet.");
        }
      }
    }

    void loadOwnSightings();

    return () => {
      isCurrent = false;
    };
  }, [isMapLoaded, user.id]);

  useEffect(() => {
    const map = mapRef.current;

    if (map && isMapLoaded && map.getLayer(OWN_SIGHTINGS_LAYER_ID)) {
      map.setLayoutProperty(
        COMMUNITY_HEATMAP_LAYER_ID,
        "visibility",
        onlyOwnSightings ? "none" : "visible",
      );
      map.setLayoutProperty(
        OWN_SIGHTINGS_HEATMAP_LAYER_ID,
        "visibility",
        ownLayerMode === "heatmap" ? "visible" : "none",
      );
      map.setLayoutProperty(
        OWN_SIGHTINGS_LAYER_ID,
        "visibility",
        ownLayerMode === "arrows" ? "visible" : "none",
      );
    }
  }, [isMapLoaded, onlyOwnSightings, ownLayerMode]);

  useEffect(() => {
    timeFilterRef.current = { weekday: selectedWeekday, hour: selectedHour };
    const map = mapRef.current;

    if (map && isMapLoaded) {
      const filter = createSightingTimeFilter(selectedWeekday, selectedHour);
      map.setFilter(OWN_SIGHTINGS_HEATMAP_LAYER_ID, filter);
      map.setFilter(OWN_SIGHTINGS_LAYER_ID, filter);
    }
  }, [isMapLoaded, selectedHour, selectedWeekday]);

  useEffect(() => {
    if (isMapLoaded) {
      requestUserLocation(
        mapRef,
        maplibreRef,
        markerRef,
        setIsLocating,
        setLocationMessage,
      );
    }
  }, [isMapLoaded]);

  useEffect(() => {
    const map = mapRef.current;

    if (!map || !isMapLoaded) {
      return;
    }

    const activeMap = map;
    let isCurrent = true;
    let requestId = 0;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    async function loadCommunityGrid() {
      const currentRequestId = ++requestId;
      const bounds = activeMap.getBounds();
      const source = activeMap.getSource(COMMUNITY_SIGHTINGS_SOURCE_ID) as
        | GeoJSONSource
        | undefined;

      source?.setData({ type: "FeatureCollection", features: [] });
      setCommunityGridStatus("loading");

      try {
        const { data, error } = await getSupabaseClient().rpc("get_sighting_grid", {
          weekday: selectedWeekday,
          hour_from: selectedHour,
          hour_to: selectedHour + 1,
          min_lon: bounds.getWest(),
          min_lat: bounds.getSouth(),
          max_lon: bounds.getEast(),
          max_lat: bounds.getNorth(),
        });

        if (error) {
          throw error;
        }

        if (!isCurrent || currentRequestId !== requestId) {
          return;
        }

        const rows = data as unknown as CommunityGridRow[];
        const features: CommunityGridFeature[] = rows.map((row) => ({
          type: "Feature",
          id: `${row.longitude}:${row.latitude}`,
          geometry: {
            type: "Point",
            coordinates: [Number(row.longitude), Number(row.latitude)],
          },
          properties: {
            observation_count: Number(row.observation_count),
            heat_weight: Number(row.heat_weight),
          },
        }));

        source?.setData({ type: "FeatureCollection", features });
        setCommunityGridStatus(features.length === 0 ? "empty" : null);
      } catch (error) {
        console.error("Community heatmap could not be loaded.", error);
        if (isCurrent && currentRequestId === requestId) {
          setCommunityGridStatus("error");
        }
      }
    }

    function scheduleCommunityGrid() {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      debounceTimer = setTimeout(() => void loadCommunityGrid(), 220);
    }

    scheduleCommunityGrid();
    activeMap.on("moveend", scheduleCommunityGrid);

    return () => {
      isCurrent = false;
      requestId += 1;
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      activeMap.off("moveend", scheduleCommunityGrid);
    };
  }, [isMapLoaded, selectedHour, selectedWeekday]);

  useEffect(() => {
    if (!isTimePlaying) {
      return;
    }

    const timer = setInterval(advanceTimeline, 1200);

    return () => clearInterval(timer);
  }, [isTimePlaying]);

  useEffect(() => {
    const map = mapRef.current;

    if (!map || !isMapLoaded || !isAddingSighting) {
      return;
    }

    const activeMap = map as MapLibreMap;
    const canvas = activeMap.getCanvas();

    function getCoordinates(event: PointerEvent): Coordinates {
      const rect = canvas.getBoundingClientRect();
      const location = activeMap.unproject([
        event.clientX - rect.left,
        event.clientY - rect.top,
      ]);
      return [location.lng, location.lat];
    }

    function onPointerDown(event: PointerEvent) {
      if (
        isSavingRef.current ||
        !event.isPrimary ||
        (event.pointerType === "mouse" && event.button !== 0)
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      const start = getCoordinates(event);
      activePointerRef.current = { pointerId: event.pointerId, start };
      canvas.setPointerCapture(event.pointerId);
      setIsDrawing(true);
      setDrawingMessage(null);
      setSaveError(null);
      renderArrowLayer(activeMap, []);
    }

    function onPointerMove(event: PointerEvent) {
      const activePointer = activePointerRef.current;

      if (!activePointer || activePointer.pointerId !== event.pointerId) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      renderArrowLayer(activeMap, [
        { id: "draft", start: activePointer.start, end: getCoordinates(event) },
      ]);
    }

    function onPointerUp(event: PointerEvent) {
      const activePointer = activePointerRef.current;

      if (!activePointer || activePointer.pointerId !== event.pointerId) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      const end = getCoordinates(event);
      activePointerRef.current = null;
      setIsDrawing(false);

      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }

      if (!isSightingStrokeLongEnough(activePointer.start, end)) {
        renderArrowLayer(activeMap, []);
        setDrawingMessage("Vedä pidempi nuoli");
        return;
      }

      const drawn: ArrowPath = {
        id: "draft",
        start: activePointer.start,
        end,
      };
      renderArrowLayer(activeMap, [drawn]);
      void saveSighting(drawn);
    }

    function onPointerCancel(event: PointerEvent) {
      if (activePointerRef.current?.pointerId !== event.pointerId) {
        return;
      }

      activePointerRef.current = null;
      setIsDrawing(false);
      renderArrowLayer(activeMap, []);
    }

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerCancel);

    return () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerCancel);
    };
  }, [isAddingSighting, isMapLoaded]);

  useEffect(() => {
    const map = mapRef.current;

    if (map && isMapLoaded) {
      setMapGesturesEnabled(map, !isAddingSighting);
    }
  }, [isAddingSighting, isMapLoaded]);

  function cancelSighting() {
    const map = mapRef.current;

    if (map) {
      renderArrowLayer(map, []);
      setMapGesturesEnabled(map, true);
    }

    activePointerRef.current = null;
    isAddingSightingRef.current = false;
    setIsDrawing(false);
    setIsAddingSighting(false);
    isSavingRef.current = false;
    setIsSaving(false);
    setDrawingMessage(null);
    setSaveError(null);
  }

  function toggleSightingMode() {
    if (isAddingSighting) {
      cancelSighting();
      return;
    }

    const map = mapRef.current;
    if (map) {
      setMapGesturesEnabled(map, false);
      renderArrowLayer(map, []);
    }

    setIsAddingSighting(true);
    isAddingSightingRef.current = true;
    setDrawingMessage("Vedä nuoli kartalle");
  }

  async function undoSavedSighting() {
    if (!undoSighting || isUndoing) {
      return;
    }

    setIsUndoing(true);
    setUndoError(null);

    const { error } = await getSupabaseClient()
      .from("sightings")
      .delete()
      .eq("id", undoSighting.databaseId);

    if (error) {
      console.error("Sighting undo failed.", error);
      setUndoError("Kumoaminen ei onnistunut.");
      setIsUndoing(false);
      return;
    }

    ownSightingsRef.current = ownSightingsRef.current.filter(
      (feature) => feature.properties.id !== undoSighting.databaseId,
    );
    setOwnSightings(ownSightingsRef.current);
    setOwnSightingsCount(ownSightingsRef.current.length);
    const map = mapRef.current;
    if (map) {
      renderArrowLayer(map, []);
      setOwnSightingsData(map, ownSightingsRef.current);
    }

    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    undoSightingRef.current = null;
    setUndoSighting(null);
    setIsUndoing(false);
  }

  const hasOwnSightingsForSelectedTime = ownSightings.some(
    (feature) =>
      feature.properties.weekday === selectedWeekday &&
      feature.properties.hour === selectedHour,
  );
  const showOwnEmptyState =
    onlyOwnSightings &&
    !isAddingSighting &&
    ownSightingsCount !== null &&
    !hasOwnSightingsForSelectedTime;
  const showCommunityEmptyState =
    !onlyOwnSightings && !isAddingSighting && communityGridStatus === "empty";
  const showCommunityError =
    !onlyOwnSightings && !isAddingSighting && communityGridStatus === "error";
  const hasCenterNotice =
    showOwnEmptyState || showCommunityEmptyState || showCommunityError || saveError || undoSighting;

  return (
    <main className={`map-screen${isAddingSighting ? " is-drawing" : ""}`}>
      <div ref={containerRef} aria-label="Kartta Helsingistä" className="map-canvas" />

      <div className="map-toolbar">
        <button
          className="map-toolbar-button map-locate-button"
          disabled={!isMapLoaded || isLocating || isAddingSighting}
          onClick={() => requestUserLocation(
            mapRef,
            maplibreRef,
            markerRef,
            setIsLocating,
            setLocationMessage,
          )}
          type="button"
        >
          {isLocating ? "Paikannetaan..." : "Paikanna minut"}
        </button>
      </div>

      <div className="own-layer-control">
        <button
          aria-checked={onlyOwnSightings}
          className="own-layer-toggle"
          disabled={!isMapLoaded}
          onClick={() => setOnlyOwnSightings((onlyOwn) => !onlyOwn)}
          role="switch"
          type="button"
        >
          <span aria-hidden="true" className="own-layer-switch-track">
            <span className="own-layer-switch-thumb" />
          </span>
          <span>Vain omat</span>
        </button>
        {!isAddingSighting && (
          <div aria-label="Oman havaintokerroksen esitystapa" className="own-layer-mode">
            <button
              aria-pressed={ownLayerMode === "arrows"}
              onClick={() => setOwnLayerMode("arrows")}
              type="button"
            >
              Nuolet
            </button>
            <button
              aria-pressed={ownLayerMode === "heatmap"}
              onClick={() => setOwnLayerMode("heatmap")}
              type="button"
            >
              Heatmap
            </button>
          </div>
        )}
        {!onlyOwnSightings && !isAddingSighting && (
          <div
            aria-label="Yhteisöhavaintoja: harvaa vasemmalla, vilkasta oikealla"
            className="own-layer-legend"
          >
            <span>Harvaa</span>
            <i aria-hidden="true" className="own-heatmap-gradient" />
            <span>Vilkasta</span>
          </div>
        )}
        {ownLayerMode === "heatmap" && !isAddingSighting && (
          <div
            aria-label="Omia havaintoja: harvaa vasemmalla, vilkasta oikealla"
            className="own-layer-legend"
          >
            <span>Harvaa</span>
            <i aria-hidden="true" className="own-heatmap-gradient own-heatmap-gradient-own" />
            <span>Vilkasta</span>
          </div>
        )}
        {ownSightingsError && (
          <p className="own-layer-error" role="status">{ownSightingsError}</p>
        )}
      </div>

      <section aria-label="Havaintojen aikajana" className="map-time-control">
        <div className="map-time-control-header">
          <button
            className="map-add-button"
            aria-pressed={isAddingSighting}
            disabled={!isMapLoaded || isSaving}
            onClick={toggleSightingMode}
            type="button"
          >
            {isAddingSighting ? "Lopeta havaintotila" : "Lisää havainto"}
          </button>
          <div className="map-time-readout">
            <span>Historiallinen vertailu</span>
            <output aria-live="polite">
              {selectedTimeWindow.startLabel}–{selectedTimeWindow.endLabel}
            </output>
          </div>
          <button
            aria-label={isTimePlaying ? "Pysäytä tuntien selaus" : "Toista tunnit"}
            className="map-time-play"
            disabled={!isMapLoaded}
            onClick={() => setIsTimePlaying((playing) => !playing)}
            title={isTimePlaying ? "Pysäytä" : "Toista tunnit"}
            type="button"
          >
            <span aria-hidden="true">{isTimePlaying ? "Ⅱ" : "▶"}</span>
          </button>
        </div>
        <div className="map-time-slider-row">
          <button
            aria-label="Palaa nykyhetkeen"
            className="map-time-now"
            disabled={!isMapLoaded}
            onClick={() => {
              setTimelineAnchor(currentHourAnchor(Date.now()));
              setSelectedOffset(0);
              setIsTimePlaying(false);
            }}
            type="button"
          >
            Nyt
          </button>
          <input
            aria-label="Valitse tuleva tunti"
            aria-valuetext={`${selectedTimeWindow.startLabel}–${selectedTimeWindow.endLabel}, ${selectedOffset} tuntia nykyhetkestä`}
            disabled={!isMapLoaded}
            max={FUTURE_HOUR_OFFSETS}
            min={0}
            onChange={(event) => setSelectedOffset(Number(event.target.value))}
            step={1}
            type="range"
            value={selectedOffset}
          />
          <span aria-hidden="true">+23 h</span>
        </div>
        <div aria-hidden="true" className="map-time-ticks">
          <span>Nyt</span><span>+6 h</span><span>+12 h</span><span>+18 h</span><span>+23 h</span>
        </div>
      </section>

      {hasCenterNotice && (
        <div className="map-center-notices">
          {showOwnEmptyState && (
            <p className="community-grid-status" role="status">
              Ei omia havaintoja tällä tunnilla
              <span>Vaihda aikaa alareunan aikajanasta</span>
            </p>
          )}
          {showCommunityEmptyState && (
            <p className="community-grid-status" role="status">
              Ei yhteisöhavaintoja tällä ajalla
              <span>Vähintään 3 käyttäjää / ruutu</span>
            </p>
          )}
          {showCommunityError && (
            <p className="community-grid-status is-error" role="alert">
              Yhteisöheatmapia ei voitu ladata.
            </p>
          )}
          {saveError && (
            <p aria-live="assertive" className="map-save-error" role="alert">
              {saveError}
            </p>
          )}
          {undoSighting && (
            <div aria-live="polite" className="map-undo-toast" role="status">
              <span>{undoError ?? "Havainto tallennettu ·"}</span>
              <button disabled={isUndoing} onClick={undoSavedSighting} type="button">
                {isUndoing ? "Kumotaan..." : "Kumoa"}
              </button>
            </div>
          )}
        </div>
      )}

      {isAddingSighting && (
        <p aria-live="polite" className="map-draw-status" role="status">
          {isSaving ? drawingMessage : isDrawing ? "Piirretään nuolta..." : drawingMessage}
        </p>
      )}

      {locationMessage && (
        <p aria-live="polite" className="map-location-message" role="status">
          {locationMessage}
        </p>
      )}

      {!isMapLoaded && !mapError && (
        <div aria-live="polite" className="map-loading" role="status">
          <span aria-hidden="true" className="map-loading-spinner" />
          <span>Ladataan karttaa...</span>
        </div>
      )}

      {mapError && (
        <p className="map-error" role="alert">
          {mapError}
        </p>
      )}

    </main>
  );
}