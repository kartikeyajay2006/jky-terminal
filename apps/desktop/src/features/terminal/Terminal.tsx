import { useRef } from "react";
import { useXterm } from "./useXterm";
import "@xterm/xterm/css/xterm.css";
import "./Terminal.css";

interface TerminalProps {
  tabId: string;
}

export function Terminal({ tabId }: TerminalProps) {
  const container = useRef<HTMLDivElement>(null);
  useXterm(container);

  return (
    <div
      className="term"
      role="application"
      aria-label="Terminal"
      data-tab-id={tabId}
      ref={container}
    />
  );
}
