import { useCallback, useEffect, useState } from "react";
import { getPlatform } from "../../../platform";
import type { NewsArticle, NewsSource } from "../../../platform/types";

/** How many stories to ask each paper for. Rust clamps anything larger. */
const PER_SOURCE = 12;

/**
 * How long ago a story was published, in words.
 *
 * Takes the RFC 822 string the feed sent, because that is what papers write
 * and `Date.parse` already understands it — including the offset, so a paper
 * publishing in +05:30 is not read as five hours stale. `now` is a parameter
 * so this is testable without freezing the clock.
 *
 * Returns null rather than a guess when there is no readable date: a wrong
 * timestamp on a news story is worse than no timestamp.
 */
export function sinceLabel(published: string | null, now: number): string | null {
  if (!published) return null;
  const at = Date.parse(published);
  if (Number.isNaN(at)) return null;

  // Clamped at zero: papers and this machine disagree by a few seconds, and
  // "-1m ago" is a bug report waiting to be filed.
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * The News app.
 *
 * Real papers, read from the RSS feeds they publish for the purpose — public,
 * no key, no account, which is what keeps this in the "no auth, ever" tier.
 * Rust makes every request and strips the markup before it arrives, so this
 * renders plain text only.
 *
 * The first story is set larger than the rest. That is a newspaper's own
 * device and it carries real information here: the feed's order is the
 * paper's own judgement about what leads.
 *
 * Following a story hands the URL to the operating system. This app does not
 * embed pages — an arbitrary page cannot be framed, which is what the Browser
 * app exists to solve and it is not built yet.
 */
export function News() {
  const [sources, setSources] = useState<NewsSource[]>([]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [articles, setArticles] = useState<NewsArticle[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // The tabs are a convenience; the stories are the point. Losing the paper
  // list must not take the news with it.
  useEffect(() => {
    void getPlatform()
      .apps.newsSources()
      .then(setSources)
      .catch(() => setSources([]));
  }, []);

  const load = useCallback(async (source: string | null) => {
    setLoading(true);
    setError(null);
    try {
      setArticles(await getPlatform().apps.news(source, PER_SOURCE));
      setNow(Date.now());
    } catch (e) {
      // Cleared, so yesterday's front page is never left under a failure
      // notice looking like it had just been fetched.
      setArticles(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(chosen);
  }, [chosen, load]);

  function open(url: string) {
    void getPlatform().openExternal(url);
  }

  return (
    <div className="news">
      <div className="news__head">
        <div>
          <p className="news__eyebrow">
            {chosen ? sources.find((s) => s.id === chosen)?.region : "Front pages"}
          </p>
          <h2 className="news__title">
            {chosen ? (sources.find((s) => s.id === chosen)?.name ?? "News") : "Today"}
          </h2>
        </div>
        <button
          type="button"
          className="news__refresh"
          onClick={() => void load(chosen)}
          disabled={loading}
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {sources.length > 0 && (
        <div className="news__papers" role="tablist" aria-label="Papers">
          <button
            type="button"
            role="tab"
            className="news__paper"
            aria-selected={chosen === null}
            onClick={() => setChosen(null)}
          >
            All
          </button>
          {sources.map((source) => (
            <button
              key={source.id}
              type="button"
              role="tab"
              className="news__paper"
              aria-selected={chosen === source.id}
              onClick={() => setChosen(source.id)}
            >
              {source.name}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="news__failure">
          <p className="news__error" role="alert">
            {error}
          </p>
          <button type="button" className="news__retry" onClick={() => void load(chosen)}>
            Try again
          </button>
        </div>
      )}

      {loading && !articles && <p className="news__loading">Reading the papers…</p>}

      {articles && articles.length === 0 && (
        <p className="news__loading">That paper has nothing new right now.</p>
      )}

      {articles && articles.length > 0 && (
        <ol className="news__list" aria-label="Stories">
          {articles.map((article, i) => (
            <li
              key={`${article.source_id}:${article.link}`}
              className="news__item"
              data-lead={i === 0 ? "" : undefined}
            >
              {article.category && <p className="news__section">{article.category}</p>}

              <button
                type="button"
                className="news__headline"
                onClick={() => open(article.link)}
              >
                {article.title}
              </button>

              {article.summary && <p className="news__summary">{article.summary}</p>}

              <p className="news__byline">
                <span className="news__paper-name">{article.source_name}</span>
                {article.host && <span className="news__host">{article.host}</span>}
                {sinceLabel(article.published, now) && (
                  <span>{sinceLabel(article.published, now)}</span>
                )}
              </p>
            </li>
          ))}
        </ol>
      )}

      {articles && articles.length > 0 && (
        <p className="news__note">Stories open in your browser — this app does not embed pages.</p>
      )}
    </div>
  );
}
