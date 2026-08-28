import { useEffect } from "react";
import type { DueItem } from "./due";
import { NotificationRow } from "./NotificationRow";
import { useNotifications } from "./notificationStore";

/** How long a heads-up stays before retiring to the centre. */
export const BANNER_LIFETIME_MS = 8_000;

/**
 * At most this many at once. A phone shows one or two and stacks the rest;
 * a column of nine covering the workspace is not a notification, it is an
 * obstruction.
 */
export const MAX_BANNERS = 3;

/**
 * The heads-up stack.
 *
 * Slides in when something becomes due, then gets out of the way on its own.
 * Nothing is lost when one retires — it is still in the centre behind the
 * bell, which is the whole point of the split: the banner is the
 * interruption, the centre is the record.
 */
export function NotificationBanners({ due }: { due: DueItem[] }) {
  const dismissed = useNotifications((s) => s.dismissed);
  const seen = useNotifications((s) => s.seen);
  const now = useNotifications((s) => s.now);
  const dismiss = useNotifications((s) => s.dismiss);
  const markSeen = useNotifications((s) => s.markSeen);

  const showing = due
    .filter((d) => d.urgent && !dismissed.has(d.key) && !seen.has(d.key))
    .slice(0, MAX_BANNERS);

  // One timer per banner on screen. Retiring is per-item rather than
  // per-stack so a banner that arrived late still gets its full moment
  // instead of inheriting whatever was left of an earlier one's.
  const showingKeys = showing.map((d) => d.key).join("|");
  useEffect(() => {
    if (!showingKeys) return;
    const timers = showingKeys
      .split("|")
      .map((key) => setTimeout(() => markSeen(key), BANNER_LIFETIME_MS));
    return () => timers.forEach(clearTimeout);
  }, [showingKeys, markSeen]);

  if (showing.length === 0) return null;

  return (
    <div className="banners" role="status" aria-live="polite" aria-label="New notifications">
      {showing.map((item) => (
        <div key={item.key} className="banners__card">
          <NotificationRow
            item={item}
            now={now}
            onDismiss={() => dismiss(item.key)}
          />
        </div>
      ))}
    </div>
  );
}
