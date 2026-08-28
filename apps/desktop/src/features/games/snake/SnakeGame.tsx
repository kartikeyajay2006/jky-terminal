import { useCallback, useEffect, useRef, useState } from "react";
import { Grid } from "../engine/grid";
import { drainSteps, useGameLoop } from "../engine/loop";
import { directionFor, isActionKey, useGameKeys } from "../engine/keys";
import { GameScreen, type GameScreenHandle } from "../GameScreen";
import { GameWindow, Meter, Panel, Readout } from "../GameChrome";
import { highScore, padScore, submitScore } from "../scores";
import {
  COLS,
  ROWS,
  initialState,
  makeRandom,
  speedFraction,
  speedLabel,
  start,
  tick,
  turn,
  type SnakeState,
} from "./rules";

/** The board is drawn inside a border, so the grid is two cells bigger. */
const PAD_X = 1;
const PAD_Y = 1;

export function SnakeGame() {
  const screen = useRef<GameScreenHandle>(null);
  const grid = useRef(new Grid(COLS + PAD_X * 2, ROWS + PAD_Y * 2));
  const rand = useRef(makeRandom(Date.now() & 0xffff));
  const state = useRef<SnakeState>(initialState(rand.current));
  const accumulator = useRef(0);
  const banked = useRef(false);

  const [phase, setPhase] = useState(state.current.phase);
  const [score, setScore] = useState(0);
  const [length, setLength] = useState(state.current.body.length);
  const [interval, setIntervalMs] = useState(state.current.intervalMs);
  const [best, setBest] = useState(() => highScore("snake"));

  const paint = useCallback(() => {
    const s = state.current;
    const g = grid.current;
    g.clear(" ", "bg");

    // The playing field, in a dashed border the way the reference draws it.
    g.box(0, 0, COLS + 2, ROWS + 2, "mint");

    // A faint dot lattice, so the board reads as a grid rather than a void
    // and the snake's position is legible without counting.
    for (let y = 0; y < ROWS; y += 1) {
      for (let x = 0; x < COLS; x += 1) {
        if ((x + y) % 4 === 0) g.set(x + PAD_X, y + PAD_Y, "·", "dim");
      }
    }

    // Food, with a little stalk.
    g.set(s.food.x + PAD_X, s.food.y + PAD_Y, "◆", "danger");

    // The snake: a brighter head, so which way it is going is never in doubt.
    for (let i = s.body.length - 1; i >= 0; i -= 1) {
      const p = s.body[i];
      g.set(
        p.x + PAD_X,
        p.y + PAD_Y,
        i === 0 ? "█" : "▓",
        i === 0 ? "accent" : "mint",
      );
    }

    if (s.phase === "ready") {
      g.banner(ROWS / 2 - 1, "╔════════════════════════╗", "accent");
      g.banner(ROWS / 2, "║   S N A K E   G A M E  ║", "accent");
      g.banner(ROWS / 2 + 1, "╚════════════════════════╝", "accent");
      g.banner(ROWS / 2 + 3, "PRESS SPACE TO PLAY", "text");
    } else if (s.phase === "paused") {
      g.banner(ROWS / 2, "── P A U S E D ──", "warn");
      g.banner(ROWS / 2 + 2, "SPACE to resume", "dim");
    } else if (s.phase === "over") {
      g.banner(ROWS / 2 - 1, "╔════════════════════════╗", "danger");
      g.banner(ROWS / 2, "║     G A M E  O V E R   ║", "danger");
      g.banner(ROWS / 2 + 1, "╚════════════════════════╝", "danger");
      g.banner(ROWS / 2 + 3, `LENGTH ${s.body.length} · SCORE ${s.score}`, "text");
      g.banner(ROWS / 2 + 4, "SPACE to play again", "dim");
    }

    screen.current?.draw(g);
  }, []);

  useGameLoop(phase === "running", (dt) => {
    const s = state.current;
    accumulator.current += dt;

    // A snake moves in whole cells on a fixed tick while the screen redraws
    // at whatever rate it likes, so the two are drained apart.
    const { steps, rest } = drainSteps(accumulator.current, s.intervalMs);
    accumulator.current = rest;
    for (let i = 0; i < steps && s.phase === "running"; i += 1) {
      tick(s, rand.current);
    }

    paint();

    if (s.score !== score) setScore(s.score);
    if (s.body.length !== length) setLength(s.body.length);
    if (s.intervalMs !== interval) setIntervalMs(s.intervalMs);

    if (s.phase === "over" && !banked.current) {
      banked.current = true;
      setBest(submitScore("snake", s.score));
      setPhase("over");
    }
  });

  const begin = useCallback(() => {
    state.current = start(rand.current);
    accumulator.current = 0;
    banked.current = false;
    setScore(0);
    setLength(state.current.body.length);
    setIntervalMs(state.current.intervalMs);
    setPhase("running");
    paint();
  }, [paint]);

  useGameKeys(true, (key) => {
    const s = state.current;

    if (isActionKey(key)) {
      if (s.phase === "running") {
        s.phase = "paused";
        setPhase("paused");
        paint();
      } else if (s.phase === "paused") {
        s.phase = "running";
        setPhase("running");
      } else {
        begin();
      }
      return;
    }

    const dir = directionFor(key);
    if (dir) turn(s, dir);
  });

  useEffect(() => {
    paint();
  }, [paint, phase]);

  return (
    <GameWindow
      title="SNAKE GAME"
      glyph="🐍"
      hint="Arrow keys or WASD · SPACE to pause"
      right={
        <span className="gw__scores">
          <Readout label="SCORE" value={padScore(score, 4)} tone="mint" />
          <Readout label="HI-SCORE" value={padScore(best, 4)} tone="warn" />
        </span>
      }
    >
      <div className="game-layout">
        <div className="game-side">
          <Panel title="Stats" tone="mint">
            <p className="stat">
              <span className="stat__key">SCORE</span>
              <span className="stat__value">{padScore(score, 4)}</span>
            </p>
            <p className="stat">
              <span className="stat__key">HIGH SCORE</span>
              <span className="stat__value">{padScore(best, 4)}</span>
            </p>
            <p className="stat">
              <span className="stat__key">LENGTH</span>
              <span className="stat__value">{length}</span>
            </p>
            <p className="stat">
              <span className="stat__key">SPEED</span>
              <span className="stat__value">{speedLabel(interval)}</span>
            </p>
            <Meter fraction={speedFraction(interval)} />
          </Panel>
        </div>

        <GameScreen ref={screen} label="Snake playfield" />

        <div className="game-side">
          <Panel title="Controls" tone="accent">
            <ul className="keys">
              <li>
                <kbd>↑</kbd> Up
              </li>
              <li>
                <kbd>↓</kbd> Down
              </li>
              <li>
                <kbd>←</kbd> Left
              </li>
              <li>
                <kbd>→</kbd> Right
              </li>
              <li>
                <kbd>SPC</kbd> Pause
              </li>
            </ul>
          </Panel>
        </div>
      </div>

      <p className="game-tip">Eat food, grow longer, beat your high score!</p>
    </GameWindow>
  );
}
