import { describe, expect, it } from "vitest";
import { calculate, formatResult } from "./calculate";

describe("calculate", () => {
  it("adds two numbers", () => {
    expect(calculate("2+3")).toEqual({ ok: true, value: 5 });
  });

  it("subtracts, multiplies and divides", () => {
    expect(calculate("9-4")).toEqual({ ok: true, value: 5 });
    expect(calculate("6*7")).toEqual({ ok: true, value: 42 });
    expect(calculate("8/2")).toEqual({ ok: true, value: 4 });
  });

  it("gives multiplication precedence over addition", () => {
    expect(calculate("2+3*4")).toEqual({ ok: true, value: 14 });
  });

  it("lets parentheses override precedence", () => {
    expect(calculate("(2+3)*4")).toEqual({ ok: true, value: 20 });
  });

  it("reads decimals", () => {
    expect(calculate("1.5+2.25")).toEqual({ ok: true, value: 3.75 });
  });

  it("applies a leading minus as negation", () => {
    expect(calculate("-5+2")).toEqual({ ok: true, value: -3 });
  });

  it("negates a parenthesised group", () => {
    expect(calculate("-(3+4)")).toEqual({ ok: true, value: -7 });
  });

  it("raises to a power, binding tighter than multiplication", () => {
    expect(calculate("2*3^2")).toEqual({ ok: true, value: 18 });
  });

  it("associates powers to the right", () => {
    expect(calculate("2^3^2")).toEqual({ ok: true, value: 512 });
  });

  it("reads a percentage as a hundredth", () => {
    expect(calculate("50%")).toEqual({ ok: true, value: 0.5 });
  });

  it("ignores whitespace", () => {
    expect(calculate("  12  +  8  ")).toEqual({ ok: true, value: 20 });
  });

  it("treats an empty expression as no answer rather than an error", () => {
    expect(calculate("   ")).toEqual({ ok: true, value: null });
  });

  // Division by zero is the one case where IEEE 754 would hand back Infinity
  // and the display would show "∞" as though it were an answer.
  it("refuses to divide by zero", () => {
    expect(calculate("1/0")).toEqual({ ok: false, error: "cannot divide by zero" });
  });

  it("reports an unclosed parenthesis", () => {
    expect(calculate("(2+3")).toEqual({ ok: false, error: "missing a closing )" });
  });

  it("reports a stray closing parenthesis", () => {
    expect(calculate("2+3)")).toEqual({ ok: false, error: "unexpected )" });
  });

  it("reports a dangling operator", () => {
    expect(calculate("2+")).toEqual({ ok: false, error: "the expression is unfinished" });
  });

  it("reports a character it does not understand", () => {
    expect(calculate("2 $ 3")).toEqual({ ok: false, error: "unexpected character: $" });
  });

  // The whole reason this is a parser and not `eval`: the window has a
  // security boundary, and handing arbitrary text to an interpreter would be
  // a hole straight through it. A JavaScript expression must not evaluate.
  it("does not evaluate JavaScript", () => {
    const result = calculate("globalThis");
    expect(result.ok).toBe(false);
  });

  it("does not evaluate a call expression", () => {
    const result = calculate("alert(1)");
    expect(result.ok).toBe(false);
  });

  it("rejects a result that is not finite", () => {
    expect(calculate("9^9^9")).toEqual({ ok: false, error: "that number is too large" });
  });
});

describe("formatResult", () => {
  it("shows a whole number without a decimal point", () => {
    expect(formatResult(42)).toBe("42");
  });

  it("keeps a genuine decimal", () => {
    expect(formatResult(3.75)).toBe("3.75");
  });

  it("keeps a negative number's sign", () => {
    expect(formatResult(-7.5)).toBe("-7.5");
  });

  // Binary floating point makes 0.1 + 0.2 come to 0.30000000000000004.
  // Showing that is technically honest and practically useless.
  it("rounds away binary floating-point noise", () => {
    expect(formatResult(0.1 + 0.2)).toBe("0.3");
  });

  it("keeps real precision rather than truncating to the noise threshold", () => {
    expect(formatResult(1 / 3)).toBe("0.333333333333");
  });

  it("falls back to exponent form for very large numbers", () => {
    expect(formatResult(1e30)).toBe("1e+30");
  });
});
