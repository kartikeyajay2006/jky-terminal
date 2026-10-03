import { useTabs } from "../../app/tabStore";
import { useNav } from "../../app/navStore";
import { requestType } from "../terminal/typeEvent";

/**
 * Put a command on the prompt of the terminal that has focus.
 *
 * Typed, not run — the same rule the command panels follow. A history that
 * executed what you clicked would be a history you had to be careful in,
 * and the whole point is to be able to browse it.
 */
export function typeIt(command: string) {
  const { tabs, activeId } = useTabs.getState();
  const tab = tabs.find((t) => t.id === activeId) ?? tabs[0];
  if (!tab) return;
  useTabs.getState().focusPane(tab.id, tab.focusedPane);
  // Onto the terminal section as well, or the command lands on a prompt
  // behind the panel that was asked to put it there.
  useNav.getState().go("terminal");
  requestType({ pane: tab.focusedPane, text: command });
}
