import { runRegex } from "./regexEngine";

/**
 * Runs one pattern, off the thread that draws.
 *
 * Four lines on purpose: everything worth testing is in `regexEngine`, and a
 * worker is the one thing a test cannot easily reach. What it buys is the
 * ability to be *killed* — see `useRegex`.
 */
self.onmessage = (event: MessageEvent<{ pattern: string; flags: string; text: string }>) => {
  const { pattern, flags, text } = event.data;
  self.postMessage(runRegex(pattern, flags, text));
};
