export interface ModelOption {
  id: string;
  label: string;
  note: string;
}

export interface ProviderStatus {
  id: string;
  displayName: string;
  tagline: string;
  consoleUrl: string;
  /** Local runtimes need no credential. */
  requiresKey: boolean;
  /** Accepted key prefixes, used to show the expected shape. May be empty. */
  keyPrefixes: string[];
  connected: boolean;
  models: ModelOption[];
  defaultModel: string;
  /** The user's explicit choice, if they have made one. */
  selectedModel: string | null;
}

/**
 * Every native capability the UI is allowed to reach.
 *
 * Note what is absent: there is no `getSecret`. The frontend can store a
 * secret, ask whether one exists, and delete it — never read it back. This
 * mirrors the Rust IPC surface, which has no getter either.
 */
export interface VaultApi {
  setSecret(provider: string, value: string): Promise<void>;
  hasSecret(provider: string): Promise<boolean>;
  deleteSecret(provider: string): Promise<void>;
  listProviders(): Promise<ProviderStatus[]>;
}

/**
 * One shortcut, as the keymap reports it.
 *
 * `chord` is canonical — modifiers in a fixed order, `Ctrl` standing for
 * Ctrl-or-Cmd, which is what every shortcut in this app has always accepted.
 * Matching is done against this string, so the window never has to decide
 * what a chord means; `jky-keys` already did.
 */
export interface Binding {
  /** The action id, e.g. `pane-split-right`. */
  action: string;
  label: string;
  /** Which part of the app it belongs to, for grouping in the panel. */
  group: string;
  chord: string;
  default_chord: string;
  custom: boolean;
}

/** A chord two actions both answer to. Only a hand-edited file can hold one. */
export interface Conflict {
  chord: string;
  actions: string[];
}

export interface Keyboard {
  bindings: Binding[];
  conflicts: Conflict[];
}

/**
 * What every key is bound to.
 *
 * Every call answers with the whole keyboard, so the panel cannot end up
 * drawing a table that disagrees with the file — the same rule the dashboard
 * collections follow, for the same reason.
 *
 * Nothing here presses a key. Rust decides what a chord *means*; the window
 * looks up the meaning and does it.
 */
export interface KeysApi {
  list(): Promise<Keyboard>;
  /** Point one action at a chord. Rejects one another action already holds. */
  bind(action: string, chord: string): Promise<Keyboard>;
  reset(action: string): Promise<Keyboard>;
  resetAll(): Promise<Keyboard>;
}

/**
 * One command that ran, anywhere, at any time.
 *
 * Not scrollback: that is what a command *printed*, capped and rolling and
 * kept per terminal. This is what was *typed* — small, yours, and the thing
 * worth finding a month later.
 */
export interface HistoryEntry {
  command: string;
  /** Where it ran. `ls` here is a different answer from `ls` there. */
  cwd: string;
  /** Zero means it worked. The shell reports it; nothing is inferred. */
  code: number;
  /** Milliseconds since the epoch. */
  at: number;
  /** The pane it was typed in. */
  session: string;
  /** The machine it ran on: absent for this one, a host for an SSH session. */
  host?: string | null;
}

/** One search result: the entry, plus why it is here. */
export interface HistoryHit extends HistoryEntry {
  /** How many times this exact command has been run, ever. */
  count: number;
  /** The most recent time it ran, which is not necessarily `at`. */
  last_at: number;
}

export interface HistoryQuery {
  /** Matched as a subsequence: `dkrps` finds `docker ps`. Empty means all. */
  text: string;
  session?: string | null;
  cwd?: string | null;
  failedOnly?: boolean;
  limit?: number;
}

/**
 * Every command you have run.
 *
 * Ranking lives in Rust, not here: tightness, frequency and recency are the
 * kind of thing that has to be tested against a hundred entries, and a window
 * that sorted its own results would have to be handed all of them to do it.
 */
export interface HistoryApi {
  record(entry: HistoryEntry): Promise<void>;
  search(query: HistoryQuery): Promise<HistoryHit[]>;
  /** Forget every run of one command — not the row being looked at. */
  forget(command: string): Promise<number>;
  clear(): Promise<void>;
}

/** Where a suggestion came from, so the list can say. */
export type SuggestionKind =
  | "directory"
  | "file"
  | "executable"
  | "flag"
  | "branch"
  | "script"
  | "history";

