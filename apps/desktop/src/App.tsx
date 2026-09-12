import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { Shell } from "./app/Shell";
import { TabBar } from "./app/TabBar";
import { useAsk } from "./app/askStore";
import { useChat } from "./app/chatStore";
import { allPaneKeys, useTabs } from "./app/tabStore";
import { useShortcuts } from "./app/useShortcuts";
import { actionFor, useKeymap } from "./app/keymapStore";
import { Assistant } from "./features/assistant/Assistant";
import { Dashboard } from "./features/dashboard/Dashboard";
import { useDashboard } from "./features/dashboard/dashboardStore";
import { Apps } from "./features/apps/Apps";
import { History } from "./features/history/History";
import { Remote } from "./features/remote/Remote";
import { UnsavedDialog, type Answer } from "./features/editor/UnsavedDialog";
import { idOf, isDirty, unsavedCount, useEditor } from "./features/editor/editorStore";
import { Workspaces } from "./features/workspace/Workspaces";

import { useOpenGame } from "./features/games/openStore";
import { useNav } from "./app/navStore";
import { Palette } from "./features/palette/Palette";
import { Settings } from "./features/settings/Settings";
import { PaneTree } from "./features/terminal/panes/PaneTree";
import { getPlatform } from "./platform";
import "./styles/tokens.css";
import "./styles/themes.css";
import "./styles/base.css";
// After the tokens it reads and before any component that animates.
import "./styles/motion.css";
import "./styles/controls.css";
import "./styles/board.css";

/**
 * The editor, fetched when it is first opened.
 *
 * CodeMirror is about a third of a megabyte, and nobody who never opens the
 * editor should download it — which is exactly the objection that kept an
 * editor out of this app in the first place. Loaded this way it is a chunk of
 * its own, and each language mode is another (see `editor/language.ts`), so
 * the cost is paid by whoever asks for it and by nobody else.
 */
const Editor = lazy(async () => ({
  default: (await import("./features/editor/Editor")).Editor,
}));

/**
 * Two sections that are whole applications, fetched when they are opened.
 *
 * Games carries four game engines and Developer carries a regex worker, a JWT
 * decoder and a JSON tool. Both are reached by clicking a rail item, which
 * means neither is on the path to a terminal — and a terminal is what this
 * app is for. Keeping them in the entry bundle made every cold start pay for
 * tools most sessions never open.
 */
const Games = lazy(async () => ({
  default: (await import("./features/games/Games")).Games,
}));

const Developer = lazy(async () => ({
  default: (await import("./features/developer/Developer")).Developer,
}));

