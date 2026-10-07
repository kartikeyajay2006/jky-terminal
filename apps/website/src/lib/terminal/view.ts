import { Shell } from "../shell/engine";
import type { Block, Line, Proposal, ShellContext } from "../shell/types";
import { currentTheme, labelOf, setTheme, themes } from "../theme";
import { h } from "./dom";
import { renderPanel } from "./panels";

/**
 * The website's terminal: a JKY window you can type into.
 *
 * Keys go to a real (visually hidden) input, so a phone's keyboard opens and
 * every IME works; the shell owns the line and the view draws it with a
 * block cursor. Output streams in line by line, panels build beneath it, and
 * effects reach out of the window — `jky theme` re-themes the whole page,
 * revealed from the terminal's own cursor.
 */

interface Options {
  version: string;
  still: boolean;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const id = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(id);
      reject(new DOMException("aborted", "AbortError"));
    });
  });

export function mountTerminal(root: HTMLElement, opts: Options) {
  const required = ["[data-screen]", "[data-log]", "[data-prompt]", "[data-input]", "[data-window]"];
  if (required.some((sel) => !root.querySelector(sel))) return;
  // Present, checked above; typed as such so the functions below can use them.
  const need = <T extends Element = HTMLElement>(sel: string) => root.querySelector(sel) as T;
  const screen = need("[data-screen]");
  const log = need("[data-log]");
  const prompt = need("[data-prompt]");
  const input = need<HTMLInputElement>("[data-input]");
  const windowEl = need("[data-window]");
  const themeName = root.querySelector<HTMLElement>("[data-theme-name]");

  const ctx: ShellContext = { version: opts.version, themes, currentTheme };
  const shell = new Shell(ctx);
  let busy = false;
  // Set when the visitor takes over: whatever is still streaming finishes
  // at once instead of making them wait for it.
  let hurry = false;
  // Enter pressed while output was still arriving; run it as soon as it ends.
  let pendingEnter = false;
  let demo: AbortController | null = null;
  let demoTheme: string | null = null;

  // ---- drawing -------------------------------------------------------------

  const promptSpans = () => [
    h("span", { class: "pr__path" }, shell.cwd),
    h("span", { class: "pr__branch" }, ` ${shell.branch}`),
    h("span", { class: "pr__sym" }, " $ "),
  ];

  const drawPrompt = () => {
    const before = shell.line.slice(0, shell.cursor);
    const at = shell.line[shell.cursor] ?? " ";
    const after = shell.line.slice(shell.cursor + 1);
    prompt.replaceChildren(...promptSpans(), before, h("span", { class: "pr__cursor", "data-cursor": "" }, at), after);
    prompt.hidden = busy;
  };

  const lineEl = (spans: Line) => {
    const el = h("div", { class: "ln" });
    if (spans.length === 0 || spans.every((s) => s.text === "")) el.textContent = " ";
    for (const s of spans) el.append(s.tone ? h("span", { class: `t-${s.tone}` }, s.text) : s.text);
    return el;
  };

  const toEnd = () => {
    screen.scrollTop = screen.scrollHeight;
  };

  const trim = () => {
    while (log.childElementCount > 220) log.firstElementChild?.remove();
  };

  const echo = (text: string) => {
    log.append(h("div", { class: "ln ln--echo" }, ...promptSpans(), text));
  };

  // ---- output ----------------------------------------------------------------

  const typeAtPrompt = (command: string) => {
    stopDemo();
    shell.set(command);
    input.value = command;
    drawPrompt();
    input.focus({ preventScroll: true });
    toEnd();
  };

  async function print(blocks: Block[]) {
    for (const block of blocks) {
      if (block.kind === "lines") {
        for (const l of block.lines) {
          log.append(lineEl(l));
          toEnd();
          if (!opts.still && !hurry) await sleep(14);
        }
      } else if (block.kind === "panel") {
        if (!opts.still && !hurry) await sleep(140);
        log.append(renderPanel(block, { type: typeAtPrompt }));
      } else if (block.kind === "note") {
        log.append(h("div", { class: "ln ln--note" }, block.text));
      } else if (block.kind === "banner") {
        const banner = root.querySelector<HTMLElement>("[data-banner]");
        if (banner) log.append(banner.cloneNode(true));
      } else if (block.kind === "approval") {
        log.append(approval(block.proposal));
      }
      trim();
      toEnd();
    }
  }

  /** The assistant's approval card: what the command would do, and your call. */
  function approval(p: Proposal): HTMLElement {
    const actions = h("div", { class: "ap__actions" });
    const approve = h("button", { class: "ap__btn ap__btn--go", type: "button" }, "Approve");
    const dry = h("button", { class: "ap__btn", type: "button" }, "Dry run");
    const decline = h("button", { class: "ap__btn", type: "button" }, "Decline");
    let confirm: HTMLInputElement | null = null;
    if (p.confirm) {
      confirm = h("input", { class: "ap__confirm", type: "text", autocomplete: "off", spellcheck: "false", "aria-label": `Type ${p.confirm} to approve` });
      approve.setAttribute("disabled", "");
      confirm.addEventListener("input", () => approve.toggleAttribute("disabled", confirm?.value.trim() !== p.confirm));
      confirm.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && confirm?.value.trim() === p.confirm) approve.click();
        e.stopPropagation();
      });
    }
    actions.append(approve, dry, decline);
    const card = h(
      "section",
      { class: "ap", "data-destructive": String(!!p.confirm) },
      h("div", { class: "ap__said" }, h("span", { class: "ap__who" }, "✦ assistant "), p.said),
      h(
        "div",
        { class: "ap__card" },
        h("div", { class: "ap__head" }, p.confirm ? "This deletes files. Approve it?" : "Run this command?"),
        h("code", { class: "ap__cmd" }, p.command),
        h(
          "dl",
          { class: "ap__facts" },
          h("dt", null, "Reads"),
          h("dd", null, p.reads),
          h("dt", null, "Writes"),
          h("dd", { class: p.confirm ? "t-danger" : "" }, p.writes),
          h("dt", null, "Network"),
          h("dd", null, p.network),
        ),
        confirm
          ? h("label", { class: "ap__type" }, "Type ", h("code", null, p.confirm), " to approve ", confirm)
          : null,
        actions,
      ),
    );
    const settle = (status: string, tone: string, after: Line[] = []) => {
      actions.replaceWith(h("div", { class: `ap__status t-${tone}` }, status));
      confirm?.closest("label")?.remove();
      for (const l of after) log.append(lineEl(l));
      toEnd();
      input.focus({ preventScroll: true });
    };
    approve.addEventListener("click", () => settle(`✓ Approved — ran ${p.command}`, "mint", p.result));
    dry.addEventListener("click", () =>
      settle(`Dry run — ${p.writes === "nothing" ? "it would change nothing" : `it would ${p.writes.replace(/^deletes/, "delete")}`}. Nothing ran.`, "warn"),
    );
    decline.addEventListener("click", () => settle("Declined. Nothing ran.", "muted"));
    return card;
  }

  async function effects(e: { theme?: string; clear?: boolean; exit?: boolean } | undefined, fromDemo: boolean) {
    if (!e) return;
    if (e.clear) log.replaceChildren();
    if (e.theme) {
      const cursor = prompt.querySelector("[data-cursor]") ?? log.lastElementChild ?? screen;
      const r = cursor.getBoundingClientRect();
      await setTheme(e.theme, { x: r.left + r.width / 2, y: r.top + r.height / 2, persist: !fromDemo });
    }
    if (e.exit) await closeWindow();
  }

  /** `exit`: the window closes, the shell does not — JKY's first promise. */
  async function closeWindow() {
    windowEl.dataset.state = "closed";
    const started = Date.now();
    const overlay = root.querySelector<HTMLElement>("[data-closed]");
    const ticker = root.querySelector<HTMLElement>("[data-ticker]");
    const reopen = root.querySelector<HTMLButtonElement>("[data-reopen]");
    if (!overlay || !reopen) return;
    overlay.hidden = false;
    const timer = setInterval(() => {
      if (ticker) ticker.textContent = `${Math.floor((Date.now() - started) / 1000)}s`;
    }, 250);
    reopen.focus({ preventScroll: true });
    await new Promise<void>((resolve) => reopen.addEventListener("click", () => resolve(), { once: true }));
    clearInterval(timer);
    const away = Math.max(1, Math.round((Date.now() - started) / 1000));
    overlay.hidden = true;
    windowEl.dataset.state = "open";
    log.append(
      h("div", { class: "ln ln--note" }, `Rejoined the shell. While the window was closed (${away}s), it kept printing:`),
      lineEl([{ text: "✓", tone: "mint" }, { text: ` vite build — 1,284 modules transformed in ${Math.min(away, 59)}s` }]),
      lineEl([{ text: "  dist/assets/index-4f2a9c.js   ", tone: "dim" }, { text: "142.31 kB │ gzip: 46.02 kB" }]),
    );
    toEnd();
    input.focus({ preventScroll: true });
  }

  async function execute(fromDemo = false) {
    const { input: typed, result } = shell.submit();
    input.value = "";
    echo(typed);
    busy = true;
    drawPrompt();
    try {
      await print(result.blocks);
      await effects(result.effects, fromDemo);
    } finally {
      busy = false;
      hurry = false;
      syncFromInput();
      toEnd();
    }
    if (pendingEnter) {
      pendingEnter = false;
      void execute();
    }
  }

  // ---- keys ----------------------------------------------------------------

  const syncFromInput = () => {
    shell.line = input.value;
    shell.cursor = input.selectionStart ?? input.value.length;
    drawPrompt();
  };

  const syncToInput = () => {
    input.value = shell.line;
    input.setSelectionRange(shell.cursor, shell.cursor);
    drawPrompt();
  };

  input.addEventListener("input", () => {
    stopDemo();
    syncFromInput();
  });
  input.addEventListener("select", syncFromInput);
  input.addEventListener("keyup", (e) => {
    if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) syncFromInput();
  });

  input.addEventListener("keydown", (e) => {
    stopDemo();
    if (busy) {
      // Output is still arriving. Typing goes into the line as usual — it
      // shows once the prompt returns — and Enter is held until then.
      hurry = true;
      if (e.key === "Enter") {
        e.preventDefault();
        pendingEnter = true;
      } else if (e.key === "Tab") {
        e.preventDefault();
      }
      return;
    }
    const ctrl = e.ctrlKey && !e.altKey && !e.metaKey;
    if (e.key === "Enter") {
      e.preventDefault();
      void execute();
    } else if (e.key === "Tab" && shell.line.length > 0) {
      e.preventDefault();
      const options = shell.complete();
      if (options.length > 1) {
        echo(shell.line);
        log.append(lineEl([{ text: options.join("   "), tone: "accent" }]));
        toEnd();
      }
      syncToInput();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      shell.up();
      syncToInput();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      shell.down();
      syncToInput();
    } else if (ctrl && e.key.toLowerCase() === "l") {
      e.preventDefault();
      log.replaceChildren();
    } else if (ctrl && e.key.toLowerCase() === "c" && !window.getSelection()?.toString()) {
      e.preventDefault();
      echo(`${shell.interrupt()}^C`);
      syncToInput();
    } else if (ctrl && e.key.toLowerCase() === "u") {
      e.preventDefault();
      shell.killToStart();
      syncToInput();
    } else if (ctrl && e.key.toLowerCase() === "w") {
      e.preventDefault();
      shell.deleteWord();
      syncToInput();
    }
  });

  input.addEventListener("focus", () => root.classList.add("is-focused"));
  input.addEventListener("blur", () => root.classList.remove("is-focused"));

  // A click anywhere in the screen that is not a control focuses the prompt.
  screen.addEventListener("pointerup", (e) => {
    const target = e.target as Element;
    if (target.closest("button, a, input, code, .jt") || window.getSelection()?.toString()) return;
    stopDemo();
    input.focus({ preventScroll: true });
  });

  // Typing with nothing focused, while the terminal is in view, types here.
  let inView = false;
  new IntersectionObserver(
    ([entry]) => {
      inView = entry.intersectionRatio > 0.45;
      // Scrolled away mid-demo: stop, so nothing changes behind the reader.
      if (entry.intersectionRatio < 0.2) stopDemo();
    },
    { threshold: [0, 0.2, 0.45, 1] },
  ).observe(root);
  document.addEventListener("keydown", (e) => {
    const active = document.activeElement;
    if (!inView || e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
    if (active && active !== document.body && active !== document.documentElement) return;
    input.focus({ preventScroll: true });
  });

  // ---- chips and the demo ----------------------------------------------------

  async function typeOut(command: string, signal?: AbortSignal) {
    for (const ch of command) {
      shell.insert(ch);
      drawPrompt();
      await sleep(opts.still ? 0 : 38 + Math.random() * 55, signal);
    }
    await sleep(opts.still ? 0 : 260, signal);
  }

  for (const chip of document.querySelectorAll<HTMLButtonElement>("[data-chip]")) {
    chip.addEventListener("click", async () => {
      if (busy) return;
      stopDemo();
      shell.set("");
      await typeOut(chip.dataset.chip ?? "");
      await execute();
      if (matchMedia("(hover: hover)").matches) input.focus({ preventScroll: true });
    });
  }

  function stopDemo() {
    if (!demo) return;
    hurry = busy;
    demo.abort();
    demo = null;
    root.classList.remove("is-demo");
    // The demo types into the shell, the visitor into the input: drop the
    // demo's half-typed line and keep whatever the visitor has started.
    if (!busy) {
      shell.set(input.value);
      drawPrompt();
    }
    if (demoTheme) {
      void setTheme(demoTheme, { persist: false, instant: !inView });
      demoTheme = null;
    }
  }

  async function playDemo() {
    demo = new AbortController();
    const { signal } = demo;
    root.classList.add("is-demo");
    const original = currentTheme();
    const contrast = ["light", "gold"].includes(original) ? "cyberpunk" : "gold";
    try {
      await sleep(500, signal);
      for (const cmd of ["git status -s", "docker ps"]) {
        await typeOut(cmd, signal);
        await execute(true);
        await sleep(1900, signal);
      }
      if (!opts.still) {
        demoTheme = original;
        await typeOut(`jky theme ${contrast}`, signal);
        await execute(true);
        await sleep(2300, signal);
        await typeOut(`jky theme ${original}`, signal);
        await execute(true);
        demoTheme = null;
        await sleep(500, signal);
      }
      log.append(h("div", { class: "ln ln--note ln--turn" }, "Your turn — type help, or click a command below."));
      toEnd();
      root.classList.remove("is-demo");
      demo = null;
    } catch {
      /* interrupted: the visitor took over */
    }
  }

  // ---- start -----------------------------------------------------------------

  const showTheme = () => {
    if (themeName) themeName.textContent = labelOf(currentTheme());
  };
  showTheme();
  window.addEventListener("jky:theme", showTheme);

  log.replaceChildren();
  drawPrompt();
  root.dataset.ready = "true";

  let started = false;
  const io = new IntersectionObserver(
    ([entry]) => {
      if (started || entry.intersectionRatio < 0.5) return;
      started = true;
      io.disconnect();
      void playDemo();
    },
    { threshold: [0, 0.5] },
  );
  io.observe(root);
}