export interface Suggestion {
  /** The text that replaces what was typed. */
  value: string;
  /** What to show. A path shows only its last part. */
  display: string;
  kind: SuggestionKind;
  /** A word or two of context. Empty when there is nothing worth saying. */
  detail: string;
  /**
   * Byte offset this suggestion replaces from.
   *
   * Almost always the word being typed. A whole command line recalled from
   * history replaces the whole command — `docker r` completed to
   * `docker run …` must not become `docker docker run …`.
   */
  from: number;
}

export interface Completions {
  /** Where the word being completed begins. */
  start: number;
  /** Where it ends — the cursor. */
  end: number;
  word: string;
  items: Suggestion[];
}

/**
 * What could come next on a command line.
 *
 * Reads directories, `PATH` and a repository's refs. It runs nothing — not
 * the command being completed, not `git`, not `--help`. A completion engine
 * that executed anything to find out what to offer would execute it on every
 * keystroke, at a prompt where the person has not decided yet.
 */
export interface CompleteApi {
  suggest(line: string, cursor: number, cwd: string, limit: number): Promise<Completions>;
}

/**
 * A machine you can open a terminal on.
 *
 * Note what is absent: no password, and no key. This app stores neither and
 * asks for neither — connecting runs the `ssh` your machine already has, so
 * your agent, your `~/.ssh/config`, your `known_hosts` and your keys are the
 * ones in use.
 */
export interface RemoteHost {
  /** Stable across renames. */
  id: string;
  /** What to call it. The address stands in when empty. */
  label: string;
  /** A hostname, an address, or a name from `~/.ssh/config`. */
  address: string;
  /** Empty means whatever ssh would use on its own. */
  user: string;
  port?: number | null;
  identity_file?: string | null;
  jump?: string | null;
  /** Milliseconds since the epoch, for ordering by last used. */
  last_used: number;
}

/**
 * Terminals on other machines.
 *
 * `spawn` takes a saved host's id and never a command line. That is the whole
 * boundary: the argument list is built in Rust from what was saved, and an
 * address that could be read as an ssh option is refused there — on save as
 * well as on connect, so the two can never disagree.
 */
export interface RemoteApi {
  list(): Promise<RemoteHost[]>;
  /** Add or replace one. Rejects a host that could never connect. */
  save(host: RemoteHost): Promise<RemoteHost[]>;
  forget(id: string): Promise<RemoteHost[]>;
  /** Open a pty running ssh. Resolves to a session id, like `pty.spawn`. */
  spawn(id: string, cols: number, rows: number): Promise<string>;
}

/** One folder the editor has open. */
export interface Folder {
  /** The folder as it was configured. This is its identity in every call. */
  root: string;
  /** Its last part, for the tree's heading. */
  name: string;
  /** Whether it can still be read. A drive can be unplugged. */
  available: boolean;
}

/** One entry in the editor's file tree. */
export interface FileEntry {
  /** Workspace-relative, with `/` separators on every platform. */
  path: string;
  name: string;
  is_dir: boolean;
  size: number;
}

/**
 * Files, inside one folder and nowhere else.
 *
 * Every path here is **workspace-relative**. The window never names an
 * absolute one — the folder is chosen once, in Settings, and Rust refuses
 * anything that resolves outside it. Until a folder is opened, nothing here
 * can reach anything at all.
 */
/** What a file that cannot be edited turns out to be. */
export interface FilePreview {
  kind: "image" | "pdf" | "binary";
  mime: string;
  size: number;
  /** Base64 bytes, for images small enough to draw. */
  data?: string | null;
  /** Why there are none, when there are none. */
  note?: string | null;
}

export interface FilesApi {
  /**
   * What a file is, when it is not one the editor can edit.
   *
   * The same bytes `read` returns, through the same checks — it differs only
   * in what it does with something that is not UTF-8.
   */
  preview(root: string, path: string): Promise<FilePreview>;
  /** Make an empty file, or a directory. Refuses a name already taken. */
  create(root: string, path: string, folder: boolean): Promise<void>;
  /** Rename or move, inside one open folder. */
  rename(root: string, from: string, to: string): Promise<void>;
  /** Delete a file, or a directory with nothing in it. */
  remove(root: string, path: string): Promise<void>;
  /** Every folder the editor has open. Empty until somebody opens one. */
  folders(): Promise<Folder[]>;
  /** Open one more folder. */
  openFolder(dir: string): Promise<Folder[]>;
  /** Close one, leaving the others open. */
  closeFolder(dir: string): Promise<Folder[]>;
  /** One directory's contents. An empty path is that folder's own root. */
  list(root: string, path: string): Promise<FileEntry[]>;
  read(root: string, path: string): Promise<string>;
  write(root: string, path: string, text: string): Promise<void>;
}

