import { useCallback, useEffect, useRef, useState } from "react";
import { Grid } from "../engine/grid";
import { drainSteps, useGameLoop } from "../engine/loop";
import { directionFor, isActionKey, useGameKeys } from "../engine/keys";
import { Particles } from "../engine/particles";
import { BIG_ROWS, bigWord, countdownDone, countdownPulse, countdownWord } from "../engine/countdown";
import { GameScreen, type GameScreenHandle } from "../GameScreen";
import { GameWindow, Meter, Panel, Readout } from "../GameChrome";
import { highScore, padScore, submitScore } from "../scores";
import { recordPlay } from "../stats";
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
  const bits = useRef(new Particles());
  const banked = useRef(false);
  /** Milliseconds into the pre-run countdown, or null when not counting. */
  const counting = useRef<number | null>(null);
  /** The score last frame, so eating can be celebrated exactly once. */
  const lastScore = useRef(0);

  const [phase, setPhase] = useState(state.current.phase);
  const [beatRecord, setBeatRecord] = useState(false);
  /** Mirrors the countdown ref, purely so a change restarts the loop. */
  const [counted, setCounted] = useState(false);
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

    bits.current.draw(g);

    const count = counting.current;
    if (count !== null) {
      const word = countdownWord(count);
      if (word) {
        const art = bigWord(word);
        const paint = word === "GO" ? "mint" : "accent";
        const width = Math.max(...art.map((r) => r.length));
        const left = Math.floor((COLS + PAD_X * 2 - width) / 2);
        const top = Math.round(ROWS / 2) - Math.floor(BIG_ROWS / 2);
        // Cleared behind the digits, or they read as terrain rather than as
        // a countdown — which is exactly what a one-character "3" did.
        for (let r = -1; r <= BIG_ROWS; r += 1) {
          g.hLine(left - 5, top + r, width + 10, " ", "bg");
        }
        art.forEach((row, r) => g.text(left, top + r, row, paint));
        // A tick under it that shortens, so the wait is visible rather than
        // only being three numbers that change.
        const remaining = countdownPulse(count);
        g.hLine(left, top + BIG_ROWS + 1, Math.round(width * remaining), "▬", "dim");
      }
    } else if (s.phase === "ready") {
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
      if (beatRecord) g.banner(ROWS / 2 + 4, "★  NEW RECORD  ★", "warn");
      g.banner(ROWS / 2 + 5, "SPACE to play again", "dim");
    }

    screen.current?.draw(g);
  }, [beatRecord]);

  useGameLoop(phase === "running" || counted, (dt) => {
    const s = state.current;

    // The countdown runs its own clock but not the snake.
    if (counting.current !== null) {
      counting.current += dt;
      bits.current.step(dt);
      if (countdownDone(counting.current)) {
        counting.current = null;
        setCounted(false);
        s.phase = "running";
        setPhase("running");
      }
      paint();
      return;
    }

    accumulator.current += dt;
    bits.current.step(dt);
    const wasAlive = s.phase === "running";

    // A snake moves in whole cells on a fixed tick while the screen redraws
    // at whatever rate it likes, so the two are drained apart.
    const { steps, rest } = drainSteps(accumulator.current, s.intervalMs);
    accumulator.current = rest;
    for (let i = 0; i < steps && s.phase === "running"; i += 1) {
      tick(s, rand.current);
    }

    // Ate an apple: a burst where it was.
    if (s.score > lastScore.current) {
      const head = s.body[0];
      bits.current.burst(head.x + PAD_X, head.y + PAD_Y, rand.current, "danger", 10, 18);
      screen.current?.flash("mint");
      lastScore.current = s.score;
    }

    // Ran into something.
    if (wasAlive && s.phase === "over") {
      const head = s.body[0];
      bits.current.burst(head.x + PAD_X, head.y + PAD_Y, rand.current, "danger", 16, 26);
      screen.current?.shake("big");
      screen.current?.flash("danger");
    }

    paint();

    if (s.score !== score) setScore(s.score);
    if (s.body.length !== length) setLength(s.body.length);
    if (s.intervalMs !== interval) setIntervalMs(s.intervalMs);

    if (s.phase === "over" && !banked.current) {
      banked.current = true;
      const previous = highScore("snake");
      setBest(submitScore("snake", s.score));
      recordPlay("snake", s.score);
      if (s.score > previous && s.score > 0) {
        setBeatRecord(true);
        screen.current?.flash("warn");
      }
      setPhase("over");
    }
  });

  const begin = useCallback(() => {
    state.current = start(rand.current);
    // Held at ready while the countdown runs, so nothing moves until GO.
    state.current.phase = "ready";
    accumulator.current = 0;
    bits.current.clear();
    banked.current = false;
    counting.current = 0;
    lastScore.current = 0;
    setBeatRecord(false);
    setCounted(true);
    setScore(0);
    setLength(state.current.body.length);
    setIntervalMs(state.current.intervalMs);
    setPhase("ready");
    paint();
  }, [paint]);

  useGameKeys(true, (key) => {
    const s = state.current;

    if (isActionKey(key)) {
      if (counting.current !== null) return;
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

      <p className="game-tip" data-cheer={beatRecord || undefined}>
        {beatRecord
          ? "★ NEW RECORD — LONGEST YET ★"
          : "Eat food, grow longer, beat your high score!"}
      </p>
    </GameWindow>
  );
}
