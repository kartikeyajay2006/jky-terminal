/**
 * Worked examples, at the top of every tool.
 *
 * An empty box with a clever name teaches nobody anything. Each of these
 * loads real input and says what you will see when it does — including the
 * ones that go wrong on purpose, because "what does this do when the input is
 * broken" is the question people actually have and the one an empty box
 * cannot answer.
 *
 * They are buttons rather than prose for the same reason: reading about a
 * tool is not using one, and the fastest way to understand any of these is to
 * have something in it that you can then take apart.
 */
export interface Example {
  /** What this example is, in two or three words. */
  label: string;
  /** What you will see. Written as a promise about the result. */
  shows: string;
  load: () => void;
}

export function Examples({ examples }: { examples: Example[] }) {
  return (
    <section className="ex" aria-label="Examples">
      <p className="ex__title">Try one</p>
      <div className="ex__list">
        {examples.map((example) => (
          <button
            key={example.label}
            type="button"
            className="ex__item"
            onClick={example.load}
          >
            <span className="ex__label">{example.label}</span>
            <span className="ex__shows">{example.shows}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

/**
 * What a tool is for, above the controls.
 *
 * One sentence on the use, one on when you would reach for it. The second is
 * the one that matters: knowing what a hash *is* does not tell you why the
 * app has one.
 */
export function WhatFor({ children }: { children: React.ReactNode }) {
  return <div className="ex__what">{children}</div>;
}