/**
 * What you are working on, saved under a name.
 *
 * Not a folder and not a window: the answer to "put me back where I was on
 * that project" — which folders the editor had open, where terminals start,
 * how many, and which machine if any.
 */
export interface SavedWorkspace {
  /** Stable across renames. */
  id: string;
  name: string;
  /** Folders for the editor to open, as typed. */
  folders: string[];
  /** Where new terminals start. Absent leaves the setting alone. */
  terminal_dir?: string | null;
  /** How many terminals to open. Zero leaves the terminals alone. */
  terminals: number;
  /** A saved host to open a terminal on, by its id in `RemoteApi`. */
  host?: string | null;
  /** A line about what this is for. */
  note: string;
  last_used: number;
}

export interface Workspaces {
  workspaces: SavedWorkspace[];
  /** The one in use. Null means what is open was arranged by hand. */
  active: string | null;
}

/** What switching to a workspace actually did. */
export interface WorkspaceApplied {
  workspace: SavedWorkspace;
  /** The folders now open in the editor. */
  folders: string[];
  /** Folders it named that are not there. Reported, never deleted. */
  missing: string[];
  /** Where new terminals will start now, if the workspace named somewhere. */
  terminal_dir?: string | null;
  /** Set when it named a start directory that is not there. */
  terminal_dir_missing: boolean;
}

/**
 * Saved project setups.
 *
 * A workspace names folders; it does not grant them. Opening one goes through
 * the same checks as opening a folder by hand, so a hand-edited file is a
 * wish rather than a way to read the machine.
 */
export interface WorkspaceApi {
  list(): Promise<Workspaces>;
  save(workspace: SavedWorkspace): Promise<Workspaces>;
  forget(id: string): Promise<Workspaces>;
  /** Switch. Replaces the open folders with the ones it names. */
  activate(id: string): Promise<WorkspaceApplied>;
  /** Stop being in one. Does not close what is open. */
  leave(): Promise<Workspaces>;
}

/**
 * The window's own life.
 *
 * One capability and one reason: unsaved work. Everything else about the
 * window belongs to the operating system, and an app that asked to manage its
 * own frame would be an app reimplementing a title bar.
 */
export interface LifecycleApi {
  /**
   * Be told before the window closes.
   *
   * The handler answers whether closing may go ahead. Returning false stops
   * it — the app is then expected to ask the person something and call
   * `close` if they say yes. Resolves to a function that stops listening.
   */
  onCloseRequested(handler: () => boolean): Promise<() => void>;
  /** Close for real, past the guard. */
  close(): Promise<void>;
}

/** A command that can be run again on a timer. */
export interface LiveSource {
  /** What the window names. Never a command line. */
  id: string;
  program: string;
  args: string[];
  /** How it is written when typed, for the panel to show. */
  shown: string;
}

/** What a run produced. */
export interface LiveRun {
  text: string;
  /** Zero means it worked. */
  code: number;
}

/**
 * Running one of a few known commands again, so a panel can stay current.
 *
 * `run` takes an **id**, never a command line: the program and its arguments
 * are constants in Rust, handed to the OS as a list with no shell between.
 * There is no path from a string in the window to a process.
 */
export interface LiveApi {
  sources(): Promise<LiveSource[]>;
  run(source: string): Promise<LiveRun>;
}

export interface SettingsApi {
  setSelectedModel(provider: string, model: string): Promise<void>;
  setActiveProvider(provider: string): Promise<void>;
}

export interface PtyApi {
  /** `banner` is stored so the `jky-terminal` shell command can reprint it. */
  spawn(cols: number, rows: number, banner: string, accent: string): Promise<string>;
  /**
   * What a new terminal will run — "zsh", "fish", "powershell".
   *
   * Asked rather than guessed. The status bar used to infer it from the user
   * agent, which says what the operating system is and nothing whatever about
   * the shell.
   */
  shell(): Promise<string>;
  write(id: string, data: string): Promise<void>;
  resize(id: string, cols: number, rows: number): Promise<void>;
  kill(id: string): Promise<void>;
  /** Subscribe to this session's output. Resolves to an unsubscribe function. */
  onData(id: string, handler: (chunk: string) => void): Promise<() => void>;
  /**
   * Start streaming output. Call only after `onData` has resolved: the shell
   * prints its prompt the instant it starts, and attaching first would emit
   * that prompt before anything was listening.
   */
  attach(id: string): Promise<void>;
}

export interface AiMessage {
  role: "user" | "assistant";
  content: Array<
    | { type: "text"; text: string }
    | { type: "tool_use"; id: string; name: string; input: unknown }
    | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean }
  >;
}

