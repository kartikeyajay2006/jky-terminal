import { describe, expect, it } from "vitest";
import { canMove, emptyBoard, fold, highest, move, spawn, type Game2048 } from "./rules";

const fixed = () => 0;
const playing = (board: number[][]): Game2048 => ({ board, score: 0, moves: 0, phase: "playing" });

describe("2048 rules", () => {
  it("merges a pair once and awards its value", () => {
    expect(fold([2, 2, 0, 0])).toEqual({ line: [4, 0, 0, 0], gained: 4 });
  });

  it("does not merge a newly formed tile twice", () => {
    expect(fold([2, 2, 2, 2])).toEqual({ line: [4, 4, 0, 0], gained: 8 });
  });

  it("adds one tile only after an effective move", () => {
    const state = playing([[2, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
    const next = move(state, "right", fixed);
    expect(next.moves).toBe(1);
    expect(next.board.flat().filter(Boolean)).toHaveLength(2);
  });

  it("does not mutate state or spawn after an ineffective move", () => {
    const state = playing([[2, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
    expect(move(state, "left", fixed)).toBe(state);
  });

  it("moves columns toward the selected edge", () => {
    const state = playing([[2, 0, 0, 0], [2, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
    const next = move(state, "down", fixed);
    expect(next.board[3][0]).toBe(4);
    expect(next.score).toBe(4);
  });

  it("ends a board with no spaces and no adjacent match", () => {
    const board = [[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 2]];
    expect(canMove(board)).toBe(false);
  });

  it("recognises a 2048 win before spawning a new tile", () => {
    const state = playing([[1024, 1024, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
    const next = move(state, "left", fixed);
    expect(next.phase).toBe("won");
    expect(next.board.flat().filter(Boolean)).toHaveLength(1);
    expect(highest(next.board)).toBe(2048);
  });

  it("never adds a tile to a full board", () => {
    const board = emptyBoard().map(() => [2, 4, 8, 16]);
    expect(spawn(board, fixed)).toEqual(board);
  });
});
