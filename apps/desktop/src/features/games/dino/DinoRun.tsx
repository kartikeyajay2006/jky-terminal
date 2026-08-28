import { useCallback, useEffect, useRef, useState } from "react";
import { Grid } from "../engine/grid";
import { useGameLoop } from "../engine/loop";
import { isActionKey, useGameKeys } from "../engine/keys";
import { GameScreen, type GameScreenHandle } from "../GameScreen";
import { GameWindow, Panel, Readout } from "../GameChrome";
import { highScore, padScore, submitScore } from "../scores";
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
  const banked = useRef(false);

  const [phase, setPhase] = useState(state.current.phase);
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(state.current.lives);
  const [speed, setSpeed] = useState(state.current.speed);
  const [best, setBest] = useState(() => highScore("dino"));

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
    if (s.phase === "ready") {
      g.banner(9, "╔══════════════════════════════╗", "accent");
      g.banner(10, "║      D I N O   R U N         ║", "accent");
      g.banner(11, "╚══════════════════════════════╝", "accent");
      g.banner(13, "PRESS SPACE TO RUN", "text");
      g.banner(15, "SPACE jump   ↓ duck", "dim");
    } else if (s.phase === "over") {
      g.banner(9, "╔══════════════════════════════╗", "danger");
      g.banner(10, "║        G A M E  O V E R      ║", "danger");
      g.banner(11, "╚══════════════════════════════╝", "danger");
      g.banner(13, `YOU RAN ${s.score} METRES`, "text");
      g.banner(15, "PRESS SPACE TO RUN AGAIN", "dim");
    }

    screen.current?.draw(g);
  }, []);

  useGameLoop(phase === "running", (dt) => {
    const s = state.current;
    step(s, dt, rand.current);
    paint();

    // Committed to React only when the shown value actually changes, so a
    // frame in which nothing visible moved costs no reconciliation at all.
    if (s.score !== score) setScore(s.score);
    if (s.lives !== lives) setLives(s.lives);
    const shownSpeed = Math.round(s.speed);
    if (shownSpeed !== speed) setSpeed(shownSpeed);

    if (s.phase === "over" && !banked.current) {
      banked.current = true;
      setBest(submitScore("dino", s.score));
      setPhase("over");
    }
  });

  const begin = useCallback(() => {
    state.current = start(state.current);
    banked.current = false;
    setScore(0);
    setLives(state.current.lives);
    setPhase("running");
    paint();
  }, [paint]);

  useGameKeys(true, (key) => {
    const s = state.current;
    if (isActionKey(key)) {
      if (s.phase === "running") jump(s);
      else begin();
      return;
    }
    if (key === "ArrowUp" || key === "w" || key === "W") {
      jump(s);
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
      hint="SPACE to jump · ↓ to duck"
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

          <p className="game-tip">
            {phase === "running" ? "JUMP OVER THE CACTUSES!" : "PRESS SPACE TO BEGIN"}
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
