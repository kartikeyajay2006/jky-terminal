import type {
  GitHubActivity,
  GitHubContributions,
  GitHubProfile,
  GitHubSummary,
} from "../../../platform/types";
import { relativeDay } from "./GitHub";

/** Which pane of the GitHub app is showing. */
export type Section =
  | "dashboard"
  | "notifications"
  | "repositories"
  | "issues"
  | "pulls"
  | "activity";

export const SECTIONS: { id: Section; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "notifications", label: "Notifications" },
  { id: "repositories", label: "Repositories" },
  { id: "issues", label: "Issues" },
  { id: "pulls", label: "Pull Requests" },
  { id: "activity", label: "Activity" },
];

/** 1337 → "1,337". Counts in the thousands are unreadable without it. */
function grouped(n: number): string {
  return n.toLocaleString("en-US");
}

/**
 * The left rail.
 *
 * Buttons rather than links: nothing here changes the address, and a link that
 * goes nowhere is a link a screen reader announces wrongly.
 */
export function Sidebar({
  current,
  unread,
  onSelect,
}: {
  current: Section;
  unread: number;
  onSelect: (id: Section) => void;
}) {
  return (
    <nav className="ghd__rail" aria-label="GitHub sections">
      <p className="ghd__rail-title">Menu</p>
      <ul className="ghd__rail-list">
        {SECTIONS.map((section) => (
          <li key={section.id}>
            <button
              type="button"
              className="ghd__rail-item"
              // `true` rather than `page`: these are panes within one app, not
              // separate destinations.
              aria-current={current === section.id ? "true" : undefined}
              onClick={() => onSelect(section.id)}
            >
              <span className="ghd__rail-label">{section.label}</span>
              {section.id === "notifications" && unread > 0 && (
                <span className="ghd__rail-count">{unread}</span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** The account card: who you are, above everything else. */
export function ProfileCard({
  user,
  onOpen,
}: {
  user: GitHubProfile;
  onOpen: (url: string) => void;
}) {
  const initials = user.login.slice(0, 2).toUpperCase();
  return (
    <section className="ghd__box ghd__profile" aria-label="Account">
      {/* The avatar is drawn rather than fetched: `img-src` is `'self' data:`
          and loading it would mean opening the CSP to GitHub's image host. */}
      <span className="ghd__avatar" aria-hidden="true">
        {initials}
      </span>
      <div className="ghd__profile-who">
        <button type="button" className="ghd__login" onClick={() => onOpen(user.html_url)}>
          {user.login}
        </button>
        {user.name && <p className="ghd__realname">{user.name}</p>}
        {user.bio && <p className="ghd__bio">{user.bio}</p>}
      </div>
    </section>
  );
}

/** The counts a profile leads with, each in its own box. */
export function Overview({ summary }: { summary: GitHubSummary }) {
  const tiles: [string, string][] = [
    ["Repositories", grouped(summary.user.public_repos)],
    ["Followers", grouped(summary.user.followers)],
    ["Following", grouped(summary.user.following)],
    ["Stars", grouped(summary.stars_received)],
    ["Contributions", summary.contributions ? grouped(summary.contributions.total) : "—"],
  ];

  return (
    <section className="ghd__overview" aria-label="Overview">
      {tiles.map(([label, value]) => (
        <div key={label} className="ghd__box ghd__tile" role="group" aria-label={label}>
          <p className="ghd__tile-label">{label}</p>
          <p className="ghd__tile-value">{value}</p>
        </div>
      ))}
    </section>
  );
}

/**
 * The contribution calendar.
 *
 * An image role with a single label rather than a grid of 365 cells: a screen
 * reader reading out every square one at a time would be unusable, and the
 * total above it already says what the picture says.
 */
export function Heatmap({ contributions }: { contributions: GitHubContributions }) {
  return (
    <div className="ghd__box ghd__heat">
      <div className="ghd__heat-head">
        <p className="ghd__box-title">Contributions in the last year</p>
        <p className="ghd__heat-key" aria-hidden="true">
          Less
          {[0, 1, 2, 3, 4].map((level) => (
            <span key={level} className="ghd__day" data-key data-level={level} />
          ))}
          More
        </p>
      </div>
      <div
        className="ghd__heat-grid"
        role="img"
        aria-label={`Contributions in the last year: ${grouped(contributions.total)} in total`}
      >
        {contributions.weeks.map((week, w) => (
          <span key={w} className="ghd__week">
            {week.map((day) => (
              <span
                key={day.date}
                className="ghd__day"
                data-level={day.level}
                title={`${day.count} on ${day.date}`}
              />
            ))}
          </span>
        ))}
      </div>
    </div>
  );
}

/** The feed, already turned into sentences by Rust. */
export function ActivityFeed({
  activity,
  now,
  onOpen,
}: {
  activity: GitHubActivity[];
  now: number;
  onOpen: (url: string) => void;
}) {
  return (
    <div className="ghd__box">
      <p className="ghd__box-title">Activity</p>
      {activity.length === 0 ? (
        <p className="gh__quiet">Nothing recent.</p>
      ) : (
        <ul className="ghd__feed" aria-label="Activity">
          {activity.map((item) => (
            <li key={item.id}>
              <button type="button" className="ghd__feed-row" onClick={() => onOpen(item.html_url)}>
                <span className="ghd__feed-line">
                  <span className="ghd__verb">{item.verb}</span>{" "}
                  <span className="ghd__feed-repo">{item.repo}</span>
                </span>
                {item.detail && <span className="ghd__feed-detail">{item.detail}</span>}
                {relativeDay(item.at, now) && (
                  <span className="ghd__feed-when">{relativeDay(item.at, now)}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
