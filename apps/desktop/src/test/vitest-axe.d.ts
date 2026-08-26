import type { AxeMatchers } from "vitest-axe/matchers";

// vitest-axe 0.1.0 augments the legacy global `Vi` namespace. vitest 2 reads
// matcher types from the "vitest" module instead, so the augmentation has to
// be restated here for `expect(...).toHaveNoViolations()` to type-check.
// AxeMatchers is not generic — parameterising it here is a type error.
declare module "vitest" {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Assertion extends AxeMatchers {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface AsymmetricMatchersContaining extends AxeMatchers {}
}
