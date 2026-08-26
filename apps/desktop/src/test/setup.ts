import "@testing-library/jest-dom/vitest";
import * as axeMatchers from "vitest-axe/matchers";
import { expect } from "vitest";

// vitest-axe 0.1.0 ships its type augmentation against the old global `Vi`
// namespace, which vitest 2 no longer uses, so the matchers are registered
// here and their types are declared in vitest-axe.d.ts alongside.
expect.extend(axeMatchers);

/*
 * jsdom implements no layout engine, so a handful of browser APIs that depend
 * on geometry simply do not exist. Components are right to call them and a
 * real browser always provides them, so they are stubbed here rather than
 * guarded at every call site — a guard would let a genuine bug hide behind an
 * optional-call operator.
 */

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
