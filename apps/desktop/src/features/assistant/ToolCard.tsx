import { useId, useState } from "react";
import type { ToolRequest } from "../../platform";

interface ToolCardProps {
  request: ToolRequest;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}

export function ToolCard({ request, onApprove, onReject }: ToolCardProps) {
  const confirmId = useId();
  const [typed, setTyped] = useState("");

  // A destructive command needs more than a click. Retyping it is the
  // cheapest friction that still requires reading what you are agreeing to.
  const ready = !request.destructive || typed.trim() === request.command.trim();

  return (
    <div className="tool" data-destructive={request.destructive}>
      <div className="tool__head">
        <span className="tool__name">{request.name}</span>
        {request.destructive && <span className="tool__warn">destructive</span>}
      </div>

      <pre className="tool__cmd">{request.command}</pre>
      {request.reason && <p className="tool__why">{request.reason}</p>}

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
