import { useId, useState } from "react";
import type { CommandExplanation, ToolRequest } from "../../platform";
import { copyText } from "../terminal/clipboard";

interface ToolCardProps {
  request: ToolRequest;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}

export function ToolCard({ request, onApprove, onReject }: ToolCardProps) {
  const confirmId = useId();
  const [typed, setTyped] = useState("");
  // Older persisted approval cards predate risk labels. They remain fully
  // gated and get the conservative label rather than rendering a blank tag.
  const risk = request.risk ?? (request.destructive ? "destructive" : "runs locally");

  // A destructive command needs more than a click. Retyping it is the
  // cheapest friction that still requires reading what you are agreeing to.
  const ready = !request.destructive || typed.trim() === request.command.trim();

  return (
    <div className="tool" data-destructive={request.destructive}>
      <div className="tool__head">
        <span className="tool__name">{request.name}</span>
        <span className="tool__warn" data-risk={risk}>{risk}</span>
      </div>

      <pre className="tool__cmd">{request.command}</pre>
      <p className="tool__scope">
        This exact command runs only after approval. Review its risk label and reason before deciding.
      </p>
      {request.reason && <p className="tool__why">{request.reason}</p>}
      {request.explanation && <Explained explanation={request.explanation} />}

      {request.destructive && (
        <div className="field">
          <label className="field__label" htmlFor={confirmId}>
            Type the command to confirm
          </label>
          <input
            id={confirmId}
            className="input"
            value={typed}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => setTyped(e.target.value)}
          />
        </div>
      )}

      <div className="tool__actions">
        <button
          type="button"
          className="btn btn--primary"
          disabled={!ready}
          onClick={() => onApprove(request.id)}
        >
          Run
        </button>
        <button type="button" className="btn btn--danger" onClick={() => onReject(request.id)}>
          Don&apos;t run
        </button>
      </div>
    </div>
  );
}

/**
 * What Rust read in the command, laid out for the person deciding.
 *
 * Every line here is a reason to look closer, never a reason to relax: the
 * command needs approval whatever this says, and the footnote says so.
 */
function Explained({ explanation }: { explanation: CommandExplanation }) {
  const { effects, hosts, paths, dry_run: dryRun, unrecognised } = explanation;
  const [copied, setCopied] = useState(false);
  const empty = effects.length === 0 && hosts.length === 0 && paths.length === 0 && unrecognised.length === 0;

  return (
    <div className="tool__explain">
      {effects.length > 0 && (
        <ul className="tool__effects" aria-label="What this would do">
          {effects.map((effect) => (
            <li key={`${effect.kind}:${effect.text}`} data-kind={effect.kind}>
              <span className="tool__kind">{effect.kind}</span>
              {effect.text}
            </li>
          ))}
        </ul>
      )}
      {empty && <p className="tool__note">Nothing in it deletes, writes, installs or reaches the network that JKY recognises.</p>}
      {hosts.length > 0 && (
        <p className="tool__note">
          <b>Reaches</b> {hosts.map((h, i) => <code key={h}>{i > 0 ? ", " : ""}{h}</code>)}
        </p>
      )}
      {paths.length > 0 && (
        <p className="tool__note">
          <b>Touches</b> {paths.map((p, i) => <code key={p}>{i > 0 ? ", " : ""}{p}</code>)}
        </p>
      )}
      {unrecognised.length > 0 && (
        <p className="tool__note tool__note--unknown">
          JKY does not recognise <code>{unrecognised.join(", ")}</code> — it could do anything you can.
        </p>
      )}
      {dryRun && (
        <div className="tool__preview">
          <span>Preview first</span>
          <code>{dryRun}</code>
          <button
            type="button"
            className="btn"
            aria-label="Copy the preview command"
            onClick={() => void copyText(dryRun).then(setCopied)}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}
      <p className="tool__scope">An explanation, not a guarantee: read the command itself before you decide.</p>
    </div>
  );
}
