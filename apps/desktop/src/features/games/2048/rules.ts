/** The complete, deterministic rules for 2048. */

export const SIZE = 4;
export const TARGET = 2048;

export type Direction = "up" | "down" | "left" | "right";
export type Phase = "ready" | "playing" | "won" | "over";
export type Board = number[][];

export interface Game2048 {
  board: Board;
  score: number;
  moves: number;
  phase: Phase;
}

export type Random = () => number;

export function emptyBoard(): Board {
  return Array.from({ length: SIZE }, () => Array<number>(SIZE).fill(0));
}

export function copyBoard(board: Board): Board {
  return board.map((row) => [...row]);
}

/** Put a 2 (90%) or 4 (10%) in one genuinely empty cell. */
export function spawn(board: Board, random: Random): Board {
  const next = copyBoard(board);
  const free: Array<[number, number]> = [];
  next.forEach((row, y) => row.forEach((value, x) => {
    if (value === 0) free.push([x, y]);
  }));
  if (free.length === 0) return next;
  const [x, y] = free[Math.min(free.length - 1, Math.floor(random() * free.length))];
  next[y][x] = random() < 0.1 ? 4 : 2;
  return next;
}

export function initialState(random: Random): Game2048 {
  return { board: spawn(spawn(emptyBoard(), random), random), score: 0, moves: 0, phase: "ready" };
}

/** Fold a line toward its first cell. A tile may merge exactly once per move. */
export function fold(line: number[]): { line: number[]; gained: number } {
  const values = line.filter(Boolean);
  const result: number[] = [];
  let gained = 0;
  for (let i = 0; i < values.length; i += 1) {
    if (values[i] === values[i + 1]) {
      const merged = values[i] * 2;
      result.push(merged);
      gained += merged;
      i += 1;
    } else {
      result.push(values[i]);
    }
  }
  return { line: [...result, ...Array<number>(SIZE - result.length).fill(0)], gained };
}

function readLine(board: Board, index: number, direction: Direction): number[] {
  if (direction === "left") return [...board[index]];
  if (direction === "right") return [...board[index]].reverse();
  const column = board.map((row) => row[index]);
  return direction === "up" ? column : column.reverse();
}

function writeLine(board: Board, index: number, direction: Direction, line: number[]): void {
  const values = direction === "right" || direction === "down" ? [...line].reverse() : line;
  if (direction === "left" || direction === "right") {
    board[index] = values;
  } else {
    values.forEach((value, y) => { board[y][index] = value; });
  }
}

export function canMove(board: Board): boolean {
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const value = board[y][x];
      if (value === 0) return true;
      if (x + 1 < SIZE && value === board[y][x + 1]) return true;
      if (y + 1 < SIZE && value === board[y + 1][x]) return true;
    }
  }
  return false;
}

export function highest(board: Board): number {
  return Math.max(0, ...board.flat());
}

/** Apply one move. An ineffective arrow does not add a tile or a move. */
export function move(state: Game2048, direction: Direction, random: Random): Game2048 {
  if (state.phase !== "playing") return state;

  const board = copyBoard(state.board);
  let changed = false;
  let gained = 0;
  for (let index = 0; index < SIZE; index += 1) {
    const before = readLine(board, index, direction);
    const folded = fold(before);
    if (before.some((value, i) => value !== folded.line[i])) changed = true;
    gained += folded.gained;
    writeLine(board, index, direction, folded.line);
  }
  if (!changed) return state;

  const score = state.score + gained;
  if (highest(board) >= TARGET) return { board, score, moves: state.moves + 1, phase: "won" };
  const next = spawn(board, random);
  return {
    board: next,
    score,
    moves: state.moves + 1,
    phase: canMove(next) ? "playing" : "over",
  };
}

export function start(random: Random): Game2048 {
  return { ...initialState(random), phase: "playing" };
}
