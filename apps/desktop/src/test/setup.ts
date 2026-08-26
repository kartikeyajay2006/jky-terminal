import "@testing-library/jest-dom/vitest";

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
