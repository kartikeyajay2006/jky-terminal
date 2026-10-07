/** Loaded only when a story approaches the viewport. */
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { onPageScroll, syncPageScroll } from "./motion";

gsap.registerPlugin(ScrollTrigger);
gsap.ticker.lagSmoothing(0);
onPageScroll(ScrollTrigger.update);
ScrollTrigger.addEventListener("refresh", syncPageScroll);

export { gsap, ScrollTrigger };

/** Refresh together after nearby scenes finish setting up. */
let settleTimer = 0;
export function settle() {
  clearTimeout(settleTimer);
  settleTimer = window.setTimeout(() => {
    ScrollTrigger.sort();
    ScrollTrigger.refresh();
  }, 150);
}
