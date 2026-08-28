import { useCallback, useEffect, useRef, useState } from "react";
import { Grid } from "../engine/grid";
import { useGameLoop } from "../engine/loop";
import { isActionKey, useGameKeys } from "../engine/keys";
import { GameScreen, type GameScreenHandle } from "../GameScreen";
import { GameWindow, Panel, Readout } from "../GameChrome";
import { highScore, padScore, submitScore } from "../scores";
import {
  BIRD_X,
  COLS,
  GROUND_Y,
  PIPE_W,
  ROWS,
  flap,
  initialState,
  makeRandom,
  start,
  step,
  type FlappyState,
} from "./flappyGame";

/** Wing up and wing down, so the bird animates while it climbs. */
const BIRD_UP = ["▄██▖", "▝██▘"];
const BIRD_DOWN = ["▗██▖", "▄██▀"];
const BIRD_DEAD = ["▗xx▖", "▀██▄"];

export function FlappyBird() {
  const screen = useRef<GameScreenHandle>(null);
  const grid = useRef(new Grid(COLS, ROWS));
  const rand = useRef(makeRandom(Date.now() & 0xffff));
  const state = useRef<FlappyState>(initialState(rand.current));
  const banked = useRef(false);

  const [phase, setPhase] = useState(state.current.phase);
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(() => highScore("flappy"));

  const paint = useCallback(() => {
    const s = state.current;
    const g = grid.current;
    g.clear(" ", "bg");

    // --- stars, high and faint ---
    for (let i = 0; i < 18; i += 1) {
      const x = (i * 43 - Math.floor(s.elapsed * 2)) % COLS;
      g.set(x < 0 ? x + COLS : x, (i * 5) % 4, "·", "dim");
    }

    // --- clouds ---
    for (const c of s.clouds) {
      g.sprite(Math.round(c.x), c.y, ["  ▁▁▁ ", " ▄████"], "accentDim");
    }

    // --- the skyline, with lit windows ---
    for (const b of s.buildings) {
      const x = Math.round(b.x);
      const top = GROUND_Y - b.h;
      for (let row = 0; row < b.h; row += 1) {
        g.hLine(x, top + row, b.w, "▒", "dim");
      }
      // Windows on a fixed lattice keyed to the building's own position, so
      // they stay put as the city scrolls rather than twinkling randomly.
      for (let wy = top + 1; wy < GROUND_Y - 1; wy += 2) {
        for (let wx = x + 1; wx < x + b.w - 1; wx += 2) {
          if ((wx * 7 + wy * 13 + b.w) % 5 < 2) g.set(wx, wy, "▪", "warn");
        }
      }
    }

    // --- pipes ---
    for (const p of s.pipes) {
      const x = Math.round(p.x);
      const gapEnd = p.gapTop + p.gapHeight;

      for (let y = 1; y < p.gapTop; y += 1) g.hLine(x, y, PIPE_W, "█", "mint");
      for (let y = gapEnd; y < GROUND_Y; y += 1) g.hLine(x, y, PIPE_W, "█", "mint");

      // Lips, one cell wider than the shaft, which is what makes a pipe read
      // as a pipe rather than as a green column.
      if (p.gapTop >= 1) {
        g.hLine(x - 1, p.gapTop - 1, PIPE_W + 2, "█", "accent");
      }
      if (gapEnd < GROUND_Y) {
        g.hLine(x - 1, gapEnd, PIPE_W + 2, "█", "accent");
      }
    }

    // --- ground ---
    g.hLine(0, GROUND_Y, COLS, "▀", "mint");
    for (let y = GROUND_Y + 1; y < ROWS; y += 1) {
      for (let x = 0; x < COLS; x += 1) {
        const world = Math.floor(x + s.elapsed * s.speed);
        g.set(x, y, world % 4 === 0 ? "╱" : "░", "dim");
      }
    }

    // --- the bird ---
    const climbing = s.vy < 0;
    const sprite = s.phase === "over" ? BIRD_DEAD : climbing ? BIRD_UP : BIRD_DOWN;
    g.sprite(BIRD_X, Math.round(s.y), sprite, s.phase === "over" ? "danger" : "warn");

    // A little motion trail, so speed is visible even against a plain sky.
    if (s.phase === "running") {
      for (let i = 1; i <= 4; i += 1) {
        g.set(BIRD_X - i * 2, Math.round(s.y) + 1, "·", "dim");
      }
    }

    // --- the score, large, over the sky ---
    if (s.phase === "running") {
      g.centre(2, padScore(s.score, 4), "text");
    }

    if (s.phase === "ready") {
      g.banner(9, "╔═══════════════════════════╗", "accent");
      g.banner(10, "║    F L A P P Y   B I R D  ║", "accent");
      g.banner(11, "╚═══════════════════════════╝", "accent");
      g.banner(13, "PRESS SPACE TO FLY", "text");
      g.banner(15, "SPACE flaps · mind the pipes", "dim");
    } else if (s.phase === "over") {
      g.banner(9, "╔═══════════════════════════╗", "danger");
      g.banner(10, "║      G A M E  O V E R     ║", "danger");
      g.banner(11, "╚═══════════════════════════╝", "danger");
      g.banner(13, `YOU CLEARED ${s.score} PIPES`, "text");
      g.banner(15, "PRESS SPACE TO FLY AGAIN", "dim");
    }

    screen.current?.draw(g);
  }, []);

  useGameLoop(phase === "running", (dt) => {
    const s = state.current;
    step(s, dt, rand.current);
    paint();

    if (s.score !== score) setScore(s.score);

    if (s.phase === "over" && !banked.current) {
      banked.current = true;
      setBest(submitScore("flappy", s.score));
      setPhase("over");
    }
  });

  const begin = useCallback(() => {
    state.current = start(state.current);
    banked.current = false;
    setScore(0);
    setPhase("running");
    paint();
  }, [paint]);

  useGameKeys(true, (key) => {
    const s = state.current;
    if (isActionKey(key) || key === "ArrowUp" || key === "w" || key === "W") {
      if (s.phase === "running") flap(s);
      else begin();
    }
  });

  useEffect(() => {
    paint();
  }, [paint, phase]);

  return (
    <GameWindow
      title="FLAPPY BIRD"
      glyph="🐦"
      hint="SPACE to flap"
      right={
        <span className="gw__scores">
          <Readout label="SCORE" value={padScore(score, 4)} tone="warn" />
          <Readout label="HI-SCORE" value={padScore(best, 4)} tone="mint" />
        </span>
      }
    >
      <div className="game-layout game-layout--stacked">
        <GameScreen ref={screen} label="Flappy Bird playfield" />

        <div className="game-strip">
          <Panel title="Flight" tone="warn">
            <p className="stat">
              <span className="stat__key">PIPES</span>
              <span className="stat__value">{padScore(score, 4)}</span>
            </p>
          </Panel>

          <p className="game-tip">
            {phase === "running"
              ? "AVOID THE PIPES AND FLY AS FAR AS YOU CAN!"
              : "PRESS SPACE TO TAKE OFF"}
          </p>

          <Panel title="Best" tone="mint">
            <p className="stat">
              <span className="stat__key">HI-SCORE</span>
              <span className="stat__value">{padScore(best, 4)}</span>
            </p>
          </Panel>
        </div>
      </div>
    </GameWindow>
  );
}