export interface ToolRequest {
  id: string;
  name: string;
  command: string;
  reason: string;
  destructive: boolean;
}

export interface ToolRan {
  id: string;
  name: string;
  summary: string;
  is_error: boolean;
}

export interface AiApi {
  send(provider: string, conversation: AiMessage[]): Promise<void>;
  /** Stop the turn in flight. */
  cancel(): Promise<void>;
  approveTool(id: string): Promise<void>;
  rejectTool(id: string): Promise<void>;
  onDelta(handler: (text: string) => void): Promise<() => void>;
  onToolRequest(handler: (req: ToolRequest) => void): Promise<() => void>;
  /** A tool that ran without needing approval. */
  onToolRan(handler: (ran: ToolRan) => void): Promise<() => void>;
  onDone(handler: (stopReason: string) => void): Promise<() => void>;
  onError(handler: (message: string) => void): Promise<() => void>;
  /**
   * One question, one answer.
   *
   * Not `send`: no tools, no history, no turn — so a suggestion under a
   * failed command cannot run anything, and cannot collide with a
   * conversation in the Assistant panel. The answer is cut off once it is
   * long enough, which is the only way to stop paying for one.
   */
  askOnce(provider: string, prompt: string): Promise<string>;
}

export interface CommandSpec {
  /** Every spelling that works. The first is the canonical one. */
  names: string[];
  usage: string;
  summary: string;
  detail: string;
}

// --- the dashboard's collections -------------------------------------------

/**
 * Six named colours. Named, not hex: a hex dot picked against the dark theme
 * is wrong in the six other palettes and invisible in High Contrast, so each
 * theme resolves the name to its own token.
 */
export type EventColour = "rose" | "azure" | "mint" | "amber" | "violet" | "cyan";

export const EVENT_COLOURS: EventColour[] = [
  "rose",
  "azure",
  "mint",
  "amber",
  "violet",
  "cyan",
];

export interface Note {
  id: string;
  title: string;
  body: string;
  /** RFC 3339, UTC. Rendered on the reader's clock, never stored local. */
  created_at: string;
  updated_at: string;
}

export interface Todo {
  id: string;
  text: string;
  done: boolean;
  created_at: string;
}

export interface Event {
  id: string;
  title: string;
  /** RFC 3339, UTC. */
  starts_at: string;
  colour: EventColour;
  /** Minutes of email warning. null means no alert for this event. */
  alert_minutes_before: number | null;
}

/**
 * A daily checklist item.
 *
 * `at` is a local wall-clock "HH:MM", unlike everything else here, because
 * "07:00 morning exercise" means seven in the morning wherever you are.
 */
export interface Reminder {
  id: string;
  text: string;
  at: string;
  done: boolean;
}

/**
 * One collection.
 *
 * Every mutation answers with the whole collection, so the caller cannot end
 * up rendering something other than what is on disk.
 */
export interface CollectionApi<T> {
  list(): Promise<T[]>;
  save(record: T): Promise<T[]>;
  remove(id: string): Promise<T[]>;
}

export interface StoreApi {
  readonly notes: CollectionApi<Note>;
  readonly todos: CollectionApi<Todo>;
  readonly events: CollectionApi<Event>;
  readonly reminders: CollectionApi<Reminder>;
}

/** A game's best score, as the window reports it to the shell listing. */
export interface GameScore {
  id: string;
  best: number;
}

/**
 * What a terminal had on screen, kept across a restart.
 *
 * Capped and rolling, unlike the collections in `StoreApi` — terminal output
 * is emitted rather than authored, and the reasoning for the difference lives
 * in `crates/jky-store/src/scrollback.rs`.
 */
export interface ScrollbackApi {
  load(key: string): Promise<string>;
  save(key: string, text: string): Promise<void>;
  forget(key: string): Promise<void>;
  /** Drop every saved terminal that is not one of `keys`. */
  prune(keys: string[]): Promise<void>;
}

export interface GamesApi {
  /**
   * Hand the shell listing its numbers.
   *
   * High scores live in the window, so `jky games` — which runs in a shell
   * that cannot see browser storage — would otherwise have nothing to print.
   */
  publishScores(scores: GameScore[]): Promise<void>;
}

/**
 * Weather, as `jky-apps` serialises it.
 *
 * The field names are snake_case because serde writes Rust field names as
 * they are declared, and `apps.parity.test.ts` checks these against the Rust
 * source so a rename on either side fails rather than rendering `undefined`.
 */
