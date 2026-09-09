/**
 * Putting a command on a terminal's prompt from somewhere else in the app.
 *
 * A window event rather than a store, because the sender and the receiver
 * have nothing else in common: the History section knows a pane id and a
 * string, and the terminal that owns that pane is mounted somewhere it cannot
 * reach. A store would mean a piece of shared state that is written, read
 * once and immediately meaningless — which is a message, not state.
 *
 * The name is namespaced because this is dispatched on `window`, which
 * belongs to everything.
 */
export const TYPE_EVENT = "jky:type";

export interface TypeRequest {
  /** Which terminal. Ignored by every other one. */
  pane: string;
  /** Typed, not run. No newline is sent. */
  text: string;
}

export function requestType(request: TypeRequest): void {
  window.dispatchEvent(new CustomEvent<TypeRequest>(TYPE_EVENT, { detail: request }));
}
