/**
 * What the website's simulated shell produces. Plain data, so the shell can
 * be tested without a page and drawn by any view.
 */

export type Tone = "dim" | "muted" | "text" | "accent" | "violet" | "magenta" | "mint" | "warn" | "danger" | "bold";

export interface Span {
  text: string;
  tone?: Tone;
}

export type Line = Span[];

export interface FileChange {
  code: string;
  path: string;
}

export type Panel =
  | {
      kind: "docker";
      containers: { id: string; name: string; image: string; status: string; up: boolean; ports: string }[];
    }
  | { kind: "git-status"; staged: FileChange[]; unstaged: FileChange[]; untracked: string[] }
  | { kind: "git-log"; commits: { hash: string; subject: string; when: string; head: boolean }[] }
  | { kind: "df"; disks: { mount: string; used: string; size: string; pct: number }[] }
  | { kind: "ls"; entries: { name: string; dir: boolean; size: string; date: string }[] }
  | { kind: "json"; value: unknown }
  | { kind: "mkdir"; dir: string };

export interface Proposal {
  /** What the assistant said before proposing. */
  said: string;
  command: string;
  /** What running it would do, spelled out — the app's approval card. */
  reads: string;
  writes: string;
  network: string;
  /** Destructive: must be typed back before it can run. */
  confirm?: string;
  /** What appears if it is approved. */
  result: Line[];
}

export type Block =
  | { kind: "lines"; lines: Line[] }
  | { kind: "panel"; command: string; label: string; panel: Panel }
  | { kind: "note"; text: string }
  | { kind: "banner"; version: string }
  | { kind: "approval"; proposal: Proposal };

export interface Effects {
  theme?: string;
  clear?: boolean;
  exit?: boolean;
}

export interface Result {
  blocks: Block[];
  effects?: Effects;
}

export interface ShellContext {
  version: string;
  themes: { id: string; label: string }[];
  currentTheme(): string;
}
