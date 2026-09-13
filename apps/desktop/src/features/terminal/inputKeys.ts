/**
 * Keys whose terminal answer is older than the question.
 *
 * A terminal has sent the same byte for Enter and Shift+Enter since 1978.
 * There was no reason to tell them apart when the thing on the other end was
 * a shell reading one line at a time, and every encoding since has kept the
 * ambiguity for compatibility.
 *
 * It matters now because the thing on the other end is often not a shell. An
 * assistant that takes a paragraph needs a way to say "newline" that is not
 * "send" — and without one, a multi-line prompt submits itself halfway
 * through the second sentence. That is not a small annoyance in a terminal
 * that calls itself an AI terminal; it is the feature not working.
 *
 * The real fix is the kitty keyboard protocol, which makes every key
 * unambiguous. It is an xterm.js feature and it is not in the release this
 * app ships — 6.0 brought synchronized output, and the keyboard work is in a
 * 6.1 beta with known bugs that has no place in something people install. So
 * this does the one substitution that needs no protocol at all.
 *
 * `\n` is Ctrl+J, the line feed. Every assistant CLI binds it to "insert a
 * newline" precisely because it is the one key that survives every terminal,
 * and a shell reads it as Enter — which is what Shift+Enter did here anyway.
 * So this is strictly better everywhere and worse nowhere, which is the test
 * a workaround has to pass to be worth shipping.
 */

/**
 * What a key should send instead of whatever the terminal would send.
 *
 * Null means "nothing to override" — the overwhelming majority of keys, which
 * go on to xterm untouched.
 */
export function overrideBytes(event: KeyboardEvent): string | null {
  if (event.type !== "keydown") return null;

  // Shift and nothing else. Ctrl+Enter and Alt+Enter are bound by real
  // programs to their own things, and a terminal that quietly rewrote them
  // would be one you could not use those programs in.
  if (event.key === "Enter" && event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
    return "\n";
  }

  return null;
}
