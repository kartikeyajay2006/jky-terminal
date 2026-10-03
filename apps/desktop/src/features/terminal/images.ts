/**
 * Inline images: Sixel, and the iTerm2 image protocol.
 *
 * Loaded after the terminal opens, from a chunk of its own, so the bundle
 * every window downloads at start-up does not carry an image decoder that
 * most sessions never use.
 *
 * Images arrive in terminal output, and terminal output is untrusted — a
 * program, a remote machine or a log file can send one. So every limit is
 * stated here rather than inherited from a default that could change: how
 * many pixels one image may have, how large its encoded form may be, and how
 * much memory all images together may hold before the oldest are dropped.
 *
 * Kitty's graphics protocol is not supported by this decoder, and the
 * settings and docs say so.
 */
export const IMAGE_OPTIONS = {
  // 4096 × 4096: a large screenshot, and 64 MiB of pixels at most.
  pixelLimit: 4096 * 4096,
  // MB, for every image the scrollback still holds. The oldest go first.
  storageLimit: 64,
  showPlaceholder: true,
  sixelSupport: true,
  sixelScrolling: true,
  sixelPaletteLimit: 256,
  // Bytes of encoded data one image may send before it is abandoned.
  sixelSizeLimit: 25_000_000,
  iipSupport: true,
  iipSizeLimit: 20_000_000,
  // Lets an image tool ask the window's pixel size and fit its output.
  enableSizeReports: true,
} as const;

/** The one method this needs from a terminal. */
interface LoadsAddons {
  loadAddon(addon: never): void;
}

/**
 * Teach a terminal to draw images. Resolves to whether it could.
 *
 * Never throws: a terminal that will not open because a decoder failed to
 * load would be a poor trade for pictures.
 */
export async function loadImages(term: LoadsAddons): Promise<boolean> {
  try {
    const { ImageAddon } = await import("@xterm/addon-image");
    term.loadAddon(new ImageAddon({ ...IMAGE_OPTIONS }) as never);
    return true;
  } catch {
    return false;
  }
}
