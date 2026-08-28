import { describe, expect, it } from "vitest";
import { Particles, POOL_SIZE } from "./particles";
import { Grid } from "./grid";
import { makeRandom } from "../dino/rules";

const rand = makeRandom(31);

describe("the particle pool", () => {
  it("starts empty", () => {
    expect(new Particles().alive).toBe(0);
  });

  it("comes alive when something is emitted", () => {
    const p = new Particles();
    p.emit({ x: 1, y: 1, vx: 0, vy: 0, life: 1, paint: "mint" });
    expect(p.alive).toBe(1);
  });

  it("dies out on its own", () => {
    const p = new Particles();
    p.emit({ x: 1, y: 1, vx: 0, vy: 0, life: 0.1, paint: "mint" });
    p.step(200);
    expect(p.alive).toBe(0);
  });

  it("can be wiped, for starting a fresh round", () => {
    const p = new Particles();
    p.burst(5, 5, rand, "danger");
    expect(p.alive).toBeGreaterThan(0);
    p.clear();
    expect(p.alive).toBe(0);
  });

  it("never grows past its pool, however much is thrown at it", () => {
    // Emitting during play must not allocate: a game that garbage-collects
    // mid-jump is exactly the stutter this renderer is arranged to avoid.
    const p = new Particles(16);
    for (let i = 0; i < 500; i += 1) p.burst(5, 5, rand, "mint", 12);
    expect(p.alive).toBeLessThanOrEqual(16);
  });

  it("has a pool big enough for a burst and a trail at once", () => {
    expect(POOL_SIZE).toBeGreaterThanOrEqual(32);
  });
});

describe("moving", () => {
  it("carries a particle along its velocity", () => {
    const p = new Particles();
    p.emit({ x: 0, y: 0, vx: 10, vy: 0, life: 1, paint: "mint" });
    p.step(100);

    const g = new Grid(10, 3);
    p.draw(g);
    // Ten cells a second for a tenth of a second is one cell along.
    expect(g.charAt(1, 0)).not.toBe(" ");
  });

  it("pulls a particle down when it has gravity", () => {
    const p = new Particles();
    p.emit({ x: 4, y: 0, vx: 0, vy: 0, life: 2, paint: "dim", gravity: 40 });
    p.step(300);

    const g = new Grid(10, 8);
    p.draw(g);
    expect(g.charAt(4, 0)).toBe(" ");
  });

  it("leaves a particle with no gravity where its velocity takes it", () => {
    const p = new Particles();
    p.emit({ x: 4, y: 3, vx: 0, vy: 0, life: 2, paint: "dim" });
    p.step(300);

    const g = new Grid(10, 8);
    p.draw(g);
    expect(g.charAt(4, 3)).not.toBe(" ");
  });
});

describe("drawing", () => {
  it("draws nothing when nothing is alive", () => {
    const g = new Grid(8, 3);
    new Particles().draw(g);
    expect(g.toText().trim()).toBe("");
  });

  it("thins out as a particle ages, rather than vanishing at full brightness", () => {
    const p = new Particles();
    p.emit({ x: 2, y: 0, vx: 0, vy: 0, life: 1, paint: "mint", chars: "AB" });

    const fresh = new Grid(5, 1);
    p.draw(fresh);
    expect(fresh.charAt(2, 0)).toBe("A");

    p.step(600);
    const old = new Grid(5, 1);
    p.draw(old);
    expect(old.charAt(2, 0)).toBe("B");
  });

  it("drops a particle that has drifted off the board rather than wrapping", () => {
    const p = new Particles();
    p.emit({ x: 2, y: 0, vx: -100, vy: 0, life: 5, paint: "mint" });
    p.step(500);

    const g = new Grid(6, 2);
    p.draw(g);
    expect(g.toText().trim()).toBe("");
  });
});

describe("the shapes", () => {
  it("a puff of dust spreads sideways rather than leaping", () => {
    const p = new Particles();
    p.dust(10, 5, rand);
    expect(p.alive).toBeGreaterThan(2);
  });

  it("a burst goes out in every direction", () => {
    // Round rather than a smear with a bald patch on one side.
    const p = new Particles();
    p.burst(20, 10, rand, "danger", 16, 24);

    const g = new Grid(40, 20);
    p.step(80);
    p.draw(g);

    const rows = g.toText().split("\n");
    const touched = rows.filter((r) => r.trim().length > 0).length;
    expect(touched).toBeGreaterThan(1);
  });

  it("a burst emits the number it was asked for", () => {
    const p = new Particles();
    p.burst(5, 5, rand, "mint", 9);
    expect(p.alive).toBe(9);
  });

  it("a trail is thrown backwards, behind whatever left it", () => {
    const p = new Particles();
    p.trail(20, 5, rand, "warn");
    p.step(120);

    const g = new Grid(40, 10);
    p.draw(g);
    const row = g.toText().split("\n")[5] ?? "";
    // Left of where it was emitted.
    expect(row.slice(0, 20).trim().length).toBeGreaterThan(0);
  });
});
