/**
 * The page's motion: smooth scrolling, and the scroll-driven scenes built on
 * it. One clock — GSAP's ticker drives Lenis, Lenis feeds ScrollTrigger — so
 * a pinned scene and the scroll that moves it never disagree by a frame.
 *
 * Asked for less motion, none of this starts: the page scrolls natively and
 * every scene is drawn in its finished state by CSS.
 */
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import Lenis from "lenis";

gsap.registerPlugin(ScrollTrigger, SplitText);

export { gsap, ScrollTrigger };

export const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

let lenis: Lenis | null = null;
let started = false;

export function startMotion() {
  if (started) return;
  started = true;
  if (still()) {
    document.documentElement.classList.add("is-still");
    return;
  }

  lenis = new Lenis({
    duration: 1.1,
    easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    wheelMultiplier: 1,
    touchMultiplier: 1.4,
  });
  lenis.on("scroll", ScrollTrigger.update);
  gsap.ticker.add((time) => lenis?.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);
  document.documentElement.classList.add("has-lenis");

  // In-page links glide instead of jumping, and still land under the nav.
  document.addEventListener("click", (e) => {
    const a = (e.target as Element).closest<HTMLAnchorElement>('a[href^="#"]');
    if (!a || !lenis) return;
    const id = a.getAttribute("href") ?? "";
    const target = id.length > 1 ? document.querySelector(id) : null;
    if (!target) return;
    e.preventDefault();
    lenis.scrollTo(target as HTMLElement, { offset: -84, duration: 1.4 });
    history.pushState(null, "", id);
  });

  revealHeadings();
  revealBlocks();
}

/** Headings rise into place line by line, each line behind its own mask. */
function revealHeadings() {
  for (const el of document.querySelectorAll<HTMLElement>("[data-split]")) {
    SplitText.create(el, {
      type: "lines",
      mask: "lines",
      autoSplit: true,
      onSplit(self) {
        return gsap.from(self.lines, {
          yPercent: 115,
          rotate: 2.5,
          duration: 1.15,
          ease: "expo.out",
          stagger: 0.085,
          scrollTrigger: { trigger: el, start: "top 86%", once: true },
        });
      },
    });
  }
}

/** Anything marked [data-reveal] arrives as it scrolls in; children stagger. */
function revealBlocks() {
  for (const el of document.querySelectorAll<HTMLElement>("[data-reveal]")) {
    const kids = el.dataset.reveal === "children" ? [...el.children] : [el];
    gsap.from(kids, {
      y: 36,
      opacity: 0,
      filter: "blur(6px)",
      duration: 1.1,
      ease: "expo.out",
      stagger: 0.08,
      scrollTrigger: { trigger: el, start: "top 88%", once: true },
      clearProps: "filter",
    });
  }
}

/** A number that decodes into place, the way the headline does. */
export function decodeNumber(el: HTMLElement, trigger: Element = el) {
  const target = el.textContent ?? "";
  const DIGITS = "0123456789";
  const SYMBOLS = "#%&$@*+=";
  ScrollTrigger.create({
    trigger,
    start: "top 85%",
    once: true,
    onEnter: () => {
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
    },
  });
}

/** Buttons lean toward the pointer, a little, and settle back. */
export function magnetize(selector = "[data-magnetic]") {
  if (still() || !matchMedia("(hover: hover)").matches) return;
  for (const el of document.querySelectorAll<HTMLElement>(selector)) {
    // Safe to call from any component: an element is only bound once.
    if (el.dataset.magnetized) continue;
    el.dataset.magnetized = "true";
    const xTo = gsap.quickTo(el, "x", { duration: 0.6, ease: "elastic.out(1, 0.45)" });
    const yTo = gsap.quickTo(el, "y", { duration: 0.6, ease: "elastic.out(1, 0.45)" });
    el.addEventListener("pointermove", (e) => {
      const r = el.getBoundingClientRect();
      xTo((e.clientX - (r.left + r.width / 2)) * 0.28);
      yTo((e.clientY - (r.top + r.height / 2)) * 0.36);
    });
    el.addEventListener("pointerleave", () => {
      xTo(0);
      yTo(0);
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