export interface WeatherConditions {
  temperature_c: number;
  feels_like_c: number;
  humidity_pct: number;
  wind_kph: number;
  /** WMO weather code, kept so the panel can choose an icon. */
  code: number;
  /** The same code in words, sent by Rust so there is one WMO table. */
  description: string;
  is_day: boolean;
  observed_at: string;
}

export interface WeatherDay {
  date: string;
  code: number;
  description: string;
  high_c: number;
  low_c: number;
}

export interface WeatherReport {
  now: WeatherConditions;
  days: WeatherDay[];
  timezone: string;
}

/**
 * A point on the map with a name.
 *
 * Shared by Weather and Map: both need a coordinate, and only one of them is
 * about the weather. Mirrors `Place` in `crates/jky-apps/src/places.rs`.
 */
export interface Place {
  name: string;
  country: string;
  /** State or province: two places share a name often enough to need it. */
  region: string | null;
  latitude: number;
  longitude: number;
  timezone: string | null;
}

/** A newspaper the News app can read. */
export interface NewsSource {
  id: string;
  name: string;
  /** Where this paper reports from; groups the picker. */
  region: string;
  url: string;
}

/** One story, as `jky-apps` serialises it. */
export interface NewsArticle {
  title: string;
  link: string;
  /** A line or two, markup already removed in Rust. */
  summary: string | null;
  category: string | null;
  /** RFC 822 as the feed wrote it; the panel turns it into words. */
  published: string | null;
  source_id: string;
  source_name: string;
  host: string | null;
}

/**
 * How far apart two places are.
 *
 * `straight_m` is always present because it is arithmetic on two coordinates.
 * The road figures are absent when no road connects the two, or when the
 * routing service could not be reached — the straight line is still true, and
 * losing it because a third party was busy would be worse.
 */
export interface Route {
  straight_m: number;
  road_m: number | null;
  duration_s: number | null;
}

/** Whether GitHub can be signed into, and whether it has been. */
export interface GitHubStatus {
  /** An OAuth client id has been set. Without one there is nothing to sign into. */
  configured: boolean;
  /** A token is in the keychain. Never the token itself. */
  connected: boolean;
}

/**
 * What to show while the person approves the sign-in.
 *
 * No device code: that is the credential which redeems the token and it stays
 * in Rust. The window gets the short code to type and where to type it.
 */
export interface GitHubDeviceStart {
  user_code: string;
  verification_uri: string;
  interval_s: number;
  expires_in_s: number;
}

/** How far the sign-in has got. Tagged, so states cannot be confused by spelling. */
export type GitHubConnectState =
  | { state: "pending"; interval_s: number }
  | { state: "connected"; login: string }
  | { state: "denied" }
  | { state: "expired" };

export interface GitHubProfile {
  login: string;
  name: string | null;
  bio: string | null;
  avatar_url: string | null;
  html_url: string;
  public_repos: number;
  followers: number;
  following: number;
}

/** One line of the activity feed, already turned into words by Rust. */
export interface GitHubActivity {
  id: string;
  /** "Pushed to", "Opened PR", "Merged PR", "Starred", … */
  verb: string;
  repo: string;
  detail: string;
  html_url: string;
  at: string;
}

export interface GitHubContribDay {
  date: string;
  count: number;
  /** 0–4, graded against the busiest day of the year. */
  level: number;
}

export interface GitHubContributions {
  total: number;
  /** Weeks of seven days, oldest first — the shape the heatmap draws. */
  weeks: GitHubContribDay[][];
}

export interface GitHubRepo {
  name: string;
  full_name: string;
  private: boolean;
  html_url: string;
  description: string | null;
  language: string | null;
  stars: number;
  open_issues: number;
  updated_at: string;
}

/** An issue or a pull request; GitHub's search returns both in one list. */
export interface GitHubItem {
  number: number;
  title: string;
  html_url: string;
  state: string;
  repo: string | null;
  is_pull_request: boolean;
  draft: boolean;
}

/** One row in a repository's file listing. */
export interface GitHubEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  html_url: string;
}

/** A file's contents, or the reason there are none to show. */
export interface GitHubFile {
  name: string;
  path: string;
  size: number;
  html_url: string;
  text: string | null;
  is_binary: boolean;
  too_large: boolean;
}

export interface GitHubCommit {
  sha: string;
  short_sha: string;
  /** The first line of the message; the body stays on the commit page. */
  subject: string;
  author: string;
  date: string;
  html_url: string;
}

export interface GitHubBranch {
  name: string;
  protected: boolean;
}

export interface GitHubNotification {
  id: string;
  title: string;
  /** Why it is in front of you: "mention", "review requested", … */
  reason: string;
  kind: string;
  repo: string;
  unread: boolean;
  updated_at: string;
  html_url: string;
}

