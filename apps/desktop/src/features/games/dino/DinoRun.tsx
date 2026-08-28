import { useCallback, useEffect, useRef, useState } from "react";
import { Grid } from "../engine/grid";
import { useGameLoop } from "../engine/loop";
import { isActionKey, useGameKeys } from "../engine/keys";
import { Particles } from "../engine/particles";
import { BIG_ROWS, bigWord, countdownDone, countdownPulse, countdownWord } from "../engine/countdown";
import { GameScreen, type GameScreenHandle } from "../GameScreen";
import { GameWindow, Panel, Readout } from "../GameChrome";
import { highScore, padScore, submitScore } from "../scores";
import { recordPlay } from "../stats";
import {
  COLS,
  DINO_X,
  GROUND_Y,
  ROWS,
  airborne,
  dinoHeight,
  initialState,
  jump,
  makeRandom,
  setDucking,
  start,
  step,
  type DinoState,
} from "./rules";

/** The dino, mid-stride. Two frames, so the legs move as it runs. */
const DINO_A = [
  "    ▄███▄",
  "    █▀█▀█",
  "▄▄▄██████",
  "███████▀ ",
  " ▀█  ▀█  ",
];
const DINO_B = [
  "    ▄███▄",
  "    █▀█▀█",
  "▄▄▄██████",
  "███████▀ ",
  "  █▄  █▄ ",
];
const DINO_DUCK = ["         ", "         ", "▄▄▄██████", "█████████", " ▀█   ▀█ "];
const DINO_DEAD = [
  "    ▄███▄",
  "    █x█x█",
  "▄▄▄██████",
  "███████▀ ",
  " ▀█  ▀█  ",
];

const MOON = ["▄▀▀▄", "█  █", "▀▄▄▀"];

