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

export interface SettingsApi {
  setSelectedModel(provider: string, model: string): Promise<void>;
  setActiveProvider(provider: string): Promise<void>;
}

export interface PtyApi {
  /** `banner` is stored so the `jky-terminal` shell command can reprint it. */
  spawn(cols: number, rows: number, banner: string, accent: string): Promise<string>;
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
}

export interface Platform {
  readonly kind: "web" | "tauri";
  readonly vault: VaultApi;
  readonly settings: SettingsApi;
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
  /** What each terminal had on screen last time. */
  readonly scrollback: ScrollbackApi;
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
