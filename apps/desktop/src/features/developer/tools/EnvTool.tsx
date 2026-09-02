import { useEffect, useMemo, useState } from "react";
import { getPlatform } from "../../../platform";
import type { EnvVar } from "../../../platform/types";
import { CopyButton, ToolFrame } from "./Shared";
import { WhatFor } from "./Examples";

/**
 * The environment viewer.
 *
 * What a **new** terminal in this app would inherit — this process's
 * environment, which is what a spawned shell gets. Not the environment of a
 * shell already running: nothing outside a process can change that, and a
 * panel offering to would be lying about what it did. The heading says so,
 * because "manage your environment variables" is the promise every tool like
 * this makes and none of them keeps.
 *
 * Values that look like secrets are hidden behind a click rather than
 * withheld. It is the user's own environment and they may well need to read
 * it; what they do not need is their AWS key on screen while someone is
 * looking over their shoulder.
 */
export function EnvTool() {
  const [vars, setVars] = useState<EnvVar[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [shown, setShown] = useState<Set<string>>(new Set());

  useEffect(() => {
    let live = true;
    void getPlatform()
      .tools.environment()
      .then((next) => {
        if (live) setVars(next);
      })
      .catch((e: unknown) => {
        if (live) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      live = false;
    };
  }, []);

  const matching = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!vars) return [];
    if (!needle) return vars;
    // Names and values both: PATH is found by its name, and the directory you
    // are hunting for is found by its value.
    return vars.filter(
      (v) =>
        v.name.toLowerCase().includes(needle) ||
        (!v.secret && v.value.toLowerCase().includes(needle)),
    );
  }, [vars, search]);

  const reveal = (name: string) =>
    setShown((seen) => {
      const next = new Set(seen);
      next.add(name);
      return next;
    });

  return (
    <ToolFrame hint="This process's environment — what a terminal opened now would start with.">
      <WhatFor>
        <p>See every variable a new terminal in this app would inherit.</p>
        <p>
          Reach for it when a program cannot find something and you suspect
          `PATH`, or when a tool behaves differently here than in your own
          shell. This will not change a terminal that is already open —
          nothing outside a running process can.
        </p>
      </WhatFor>

      <div className="tl__row">
        <label className="tl__sr" htmlFor="env-search">
          Search
        </label>
        <input
          id="env-search"
          className="tl__input"
          type="search"
          aria-label="Search variables"
          placeholder="Name or value…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {vars && (
          <span className="tl__note">
            {matching.length} of {vars.length}
          </span>
        )}
      </div>

      {error && (
        <p className="tl__error" role="alert">
          {error}
        </p>
      )}

      {vars && (
        <dl className="env__list" aria-label="Environment">
          {matching.map((v) => {
            const hidden = v.secret && !shown.has(v.name);
            return (
              <div className="env__row" key={v.name} data-secret={v.secret || undefined}>
                <dt>{v.name}</dt>
                <dd>
                  {hidden ? (
                    <button
                      type="button"
                      className="tool tool--small"
                      onClick={() => reveal(v.name)}
                    >
                      Hidden — show
                    </button>
                  ) : (
                    <>
                      <code className="env__value">{v.value}</code>
                      <CopyButton text={v.value} />
                    </>
                  )}
                </dd>
              </div>
            );
          })}
        </dl>
      )}
    </ToolFrame>
  );
}
