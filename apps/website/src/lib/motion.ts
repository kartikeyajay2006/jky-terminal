/**
 * The page's lightweight motion: smooth scrolling and viewport reveals.
 * Story timelines load separately, when they approach the viewport.
 *
 * Asked for less motion, none of this starts: the page scrolls natively and
 * every scene is drawn in its finished state by CSS.
 */
import Lenis from "lenis";

export const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Build each scene near the viewport, before its scroll timeline begins. */
export function whenNear(el: HTMLElement, fn: () => void | Promise<void>) {
  const io = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    io.disconnect();
    void document.fonts.ready.then(async () => {
      await fn();
      el.dataset.sceneReady = "true";
    });
  }, { rootMargin: "600px 0px" });
  io.observe(el);
}

let lenis: Lenis | null = null;

/** Connect a lazily loaded story's scroll reader to the page's scroll clock. */
export function onPageScroll(fn: () => void) {
  lenis?.on("scroll", fn);
}

/** ScrollTrigger briefly resets native scroll while refreshing its geometry. */
export function syncPageScroll() {
  if (!lenis?.isScrolling) lenis?.scrollTo(window.scrollY, { immediate: true, force: true });
}
let started = false;

export function startMotion() {
  if (started) return;
  started = true;
  if (still()) {
    document.documentElement.classList.add("is-still");
    return;
  }

  lenis = new Lenis({
    duration: 0.85,
    easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    wheelMultiplier: 1,
    allowNestedScroll: true,
    autoRaf: true,
  });
  document.documentElement.classList.add("has-lenis");

  const hashTarget = (hash: string) => {
    try {
      return document.getElementById(decodeURIComponent(hash.slice(1)));
    } catch {
      return null;
    }
  };
  const sectionY = (target: HTMLElement) => {
    const pad = parseFloat(getComputedStyle(target).paddingTop) || 0;
    return Math.max(0, target.getBoundingClientRect().top + window.scrollY + pad - 96);
  };
  const alignHash = () => {
    const target = hashTarget(location.hash);
    if (!target || !lenis) return;
    lenis.resize();
    lenis.scrollTo(sectionY(target), { immediate: true, force: true });
  };

  // Native fragment jumps can use stale positions after a viewport resize.
  // Align them after layout, using the same destination as the nav links.
  window.addEventListener("hashchange", () => requestAnimationFrame(alignHash));
  const initialHash = location.hash;
  let interacted = false;
  for (const event of ["wheel", "touchstart", "pointerdown", "keydown"]) {
    window.addEventListener(event, () => { interacted = true; }, { once: true, passive: true });
  }
  void document.fonts.ready.then(() => {
    if (!interacted && location.hash === initialHash) alignHash();
  });

  // In-page links glide instead of jumping, and still land under the nav.
  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element).closest<HTMLAnchorElement>("a[href]");
    // A link to a place on this same page, written either way: "#try" or
    // "/jky-terminal/#try".
    if (!a || !lenis || !a.hash || a.origin !== location.origin || a.pathname !== location.pathname) return;
    const id = a.hash;
    const target = hashTarget(id);
    if (!target) return;
    e.preventDefault();
    // Land on the section's content, just under the nav — not on the top of
    // the generous space above it.
    lenis.resize();
    lenis.scrollTo(sectionY(target), { duration: 1.4 });
    history.pushState(null, "", id);
  });

  revealHeadings();
  revealBlocks();
}

/**
 * Reveal headings as they arrive. Animate the existing element, so there is
 * no line splitting, synchronous measurement or DOM rewrite during a scroll.
 */
function revealHeadings() {
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        io.unobserve(entry.target);
        const el = entry.target as HTMLElement;
        el.classList.add("is-heading-revealed");
        arrive(el, 24);
      }
    },
    { rootMargin: "0px 0px -6% 0px" },
  );
  for (const el of document.querySelectorAll<HTMLElement>("[data-split]")) io.observe(el);
}

/** Anything marked [data-reveal] arrives as it scrolls in; children stagger. */
function revealBlocks() {
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        io.unobserve(entry.target);
        const el = entry.target as HTMLElement;
        const kids = el.dataset.reveal === "children" ? [...el.children] : [el];
        el.classList.add("is-revealed");
        kids.forEach((kid, i) => arrive(kid, 20, i * 60));
      }
    },
    { rootMargin: "0px 0px -10% 0px" },
  );
  for (const el of document.querySelectorAll<HTMLElement>("[data-reveal]")) io.observe(el);
}

/** Browser-composited entrances leave no inline transform behind. */
function arrive(el: Element, y: number, delay = 0) {
  if (still()) return;
  el.animate([
    { opacity: 0, transform: `translateY(${y}px)` },
    { opacity: 1, transform: "translateY(0px)" },
  ], { duration: 650, delay, fill: "backwards", easing: "cubic-bezier(0.16, 1, 0.3, 1)" });
}

/** A number that decodes into place, the way the headline does. */
export function decodeNumber(el: HTMLElement, trigger: Element = el) {
  const target = el.textContent ?? "";
  const DIGITS = "0123456789";
  const SYMBOLS = "#%&$@*+=";
  const io = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    io.disconnect();
    const t0 = performance.now();
    const dur = 1300;
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / dur);
      let out = "";
      [...target].forEach((ch, i) => {
        const settleAt = 0.35 + (i / Math.max(1, target.length)) * 0.6;
        if (p >= settleAt || !/[0-9]/.test(ch)) out += ch;
        else {
          const pool = Math.random() < 0.85 ? DIGITS : SYMBOLS;
          out += pool[Math.floor(Math.random() * pool.length)];
        }
      });
      el.textContent = out;
      if (p < 1) requestAnimationFrame(step);
      else el.textContent = target;
    };
    requestAnimationFrame(step);
  }, { rootMargin: "0px 0px -15% 0px" });
  io.observe(trigger);
}

/** Buttons lean toward the pointer, a little, and settle back. */
export function magnetize(selector = "[data-magnetic]") {
  if (still() || !matchMedia("(hover: hover)").matches) return;
  for (const el of document.querySelectorAll<HTMLElement>(selector)) {
    // Safe to call from any component: an element is only bound once.
    if (el.dataset.magnetized) continue;
    el.dataset.magnetized = "true";
    el.addEventListener("pointermove", (e) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - (r.left + r.width / 2)) * 0.2;
      const y = (e.clientY - (r.top + r.height / 2)) * 0.24;
      el.style.translate = `${x}px ${y}px`;
    });
    el.addEventListener("pointerleave", () => {
      el.style.translate = "0px 0px";
    });
  }
}

/** A light that follows the pointer across a card's border and surface. */
export function spotlight(selector = "[data-spotlight]") {
  if (!matchMedia("(hover: hover)").matches) return;
  for (const el of document.querySelectorAll<HTMLElement>(selector)) {
    if (el.dataset.lit) continue;
    el.dataset.lit = "true";
    el.addEventListener("pointermove", (e) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", `${e.clientX - r.left}px`);
      el.style.setProperty("--my", `${e.clientY - r.top}px`);
    });
  }
}
