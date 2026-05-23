"use client";

// gy-command — Interactive berth picker for the CRM admin form.
//
// 2026-05-23 — George tried "Alimos marina, Athens, pier 6" and
// Nominatim returned no match (pier-level granularity isn't in
// OSM for most Greek marinas). The only way to get pier-precision
// is to let George SEE the map and click the exact berth himself.
//
// This component:
//   • Renders a 320px Leaflet map below the lat/lng inputs.
//   • Centers on Greece if no coordinates set; otherwise on the pin.
//   • Click anywhere on the map → calls onChange(lat, lng).
//   • Drag the pin → same.
//   • Updates when parent inputs change (e.g. geocode fills them).
//
// Loaded only on the edit page; no impact on the rest of the CRM.

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";

const NAVY = "#0D1B2A";
const GOLD = "#C9A84C";

// Same gold-and-navy SVG pin as the public-site BerthMap, so the
// admin's preview reads identical to what the customer will see.
const PIN_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="34" height="46" viewBox="0 0 34 46">
  <defs>
    <filter id="s" x="-25%" y="-25%" width="150%" height="150%">
      <feDropShadow dx="0" dy="2" stdDeviation="1.5" flood-color="#0D1B2A" flood-opacity="0.45"/>
    </filter>
  </defs>
  <path
    d="M17 1C8.16 1 1 8.16 1 17c0 12 16 28 16 28s16-16 16-28C33 8.16 25.84 1 17 1z"
    fill="${GOLD}"
    stroke="${NAVY}"
    stroke-width="1.5"
    filter="url(#s)"
  />
  <circle cx="17" cy="17" r="5.5" fill="${NAVY}"/>
</svg>
`;

interface Props {
  lat: number | null;
  lng: number | null;
  onChange: (lat: number, lng: number) => void;
}

// Greece, roughly centered, zoom showing mainland + islands.
const GREECE_CENTER: [number, number] = [38.5, 23.5];
const GREECE_ZOOM = 6;

export default function BerthPicker({ lat, lng, onChange }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Hold the Leaflet instance + marker between renders.
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const iconRef = useRef<L.DivIcon | null>(null);
  // Keep onChange in a ref so we don't tear down the map every
  // time the parent re-creates the callback.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Mount the map once on first render.
  useEffect(() => {
    if (!containerRef.current) return;
    if (mapRef.current) return;

    let cancelled = false;
    (async () => {
      const Lmod = await import("leaflet");
      if (cancelled || !containerRef.current) return;
      const L = Lmod.default;

      const startCenter: [number, number] =
        Number.isFinite(lat) && Number.isFinite(lng)
          ? [lat as number, lng as number]
          : GREECE_CENTER;
      const startZoom =
        Number.isFinite(lat) && Number.isFinite(lng) ? 16 : GREECE_ZOOM;

      const map = L.map(containerRef.current, {
        center: startCenter,
        zoom: startZoom,
        zoomControl: true,
        scrollWheelZoom: false,
      });
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map);

      iconRef.current = L.divIcon({
        className: "berth-picker-pin",
        html: PIN_SVG,
        iconSize: [34, 46],
        iconAnchor: [17, 44],
      });

      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        markerRef.current = L.marker([lat as number, lng as number], {
          draggable: true,
          icon: iconRef.current,
        }).addTo(map);
        markerRef.current.on("dragend", () => {
          const p = markerRef.current?.getLatLng();
          if (p) onChangeRef.current(p.lat, p.lng);
        });
      }

      map.on("click", (e: L.LeafletMouseEvent) => {
        const { lat: clat, lng: clng } = e.latlng;
        if (!markerRef.current) {
          markerRef.current = L.marker([clat, clng], {
            draggable: true,
            icon: iconRef.current!,
          }).addTo(map);
          markerRef.current.on("dragend", () => {
            const p = markerRef.current?.getLatLng();
            if (p) onChangeRef.current(p.lat, p.lng);
          });
        } else {
          markerRef.current.setLatLng([clat, clng]);
        }
        onChangeRef.current(clat, clng);
      });

      mapRef.current = map;
    })();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        markerRef.current = null;
        iconRef.current = null;
      }
    };
    // Mount once. Parent-driven changes handled by the next effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When the parent updates lat/lng (e.g. via geocode), recenter
  // the map and move the marker.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      if (markerRef.current) {
        markerRef.current.remove();
        markerRef.current = null;
      }
      return;
    }
    const ll: [number, number] = [lat as number, lng as number];
    map.flyTo(ll, Math.max(map.getZoom(), 16), { duration: 0.6 });
    if (markerRef.current) {
      markerRef.current.setLatLng(ll);
    } else if (iconRef.current) {
      // Recreate the marker if the user had cleared it.
      // Import dynamically to avoid SSR (already loaded by mount).
      import("leaflet").then((Lmod) => {
        const L = Lmod.default;
        if (!mapRef.current || !iconRef.current) return;
        markerRef.current = L.marker(ll, {
          draggable: true,
          icon: iconRef.current,
        }).addTo(mapRef.current);
        markerRef.current.on("dragend", () => {
          const p = markerRef.current?.getLatLng();
          if (p) onChangeRef.current(p.lat, p.lng);
        });
      });
    }
  }, [lat, lng]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        gridColumn: "1 / -1",
      }}
    >
      <span style={{ fontSize: 12, color: "#4b5563" }}>
        Click on the map to set the exact berth, or drag the pin once
        placed. Nominatim usually finds the marina; the pier-level
        precision comes from your click.
      </span>
      <div
        ref={containerRef}
        style={{
          width: "100%",
          height: 320,
          background: "#e9e4d4",
          border: "1px solid rgba(13, 27, 42, 0.18)",
        }}
      />
    </div>
  );
}
