export type ThemeId =
  | "cyberpunk"
  | "dracula"
  | "nord"
  | "solarized"
  | "light"
  | "gold"
  | "contrast";

export interface ThemeSpec {
  id: ThemeId;
  label: string;
  /** Shown in the switcher so the palette is recognisable before applying. */
  swatch: string;
}

export const THEMES: ThemeSpec[] = [
  { id: "cyberpunk", label: "Cyberpunk", swatch: "#00e5ff" },
  { id: "dracula", label: "Dracula", swatch: "#bd93f9" },
  { id: "nord", label: "Nord", swatch: "#88c0d0" },
  { id: "solarized", label: "Solarized", swatch: "#2aa198" },
  { id: "light", label: "Light", swatch: "#0f62fe" },
  { id: "gold", label: "Gold", swatch: "#9a6d0a" },
  { id: "contrast", label: "High Contrast", swatch: "#ffffff" },
];

export const DEFAULT_THEME: ThemeId = "cyberpunk";
const STORAGE_KEY = "jky.theme";

function isThemeId(value: string | null): value is ThemeId {
  return THEMES.some((t) => t.id === value);
}

export function applyTheme(id: ThemeId): void {
  document.documentElement.setAttribute("data-theme", id);
}

export function loadTheme(): ThemeId {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isThemeId(stored) ? stored : DEFAULT_THEME;
  } catch {
    // Storage can throw outright in a private window. A remembered theme is
    // a convenience; never let it take the app down.
    return DEFAULT_THEME;
  }
}

export function saveTheme(id: ThemeId): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Same reasoning as loadTheme: preference lost, app fine.
  }
}
