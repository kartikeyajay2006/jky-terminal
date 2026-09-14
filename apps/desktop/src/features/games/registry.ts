import type { ArcadeGame } from "./Arcade";

// Apart from `Games.tsx` so the palette can list the games without importing
// the four engines that play them: one static import of that file puts the
// whole section back in the entry bundle, which `src/lazy.test.ts` guards.

/**
 * The suite, in the order the sub-nav lists them.
 *
 * This order is also the shell command's contract — `jky games 2` means the
 * second of these — which `openStore` asserts against.
 */
export const GAMES: ArcadeGame[] = [
  {
    id: "dino",
    label: "Dino Run",
    glyph: "🦖",
    blurb: "Jump the cactuses. It only gets faster.",
    scored: true,
    keys: "SPACE · ↓",
    tone: "mint",
    art: [
      "    ▄███▄      ",
      "    █▀█▀█   ▓  ",
      "▄▄▄██████  ▓▓▓ ",
      "███████▀    ▓  ",
      "───────────────",
    ],
  },
  {
    id: "snake",
    label: "Snake",
    glyph: "🐍",
    blurb: "Eat, grow, and try not to corner yourself.",
    scored: true,
    keys: "↑ ↓ ← → · SPACE",
    tone: "accent",
    art: [
      "┌─────────────┐",
      "│ ███▓▓▓    ◆ │",
      "│     ▓       │",
      "│     ▓▓▓▓    │",
      "└─────────────┘",
    ],
  },
  {
    id: "tictactoe",
    label: "Tic Tac Toe",
    glyph: "⨯○",
    blurb: "Two players, one keyboard.",
    scored: false,
    keys: "1 – 9 · ENTER",
    tone: "violet",
    art: [
      "   X │ O │ X   ",
      "  ───┼───┼───  ",
      "   O │ X │ O   ",
      "  ───┼───┼───  ",
      "   X │ O │ X   ",
    ],
  },
  {
    id: "flappy",
    label: "Flappy Bird",
    glyph: "🐦",
    blurb: "Mind the gap. The gap gets smaller.",
    scored: true,
    keys: "SPACE",
    tone: "warn",
    art: [
      "█▌       ▐█   ",
      "█▌  ▄██▖ ▐█   ",
      "      ▝▘      ",
      "█▌       ▐█   ",
      "▀▀▀▀▀▀▀▀▀▀▀▀▀ ",
    ],
  },
];
