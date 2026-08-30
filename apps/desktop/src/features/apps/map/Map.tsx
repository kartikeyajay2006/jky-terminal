import { useCallback, useEffect, useState } from "react";
import {
  PlacePicker,
  forgetPlace,
  loadRecents,
  loadStoredPlace,
  rememberPlace,
  storePlace,
  whereabouts,
} from "../PlacePicker";
import { getPlatform } from "../../../platform";
import type { Place, Route } from "../../../platform/types";

const FROM_KEY = "jky.apps.map.place";
/**
 * Kept apart from the current place, so clearing where you are looking does
 * not also forget everywhere you have looked.
 */
const RECENTS_KEY = "jky.apps.map.recents";

/**
 * OpenStreetMap's own embed endpoint.
 *
 * Not `openstreetmap.org` itself: the main site sends
 * `X-Frame-Options: SAMEORIGIN` and cannot be framed at all. This endpoint
 * exists to be embedded and was measured to send no framing restriction —
 * which is the entire reason Map can be a `frame` app while a general browser
 * cannot. It is also the only host named in the CSP's `frame-src`, pinned by a
 * test in `src-tauri/tests/security.rs`.
 */
const EMBED = "https://www.openstreetmap.org/export/embed.html";

/** How wide a view to open on a single place: roughly a town. */
const DEFAULT_SPAN = 0.08;
/** Bounds on the span, so zooming cannot leave the map with nothing to draw. */
const MIN_SPAN = 0.002;
const MAX_SPAN = 60;

/**
 * The smallest box the tile server will draw.
 *
 * Two places on the same latitude give a box with no height, which comes back
 * blank rather than as an error.
 */
const MIN_BOX = 0.01;

interface Point {
  lat: number;
  lon: number;
}

