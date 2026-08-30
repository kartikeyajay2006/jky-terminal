/**
 * Arithmetic for the Calculator app.
 *
 * This is a hand-written parser rather than a call to `eval`, and that is a
 * security decision before it is a style one. The whole app is built so a
 * compromised window has nowhere to send anything and nothing to execute;
 * handing user text to a JavaScript interpreter would be a hole straight
 * through that, and "it is only a calculator" is exactly how such holes get
 * argued for. Anything that is not arithmetic is a parse error here.
 *
 * Grammar, loosest binding first:
 *
 *   expression := term (("+" | "-") term)*
 *   term       := unary (("*" | "/") unary)*
 *   unary      := "-" unary | power
 *   power      := postfix ("^" unary)?      -- right associative
 *   postfix    := primary "%"*
 *   primary    := number | "(" expression ")"
 */

export type CalcResult =
  | { ok: true; value: number | null }
  | { ok: false; error: string };

/** Thrown internally and turned into a result at the boundary. */
class CalcError extends Error {}

type Token =
  | { kind: "number"; value: number }
  | { kind: "op"; value: "+" | "-" | "*" | "/" | "^" | "%" }
  | { kind: "("; }
  | { kind: ")"; };

const OPERATORS = new Set(["+", "-", "*", "/", "^", "%"]);

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < src.length) {
    const c = src[i];

    if (c === " " || c === "\t" || c === "\n") {
      i += 1;
      continue;
    }

    if (c === "(") {
      tokens.push({ kind: "(" });
      i += 1;
      continue;
    }

    if (c === ")") {
      tokens.push({ kind: ")" });
      i += 1;
      continue;
    }

    if (OPERATORS.has(c)) {
      tokens.push({ kind: "op", value: c as "+" });
      i += 1;
      continue;
    }

    if (isDigit(c) || c === ".") {
      const start = i;
      let seenDot = false;
      while (i < src.length && (isDigit(src[i]) || src[i] === ".")) {
        if (src[i] === ".") {
          // A second dot in one number is a typo, not a second number.
          if (seenDot) throw new CalcError("that number has two decimal points");
          seenDot = true;
        }
        i += 1;
      }
      const text = src.slice(start, i);
      const value = Number(text);
      if (!Number.isFinite(value)) throw new CalcError(`not a number: ${text}`);
      tokens.push({ kind: "number", value });
      continue;
    }

    throw new CalcError(`unexpected character: ${c}`);
  }

  return tokens;
}

function isDigit(c: string): boolean {
  return c >= "0" && c <= "9";
}

/**
 * A cursor over the token list.
 *
 * Kept as a small class rather than threaded through every function as an
 * index, because each parse step needs to both read and advance and returning
 * a pair from all six of them obscures the grammar they exist to express.
 */
class Parser {
  private at = 0;

  constructor(private readonly tokens: Token[]) {}

  private peek(): Token | undefined {
    return this.tokens[this.at];
  }

  private eat(): Token {
    const token = this.tokens[this.at];
    // Every caller checks `peek` first, so running out here means the
    // expression stopped mid-way: "2+" reaches this with nothing left.
    if (!token) throw new CalcError("the expression is unfinished");
    this.at += 1;
    return token;
  }

  private isOp(value: string): boolean {
    const token = this.peek();
    return token?.kind === "op" && token.value === value;
  }

  get done(): boolean {
    return this.at >= this.tokens.length;
  }

  get nextIsCloser(): boolean {
    return this.peek()?.kind === ")";
  }

  expression(): number {
    let left = this.term();
    while (this.isOp("+") || this.isOp("-")) {
      const op = this.eat();
      const right = this.term();
      left = op.kind === "op" && op.value === "+" ? left + right : left - right;
    }
    return left;
  }

  private term(): number {
    let left = this.unary();
    while (this.isOp("*") || this.isOp("/")) {
      const op = this.eat();
      const right = this.unary();
      if (op.kind === "op" && op.value === "/") {
        // Left to IEEE 754 this yields Infinity, and the display would show
        // it as though it were an answer to the question asked.
        if (right === 0) throw new CalcError("cannot divide by zero");
        left = left / right;
      } else {
        left = left * right;
      }
    }
    return left;
  }

  private unary(): number {
    if (this.isOp("-")) {
      this.eat();
      return -this.unary();
    }
    return this.power();
  }

  private power(): number {
    const base = this.postfix();
    if (!this.isOp("^")) return base;
    this.eat();
    // Right associative, and through `unary` so that `2^-1` is exponent -1
    // rather than a parse error.
    return base ** this.unary();
  }

  private postfix(): number {
    let value = this.primary();
    while (this.isOp("%")) {
      this.eat();
      value = value / 100;
    }
    return value;
  }

  private primary(): number {
    const token = this.eat();

    if (token.kind === "number") return token.value;

    if (token.kind === "(") {
      const value = this.expression();
      if (this.done) throw new CalcError("missing a closing )");
      if (!this.nextIsCloser) throw new CalcError("the expression is unfinished");
      this.eat();
      return value;
    }

    if (token.kind === ")") throw new CalcError("unexpected )");

    throw new CalcError("the expression is unfinished");
  }
}

/**
 * Work out what an expression comes to.
 *
 * An empty expression is `value: null` rather than an error: the field starts
 * empty and a calculator that greets you with a complaint before you have
 * typed anything is a calculator that is wrong about whose fault that is.
 */
export function calculate(source: string): CalcResult {
  try {
    const tokens = tokenize(source);
    if (tokens.length === 0) return { ok: true, value: null };

    const parser = new Parser(tokens);
    const value = parser.expression();

    if (!parser.done) {
      throw new CalcError(parser.nextIsCloser ? "unexpected )" : "the expression is unfinished");
    }

    // Overflow reads as a real answer otherwise: 9^9^9 is Infinity, and
    // "∞" in the display looks like a result rather than a refusal.
    if (!Number.isFinite(value)) throw new CalcError("that number is too large");

    return { ok: true, value };
  } catch (e) {
    if (e instanceof CalcError) return { ok: false, error: e.message };
    throw e;
  }
}

/**
 * A number as the display should show it.
 *
 * Binary floating point makes `0.1 + 0.2` come to `0.30000000000000004`, and
 * showing that is technically honest and practically useless. Twelve
 * significant figures is comfortably inside a double's ~15-17, so this rounds
 * the representation error away without ever reaching real precision.
 */
export function formatResult(value: number): string {
  // Below 1e21 an integer prints in full; above it JavaScript switches to
  // exponent form on its own, which is what the precision path produces too.
  if (Number.isInteger(value) && Math.abs(value) < 1e21) return String(value);
  return String(Number(value.toPrecision(12)));
}