export interface GitHubSummary {
  user: GitHubProfile;
  repos: GitHubRepo[];
  issues: GitHubItem[];
  pulls: GitHubItem[];
  notifications: GitHubNotification[];
  activity: GitHubActivity[];
  /** Stars across the repositories they own. */
  stars_received: number;
  /** Absent when GraphQL declined; the rest of the dashboard still draws. */
  contributions: GitHubContributions | null;
}

/**
 * The GitHub account, over IPC.
 *
 * Note what is absent: nothing here returns a token, and nothing takes a
 * device code. Both stay in Rust for the whole flow.
 */
export interface GitHubApi {
  status(): Promise<GitHubStatus>;
  setClientId(id: string): Promise<void>;
  connectStart(): Promise<GitHubDeviceStart>;
  connectPoll(): Promise<GitHubConnectState>;
  disconnect(): Promise<void>;
  summary(): Promise<GitHubSummary>;
  /** One repository's tree at a path; an empty path is the root. */
  contents(repo: string, path: string): Promise<GitHubEntry[]>;
  file(repo: string, path: string): Promise<GitHubFile>;
  commits(repo: string): Promise<GitHubCommit[]>;
  branches(repo: string): Promise<GitHubBranch[]>;
  notifications(): Promise<GitHubNotification[]>;
}

/** Whether Gmail can be used, and whether it has been signed in to. */
export interface GmailStatus {
  /** A Google client id has been set. Without one there is nothing to sign
   *  in against, and no default ships. */
  configured: boolean;
  /** A token is in the keychain. Never the token. */
  connected: boolean;
}

/** Which mailbox this is. */
export interface GmailAccount {
  address: string;
  messages_total: number;
}

/**
 * One row in the list.
 *
 * There is no body field, and that is not an omission: only three headers and
 * the snippet are ever fetched, so the contents of the mail never reach this
 * side of the boundary.
 */
export interface GmailMessage {
  id: string;
  thread_id: string;
  /** The sender's display name, or their address when they have none. */
  from_name: string;
  from_address: string;
  subject: string;
  snippet: string;
  /** Milliseconds since the epoch. */
  received_ms: number;
  unread: boolean;
}

/**
 * One message with its text, for the reading pane.
 *
 * `body` is text, never markup. Rust turns an HTML part into text before it
 * leaves the backend, so nothing in a message can request an image — a
 * tracking pixel cannot report that it was opened — and no script in one ever
 * reaches something that would run it.
 */
export interface GmailFull {
  message: GmailMessage;
  body: string;
}

export interface GmailMailbox {
  account: GmailAccount;
  messages: GmailMessage[];
}

/**
 * Gmail, read-only.
 *
 * `connect` is one call rather than the start/poll pair GitHub needs: Google
 * refuses an embedded webview, so the sign-in happens in the person's own
 * browser and Rust waits on a loopback socket for the redirect. Nothing to
 * poll, and nothing for the window to hold — it gets back an email address.
 *
 * Note what is absent, as with GitHub: no token, no code, no verifier.
 */
export interface GmailApi {
  status(): Promise<GmailStatus>;
  /**
   * Both halves of the OAuth client, together.
   *
   * Google requires a `client_secret` at the token endpoint even for an
   * installed app, so either half alone cannot sign in — and a panel that
   * accepted one would report itself ready and then fail at the exchange,
   * after the browser, the consent and the redirect had all succeeded.
   */
  configure(id: string, secret: string): Promise<void>;
  /** Runs the whole sign-in. Resolves to the address that was connected. */
  connect(): Promise<string>;
  disconnect(): Promise<void>;
  /** The inbox, or a search across all mail when `query` is given. */
  inbox(count: number, query: string | null): Promise<GmailMailbox>;
  /** One message, with its text. The only call that fetches a body. */
  message(id: string): Promise<GmailFull>;
}

/** Where the browser pane sits, in logical pixels. */
export interface BrowserRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The Browser app's native webview.
 *
 * Not an iframe: most of the web refuses to be framed. This is a child webview
 * the operating system draws, docked into the window — which is also why it
 * cannot be drawn by the browser build, where there is no window to dock into.
 */
export interface BrowserApi {
  /** Open or navigate. Returns the address it actually went to. */
  open(url: string, rect: BrowserRect): Promise<string>;
  /** Move and resize the pane as the layout changes. */
  place(rect: BrowserRect): Promise<void>;
  close(): Promise<void>;
  /** -1 back, 1 forward, 0 reload. */
  history(step: number): Promise<void>;
  /** Whether this build can host a webview at all. */
  readonly available: boolean;
}

