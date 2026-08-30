import { useCallback, useEffect, useState, type FormEvent } from "react";
import { getPlatform } from "../../../platform";
import type { WeatherPlace, WeatherReport } from "../../../platform/types";

const PLACE_KEY = "jky.apps.weather.place";

/**
 * The place last chosen, or null.
 *
 * Storage holds whatever was last written there — including something an
 * older build wrote, or a person editing the file by hand — so the shape is
 * checked rather than trusted. A bad value asks for a place again, which is
 * the same state a first-time user is in and needs no special handling.
 */
function loadPlace(): WeatherPlace | null {
  try {
    const raw = localStorage.getItem(PLACE_KEY);
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

/** Where a place sits, for telling two of one name apart. */
function whereabouts(place: WeatherPlace): string {
  return [place.region, place.country].filter(Boolean).join(", ");
}

/** "2026-01-02" as a weekday, in the reader's own locale. */
function weekday(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString(undefined, { weekday: "short" });
}

/** Whole degrees: a tenth of a degree is below what anyone feels. */
function degrees(value: number): string {
  return `${Math.round(value)}°`;
}

/**
 * The Weather app.
 *
 * Needs no key and no account, which is why it is in the "no auth, ever" tier:
 * there is nothing here to authenticate, and asking someone to sign in to see
 * the temperature would be friction bought with nothing.
 *
 * Every request is made by Rust. The window cannot reach Open-Meteo — the CSP
 * names no host but `'self'` — so this calls across the platform adapter and
 * renders what comes back.
 */
export function Weather() {
  const [place, setPlace] = useState<WeatherPlace | null>(loadPlace);
  const [report, setReport] = useState<WeatherReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<WeatherPlace[] | null>(null);
  const [searching, setSearching] = useState(false);

  const load = useCallback(async (target: WeatherPlace) => {
    setLoading(true);
    setError(null);
    try {
      setReport(await getPlatform().apps.weather(target.latitude, target.longitude));
    } catch (e) {
      // The report is cleared so a stale reading is never shown beside an
      // error: yesterday's temperature under a failure notice reads as though
      // it were current.
      setReport(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (place) void load(place);
  }, [place, load]);

  async function runSearch(e: FormEvent) {
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

  function choose(chosen: WeatherPlace) {
    try {
      localStorage.setItem(PLACE_KEY, JSON.stringify(chosen));
    } catch {
      // Preference lost; the weather still loads for this session.
    }
    setResults(null);
    setQuery("");
    setPlace(chosen);
  }

  function changePlace() {
    try {
      localStorage.removeItem(PLACE_KEY);
    } catch {
      // Nothing to clear.
    }
    setPlace(null);
    setReport(null);
    setError(null);
  }

  if (!place) {
    return (
      <div className="wx wx--picking">
        <h2 className="wx__ask">Where are you?</h2>
        <form className="wx__search" onSubmit={runSearch}>
          <input
            className="wx__input"
            aria-label="Place"
            value={query}
            spellCheck={false}
            autoComplete="off"
            placeholder="A town or city"
            onChange={(e) => setQuery(e.target.value)}
          />
          <button type="submit" className="wx__go" disabled={searching}>
            {searching ? "Searching…" : "Search"}
          </button>
        </form>

        {error && (
          <p className="wx__error" role="alert">
            {error}
          </p>
        )}

        {results !== null && results.length === 0 && !error && (
          <p className="wx__empty">No&nbsp;place by that name. Try spelling it differently.</p>
        )}

        {results !== null && results.length > 0 && (
          <ul className="wx__results" aria-label="Places found">
            {results.map((found) => (
              <li key={`${found.latitude},${found.longitude}`}>
                <button type="button" className="wx__result" onClick={() => choose(found)}>
                  <span className="wx__result-name">{found.name}</span>
                  <span className="wx__result-where">{whereabouts(found)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="wx">
      <header className="wx__head">
        <div>
          <h2 className="wx__place">{place.name}</h2>
          <p className="wx__where">{whereabouts(place)}</p>
        </div>
        <button type="button" className="wx__change" onClick={changePlace}>
          Change place
        </button>
      </header>

      {error && (
        <div className="wx__failure">
          <p className="wx__error" role="alert">
            {error}
          </p>
          <button type="button" className="wx__retry" onClick={() => void load(place)}>
            Try again
          </button>
        </div>
      )}

      {loading && !report && <p className="wx__loading">Reading the sky…</p>}

      {report && (
        <>
          <section
            className="wx__now"
            aria-label="Current conditions"
            data-night={report.now.is_day ? undefined : ""}
          >
            <p className="wx__temp">{degrees(report.now.temperature_c)}</p>
            <p className="wx__desc">{report.now.description}</p>
            <dl className="wx__facts">
              <div>
                <dt>Feels like</dt>
                <dd>{degrees(report.now.feels_like_c)}</dd>
              </div>
              <div>
                <dt>Humidity</dt>
                <dd>{report.now.humidity_pct}%</dd>
              </div>
              <div>
                <dt>Wind</dt>
                <dd>{Math.round(report.now.wind_kph)} km/h</dd>
              </div>
            </dl>
          </section>

          <ul className="wx__outlook" aria-label="Outlook">
            {report.days.map((day) => (
              <li key={day.date} className="wx__day">
                <span className="wx__day-name">{weekday(day.date)}</span>
                <span className="wx__day-desc">{day.description}</span>
                <span className="wx__day-range">
                  <b>{degrees(day.high_c)}</b> {degrees(day.low_c)}
                </span>
              </li>
            ))}
          </ul>

          <p className="wx__stamp">
            Taken {report.now.observed_at.replace("T", " ")} · {report.timezone}
          </p>
        </>
      )}
    </div>
  );
}
