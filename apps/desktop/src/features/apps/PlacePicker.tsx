import { useEffect, useRef, useState } from "react";
import { getPlatform } from "../../platform";
import type { Place } from "../../platform/types";

/**
 * How long to wait after the last keystroke before asking.
 *
 * Short enough that the list feels like it is keeping up, long enough that
 * typing a city name is one request rather than nine.
 */
const DEBOUNCE_MS = 250;

/**
 * The shortest term worth sending.
 *
 * Two, which is measured rather than chosen: Open-Meteo's geocoder returns
 * nothing at all for a single character, and starts answering at two — "ag"
 * finds Ág and Āg, "agr" finds Agra. Searching on one letter would spend a
 * request guaranteed to come back empty and then tell the person "no place by
 * that name", which is not true. It is the geocoder declining to answer, not
 * the world lacking places beginning with A.
 *
 * From two on it behaves as expected: each letter narrows the list, and the
 * debounce keeps that from being a request per keystroke.
 */
const MIN_QUERY = 2;

/**
 * Where a place sits, for telling two of one name apart.
 *
 * "Delhi" alone matches a city in India and a village in New York; without
 * this the search results are a column of identical rows.
 */
export function whereabouts(place: Place): string {
  return [place.region, place.country].filter(Boolean).join(", ");
}

interface PlacePickerProps {
  /** The question above the box. Each app asks it in its own words. */
  prompt: string;
  /** Places to offer again without searching. */
  recents?: Place[];
  onChoose: (place: Place) => void;
}

/**
 * Search for a place and choose one.
 *
 * Shared by Weather and Map, which both need a coordinate and neither of which
 * should ask for one in latitude and longitude.
 *
 * It searches as you type. Requiring a button press meant typing a name,
 * waiting, and getting nothing — which read as the app being slow when it had
 * simply not been asked. The debounce is what keeps that from being one
 * request per letter.
 */
export function PlacePicker({ prompt, recents, onChoose }: PlacePickerProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Place[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Which search is current.
   *
   * Replies can arrive out of order — a slow one for "Del" landing after a
   * fast one for "Delhi" — and without this the older list would be shown
   * under the newer query.
   */
  const latest = useRef(0);

  useEffect(() => {
    const term = query.trim();

    if (term.length < MIN_QUERY) {
      // Emptying the box clears the list rather than leaving the last search
      // stranded under an empty field.
      setResults(null);
      setSearching(false);
      latest.current += 1;
      return;
    }

    const ticket = ++latest.current;
    const timer = setTimeout(async () => {
      setSearching(true);
      setError(null);
      try {
        const found = await getPlatform().apps.searchPlaces(term);
        if (ticket !== latest.current) return;
        setResults(found);
      } catch (err) {
        if (ticket !== latest.current) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (ticket === latest.current) setSearching(false);
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query]);

  async function useMyLocation() {
    setLocating(true);
    setError(null);
    try {
      onChoose(await getPlatform().apps.locate());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLocating(false);
    }
  }

  return (
    <div className="picker">
      <h2 className="picker__ask">{prompt}</h2>

      <div className="picker__form">
        <input
          className="picker__input"
          aria-label="Place"
          value={query}
          spellCheck={false}
          autoComplete="off"
          placeholder="Start typing a town or city"
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="picker__status" aria-hidden="true">
          {searching ? "…" : ""}
        </span>
      </div>

      <button
        type="button"
        className="picker__locate"
        disabled={locating}
        onClick={() => void useMyLocation()}
      >
        <span aria-hidden="true">◎</span>
        {locating ? "Locating…" : "Use my location"}
      </button>

      {error && (
        <p className="picker__error" role="alert">
          {error}
        </p>
      )}

      {results !== null && results.length === 0 && !error && !searching && (
        <p className="picker__empty">No&nbsp;place by that name. Try spelling it differently.</p>
      )}

      {results !== null && results.length > 0 && (
        <ul className="picker__results" aria-label="Places found">
          {results.map((found) => (
            <li key={`${found.latitude},${found.longitude}`}>
              <button type="button" className="picker__result" onClick={() => onChoose(found)}>
                <span className="picker__result-name">{found.name}</span>
                <span className="picker__result-where">{whereabouts(found)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {results === null && recents && recents.length > 0 && (
        <div className="picker__recents">
          <p className="picker__recents-title">Recent</p>
          <ul className="picker__results" aria-label="Recent places">
            {recents.map((past) => (
              <li key={`${past.latitude},${past.longitude}`}>
                <button type="button" className="picker__result" onClick={() => onChoose(past)}>
                  <span className="picker__result-name">{past.name}</span>
                  <span className="picker__result-where">{whereabouts(past)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * A place read back from browser storage, or null.
 *
 * Storage holds whatever was last written there — including something an older
 * build wrote, or a person editing the file by hand — so the shape is checked
 * rather than trusted. A bad value means asking again, which is the state a
 * first-time user is already in and needs no separate handling.
 */
export function loadStoredPlace(key: string): Place | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return validPlace(JSON.parse(raw));
  } catch {
    // Unreadable or unparseable: ask again.
  }
  return null;
}

function validPlace(value: unknown): Place | null {
  if (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Place).name === "string" &&
    Number.isFinite((value as Place).latitude) &&
    Number.isFinite((value as Place).longitude)
  ) {
    return value as Place;
  }
  return null;
}

export function storePlace(key: string, place: Place): void {
  try {
    localStorage.setItem(key, JSON.stringify(place));
  } catch {
    // Preference lost; the app still works for this session.
  }
}

export function forgetPlace(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Nothing to clear.
  }
}

/** How many past places to keep. Enough to be useful, short enough to scan. */
const MAX_RECENTS = 5;

/**
 * Places visited before, newest first.
 *
 * Anything unreadable is dropped rather than failing the list: a bad row
 * should cost that row, and the list is a convenience either way.
 */
export function loadRecents(key: string): Place[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(validPlace)
      .filter((p): p is Place => p !== null)
      .slice(0, MAX_RECENTS);
  } catch {
    return [];
  }
}

/**
 * Add a place to the front of the list.
 *
 * Matched on coordinate rather than name, because two different places share
 * a name often enough that keying on it would collapse them into one row.
 */
export function rememberPlace(key: string, place: Place): Place[] {
  const kept = [
    place,
    ...loadRecents(key).filter(
      (p) => p.latitude !== place.latitude || p.longitude !== place.longitude,
    ),
  ].slice(0, MAX_RECENTS);

  try {
    localStorage.setItem(key, JSON.stringify(kept));
  } catch {
    // The list is a convenience; losing it costs nothing else.
  }
  return kept;
}
