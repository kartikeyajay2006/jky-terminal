import { Emblem } from "../components/Emblem";

/**
 * The terminal section with no terminal open.
 *
 * Centred in the space a terminal would fill, with the emblem as the one thing
 * to look at and the way to open a terminal right under it. An empty screen is
 * an invitation to act, so it says how, rather than only that nothing is here.
 */
export function EmptyWorkspace() {
  return (
    <div className="workspace__empty">
      <div className="workspace__emblem">
        <Emblem />
      </div>
      <p className="workspace__title">No terminal open</p>
      <p className="workspace__hint">
        Choose <b>+ New terminal</b> above, or press <kbd>Ctrl</kbd>+<kbd>T</kbd>.
      </p>
    </div>
  );
}
