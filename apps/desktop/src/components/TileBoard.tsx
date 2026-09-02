import { useEffect, useState, type ReactNode } from "react";
import {
  addGroup,
  defaultLayout,
  duplicateItem,
  loadLayout,
  moveItem,
  removeGroup,
  removeItem,
  renameGroup,
  restoreAll,
  saveLayout,
  setHidden,
  setSize,
  shownItems,
  togglePin,
  type Group,
  type GroupSpec,
  type Layout,
  type Placeable,
  type Placement,
  type TileSize,
} from "../lib/tileLayout";

/**
 * A board of tiles you can open, and rearrange.
 *
 * Shared by the Apps grid and the Developer Tools grid. They want exactly the
 * same board — drag, resize, pin, hide, duplicate, group — and differ only in
 * what a tile says and where a new one lands. Two copies of this would be two
 * copies of the drag handling, and the second copy is the one that stops
 * getting fixed.
 *
 * Editing is a mode. Outside it a tile is a button that opens something; a
 * board where every tile also carries six controls is one you cannot use for
 * the thing it is for.
 */

/** Everything a tile shows. The board never looks inside beyond this. */
export interface BoardItem extends Placeable {
  name: string;
  glyph: string;
  blurb: string;
  /** A theme token name — `accent`, `mint`, `warn`. Never a colour. */
  accent: string;
  /** A short word under the name, when there is something to say. */
  badge?: string;
}

export interface TileBoardProps<T extends BoardItem> {
  items: T[];
  groups: GroupSpec<T>[];
  /**
   * What this board is, for anyone who cannot see it.
   *
   * Named by the caller rather than fixed as "Board": a screen reader saying
   * "Board" twice in an app with two of them is no better than saying
   * nothing.
   */
  label: string;
  /** Where this board's arrangement is kept. One key per board. */
  storageKey: string;
  /** Which items are already open, marked so on their tiles. */
  openIds?: string[];
  onOpen: (id: string) => void;
  /** The heading, counts and prose above the board. */
  header: (counts: { shown: number; groups: number; hidden: number }) => ReactNode;
}

