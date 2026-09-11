import { useEffect, useRef } from "react";
import { heightOf, longestOf, toneOf, tookText, type Tick } from "./ticks";
import "./Timeline.css";

/**
 * The session as a shape.
 *
 * One mark per command, as tall as the command was long, coloured by how it
 * ended. The four-minute build is the tall red one you can point at; the
 * hundred quick commands around it are the texture that makes it obvious.
 *
 * Only a terminal that knows exactly where commands start can draw this. One
 * that searched its own output for a prompt would be guessing at every
 * boundary, and a strip built on guesses is a strip that points at the wrong
 * line — which is worse than not having one.
 */
export function Timeline({
  ticks,
  onJump,
}: {
  ticks: readonly Tick[];
  /** Scroll the terminal to the line a command's prompt is on. */
  onJump: (line: number) => void;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const longest = longestOf(ticks);

  // Follow the session. Without this the strip fills up and then quietly
  // stops showing the command you just ran.
  useEffect(() => {
    const box = strip.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [ticks.length]);

  if (ticks.length === 0) return null;

  // A group of buttons rather than a list: every tick is something you press
  // to get somewhere, and `role="listitem"` on a button takes the button role
  // away — leaving a control that reads as text and gives no hint it is one.
  return (
    <div className="tline" ref={strip} role="group" aria-label="Commands in this session">
      {ticks.map((tick) => (
        <button
          key={tick.id}
          type="button"
          className="tline__tick"
          data-tone={toneOf(tick)}
          style={{ height: `${heightOf(tick.took, longest)}px` }}
          // The command and how long it took, which is everything the strip
          // is drawn from — said in words for anyone who cannot read a shape.
          title={`${tick.command} · ${tookText(tick.took)}${
            tick.code ? ` · exit ${tick.code}` : ""
          }`}
          aria-label={`${tick.command}, ${tookText(tick.took)}. Jump to it.`}
          onClick={() => onJump(tick.line)}
        />
      ))}
    </div>
  );
}
