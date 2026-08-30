import { useCallback, useEffect, useState } from "react";
import { getPlatform } from "../../../platform";
import type { NewsStory } from "../../../platform/types";

/** How many headlines to ask for. Rust clamps anything larger. */
const HEADLINES = 20;

/**
 * How long ago something was posted, in words.
 *
 * `now` is a parameter so this is testable without freezing the clock, and
 * a future timestamp reads as "just now" rather than as a negative age —
 * clocks disagree, and "-1m ago" is a bug report waiting to be filed.
 */
export function sinceLabel(postedAt: number, now: number): string {
  const seconds = Math.max(0, now - postedAt);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * The News app.
 *
 * A public API with no key and no account, so it is in the "no auth, ever"
 * tier. Rust makes every request — the window can reach no host — and fetches
 * the individual stories concurrently, which is the difference between a panel
 * that fills and one that crawls.
 *
 * Following a headline hands the URL to the operating system rather than
 * opening it here. This app does not embed articles: an arbitrary page cannot
 * be framed, which is what the Browser app exists to solve, and it is not
 * built yet. Pretending otherwise would mean a headline that silently did
 * nothing.
 */
export function News() {
  const [stories, setStories] = useState<NewsStory[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStories(await getPlatform().apps.news(HEADLINES));
      setNow(Math.floor(Date.now() / 1000));
    } catch (e) {
      // Cleared, so a stale list is never shown under a failure notice as
      // though it had just been fetched.
      setStories(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function open(url: string) {
    void getPlatform().openExternal(url);
  }

  return (
    <div className="news">
      <div className="news__head">
        <h2 className="news__title">Top stories</h2>
        <button type="button" className="news__refresh" onClick={() => void load()} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="news__failure">
          <p className="news__error" role="alert">
            {error}
          </p>
          <button type="button" className="news__retry" onClick={() => void load()}>
            Try again
          </button>
        </div>
      )}

      {loading && !stories && <p className="news__loading">Fetching the front page…</p>}

      {stories && (
        <ol className="news__list" aria-label="Headlines">
          {stories.map((story, i) => (
            <li key={story.id} className="news__item">
              <span className="news__rank" aria-hidden="true">
                {i + 1}
              </span>
              <div className="news__body">
                {/* A post with no article — Ask HN and friends — leads to its
                    own discussion, because that is where the content is. */}
                <button
                  type="button"
                  className="news__headline"
                  onClick={() => open(story.url ?? story.discussion_url)}
                >
                  {story.title}
                </button>
                <p className="news__meta">
                  {story.host && <span className="news__host">{story.host}</span>}
                  <span>{plural(story.score, "point")}</span>
                  <span>{story.author}</span>
                  <span>{sinceLabel(story.posted_at, now)}</span>
                  <button
                    type="button"
                    className="news__comments"
                    onClick={() => open(story.discussion_url)}
                  >
                    {plural(story.comments, "comment")}
                  </button>
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}

      {stories && (
        <p className="news__note">Headlines open in your browser — this app does not embed pages.</p>
      )}
    </div>
  );
}
