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
import type { Place, WeatherReport } from "../../../platform/types";

const PLACE_KEY = "jky.apps.weather.place";
/// Kept apart from the current place, so changing where you are does not also
/// forget the places you check regularly.
const RECENTS_KEY = "jky.apps.weather.recents";

/** "2026-01-02" as a weekday, in the reader's own locale. */
function weekday(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString(undefined, { weekday: "short" });
}

/**
 * A mark for the sky, beside the words Rust already sent.
 *
 * Ranges rather than a second WMO table: the descriptions come from one place
 * in Rust, and this only has to say roughly what is happening at a glance.
 * Anything unrecognised still gets a mark, because a blank where the weather
 * should be reads as a broken panel rather than an unknown code.
 */
export function conditionGlyph(code: number, isDay: boolean): string {
  if (code === 0) return isDay ? "☀" : "☾";
  if (code <= 2) return isDay ? "⛅" : "☁";
  if (code === 3) return "☁";
  if (code <= 48) return "🌫";
  if (code <= 67) return "🌧";
  if (code <= 77) return "❄";
  if (code <= 82) return "🌦";
  if (code <= 86) return "🌨";
  if (code <= 99) return "⛈";
  return "•";
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
  const [place, setPlace] = useState<Place | null>(() => loadStoredPlace(PLACE_KEY));
  const [recents, setRecents] = useState<Place[]>(() => loadRecents(RECENTS_KEY));
  const [report, setReport] = useState<WeatherReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (target: Place) => {
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

  function choose(chosen: Place) {
    setPlace(chosen);
    storePlace(PLACE_KEY, chosen);
    setRecents(rememberPlace(RECENTS_KEY, chosen));
  }

  function changePlace() {
    forgetPlace(PLACE_KEY);
    setPlace(null);
    setReport(null);
    setError(null);
  }

  if (!place) {
    return (
      <div className="wx wx--picking">
        <PlacePicker prompt="Where are you?" recents={recents} onChoose={choose} />
      </div>
    );
  }

  return (
    <div className="wx">
      <div className="wx__head">
        <div>
          <h2 className="wx__place">{place.name}</h2>
          <p className="wx__where">{whereabouts(place)}</p>
        </div>
        <button type="button" className="wx__change" onClick={changePlace}>
          Change place
        </button>
      </div>

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
            <div className="wx__reading">
              <span className="wx__glyph" aria-hidden="true">
                {conditionGlyph(report.now.code, report.now.is_day)}
              </span>
              <p className="wx__temp">{degrees(report.now.temperature_c)}</p>
            </div>
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
                <span className="wx__day-glyph" aria-hidden="true">
                  {conditionGlyph(day.code, true)}
                </span>
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
