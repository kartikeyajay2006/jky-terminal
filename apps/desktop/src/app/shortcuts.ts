/**
 * The keystrokes the app claims, defined once.
 *
 * This exists because of a real bug. xterm.js handles a key by calling its own
 * `cancel()`, which calls `stopPropagation()` — so `Ctrl+T` pressed while a
 * terminal had focus was swallowed by the terminal and never reached the
 * window listener that opens a tab. Every app shortcut was dead in the one
 * place people spend most of their time.
 *
 * The fix is `attachCustomKeyEventHandler`, which xterm consults *before* it
 * cancels anything: returning false there makes it leave the event alone, and
 * it propagates normally. That handler and the window listeners have to agree
 * on exactly which keys those are, so the list lives here rather than being
 * written out twice and drifting.
 */

/**
 * Does this keystroke belong to the app rather than to whatever has focus?
 *
 * Every one takes a modifier. That is not decoration — it is what lets a
 * terminal keep every unmodified key, which matters in a shell where every
 * keystroke means something.
 */
export function isAppShortcut(e: KeyboardEvent): boolean {
  const mod = e.ctrlKey || e.metaKey;
  if (!mod || e.altKey) return false;

  const key = e.key.toLowerCase();

  // Copy and paste, in the terminal convention: the shifted pair, because
  // unshifted Ctrl+C is interrupt and belongs to the shell.
  if (e.shiftKey) return key === "c" || key === "v";

  // The palette, tabs, and find.
  if (["k", "t", "w", "f", "tab"].includes(key)) return true;

  // Ctrl+1 through Ctrl+9 jump to a tab.
  return /^[1-9]$/.test(e.key);
}