/**
 * What the Apps section needs fetched.
 *
 * Every call here crosses to Rust because the window cannot reach the
 * network: `connect-src 'self'` names no host. Nothing on this path is
 * secret — the weather service needs no key — so the boundary is about where
 * network access lives, not about protecting a credential.
 */
export interface AppsApi {
  weather(latitude: number, longitude: number): Promise<WeatherReport>;
  searchPlaces(query: string): Promise<Place[]>;
  /** Headlines from one paper by id, or from every paper when null. */
  news(source: string | null, limit: number): Promise<NewsArticle[]>;
  newsSources(): Promise<NewsSource[]>;
  /**
   * Roughly where this machine is, from its public address.
   *
   * City level at best and wrong behind a VPN, so it is offered as a shortcut
   * beside the search box rather than used as the truth.
   */
  locate(): Promise<Place>;
  route(from: Place, to: Place): Promise<Route>;
  readonly github: GitHubApi;
  readonly gmail: GmailApi;
}

/**
 * One reading of the machine, as Rust measured it.
 *
 * Rates are per second since the previous reading, not totals since boot —
 * the interval is measured on the Rust side rather than assumed, because a
 * sleeping window makes the real gap longer than the one the timer asked for.
 */
export interface SystemReading {
  /** Across all cores, 0–100. */
  cpu_pct: number;
  mem_used: number;
  mem_total: number;
  /** The disk the user's own files are on, not necessarily the root one. */
  disk_used: number;
  disk_total: number;
  net_rx_bps: number;
  net_tx_bps: number;
  /** How long the machine has been up, in seconds. */
  uptime_s: number;
}

/**
 * What the machine is doing.
 *
 * The window cannot read any of this itself, so Rust does and hands back
 * seven numbers. Nothing here names a process, a path or a file — the
 * narrowest thing that can answer "is it the machine or is it me".
 */
export interface SystemApi {
  status(): Promise<SystemReading>;
}

/** One input, every digest. Lowercase hex. */
export interface Hashes {
  md5: string;
  sha1: string;
  sha256: string;
  sha512: string;
}

/**
 * One line of a diff.
 *
 * Both line numbers, because after the first change the two sides stop
 * agreeing about what line anything is on. A line present on only one side
 * has `null` for the other, which is the truth rather than a zero.
 */
export interface DiffLine {
  /** `same`, `added` or `removed`. */
  kind: string;
  old: number | null;
  new: number | null;
  text: string;
}

export interface Diff {
  lines: DiffLine[];
  added: number;
  removed: number;
}

/**
 * The developer tools that need a dependency.
 *
 * The others — JSON, JWT decoding, regular expressions — are native to the
 * window and instant there, so they are not here: a round trip would buy
 * nothing and cost a frame.
 *
 * The browser build cannot do any of these, and says so rather than
 * inventing an answer. A made-up hash is not an illustrative placeholder the
 * way a made-up inbox is; it is a wrong answer to the exact question the tool
 * was opened to answer.
 */
/** One volume, as the machine reports it. */
export interface Volume {
  mount: string;
  kind: string;
  total: number;
  available: number;
}

/** Everything about the machine, in one reading. */
export interface Machine {
  /** Null where the OS will not say — reported as unknown, never guessed. */
  host: string | null;
  os: string | null;
  kernel: string | null;
  cpu_brand: string;
  cores: number;
  /** Per core, 0–100, in the order the OS lists them. */
  per_core: number[];
  mem_used: number;
  mem_total: number;
  swap_used: number;
  swap_total: number;
  /** One, five and fifteen minutes. Zeroes on Windows, which has no such idea. */
  load: [number, number, number];
  uptime_s: number;
  disks: Volume[];
}

export interface Proc {
  pid: number;
  name: string;
  /** Across all cores, so a busy process on eight cores can read 400. */
  cpu_pct: number;
  mem: number;
  started: number;
  command: string;
}

export type ProcSort = "cpu" | "memory" | "name";

/**
 * One thing listening on this machine.
 *
 * A row per port rather than per socket: a server bound to both IP stacks is
 * two rows in the kernel's table and one server, and showing it twice answers
 * a question nobody asked. `addresses` keeps what was merged.
 */
export interface Listener {
  port: number;
  protocol: "tcp" | "udp";
  /**
   * `network` means another machine can reach it — `0.0.0.0` and `::` are
   * every interface, not none. `local` means loopback only.
   */
  reach: "local" | "network";
  /** Null when the socket belongs to a process this user cannot see. */
  pid: number | null;
  /** Empty when the pid is unknown, or names nothing this user can see. */
  process: string;
  command: string;
  addresses: string[];
}

