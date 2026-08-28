import { useCallback, useEffect, useRef, useState } from "react";
import { useGameKeys } from "../engine/keys";
import { GameWindow, Panel } from "../GameChrome";
import { readTally, resetTally, writeTally, type Tally } from "../scores";
import {
  emptyBoard,
  indexForKey,
  judge,
  other,
  place,
  statusLine,
  type Board,
  type Mark,
} from "./ticTacToe";

/**
 * Tic tac toe, for two people at one keyboard.
 *
 * The only game of the four with no loop at all: nothing moves on its own, so
 * it is ordinary React state and ordinary buttons rather than a painted grid.
 * Using the grid engine here would buy nothing and cost the board its
 * clickability.
 */
export function TicTacToe() {
  const [board, setBoard] = useState<Board>(emptyBoard);
  const [turn, setTurn] = useState<Mark>("X");
  const [tally, setTally] = useState<Tally>(() => readTally());

  const outcome = judge(board);
  // The tally is banked once per finished game, not once per render.
  const banked = useRef(false);

  useEffect(() => {
    if (!outcome.over || banked.current) return;
    banked.current = true;
    setTally((prev) => {
      const next: Tally = {
        x: prev.x + (outcome.winner === "X" ? 1 : 0),
        o: prev.o + (outcome.winner === "O" ? 1 : 0),
        draws: prev.draws + (outcome.draw ? 1 : 0),
      };
      writeTally(next);
      return next;
    });
  }, [outcome.over, outcome.winner, outcome.draw]);

  const play = useCallback(
    (index: number) => {
      setBoard((current) => {
        const next = place(current, index, turn);
        if (next === null) return current;
        setTurn(other(turn));
        return next;
      });
    },
    [turn],
  );

  const newGame = useCallback(() => {
    setBoard(emptyBoard());
    // The loser of the last game goes first, which is how anyone playing
    // across a table would actually do it.
    setTurn(outcome.winner ? other(outcome.winner) : "X");
    banked.current = false;
  }, [outcome.winner]);

  const clearTally = useCallback(() => {
    setTally(resetTally());
  }, []);

  useGameKeys(true, (key) => {
    if (key === "Enter") {
      newGame();
      return;
    }
    const index = indexForKey(key);
    if (index !== null) play(index);
  });

  return (
    <GameWindow
      title="TIC TAC TOE"
      glyph="⨯○"
      hint="Press 1–9 to place · ENTER for a new game"
      right={<span className="ttt__tagline">Best of Luck, Think &amp; Win!</span>}
    >
      <div className="game-layout">
        <div className="game-side">
          <Panel title="How to play" tone="magenta">
            <p className="ttt__how">Enter position (1&ndash;9) to place your mark.</p>
            <div className="ttt__guide" aria-hidden="true">
              {Array.from({ length: 9 }, (_, i) => (
                <span key={i} className="ttt__guide-cell">
                  {i + 1}
                </span>
              ))}
            </div>
          </Panel>
        </div>

        <div className="ttt__middle">
          <p className="ttt__status" data-over={outcome.over || undefined} role="status">
            {statusLine(board, turn)}
          </p>

          {/* Rows are real elements rather than a flat list of nine buttons:
              a grid whose cells are not inside rows is malformed, and a
              screen reader announces it as an unstructured pile. They lay
              out with `display: contents`, so the three-column grid on the
              board itself still does the arranging. */}
          <div className="ttt__board" role="grid" aria-label="Tic tac toe board">
            {[0, 1, 2].map((row) => (
              <div key={row} className="ttt__row" role="row">
                {[0, 1, 2].map((col) => {
                  const i = row * 3 + col;
                  const cell = board[i];
                  return (
                    <button
                      key={i}
                      type="button"
                      role="gridcell"
                      className="ttt__cell"
                      data-mark={cell ?? undefined}
                      data-won={outcome.line.includes(i) || undefined}
                      disabled={cell !== null || outcome.over}
                      aria-label={
                        cell ? `Square ${i + 1}, ${cell}` : `Square ${i + 1}, empty`
                      }
                      onClick={() => play(i)}
                    >
                      {cell ?? ""}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          <div className="ttt__actions">
            <button type="button" className="btn btn--primary" onClick={newGame}>
              New game
            </button>
            <button type="button" className="btn" onClick={clearTally}>
              Reset scores
            </button>
          </div>
        </div>

        <div className="game-side">
          <Panel title="Score board" tone="warn">
            <p className="stat">
              <span className="stat__key">X WINS</span>
              <span className="stat__value">{tally.x}</span>
            </p>
            <p className="stat">
              <span className="stat__key">O WINS</span>
              <span className="stat__value">{tally.o}</span>
            </p>
            <p className="stat">
              <span className="stat__key">DRAWS</span>
              <span className="stat__value">{tally.draws}</span>
            </p>
            <pre className="ttt__trophy" aria-hidden="true">
              {"   ___   \n  |   |  \n  \\   /  \n   | |   \n  /___\\  "}
            </pre>
          </Panel>
        </div>
      </div>
    </GameWindow>
  );
}
