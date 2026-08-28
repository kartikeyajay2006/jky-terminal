import type { Grid, Paint } from "./grid";

/**
 * Sparks, dust and debris.
 *
 * The cheapest thing that makes a game feel like it is reacting to you: a
 * landing that puffs, a cactus that shatters, an apple that bursts. All of it
 * is a handful of characters with a velocity and a countdown, drawn into the
 * same grid as everything else.
 *
 * The pool is fixed and reused. Emitting during play must not allocate — a
 * game that garbage-collects mid-jump is exactly the stutter this whole
 * renderer is arranged to avoid.
 */

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Seconds remaining. Dead at or below zero. */
  life: number;
  /** Seconds it started with, so it can fade over its own lifetime. */
  born: number;
  paint: Paint;
  /** Cycled through as it ages, so it visibly decays. */
  chars: string;
  /** Cells per second squared pulling it down. Zero floats. */
  gravity: number;
}

/** How many can exist at once. Beyond this the oldest is recycled. */
export const POOL_SIZE = 96;

export class Particles {
  private readonly pool: Particle[];
  /** Where the next emit will land, wrapping round the pool. */
  private next = 0;

  constructor(size = POOL_SIZE) {
    this.pool = Array.from({ length: size }, () => ({
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      life: 0,
      born: 1,
      paint: "dim" as Paint,
      chars: "·",
      gravity: 0,
    }));
  }

  /** How many are currently alive, for tests and for nothing else. */
  get alive(): number {
    return this.pool.reduce((n, p) => n + (p.life > 0 ? 1 : 0), 0);
  }

  clear(): void {
    for (const p of this.pool) p.life = 0;
  }

  /**
   * Take the next slot, recycling the oldest when the pool is full.
   *
   * Overwriting a live particle is the right trade: a dropped spark nobody
   * notices beats an allocation every frame, and beats refusing to show the
   * effect that just happened.
   */
  private take(): Particle {
    const p = this.pool[this.next];
    this.next = (this.next + 1) % this.pool.length;
    return p;
  }

  emit(spec: {
    x: number;
    y: number;
    vx: number;
    vy: number;
    life: number;
    paint: Paint;
    chars?: string;
    gravity?: number;
  }): void {
    const p = this.take();
    p.x = spec.x;
    p.y = spec.y;
    p.vx = spec.vx;
    p.vy = spec.vy;
    p.life = spec.life;
    p.born = spec.life;
    p.paint = spec.paint;
    p.chars = spec.chars ?? "·";
    p.gravity = spec.gravity ?? 0;
  }

  /**
   * A puff of dust, for a landing or a footfall.
   *
   * Spread sideways and barely upward: dust does not leap, it drifts out and
   * settles.
   */
  dust(x: number, y: number, rand: () => number, paint: Paint = "dim"): void {
    for (let i = 0; i < 5; i += 1) {
      this.emit({
        x,
        y,
        vx: (rand() - 0.5) * 16,
        vy: -rand() * 4,
        life: 0.28 + rand() * 0.2,
        paint,
        chars: "·˙.",
        gravity: 14,
      });
    }
  }

  /** A burst in every direction, for a hit or a pickup. */
  burst(
    x: number,
    y: number,
    rand: () => number,
    paint: Paint,
    count = 12,
    speed = 24,
  ): void {
    for (let i = 0; i < count; i += 1) {
      // Evenly spaced angles jittered a little, so a burst reads as round
      // rather than as a random smear that sometimes has a bald patch.
      const angle = (i / count) * Math.PI * 2 + (rand() - 0.5) * 0.5;
      const power = speed * (0.5 + rand() * 0.6);
      this.emit({
        x,
        y,
        vx: Math.cos(angle) * power,
        // Halved vertically: a character cell is about twice as tall as it is
        // wide, so equal speeds make a circle look like an upright ellipse.
        vy: Math.sin(angle) * power * 0.5,
        life: 0.32 + rand() * 0.34,
        paint,
        chars: "✦*·˙",
        gravity: 10,
      });
    }
  }

  /** A trail left behind something moving, thrown backwards from it. */
  trail(x: number, y: number, rand: () => number, paint: Paint): void {
    this.emit({
      x,
      y,
      vx: -6 - rand() * 8,
      vy: (rand() - 0.5) * 4,
      life: 0.2 + rand() * 0.16,
      paint,
      chars: "·˙",
      gravity: 0,
    });
  }

  step(dtMs: number): void {
    const dt = dtMs / 1000;
    for (const p of this.pool) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  /**
   * Draw every live particle.
   *
   * The character is chosen from how much life is left, so a spark visibly
   * thins out rather than vanishing at full brightness.
   */
  draw(grid: Grid): void {
    for (const p of this.pool) {
      if (p.life <= 0) continue;
      const fraction = Math.max(0, Math.min(1, p.life / p.born));
      const index = Math.min(
        p.chars.length - 1,
        Math.floor((1 - fraction) * p.chars.length),
      );
      grid.set(p.x, p.y, p.chars[index], p.paint);
    }
  }
}
