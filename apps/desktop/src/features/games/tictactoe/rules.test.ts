import { describe, expect, it } from "vitest";
import {
  LINES,
  emptyBoard,
  indexForKey,
  judge,
  other,
  place,
  statusLine,
  type Board,
  type Mark,
} from "./rules";

/** Build a board from a nine-character sketch: X, O, or a dot for empty. */
function board(sketch: string): Board {
  return [...sketch.replace(/\s/g, "")].map((c) =>
    c === "X" ? "X" : c === "O" ? "O" : null,
  ) as Board;
}

describe("the empty board", () => {
  it("has nine empty squares", () => {
    expect(emptyBoard()).toHaveLength(9);
    expect(emptyBoard().every((c) => c === null)).toBe(true);
  });

  it("is not over", () => {
    expect(judge(emptyBoard()).over).toBe(false);
  });
});

describe("the winning lines", () => {
  it("covers three rows, three columns and two diagonals", () => {
    expect(LINES).toHaveLength(8);
  });

  it("never names a square outside the board", () => {
    for (const line of LINES) {
      for (const i of line) {
        expect(i).toBeGreaterThanOrEqual(0);
        expect(i).toBeLessThan(9);
      }
    }
  });

  it("names three distinct squares in each line", () => {
    for (const line of LINES) {
      expect(new Set(line).size).toBe(3);
    }
  });
});

describe("judging a position", () => {
  it("finds a win across the top row", () => {
    const outcome = judge(board("XXX OO. ..."));
    expect(outcome.winner).toBe("X");
    expect(outcome.line).toEqual([0, 1, 2]);
  });

  it("finds a win down a column", () => {
    expect(judge(board("O.X O.X O..")).winner).toBe("O");
  });

  it("finds a win on the leading diagonal", () => {
    expect(judge(board("X.O .XO ..X")).winner).toBe("X");
  });

  it("finds a win on the other diagonal", () => {
    expect(judge(board("..O .O. OX.")).winner).toBe("O");
  });

  it("reports which three squares won it, for highlighting", () => {
    expect(judge(board("X.O .XO ..X")).line).toEqual([0, 4, 8]);
  });

  it("calls a full board with no line a draw", () => {
    expect(judge(board("XOX XOO OXX")).draw).toBe(true);
  });

  it("does not call a winning final move a draw", () => {
    // The board is full and X has a line. Checking fullness first would call
    // this a draw, which is the classic way to get this wrong.
    const outcome = judge(board("XXX OOX OXO"));
    expect(outcome.winner).toBe("X");
    expect(outcome.draw).toBe(false);
  });

  it("does not call an unfinished game a draw", () => {
    const outcome = judge(board("XO. ... ..."));
    expect(outcome.draw).toBe(false);
    expect(outcome.over).toBe(false);
  });

  it("reports no line when nobody has won", () => {
    expect(judge(board("XO. ... ...")).line).toEqual([]);
  });
});

describe("placing a mark", () => {
  it("puts the mark on the chosen square", () => {
    const next = place(emptyBoard(), 4, "X");
    expect(next?.[4]).toBe("X");
  });

  it("leaves the board it was given alone", () => {
    // A new array rather than a mutation, so a caller cannot half-apply a
    // move that turns out to be illegal.
    const before = emptyBoard();
    place(before, 0, "X");
    expect(before[0]).toBeNull();
  });

  it("refuses a square that is taken", () => {
    expect(place(board("X........"), 0, "O")).toBeNull();
  });

  it("refuses a square off the board", () => {
    for (const i of [-1, 9, 100, 1.5, NaN]) {
      expect(place(emptyBoard(), i, "X")).toBeNull();
    }
  });

  it("refuses any move once the game is won", () => {
    expect(place(board("XXX OO. ..."), 5, "O")).toBeNull();
  });

  it("refuses any move once the board is full", () => {
    expect(place(board("XOX XOO OXX"), 0, "X")).toBeNull();
  });
});

describe("taking turns", () => {
  it("alternates between the two players", () => {
    expect(other("X")).toBe("O");
    expect(other("O")).toBe("X");
  });

  it("returns to the same player after two turns", () => {
    const marks: Mark[] = ["X", "O"];
    for (const m of marks) expect(other(other(m))).toBe(m);
  });
});

describe("the keyboard", () => {
  it("maps 1 to 9 onto the board reading left to right, top to bottom", () => {
    // The arrangement printed beside the board, which is the whole point of
    // printing it.
    expect(indexForKey("1")).toBe(0);
    expect(indexForKey("5")).toBe(4);
    expect(indexForKey("9")).toBe(8);
  });

  it("ignores anything that is not a square number", () => {
    for (const key of ["0", "a", "Enter", " ", "10", ""]) {
      expect(indexForKey(key)).toBeNull();
    }
  });
});

describe("the status line", () => {
  it("says whose turn it is while the game is on", () => {
    expect(statusLine(emptyBoard(), "X")).toBe("X TO PLAY");
    expect(statusLine(board("X........"), "O")).toBe("O TO PLAY");
  });

  it("names the winner", () => {
    expect(statusLine(board("XXX OO. ..."), "O")).toBe("X WINS");
  });

  it("says so on a draw", () => {
    expect(statusLine(board("XOX XOO OXX"), "X")).toBe("A DRAW");
  });
});

describe("a whole game", () => {
  it("plays out to a win", () => {
    let b = emptyBoard();
    let turn: Mark = "X";
    // X takes the top row, O the middle, X wins on the third move.
    for (const move of [0, 3, 1, 4, 2]) {
      const next = place(b, move, turn);
      expect(next).not.toBeNull();
      b = next!;
      turn = other(turn);
    }
    const outcome = judge(b);
    expect(outcome.winner).toBe("X");
    expect(outcome.over).toBe(true);
  });

  it("plays out to a draw", () => {
    let b = emptyBoard();
    let turn: Mark = "X";
    for (const move of [4, 0, 1, 7, 6, 2, 5, 3, 8]) {
      const next = place(b, move, turn);
      if (next === null) break;
      b = next;
      turn = other(turn);
    }
    const outcome = judge(b);
    expect(outcome.over).toBe(true);
    expect(outcome.winner).toBeNull();
    expect(outcome.draw).toBe(true);
  });
});
