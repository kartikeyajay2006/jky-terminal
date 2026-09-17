import { useCallback, useRef, useState } from "react";
import { directionFor, isActionKey, useGameKeys } from "../engine/keys";
import { GameWindow, Panel, Readout } from "../GameChrome";
import { highScore, padScore, submitScore } from "../scores";
import { recordPlay } from "../stats";
import { initialState, move, start, type Direction, type Game2048 as State2048 } from "./rules";

function tier(value: number): number {
  return value === 0 ? 0 : Math.min(11, Math.log2(value));
}

/** A keyboard-first 2048 board, with no timer and therefore no background loop. */
export function Game2048() {
  const random = useRef(() => Math.random());
  const state = useRef<State2048>(initialState(random.current));
  const banked = useRef(false);
  const [shown, setShown] = useState(state.current);
  const [best, setBest] = useState(() => highScore("2048"));
  const [beatRecord, setBeatRecord] = useState(false);

  const begin = useCallback(() => {
    banked.current = false;
    setBeatRecord(false);
    state.current = start(random.current);
    setShown(state.current);
  }, []);

  const play = useCallback((direction: Direction) => {
    const next = move(state.current, direction, random.current);
    if (next === state.current) return;
    state.current = next;
    setShown(next);

    if ((next.phase === "won" || next.phase === "over") && !banked.current) {
      banked.current = true;
      const previous = highScore("2048");
      setBest(submitScore("2048", next.score));
      recordPlay("2048", next.score);
      setBeatRecord(next.score > previous && next.score > 0);
    }
  }, []);

  useGameKeys(true, (key) => {
    if (isActionKey(key)) {
      begin();
      return;
    }
    const direction = directionFor(key);
    if (direction) play(direction);
  });

  const complete = shown.phase === "won" || shown.phase === "over";
  const status =
    shown.phase === "ready"
      ? "PRESS SPACE TO START"
      : shown.phase === "won"
        ? "2048 — YOU WIN"
        : shown.phase === "over"
          ? "NO MOVES LEFT"
          : "ARROW KEYS / WASD";

  return (
    <GameWindow
      title="2048"
      glyph="▣"
      hint="Arrow keys or WASD · SPACE starts a fresh board"
      right={
        <span className="gw__scores">
          <Readout label="SCORE" value={padScore(shown.score, 5)} tone="violet" />
          <Readout label="HI-SCORE" value={padScore(best, 5)} tone="warn" />
        </span>
      }
    >
      <div className="game-layout game-layout--stacked">
        <div className="g2048" role="grid" aria-label="2048 board">
          {shown.board.map((row, y) => (
            <div className="g2048__row" role="row" key={y}>
              {row.map((value, x) => (
                <span
                  className="g2048__tile"
                  data-tier={tier(value)}
                  role="gridcell"
                  aria-label={value === 0 ? "empty" : String(value)}
                  key={`${x}-${y}`}
                >
                  {value || ""}
                </span>
              ))}
            </div>
          ))}
        </div>

        <div className="game-strip g2048__strip">
          <Panel title="Round" tone="violet">
            <p className="stat"><span className="stat__key">MOVES</span><span className="stat__value">{shown.moves}</span></p>
            <p className="stat"><span className="stat__key">MAX TILE</span><span className="stat__value">{Math.max(...shown.board.flat()) || "—"}</span></p>
          </Panel>
          <p className="game-tip" data-cheer={beatRecord || undefined}>
            {beatRecord ? "★ NEW HIGH SCORE — BANKED LOCALLY ★" : status}
          </p>
          {complete && (
            <button type="button" className="btn btn--primary" onClick={begin}>
              New board
            </button>
          )}
        </div>
      </div>
    </GameWindow>
  );
}
