import { actionFor } from "./keymapStore";

/**
 * The keystrokes the app claims, decided in one place.
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
 * on exactly which keys those are — which is now automatic, because both ask
 * the keymap the same question.
 */

/**
 * Does this keystroke belong to the app rather than to whatever has focus?
 *
 * Every binding takes a modifier, which is what lets a terminal keep every
 * unmodified key. That is enforced in `jky-keys` when a binding is made, so
 * a chord that reaches here has already passed it.
 */
export function isAppShortcut(e: KeyboardEvent): boolean {
  if (actionFor(e)) return true;

  // Ctrl/Cmd+1..9 jumps to a tab. Outside the keymap — see the note in
  // `useShortcuts` — so it has to be named here too or xterm eats it.
  return (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && /^[1-9]$/.test(e.key);
}
