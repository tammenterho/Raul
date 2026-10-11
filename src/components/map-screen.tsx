"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as MapLibreMap, Marker } from "maplibre-gl";

const HELSINKI_CENTER: [number, number] = [24.9384, 60.1699];

export function MapScreen() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const maplibreRef = useRef<typeof import("maplibre-gl") | null>(null);
  const [isMapLoaded, setIsMapLoaded] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [locationMessage, setLocationMessage] = useState<string | null>(null);

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
          zoom: 13,
        });
        mapRef.current = map;
        map.addControl(
          new maplibregl.NavigationControl({ showCompass: false }),
          "bottom-right",
        );
        map.once("load", () => {
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
      markerRef.current?.remove();
      markerRef.current = null;
      map?.remove();
      mapRef.current = null;
      maplibreRef.current = null;
    };
  }, []);

  function locateUser() {
    if (!navigator.geolocation) {
      setLocationMessage("Sijaintipalvelu ei ole käytettävissä.");
      return;
    }

    setIsLocating(true);
    setLocationMessage(null);

    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const coordinates: [number, number] = [coords.longitude, coords.latitude];
        const map = mapRef.current;
        const MarkerConstructor = maplibreRef.current?.Marker;

        if (map && MarkerConstructor) {
          markerRef.current?.remove();
          markerRef.current = new MarkerConstructor({ color: "#dc5b35" })
            .setLngLat(coordinates)
            .addTo(map);
          map.flyTo({ center: coordinates, zoom: 16, essential: true, duration: 1200 });
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

  return (
    <main className="map-screen">
      <div ref={containerRef} aria-label="Kartta Helsingistä" className="map-canvas" />

      <button
        className="map-locate-button"
        disabled={!isMapLoaded || isLocating}
        onClick={locateUser}
        type="button"
      >
        {isLocating ? "Paikannetaan..." : "Paikanna minut"}
      </button>

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