export function DinoRun() {
  const screen = useRef<GameScreenHandle>(null);
  const grid = useRef(new Grid(COLS, ROWS));
  const state = useRef<DinoState>(initialState());
  const rand = useRef(makeRandom(Date.now() & 0xffff));
  const bits = useRef(new Particles());
  const banked = useRef(false);
  /** Milliseconds into the pre-run countdown, or null when not counting. */
  const counting = useRef<number | null>(null);
  /** Lives at the last frame, so a fresh hit can be spotted and reacted to. */
  const lastLives = useRef(state.current.lives);
  /** Was the dino in the air last frame, for the landing puff. */
  const wasAirborne = useRef(false);

  const [phase, setPhase] = useState(state.current.phase);
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(state.current.lives);
  const [speed, setSpeed] = useState(state.current.speed);
  const [best, setBest] = useState(() => highScore("dino"));
  const [beatRecord, setBeatRecord] = useState(false);
  const [paused, setPaused] = useState(false);
  /** Mirrors the countdown ref, purely so a change restarts the loop. */
  const [counted, setCounted] = useState(false);

  const paint = useCallback(() => {
    const s = state.current;
    const g = grid.current;
    g.clear(" ", "bg");

    // --- sky: stars, moon, mountains, clouds ---
    // Stars are placed from the distance travelled rather than stored, so
    // they scroll with the world without needing a list of their own.
    for (let i = 0; i < 26; i += 1) {
      const x = (i * 37 - Math.floor(s.distance * 0.06)) % COLS;
      const y = (i * 7) % 7;
      g.set(x < 0 ? x + COLS : x, y, i % 3 === 0 ? "·" : "˙", "dim");
    }

    const moonX = COLS - 14 - Math.floor((s.distance * 0.04) % (COLS + 20));
    g.sprite(moonX, 1, MOON, "muted");

    // A ridge line drawn from a cheap sum of sines: enough variation that it
    // does not read as a repeating pattern at this width.
    for (let x = 0; x < COLS; x += 1) {
      const world = x + s.distance * 0.12;
      const h = 3 + Math.sin(world * 0.09) * 2 + Math.sin(world * 0.031) * 2.2;
      const top = Math.round(GROUND_Y - 6 - h);
      g.set(x, top, "▀", "dim");
    }

    for (const cloud of s.clouds) {
      g.sprite(Math.round(cloud.x), cloud.y, ["  ▁▁▁  ", "▄█████▄"], "accentDim");
    }

    // --- ground ---
    g.hLine(0, GROUND_Y, COLS, "─", "muted");
    for (let x = 0; x < COLS; x += 1) {
      const world = Math.floor(x + s.distance);
      if (world % 11 === 0) g.set(x, GROUND_Y + 1, "▪", "dim");
      if (world % 17 === 0) g.set(x, GROUND_Y + 1, "·", "dim");
    }

    // --- cacti ---
    for (const c of s.cacti) {
      const x = Math.round(c.x);
      for (let row = 0; row < c.h; row += 1) {
        const y = GROUND_Y - 1 - row;
        g.hLine(x, y, c.w, "█", "mint");
        // Arms on the taller cacti, so they are not just green rectangles.
        if (c.w >= 5 && row === Math.floor(c.h / 2)) {
          g.set(x - 1, y, "╱", "mint");
          g.set(x + c.w, y, "╲", "mint");
        }
      }
    }

    bits.current.draw(g);

    // --- the dino ---
    const h = dinoHeight(s);
    const top = GROUND_Y - h - Math.round(s.y);
    const striding = Math.floor(s.frame / 3) % 2 === 0;
    const sprite =
      s.phase === "over" ? DINO_DEAD
      : s.ducking ? DINO_DUCK
      : airborne(s) ? DINO_A
      : striding ? DINO_A
      : DINO_B;

    // Flicker while the grace period runs, so a hit is visible rather than
    // only being a number changing in the corner.
    const hidden = s.invulnerableMs > 0 && Math.floor(s.invulnerableMs / 90) % 2 === 0;
    if (!hidden) {
      g.sprite(DINO_X, top, sprite, s.phase === "over" ? "danger" : "mint");
    }

    // --- overlays ---
    const count = counting.current;
    if (count !== null) {
      const word = countdownWord(count);
      if (word) {
        const art = bigWord(word);
        const paint = word === "GO" ? "mint" : "accent";
        const width = Math.max(...art.map((r) => r.length));
        const left = Math.floor((COLS - width) / 2);
        const top = Math.round(10) - Math.floor(BIG_ROWS / 2);
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
      g.banner(9, "╔══════════════════════════════╗", "accent");
      g.banner(10, "║      D I N O   R U N         ║", "accent");
      g.banner(11, "╚══════════════════════════════╝", "accent");
      g.banner(13, "PRESS SPACE TO RUN", "text");
      g.banner(15, "SPACE jump   ↓ duck   P pause", "dim");
    } else if (paused) {
      g.banner(10, "── P A U S E D ──", "warn");
      g.banner(12, "SPACE or P to resume", "dim");
    } else if (s.phase === "over") {
      g.banner(9, "╔══════════════════════════════╗", "danger");
      g.banner(10, "║        G A M E  O V E R      ║", "danger");
      g.banner(11, "╚══════════════════════════════╝", "danger");
      g.banner(13, `YOU RAN ${s.score} METRES`, "text");
      if (beatRecord) g.banner(14, "★  NEW RECORD  ★", "warn");
      g.banner(16, "PRESS SPACE TO RUN AGAIN", "dim");
    }

    screen.current?.draw(g);
  }, [paused, beatRecord]);

  useGameLoop(phase === "running" || counted, (dt) => {
    const s = state.current;

    // The countdown runs its own clock but not the world: nothing can kill
    // you until it reaches GO.
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

    if (paused) return;

    step(s, dt, rand.current);
    bits.current.step(dt);

    // A puff where the feet land.
    const inAir = airborne(s);
    if (wasAirborne.current && !inAir && s.phase === "running") {
      bits.current.dust(DINO_X + 2, GROUND_Y - 1, rand.current);
    }
    wasAirborne.current = inAir;

    // A hit: shatter, rattle, redden.
    if (s.lives < lastLives.current) {
      bits.current.burst(DINO_X + 4, GROUND_Y - 3, rand.current, "danger", 14, 26);
      screen.current?.shake(s.lives === 0 ? "big" : "small");
      screen.current?.flash("danger");
    }
    lastLives.current = s.lives;

    paint();

    // Committed to React only when the shown value actually changes, so a
    // frame in which nothing visible moved costs no reconciliation at all.
    if (s.score !== score) setScore(s.score);
    if (s.lives !== lives) setLives(s.lives);
    const shownSpeed = Math.round(s.speed);
    if (shownSpeed !== speed) setSpeed(shownSpeed);

    if (s.phase === "over" && !banked.current) {
      banked.current = true;
      const previous = highScore("dino");
      setBest(submitScore("dino", s.score));
      recordPlay("dino", s.score);
      if (s.score > previous && s.score > 0) {
        setBeatRecord(true);
        screen.current?.flash("warn");
      }
      setPhase("over");
    }
  });

  const begin = useCallback(() => {
    state.current = start(state.current);
    // Held at ready while the countdown runs, so nothing moves until GO.
    state.current.phase = "ready";
    bits.current.clear();
    banked.current = false;
    counting.current = 0;
    lastLives.current = state.current.lives;
    wasAirborne.current = false;
    setBeatRecord(false);
    setPaused(false);
    setCounted(true);
    setScore(0);
    setLives(state.current.lives);
    setPhase("ready");
    paint();
  }, [paint]);

  useGameKeys(true, (key) => {
    const s = state.current;

    if (key === "p" || key === "P") {
      if (s.phase === "running" && counting.current === null) setPaused((p) => !p);
      return;
    }

    if (isActionKey(key)) {
      if (counting.current !== null) return;
      if (paused) {
        setPaused(false);
        return;
      }
      if (s.phase === "running") jump(s);
      else begin();
      return;
    }
    if (key === "ArrowUp" || key === "w" || key === "W") {
      if (!paused) jump(s);
      return;
    }
    if (key === "ArrowDown" || key === "s" || key === "S") setDucking(s, true);
  });

  // Ducking ends when the key comes up, which the shared key hook does not
  // cover — it only reports presses, since that is all three of the other
  // games ever need.
  useEffect(() => {
    function onKeyUp(e: KeyboardEvent) {
      if (e.key === "ArrowDown" || e.key === "s" || e.key === "S") {
        setDucking(state.current, false);
      }
    }
    window.addEventListener("keyup", onKeyUp);
    return () => window.removeEventListener("keyup", onKeyUp);
  }, []);

  // The first paint, and a repaint whenever a still frame needs redrawing.
  useEffect(() => {
    paint();
  }, [paint, phase]);

  return (
    <GameWindow
      title="DINO RUN"
      glyph="🦖"
      hint="SPACE jump · ↓ duck · P pause"
      right={
        <span className="gw__scores">
          <Readout label="SCORE" value={padScore(score)} tone="mint" />
          <Readout label="HI-SCORE" value={padScore(best)} tone="warn" />
        </span>
      }
    >
      <div className="game-layout game-layout--stacked">
        <GameScreen ref={screen} label="Dino Run playfield" />

        <div className="game-strip">
          <Panel title="Status" tone="magenta">
            <p className="stat">
              <span className="stat__key">LIVES</span>
              <span className="stat__lives">
                {Array.from({ length: 3 }, (_, i) => (
                  <span key={i} className="stat__heart" data-on={i < lives || undefined}>
                    ♥
                  </span>
                ))}
              </span>
            </p>
          </Panel>

          <p className="game-tip" data-cheer={beatRecord || undefined}>
            {beatRecord
              ? "★ NEW RECORD — NOBODY HAS RUN FURTHER ★"
              : paused
                ? "PAUSED — PRESS P TO CARRY ON"
                : phase === "running"
                  ? "JUMP OVER THE CACTUSES!"
                  : "PRESS SPACE TO BEGIN"}
          </p>

          <Panel title="Speed" tone="mint">
            <p className="stat">
              <span className="stat__key">CELLS/S</span>
              <span className="stat__value">{speed}</span>
            </p>
          </Panel>
        </div>
      </div>
    </GameWindow>
  );
}
