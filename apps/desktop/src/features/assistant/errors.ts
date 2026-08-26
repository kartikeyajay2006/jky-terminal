/**
 * Turn whatever a rejected promise carried into something worth showing.
 *
 * Tauri commands returning `Result<_, String>` reject with a plain string, not
 * an Error. Checking `instanceof Error` therefore discards the real message
 * from every backend failure and leaves the user with a generic one — which
 * is precisely the case where the detail matters most.
 */
export function describeError(cause: unknown): string {
  if (typeof cause === "string" && cause.trim()) return cause;
  if (cause instanceof Error && cause.message) return cause.message;

  // Some transports reject with an object carrying a message field.
  if (cause && typeof cause === "object") {
    const message = (cause as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
    try {
      return JSON.stringify(cause);
    } catch {
      /* fall through to the last resort */
    }
  }

  return "The request failed, and the backend gave no reason.";
}
