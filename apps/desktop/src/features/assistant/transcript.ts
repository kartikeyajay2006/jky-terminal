import type { ToolRan } from "../../platform";

const secrets = (n: number) => `${n} secret${n === 1 ? "" : "s"}`;

/** The line a tool leaves in the transcript once it has run. */
export function ranLine(ran: ToolRan): string {
  const failed = ran.is_error ? " (failed)" : "";
  const removed = ran.redacted ? ` · ${secrets(ran.redacted)} redacted before sending` : "";
  return `\n▸ ${ran.name} — ${ran.summary}${failed}${removed}\n`;
}

/**
 * Said at the top of the answer when your own message carried a secret.
 *
 * Rust replaced it before the request left; this is the receipt, so the
 * difference between what you typed and what the model saw is never hidden.
 */
export function redactedLine(count: number): string {
  const verb = count === 1 ? "was" : "were";
  return `▸ ${secrets(count)} in your message ${verb} replaced with a label before it was sent.\n\n`;
}