export type PortSort = "port" | "process" | "reach";

export interface Lookup {
  host: string;
  addresses: string[];
  took_ms: number;
}

export interface EnvVar {
  name: string;
  value: string;
  /** Guessed from the name. The panel hides it behind a click. */
  secret: boolean;
}

export interface HttpResponse {
  status: number;
  status_text: string;
  headers: Record<string, string>;
  body: string;
  /** Bytes before truncation, so the size is the truth about the reply. */
  size: number;
  truncated: boolean;
  took_ms: number;
}

export interface ToolsApi {
  hash(text: string): Promise<Hashes>;
  diff(before: string, after: string): Promise<Diff>;
  yamlToJson(text: string): Promise<string>;
  formatYaml(text: string): Promise<string>;
  /** Processor, memory, disks and uptime, in one reading. */
  machine(): Promise<Machine>;
  /** Sorted and cut in Rust; the window names an order, never an expression. */
  processes(sort: ProcSort, search: string): Promise<Proc[]>;
  /** Whether the signal was delivered — not whether the process has gone. */
  endProcess(pid: number): Promise<boolean>;
  /** What is listening, merged and sorted in Rust. Stopping one is `endProcess`. */
  ports(sort: PortSort, search: string): Promise<Listener[]>;
  /** The system resolver, asked where a name points. Addresses only. */
  resolve(host: string): Promise<Lookup>;
  /** What a new terminal would inherit. Not a running shell's environment. */
  environment(): Promise<EnvVar[]>;
  /** One HTTP request. Checked in Rust before any of it is sent. */
  request(
    method: string,
    url: string,
    headers: [string, string][],
    body: string | null,
  ): Promise<HttpResponse>;
}

/**
 * The camera.
 *
 * The window renders a picture of itself and hands over the bytes; where that
 * picture goes is decided in Rust. Neither call names a destination, and
 * neither hands anything back that the window could read — `save` returns the
 * path only so it can be shown to the person who asked.
 */
export interface CaptureApi {
  // The buffer type is pinned because a bare `Uint8Array` is generic over
  // ArrayBufferLike, which includes SharedArrayBuffer - and a Blob will not
  // take one of those. The capture always owns a plain ArrayBuffer.
  /** Write a capture to the downloads folder. Resolves with where it landed. */
  save(png: Uint8Array<ArrayBuffer>): Promise<string>;
  /** Put a capture on the clipboard, writing nothing to disk. */
  copy(png: Uint8Array<ArrayBuffer>): Promise<void>;
}

export interface Platform {
  readonly kind: "web" | "tauri";
  readonly vault: VaultApi;
  readonly settings: SettingsApi;
  /** What every shortcut is bound to. */
  readonly keys: KeysApi;
  /** Every command that has run, and how to find it again. */
  readonly history: HistoryApi;
  /** What could come next on a command line. */
  readonly complete: CompleteApi;
  /** Terminals on other machines. */
  readonly remote: RemoteApi;
  /** Running a known command again, so a panel can stay current. */
  readonly live: LiveApi;
  /** Files, inside folders the person opened and nowhere else. */
  readonly files: FilesApi;
  /** Saved project setups. */
  readonly workspaces: WorkspaceApi;
  /** Being told before the window closes, so unsaved work can be rescued. */
  readonly lifecycle: LifecycleApi;
  readonly pty: PtyApi;
  readonly ai: AiApi;
  /** Notes, todos, events and reminders. Nothing here is ever pruned. */
  readonly store: StoreApi;
  /** What the games need from the backend. */
  readonly games: GamesApi;
  /** The Browser app's native webview. Absent in the browser build. */
  readonly browser: BrowserApi;
  /** What the Apps section needs fetched, since the window cannot fetch. */
  readonly apps: AppsApi;
  /** Hashing, diffing and YAML — the tools that need a dependency. */
  readonly tools: ToolsApi;
  /** Processor, memory, disk and network, for the status readout. */
  readonly system: SystemApi;
  /** What each terminal had on screen last time. */
  readonly scrollback: ScrollbackApi;
  /** Saving or copying a picture of the window. */
  readonly capture: CaptureApi;
  /** The shell commands JKY Terminal installs. */
  listCommands(): Promise<CommandSpec[]>;
  /**
   * Hand a link to the operating system.
   *
   * Not `window.open`: the CSP forbids the webview reaching any external
   * host, and this opens the user's real browser outside the app instead.
   * Only http and https are accepted, checked in Rust.
   */
  openExternal(url: string): Promise<void>;
}
