import { describe, expect, it } from "vitest";
import { autopilot, newGame, step, turn } from "../src/lib/snake";

const fixed = () => 0; // food at the first free cell, every time

describe("snake", () => {
  it("moves one cell per step, keeping its length", () => {
    const g = newGame(10, 8, fixed);
    g.food = { x: 9, y: 0 };
    const head = { ...g.snake[0] };
    step(g, fixed);
    expect(g.snake[0]).toEqual({ x: head.x + 1, y: head.y });
    expect(g.snake).toHaveLength(3);
  });

  it("grows and scores when it eats", () => {
    const g = newGame(10, 8, fixed);
    g.food = { x: g.snake[0].x + 1, y: g.snake[0].y };
    expect(step(g, fixed)).toBe(true);
    expect(g.snake).toHaveLength(4);
    expect(g.score).toBe(1);
  });

  it("refuses to reverse into its own body", () => {
    const g = newGame(10, 8, fixed);
    turn(g, "left");
    expect(g.dir).toBe("right");
    turn(g, "up");
    expect(g.dir).toBe("up");
  });

  it("ends at a wall", () => {
    const g = newGame(5, 5, fixed);
    g.food = { x: 0, y: 0 };
    for (let i = 0; i < 6; i++) step(g, fixed);
    expect(g.over).toBe(true);
  });

  it("plays itself for a long while without dying", () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const g = newGame(20, 14, rand);
    let steps = 0;
    while (!g.over && steps < 400) {
      turn(g, autopilot(g));
      step(g, rand);
      steps++;
    }
    expect(g.score).toBeGreaterThan(5);
  });
});
