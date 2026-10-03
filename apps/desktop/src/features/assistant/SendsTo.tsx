import { findProvider } from "../../platform/catalogue";

interface Props {
  provider: string;
  /** Turns already in this conversation, all of which go with the message. */
  turns: number;
  memory: string;
}

/**
 * What pressing Send hands over, said before it happens.
 *
 * The whole conversation travels with every message, which surprises people
 * who think of a chat as a series of separate questions. Naming the provider,
 * the earlier turns and the saved context makes the outgoing request
 * something you can see rather than something you have to know.
 */
export function SendsTo({ provider, turns, memory }: Props) {
  const local = provider === "ollama";
  const name = findProvider(provider)?.displayName ?? provider;
  const earlier =
    turns === 0 ? "only this message" : `${turns} earlier turn${turns === 1 ? "" : "s"}`;

  return (
    <ul className="sends" aria-label="Sent with your message">
      <li className="sends__chip" data-local={local || undefined}>
        {local ? "Ollama · stays on this machine" : `to ${name}`}
      </li>
      <li className="sends__chip">{earlier}</li>
      {memory.trim() && <li className="sends__chip">project context</li>}
      <li
        className="sends__chip"
        title="Recognisable keys and tokens are replaced in Rust before anything leaves. A secret with no recognisable shape is not."
      >
        secrets redacted
      </li>
    </ul>
  );
}