export function TileBoard<T extends BoardItem>({
  items,
  groups,
  label,
  storageKey,
  openIds = [],
  onOpen,
  header,
}: TileBoardProps<T>) {
  const [layout, setLayout] = useState<Layout>(() => loadLayout(storageKey, items, groups));
  const [editing, setEditing] = useState(false);
  const [naming, setNaming] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  useEffect(() => {
    saveLayout(storageKey, layout);
  }, [storageKey, layout]);

  const hidden = layout.groups.flatMap((g) => g.items).filter((i) => i.hidden).length;
  const shown = layout.groups.flatMap((g) => shownItems(g)).length;

  /** Every drop target needs the same handler; only the index differs. */
  function drop(groupId: string, index: number) {
    return (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (dragging) setLayout((l) => moveItem(l, dragging, groupId, index));
      setDragging(null);
    };
  }

  return (
    <div className="board">
      <header className="board__head" aria-label={label}>
        {header({ shown, groups: layout.groups.length, hidden })}

        <div className="toolbar board__tools">
          <button
            type="button"
            className="tool"
            aria-pressed={editing}
            onClick={() => setEditing((on) => !on)}
          >
            {editing ? "Done" : "Edit layout"}
          </button>
          {editing && (
            <>
              <button
                type="button"
                className="tool"
                onClick={() => {
                  // Straight into the name field: you name a thing when you
                  // make it, and "New group" is not a name anyone wanted.
                  const next = addGroup(layout, "New group");
                  setLayout(next);
                  setNaming(next.groups.at(-1)!.id);
                }}
              >
                Add group
              </button>
              {/* Only offered when there is something to bring back, so it is
                  never a button that does nothing. */}
              {hidden > 0 && (
                <button type="button" className="tool" onClick={() => setLayout(restoreAll)}>
                  Restore {hidden} hidden
                </button>
              )}
              <button
                type="button"
                className="tool tool--quiet"
                onClick={() => setLayout(defaultLayout(items, groups))}
              >
                Reset
              </button>
            </>
          )}
        </div>
      </header>

      <div className="board__groups" role="region" aria-label={label}>
        {layout.groups.map((group) => (
          <section className="board__group" key={group.id} data-editing={editing || undefined}>
            <div className="board__group-head">
              {naming === group.id ? (
                <input
                  className="board__group-input"
                  aria-label="Group name"
                  defaultValue={group.name}
                  autoFocus
                  onBlur={(e) => {
                    setLayout((l) => renameGroup(l, group.id, e.target.value));
                    setNaming(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") setNaming(null);
                  }}
                />
              ) : (
                <h2 className="board__group-name">{group.name}</h2>
              )}
              <span className="board__group-count" aria-hidden="true">
                {shownItems(group).length}
              </span>
              {editing && (
                <span className="board__group-tools">
                  <button
                    type="button"
                    className="tool tool--small"
                    onClick={() => setNaming(group.id)}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    className="tool tool--small"
                    aria-label={`Remove group ${group.name}`}
                    disabled={layout.groups.length <= 1}
                    onClick={() => setLayout((l) => removeGroup(l, group.id))}
                  >
                    Remove group
                  </button>
                </span>
              )}
            </div>

            <ul
              className="board__grid"
              aria-label={group.name}
              onDragOver={editing ? (e) => e.preventDefault() : undefined}
              onDrop={editing ? drop(group.id, Number.MAX_SAFE_INTEGER) : undefined}
            >
              {shownItems(group).map((placement, index) => {
                const item = items.find((i) => i.id === placement.appId);
                if (!item) return null;
                return (
                  <li
                    key={placement.key}
                    onDragOver={editing ? (e) => e.preventDefault() : undefined}
                    onDrop={editing ? drop(group.id, index) : undefined}
                  >
                    <Tile
                      item={item}
                      placement={placement}
                      open={openIds.includes(item.id)}
                      editing={editing}
                      dragging={dragging === placement.key}
                      groups={layout.groups}
                      onOpen={onOpen}
                      onDragStart={() => setDragging(placement.key)}
                      onDragEnd={() => setDragging(null)}
                      onChange={setLayout}
                    />
                  </li>
                );
              })}

              {editing && shownItems(group).length === 0 && (
                <li className="board__empty">Drag something here.</li>
              )}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

function Tile<T extends BoardItem>({
  item,
  placement,
  open,
  editing,
  dragging,
  groups,
  onOpen,
  onDragStart,
  onDragEnd,
  onChange,
}: {
  item: T;
  placement: Placement;
  open: boolean;
  editing: boolean;
  dragging: boolean;
  groups: Group[];
  onOpen: (id: string) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onChange: (update: (l: Layout) => Layout) => void;
}) {
  /** Small → medium → large → small. One button rather than three. */
  const nextSize: TileSize =
    placement.size === "small" ? "medium" : placement.size === "medium" ? "large" : "small";

  /** Where a duplicate goes: the next group round, so one click is enough. */
  const elsewhere =
    groups[
      (groups.findIndex((g) => g.items.some((i) => i.key === placement.key)) + 1) % groups.length
    ];

  return (
    // A group rather than a button while editing: it holds controls, and a
    // button containing buttons is invalid and unusable with a keyboard.
    <div
      className="board__tile"
      role="group"
      aria-label={item.name}
      data-size={placement.size}
      data-editing={editing || undefined}
      data-dragging={dragging || undefined}
      data-pinned={placement.pinned || undefined}
      // Set as a variable rather than a class per item, so adding one is a
      // registry entry and never a new stylesheet rule.
      style={{ ["--app-accent" as string]: `var(--${item.accent})` }}
      draggable={editing}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
    >
      {editing ? (
        <span className="board__tile-face">
          <TileFace item={item} open={open} pinned={placement.pinned} />
        </span>
      ) : (
        <button type="button" className="board__tile-face" onClick={() => onOpen(item.id)}>
          <TileFace item={item} open={open} pinned={placement.pinned} />
          <span className="board__tile-go" aria-hidden="true">
            →
          </span>
        </button>
      )}

      {editing && (
        <div className="board__tile-edit">
          <button
            type="button"
            className="pill"
            aria-label={`Size: ${placement.size}`}
            onClick={() => onChange((l) => setSize(l, placement.key, nextSize))}
          >
            {placement.size[0].toUpperCase()}
          </button>
          <button
            type="button"
            className="pill"
            aria-pressed={placement.pinned}
            aria-label={placement.pinned ? "Unpin" : "Pin"}
            onClick={() => onChange((l) => togglePin(l, placement.key))}
          >
            ⚲
          </button>
          <button
            type="button"
            className="pill"
            aria-label="Duplicate"
            onClick={() => onChange((l) => duplicateItem(l, placement.key, elsewhere.id))}
          >
            ⧉
          </button>
          <button
            type="button"
            className="pill"
            aria-label="Hide"
            onClick={() => onChange((l) => setHidden(l, placement.key, true))}
          >
            ◯
          </button>
          <button
            type="button"
            className="pill pill--danger"
            aria-label="Remove"
            onClick={() => onChange((l) => removeItem(l, placement.key))}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}

/** What a tile says, whichever mode it is in. */
function TileFace({ item, open, pinned }: { item: BoardItem; open: boolean; pinned: boolean }) {
  return (
    <>
      <span className="board__tile-well" aria-hidden="true">
        <span className="board__tile-glyph">{item.glyph}</span>
      </span>
      <span className="board__tile-name">{item.name}</span>
      <span className="board__tile-blurb">{item.blurb}</span>
      <span className="board__tile-feet">
        {pinned && <span className="board__tile-open">pinned</span>}
        {open && <span className="board__tile-open">open</span>}
        {item.badge && <span className="board__tile-auth">{item.badge}</span>}
      </span>
    </>
  );
}
