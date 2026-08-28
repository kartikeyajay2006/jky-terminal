/**
 * Tic tac toe — two players at one keyboard.
 *
 * No computer opponent, by request: X and O are both people, so the whole of
 * the game is whose turn it is, what a win looks like, and being able to
 * start again.
 */

export type Mark = "X" | "O";
export type Cell = Mark | null;
export type Board = Cell[];

export interface Outcome {
  /** Who won, or null for a draw or an unfinished game. */
  winner: Mark | null;
  /** The three squares that won it, for highlighting. Empty otherwise. */
  line: number[];
  draw: boolean;
  over: boolean;
}

/** Every way to get three in a row: rows, columns, both diagonals. */
export const LINES: ReadonlyArray<readonly [number, number, number]> = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

export function emptyBoard(): Board {
  return Array<Cell>(9).fill(null);
}

/**
 * Read the position.
 *
 * A draw is only a draw once the board is full *and* nobody has won —
 * checking fullness first would call the final winning move a draw.
 */
export function judge(board: Board): Outcome {
  for (const line of LINES) {
    const [a, b, c] = line;
    const mark = board[a];
    if (mark && board[b] === mark && board[c] === mark) {
      return { winner: mark, line: [a, b, c], draw: false, over: true };
    }
  }
  const full = board.every((cell) => cell !== null);
  return { winner: null, line: [], draw: full, over: full };
}

/**
 * Place a mark, returning a new board, or null when the move is not legal.
 *
 * A new array rather than a mutation: there are nine cells and at most nine
 * moves in a whole game, so the cost is nothing, and returning null for an
 * illegal move means a caller cannot half-apply one.
 */
export function place(board: Board, index: number, mark: Mark): Board | null {
  if (!Number.isInteger(index) || index < 0 || index > 8) return null;
  if (board[index] !== null) return null;
  if (judge(board).over) return null;
  const next = board.slice();
  next[index] = mark;
  return next;
}

export function other(mark: Mark): Mark {
  return mark === "X" ? "O" : "X";
}

/**
 * The board index a typed key means, or null.
 *
 * The keypad is numbered the way the on-screen guide is — 1 to 9 reading
 * left to right, top to bottom — because that is the arrangement printed
 * beside the board, and matching it is the whole point of showing it.
 */
export function indexForKey(key: string): number | null {
  if (!/^[1-9]$/.test(key)) return null;
  return Number(key) - 1;
}

/** What to say above the board right now. */
export function statusLine(board: Board, turn: Mark): string {
  const outcome = judge(board);
  if (outcome.winner) return `${outcome.winner} WINS`;
  if (outcome.draw) return "A DRAW";
  return `${turn} TO PLAY`;
}