export function App() {
  const [section, setSection] = useState("terminal");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const tabs = useTabs((s) => s.tabs);
  const activeId = useTabs((s) => s.activeId);

  useShortcuts();

  /*
   * Nothing unsaved leaves without being asked about.
   *
   * The editor is unmounted whenever you are looking at something else, so
   * this cannot live there: the window can be closed from any section, and
   * from the terminal the editor does not exist to object. The files
   * themselves live in `editorStore`, which is why there is anything to ask
   * about at all.
   */
  const [quitting, setQuitting] = useState(false);
  useEffect(() => {
    let stop: (() => void) | undefined;

    void getPlatform()
      .lifecycle.onCloseRequested(() => {
        // Nothing to lose, so nothing to ask. `lifecycle.close` goes round
        // this guard rather than through it, so the answer never has to be
        // remembered.
        if (unsavedCount() === 0) return true;
        setQuitting(true);
        return false;
      })
      .then((off) => {
        stop = off;
      })
      .catch(() => {});

    return () => stop?.();
  }, []);

  const leave = useCallback(async (answer: Answer) => {
    setQuitting(false);
    if (answer === "cancel") return;

    if (answer === "save") {
      // Everything, then out. One that will not save keeps the window open
      // and says so rather than being lost on the way past.
      const editor = useEditor.getState();
      for (const file of editor.open.filter(isDirty)) {
        if (!(await useEditor.getState().save(idOf(file)))) {
          setSection("editor");
          return;
        }
      }
    }
    await getPlatform().lifecycle.close();
  }, []);

  // What the keys are bound to, before anything can be pressed. The store
  // starts on the defaults, so the gap before this lands is a window with
  // working shortcuts rather than a window with none.
  useEffect(() => {
    void useKeymap.getState().load();
  }, []);

  // Bring back conversations from the last run before anything renders them.
  useEffect(() => {
    useChat.getState().restore();
  }, []);

  // Loaded here, not only inside the Dashboard, so the notification tray has
  // events and reminders to check even if you never open the Dashboard tab.
  useEffect(() => {
    void useDashboard.getState().load();
  }, []);

  // Saved output for tabs that no longer exist is dropped once, at startup.
  // A tab closed while the app was not running would otherwise leave its
  // scrollback on disk for ever.
  useEffect(() => {
    // Every pane, not every tab: a split tab keeps one scrollback per
    // terminal in it, and pruning by tab id alone would throw away the
    // output of every pane but the first on each start.
    const keys = allPaneKeys(useTabs.getState().tabs);
    void getPlatform().scrollback.prune(keys).catch(() => {});
  }, []);

  // Assistant events are subscribed here, not in the panel. A stream that
  // arrives while the terminal is showing must still land in the session —
  // when the panel owned these, switching away silently dropped the answer.
  useEffect(() => {
    const platform = getPlatform();
    const cleanups: Array<() => void> = [];
    let cancelled = false;
    const chat = useChat.getState();

    void (async () => {
      const subs = await Promise.all([
        platform.ai.onDelta((text) => useChat.getState().appendToLastAssistant(text)),
        platform.ai.onToolRequest((req) => useChat.getState().addTool(req)),
        platform.ai.onToolRan((ran) =>
          useChat
            .getState()
            .appendToLastAssistant(
              `\n▸ ${ran.name} — ${ran.summary}${ran.is_error ? " (failed)" : ""}\n`,
            ),
        ),
        platform.ai.onDone(() => useChat.getState().setBusy(false)),
        platform.ai.onError((message) => {
          useChat.getState().setError(message);
          useChat.getState().setBusy(false);
        }),
      ]);
      if (cancelled) {
        subs.forEach((fn) => fn());
        return;
      }
      cleanups.push(...subs);
    })();

    void chat;
    return () => {
      cancelled = true;
      cleanups.forEach((fn) => fn());
    };
  }, []);

  // A question raised from a terminal pulls the assistant into view. Asking
  // and then having to find the answer would defeat the point of asking from
  // where you already are.
  const pendingQuestion = useAsk((s) => s.pending);
  useEffect(() => {
    if (pendingQuestion) setSection("assistant");
  }, [pendingQuestion]);

  // `jky games <n>` in a terminal brings the arcade up on that game. The
  // request is left in the store for the section to take, so which game was
  // asked for survives the switch.
  const pendingGame = useOpenGame((s) => s.pending);
  useEffect(() => {
    if (pendingGame) setSection("games");
  }, [pendingGame]);

  // The palette navigates by leaving a request here. The section is taken
  // now; any panel inside it is taken by that section itself, which is why
  // this reads the target rather than clearing it outright.
  const pendingNav = useNav((s) => s.pending);
  useEffect(() => {
    if (pendingNav) setSection(pendingNav.section);
  }, [pendingNav]);

  // The palette, bound here rather than in useShortcuts because it is the one
  // shortcut that has to work while a terminal has the keyboard.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (actionFor(e) === "palette-toggle") {
        e.preventDefault();
        setPaletteOpen((open) => !open);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <Shell activeId={section} onSelect={setSection}>
      {/* Hidden rather than unmounted, for the same reason the tabs inside it
          are: a terminal that unmounts disposes its display and kills its
          shell, so everything typed is gone and coming back spawns a fresh
          one. The rule was applied between tabs and not between sections, so
          a trip to the dashboard threw away every open shell. */}
      <div className="workspace" hidden={section !== "terminal"}>
        <TabBar />
        <div className="workspace__body">
          {tabs.map((tab) => (
            <div key={tab.id} className="workspace__pane" hidden={tab.id !== activeId}>
              <PaneTree
                tabId={tab.id}
                tree={tab.layout}
                focused={tab.focusedPane}
                remotes={tab.remotes}
                live={tab.id === activeId && section === "terminal"}
              />
            </div>
          ))}
          {tabs.length === 0 && (
            <p className="workspace__empty">
              No terminal open. Choose <b>+ New terminal</b> above, or press{" "}
              <kbd>Ctrl</kbd>+<kbd>T</kbd>.
            </p>
          )}
        </div>
      </div>

      {/* These three keep their state in stores, so unmounting costs nothing
          and mounting them all at once would run four sets of effects on
          every start. */}
      {/* Unmounted on leaving: it holds a search box and a debounce timer,
          and a section nobody is looking at has no business reading the
          history file every time a key is pressed somewhere else. */}
      {section === "history" && <History />}
      {section === "remote" && <Remote />}
      {section === "workspaces" && <Workspaces />}
      {/* Unmounted on leaving: CodeMirror owns its own DOM and its own
          listeners, and one left mounted behind a section nobody is looking
          at is a document tree kept alive for nothing. Unsaved text lives in
          this component, so leaving and coming back reopens from disk — the
          honest behaviour for an editor that has not saved. */}
      {section === "editor" && (
        <Suspense fallback={<p className="workspace__empty">Opening the editor…</p>}>
          <Editor />
        </Suspense>
      )}
      {section === "settings" && <Settings />}
      {section === "dashboard" && <Dashboard />}
      {section === "assistant" && <Assistant />}
      {/* Unmounted when you leave, which stops its frame loop dead: three of
          the four games animate, and one left running in the background
          would burn a core painting a board nobody is looking at. */}
      {section === "games" && (
        <Suspense fallback={<p className="workspace__empty">Loading games…</p>}>
          <Games />
        </Suspense>
      )}
      {/* Unmounted on leaving for the same reason: the apps that fetch would
          keep polling behind a section nobody is looking at, and a timer would
          keep counting where it cannot be seen. */}
      {section === "apps" && <Apps />}
      {/* Unmounted on leaving like the rest: the regex tester owns a worker,
          and one left running behind a section nobody is looking at is a
          thread nobody can see. */}
      {section === "developer" && (
        <Suspense fallback={<p className="workspace__empty">Loading the tools…</p>}>
          <Developer />
        </Suspense>
      )}

      {paletteOpen && <Palette onClose={() => setPaletteOpen(false)} />}

      {quitting && (
        <UnsavedDialog
          title={`${unsavedCount()} unsaved ${unsavedCount() === 1 ? "file" : "files"}`}
          body="Closing now throws away everything that is not on disk."
          saveLabel="Save all and quit"
          discardLabel="Quit anyway"
          onAnswer={(answer) => void leave(answer)}
        />
      )}
    </Shell>
  );
}
