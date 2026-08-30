import { useState, type FormEvent } from "react";
import { getPlatform } from "../../platform";
import type { WeatherPlace } from "../../platform/types";

/**
 * Where a place sits, for telling two of one name apart.
 *
 * "Delhi" alone matches a city in India and a village in New York; without
 * this the search results are a column of identical rows.
 */
export function whereabouts(place: WeatherPlace): string {
  return [place.region, place.country].filter(Boolean).join(", ");
}

interface PlacePickerProps {
  /** The question above the box. Each app asks it in its own words. */
  prompt: string;
  onChoose: (place: WeatherPlace) => void;
}

/**
 * Search for a place and choose one.
 *
 * Shared by Weather and Map, which both need a coordinate and neither of
 * which should ask for one in latitude and longitude. It came out of Weather
 * when Map needed the same thing — two copies of a search box is two places
 * for the error handling to drift.
 *
 * The geocoder behind it is `apps_place_search`, which is Rust's; the window
 * cannot reach it directly.
 */
export function PlacePicker({ prompt, onChoose }: PlacePickerProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<WeatherPlace[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(e: FormEvent) {
    e.preventDefault();
    if (query.trim() === "") return;
    setSearching(true);
    setError(null);
    setResults(null);
    try {
      setResults(await getPlatform().apps.searchPlaces(query));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="picker">
      <h2 className="picker__ask">{prompt}</h2>

      <form className="picker__form" onSubmit={run}>
        <input
          className="picker__input"
          aria-label="Place"
          value={query}
          spellCheck={false}
          autoComplete="off"
          placeholder="A town or city"
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="submit" className="picker__go" disabled={searching}>
          {searching ? "Searching…" : "Search"}
        </button>
      </form>

      {error && (
        <p className="picker__error" role="alert">
          {error}
        </p>
      )}

      {results !== null && results.length === 0 && !error && (
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
export function loadStoredPlace(key: string): WeatherPlace | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as WeatherPlace).name === "string" &&
      Number.isFinite((parsed as WeatherPlace).latitude) &&
      Number.isFinite((parsed as WeatherPlace).longitude)
    ) {
      return parsed as WeatherPlace;
    }
  } catch {
    // Unreadable or unparseable: ask again.
  }
  return null;
}

export function storePlace(key: string, place: WeatherPlace): void {
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