export interface Box {
  west: number;
  south: number;
  east: number;
  north: number;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** Six decimals is about a tenth of a metre — past what a map view needs. */
function round(value: number): number {
  return Number(value.toFixed(6));
}

/**
 * A box holding both points, with room around them.
 *
 * Padded by a fifth of the span so the markers are not pressed against the
 * edge, and floored at a minimum size because two places on one line would
 * otherwise give a box with no area for the tiles to fill.
 */
export function boxAround(a: Point, b: Point): Box {
  const padLon = Math.max(Math.abs(a.lon - b.lon) * 0.2, MIN_BOX);
  const padLat = Math.max(Math.abs(a.lat - b.lat) * 0.2, MIN_BOX);

  return {
    west: round(clamp(Math.min(a.lon, b.lon) - padLon, -180, 180)),
    east: round(clamp(Math.max(a.lon, b.lon) + padLon, -180, 180)),
    south: round(clamp(Math.min(a.lat, b.lat) - padLat, -90, 90)),
    north: round(clamp(Math.max(a.lat, b.lat) + padLat, -90, 90)),
  };
}

function frameUrl(box: Box, marker: Point): string {
  const bbox = `${box.west},${box.south},${box.east},${box.north}`;
  const pin = `${round(marker.lat)},${round(marker.lon)}`;
  return `${EMBED}?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${encodeURIComponent(pin)}`;
}

/**
 * The embed URL for a view of one place.
 *
 * Built from numbers, never from a string that came from anywhere else: the
 * frame's address is the one thing that decides what renders inside the app's
 * window.
 */
export function embedUrl(latitude: number, longitude: number, span: number): string {
  const half = span / 2;
  const box: Box = {
    west: round(clamp(longitude - half, -180, 180)),
    east: round(clamp(longitude + half, -180, 180)),
    south: round(clamp(latitude - half, -90, 90)),
    north: round(clamp(latitude + half, -90, 90)),
  };
  return frameUrl(box, { lat: latitude, lon: longitude });
}

/**
 * A distance in the units a person would say it in.
 *
 * Metres below a kilometre, because "0.4 km" is not how anyone gives a
 * distance; one decimal up to ten kilometres, where the tenth still means
 * something; whole kilometres above that, where it does not.
 */
export function describeDistance(metres: number): string {
  if (metres < 1000) return `${Math.round(metres)} m`;
  const km = metres / 1000;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km).toLocaleString("en-US")} km`;
}

/** A driving time in hours and minutes. */
export function describeDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/**
 * The Map app.
 *
 * Named `MapApp` rather than `Map` because `Map` is a global built-in, and a
 * component that shadows it makes every use of the real one in this file a
 * question.
 *
 * One place shows a map of it. Two show both, with the distance between them
 * by road and by air — the second because it is arithmetic and always
 * available, and a panel that went blank when no road connects two places
 * would be worse than one that says how far apart they are anyway.
 *
 * This is the app that needed the CSP's one widening. `frame-src` lets the
 * window display a document from another origin; it does not let this app's
 * JavaScript read into that frame or reach that host — same-origin policy
 * still separates them and `connect-src` is still `'self'`.
 */
export function MapApp() {
  const [from, setFrom] = useState<Place | null>(() => loadStoredPlace(FROM_KEY));
  const [to, setTo] = useState<Place | null>(null);
  const [recents, setRecents] = useState<Place[]>(() => loadRecents(RECENTS_KEY));
  const [span, setSpan] = useState(DEFAULT_SPAN);
  const [picking, setPicking] = useState<"from" | "to" | null>(null);
  const [route, setRoute] = useState<Route | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);

  const measure = useCallback(async (a: Place, b: Place) => {
    setRoute(null);
    setRouteError(null);
    try {
      setRoute(await getPlatform().apps.route(a, b));
    } catch (e) {
      setRouteError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    if (from && to) void measure(from, to);
    else setRoute(null);
  }, [from, to, measure]);

  function choose(place: Place) {
    setRecents(rememberPlace(RECENTS_KEY, place));
    if (picking === "to") {
      setTo(place);
    } else {
      storePlace(FROM_KEY, place);
      setFrom(place);
      setSpan(DEFAULT_SPAN);
    }
    setPicking(null);
  }

  if (!from || picking) {
    const asking = picking === "to" ? "Where are you going?" : "Where do you want to look?";
    return (
      <div className="map map--picking">
        <PlacePicker prompt={asking} recents={recents} onChoose={choose} />
        {picking && from && (
          <button type="button" className="map__cancel" onClick={() => setPicking(null)}>
            Cancel
          </button>
        )}
      </div>
    );
  }

  const both = to !== null;
  const src = both
    ? frameUrl(
        boxAround(
          { lat: from.latitude, lon: from.longitude },
          { lat: to.latitude, lon: to.longitude },
        ),
        { lat: to.latitude, lon: to.longitude },
      )
    : embedUrl(from.latitude, from.longitude, span);

  const title = both ? `Map of ${from.name} to ${to.name}` : `Map of ${from.name}`;

  return (
    <div className="map">
      <div className="map__ends">
        <Leg label="From" place={from} onChange={() => setPicking("from")} />

        {to ? (
          <>
            <button
              type="button"
              className="map__swap"
              aria-label="Swap the two ends"
              onClick={() => {
                const wasFrom = from;
                storePlace(FROM_KEY, to);
                setFrom(to);
                setTo(wasFrom);
              }}
            >
              ⇄
            </button>
            <Leg
              label="To"
              place={to}
              onChange={() => setPicking("to")}
              onClear={() => setTo(null)}
            />
          </>
        ) : (
          <button type="button" className="map__add" onClick={() => setPicking("to")}>
            + Add a destination
          </button>
        )}
      </div>

      {both && (
        <div className="map__trip" role="status" aria-label="Distance">
          {route ? (
            <>
              {route.road_m !== null ? (
                <span className="map__road">
                  <b>{describeDistance(route.road_m)}</b> by road
                  {route.duration_s !== null && (
                    <> · {describeDuration(route.duration_s)} driving</>
                  )}
                </span>
              ) : (
                <span className="map__noroad">No road route</span>
              )}
              <span className="map__straight">
                {describeDistance(route.straight_m)} in a straight line
              </span>
            </>
          ) : routeError ? (
            <span className="map__noroad">{routeError}</span>
          ) : (
            <span className="map__straight">Measuring…</span>
          )}
        </div>
      )}

      {!both && (
        <div className="map__controls">
          <button
            type="button"
            className="map__zoom"
            aria-label="Zoom in"
            onClick={() => setSpan((s) => clamp(s / 2, MIN_SPAN, MAX_SPAN))}
          >
            +
          </button>
          <button
            type="button"
            className="map__zoom"
            aria-label="Zoom out"
            onClick={() => setSpan((s) => clamp(s * 2, MIN_SPAN, MAX_SPAN))}
          >
            −
          </button>
          <button
            type="button"
            className="map__change"
            onClick={() => {
              forgetPlace(FROM_KEY);
              setFrom(null);
            }}
          >
            Change place
          </button>
        </div>
      )}

      {/* A whole other origin rendering inside the app's window, so it gets
          the narrowest sandbox a map still works under — scripts, and nothing
          else. No same-origin, so it cannot reach back into this document; no
          forms, no popups, no downloads. And no referrer, because which place
          someone looked up is not the tile server's business. */}
      <iframe
        key={src}
        className="map__frame"
        title={title}
        src={src}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        loading="lazy"
      />

      <p className="map__credit">Map data © OpenStreetMap contributors · routing by OSRM</p>
    </div>
  );
}

function Leg({
  label,
  place,
  onChange,
  onClear,
}: {
  label: string;
  place: Place;
  onChange: () => void;
  onClear?: () => void;
}) {
  return (
    <div className="map__leg">
      <p className="map__leg-label">{label}</p>
      <button type="button" className="map__leg-place" onClick={onChange}>
        <span className="map__leg-name">{place.name}</span>
        <span className="map__leg-where">{whereabouts(place)}</span>
      </button>
      {onClear && (
        <button
          type="button"
          className="map__leg-clear"
          aria-label="Clear destination"
          onClick={onClear}
        >
          ×
        </button>
      )}
    </div>
  );
}
