// Apart from `Dashboard.tsx` so the palette can list these without importing
// the panels that draw them: one static import of that file puts the whole
// section back in the entry bundle, which `src/lazy.test.ts` guards.

export type DashPanel = "overview" | "notes" | "todos" | "calendar" | "reminders";

interface Section {
  id: DashPanel;
  label: string;
  glyph: string;
}

/** The sub-sections, in the order they appear down the side. */
export const SECTIONS: Section[] = [
  { id: "overview", label: "Overview", glyph: "◆" },
  { id: "notes", label: "Notes", glyph: "▤" },
  { id: "todos", label: "Todos", glyph: "☑" },
  { id: "calendar", label: "Calendar", glyph: "▦" },
  { id: "reminders", label: "Reminders", glyph: "◔" },
];
