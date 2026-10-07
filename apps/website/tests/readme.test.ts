import { describe, expect, it } from "vitest";
import { inline, readComparison } from "../src/lib/readme";

describe("the comparison, read from the README", () => {
  const c = readComparison();

  it("finds JKY first among the columns", () => {
    expect(c.columns[0]).toBe("JKY");
    expect(c.columns.length).toBeGreaterThanOrEqual(5);
  });

  it("gives every row a cell for every column", () => {
    expect(c.rows.length).toBeGreaterThanOrEqual(8);
    for (const row of c.rows) expect(row.cells, row.label).toHaveLength(c.columns.length);
  });

  it("keeps the rows where JKY is behind — the honest ones", () => {
    const signed = c.rows.find((r) => /signed/i.test(r.label));
    expect(signed?.cells[0].mark).toBe("no");
    expect(c.behind.length).toBeGreaterThan(2);
    expect(c.different.length).toBeGreaterThan(2);
  });

  it("reads blanks as unverified, not as no", () => {
    const marks = c.rows.flatMap((r) => r.cells.map((x) => x.mark));
    expect(marks).toContain("unknown");
  });
});

describe("inline markdown", () => {
  it("renders bold, code and links, and escapes the rest", () => {
    expect(inline("**a** `b` [c](docs/x.md) <i>")).toBe(
      '<strong>a</strong> <code>b</code> <a href="https://github.com/kartikeyajay2006/jky-terminal/blob/main/docs/x.md">c</a> &lt;i&gt;',
    );
  });
});
