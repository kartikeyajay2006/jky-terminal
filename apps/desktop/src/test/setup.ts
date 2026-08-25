import "@testing-library/jest-dom/vitest";

// jsdom implements no layout engine, so Element.prototype.scrollIntoView does
// not exist. Components that keep an active option in view legitimately call
// it. Stub it here rather than guarding the call sites: the component is right
// to call it, and a real browser always provides it.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}
