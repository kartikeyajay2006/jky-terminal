/**
 * Which typed commands can be kept live.
 *
 * The refresh runs a fixed argument list in Rust, not the words you typed —
 * so a panel may only offer to stay live when what you typed *is* one of
 * those commands. Offering it for `df -x tmpfs` and then refreshing with
 * `df -h` would be a panel that quietly answers a different question from
 * the one on screen, which is worse than a panel that never moves.
 *
 * Hence exact spellings rather than a prefix match.
 */
const SPELLINGS: Record<string, readonly string[]> = {
  df: ["df", "df -h", "df -h -T", "df -hT"],
  ps: ["ps", "ps aux", "ps -aux"],
  "docker-ps": ["docker ps"],
};

/** How often a live panel asks again. */
export const LIVE_EVERY_MS = 2500;

/**
 * The live source for a command, or null when there is not one.
 *
 * Whitespace is collapsed first, because `docker  ps` is the same command and
 * a person who typed two spaces has not asked for something else.
 */
export function liveSourceFor(command: string): string | null {
  const typed = command.trim().replace(/\s+/g, " ");
  if (!typed) return null;

  for (const [id, spellings] of Object.entries(SPELLINGS)) {
    if (spellings.includes(typed)) return id;
  }
  return null;
}

/** Every command spelling that can be kept live, for the tests and the docs. */
export function liveSpellings(): Record<string, readonly string[]> {
  return SPELLINGS;
}
