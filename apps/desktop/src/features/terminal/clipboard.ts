/**
 * Copy and paste for a terminal.
 *
 * Both are best-effort by necessity. A webview may refuse clipboard access
 * outright depending on focus, permission state and platform, and a terminal
 * that throws an unhandled rejection because a copy was denied is worse than
 * one that quietly does nothing. Every path here reports success rather than
 * raising, so a caller can say "copied" only when it actually was.
 */

/**
 * Put text on the clipboard.
 *
 * The async API is tried first and the old `execCommand` path is kept as a
 * fallback: the modern one requires a secure context and a permission that a
 * webview does not always grant, and losing copy in a terminal over that
 * would be a genuine regression.
 */
export async function copyText(text: string): Promise<boolean> {
  if (!text) return false;

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the older path rather than giving up.
  }

  return copyByExecCommand(text);
}

/**
 * The pre-Clipboard-API way: a hidden textarea, selected, copied, removed.
 *
 * Deprecated and still the only thing that works in some webviews.
 */
function copyByExecCommand(text: string): boolean {
  const holder = document.createElement("textarea");
  holder.value = text;
  // Kept out of view without `display: none`, which would make it
  // unselectable and so uncopyable.
  holder.setAttribute("readonly", "");
  holder.style.position = "fixed";
  holder.style.top = "-1000px";
  holder.style.opacity = "0";

  try {
    document.body.appendChild(holder);
    holder.select();
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    // In a finally, because a throw between appending and copying would
    // otherwise leave an invisible textarea in the document forever — once
    // per failed copy.
    holder.remove();
  }
}

/**
 * Read the clipboard, or null when the webview will not allow it.
 *
 * There is no fallback here on purpose: `execCommand("paste")` has never
 * worked outside a real paste event, and pretending otherwise would mean a
 * menu item that silently does nothing on some platforms.
 */
export async function readText(): Promise<string | null> {
  try {
    if (!navigator.clipboard?.readText) return null;
    const text = await navigator.clipboard.readText();
    return text || null;
  } catch {
    return null;
  }
}
