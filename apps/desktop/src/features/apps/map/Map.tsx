import { useState } from "react";
import {
  PlacePicker,
  forgetPlace,
  loadStoredPlace,
  storePlace,
  whereabouts,
} from "../PlacePicker";
import type { WeatherPlace } from "../../../platform/types";

const PLACE_KEY = "jky.apps.map.place";

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

/** How wide a view to open on: roughly a town. */
const DEFAULT_SPAN = 0.08;
/** Bounds on the span, so zooming cannot leave the map with nothing to draw. */
const MIN_SPAN = 0.002;
const MAX_SPAN = 60;

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** Six decimals is about a tenth of a metre — past what a map view needs. */
function round(value: number): number {
  return Number(value.toFixed(6));
}

/**
 * The embed URL for a view centred on one coordinate.
 *
 * Built here from numbers, never from a string that came from anywhere else:
 * the frame's address is the one thing that decides what renders inside the
 * app's window, so nothing but a latitude, a longitude and a span reaches it.
 *
 * The box is clamped to the real extent of the world. A bbox running past a
 * pole or the antimeridian is not one the tile server can serve, and it comes
 * back as a blank frame rather than as an error anyone could act on.
 */
export function embedUrl(latitude: number, longitude: number, span: number): string {
  const half = span / 2;
  const west = round(clamp(longitude - half, -180, 180));
  const east = round(clamp(longitude + half, -180, 180));
  const south = round(clamp(latitude - half, -90, 90));
  const north = round(clamp(latitude + half, -90, 90));

  const bbox = `${west},${south},${east},${north}`;
  const marker = `${round(latitude)},${round(longitude)}`;
  return `${EMBED}?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${encodeURIComponent(marker)}`;
}

/**
 * The Map app.
 *
 * Named `MapApp` rather than `Map` because `Map` is a global built-in, and a
 * component that shadows it makes every use of the real one in this file a
 * question.
 *
 * This is the app that needed the CSP's one widening. `frame-src` lets the
 * window display a document from another origin; it does not let this app's
 * JavaScript read into that frame or reach that host — same-origin policy
 * still separates them and `connect-src` is still `'self'`. So the property
 * that a compromised frontend has nowhere to send anything is untouched.
 */
export function MapApp() {
  const [place, setPlace] = useState<WeatherPlace | null>(() => loadStoredPlace(PLACE_KEY));
  const [span, setSpan] = useState(DEFAULT_SPAN);

  function choose(chosen: WeatherPlace) {
    storePlace(PLACE_KEY, chosen);
    setSpan(DEFAULT_SPAN);
    setPlace(chosen);
  }

  if (!place) {
    return (
      <div className="map map--picking">
        <PlacePicker prompt="Where do you want to look?" onChoose={choose} />
      </div>
    );
  }

  return (
    <div className="map">
      <div className="map__bar">
        <div>
          <h2 className="map__place">{place.name}</h2>
          <p className="map__where">{whereabouts(place)}</p>
        </div>
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
              forgetPlace(PLACE_KEY);
              setPlace(null);
            }}
          >
            Change place
          </button>
        </div>
      </div>

      {/* A whole other origin rendering inside the app's window, so it gets
          the narrowest sandbox a map still works under — scripts, and nothing
          else. No same-origin, so it cannot reach back into this document; no
          forms, no popups, no downloads. And no referrer, because which place
          someone looked up is not the tile server's business. */}
      <iframe
        key={place.latitude + "," + place.longitude}
        className="map__frame"
        title={`Map of ${place.name}`}
        src={embedUrl(place.latitude, place.longitude, span)}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        loading="lazy"
      />

      <p className="map__credit">Map data © OpenStreetMap contributors</p>
    </div>
  );
}
