/**
 * Snake, as the app's Games section has it — small enough for a card. The
 * rules are plain data so they can be tested; the card draws them.
 *
 * Until someone takes the controls it plays itself: greedily toward the
 * food, never into a wall or its own body if any other way is open.
 */

export type Dir = "up" | "down" | "left" | "right";
export interface Point {
  x: number;
  y: number;
}

export interface Game {
  cols: number;
  rows: number;
  snake: Point[]; // head first
  dir: Dir;
  food: Point;
  score: number;
  over: boolean;
}

const STEP: Record<Dir, Point> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
const OPPOSITE: Record<Dir, Dir> = { up: "down", down: "up", left: "right", right: "left" };

export function newGame(cols: number, rows: number, rand: () => number = Math.random): Game {
  const y = Math.floor(rows / 2);
  const x = Math.floor(cols / 3);
  const snake = [
    { x, y },
    { x: x - 1, y },
    { x: x - 2, y },
  ];
  const game: Game = { cols, rows, snake, dir: "right", food: { x: 0, y: 0 }, score: 0, over: false };
  game.food = placeFood(game, rand);
  return game;
}

function occupied(game: Game, p: Point, ignoreTail = false) {
  const body = ignoreTail ? game.snake.slice(0, -1) : game.snake;
  return body.some((s) => s.x === p.x && s.y === p.y);
}

export function placeFood(game: Game, rand: () => number = Math.random): Point {
  const free: Point[] = [];
  for (let y = 0; y < game.rows; y++) for (let x = 0; x < game.cols; x++) if (!occupied(game, { x, y })) free.push({ x, y });
  return free[Math.floor(rand() * free.length)] ?? { x: 0, y: 0 };
}

/** Changes direction, refusing a reversal straight into the body. */
export function turn(game: Game, dir: Dir) {
  if (dir !== OPPOSITE[game.dir]) game.dir = dir;
}

/** Advances one step. Returns true if the snake ate. */
export function step(game: Game, rand: () => number = Math.random): boolean {
  if (game.over) return false;
  const head = game.snake[0];
  const next = { x: head.x + STEP[game.dir].x, y: head.y + STEP[game.dir].y };
  const eats = next.x === game.food.x && next.y === game.food.y;
  if (next.x < 0 || next.y < 0 || next.x >= game.cols || next.y >= game.rows || occupied(game, next, !eats)) {
    game.over = true;
    return false;
  }
  game.snake.unshift(next);
  if (eats) {
    game.score++;
    game.food = placeFood(game, rand);
  } else {
    game.snake.pop();
  }
  return eats;
}

/** The self-player: the safe direction that closes the distance to the food. */
export function autopilot(game: Game): Dir {
  const head = game.snake[0];
  const options = (Object.keys(STEP) as Dir[]).filter((d) => d !== OPPOSITE[game.dir]);
  const safe = options.filter((d) => {
    const p = { x: head.x + STEP[d].x, y: head.y + STEP[d].y };
    const eats = p.x === game.food.x && p.y === game.food.y;
    return p.x >= 0 && p.y >= 0 && p.x < game.cols && p.y < game.rows && !occupied(game, p, !eats);
  });
  const pool = safe.length ? safe : options;
  const dist = (d: Dir) => Math.abs(head.x + STEP[d].x - game.food.x) + Math.abs(head.y + STEP[d].y - game.food.y);
  return pool.sort((a, b) => dist(a) - dist(b))[0];
}
