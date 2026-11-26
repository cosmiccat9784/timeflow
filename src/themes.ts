/**
 * Theme system: a JSON-described palette + typography + background.
 *
 * A theme is data, not code. Presets ship in `public/themes/themes.json` and
 * point at images in `public/themes/backgrounds/`; users can also import their
 * own JSON from the Themes page and it is stored with their settings.
 */

export type ThemeBase = "light" | "dark";

export interface ThemeColours {
  main: string;
  sidebar: string;
  panel: string;
  elevated: string;
  border: string;
  gridLine: string;
  text: string;
  textSecondary: string;
  textMuted: string;
}

export interface ThemeBackground {
  /** "none" keeps the theme's own surfaces. */
  mode: "none" | "solid" | "image";
  /** Solid tint, or the colour behind a translucent image. */
  colour?: string;
  /** Path relative to the themes folder (`backgrounds/x.jpg`) or a data URL. */
  image?: string;
  /** 0–100 veil over the image so text stays readable. */
  dim?: number;
}

export interface ThemeFonts {
  /** CSS font-family stack for body text. */
  sans?: string;
  /** CSS font-family stack for headings. */
  heading?: string;
  /** Base font size in px (13–18). */
  size?: number;
}

import type { AppearanceSettings } from "./types";

export interface ThemeDefinition {
  id: string;
  name: string;
  base: ThemeBase;
  /** Primary accent: buttons, active items, toggles. */
  accent: string;
  /** Selection / today highlight, distinct from the accent when desired. */
  highlight: string;
  colours?: Partial<ThemeColours>;
  fonts?: ThemeFonts;
  background?: ThemeBackground;
  /** Present on shipped presets so users can tell them from their own. */
  builtin?: boolean;
}

export interface ThemesFile {
  version: 1;
  /** Folder the `background.image` paths are relative to. */
  backgroundsPath?: string;
  themes: ThemeDefinition[];
}

const DARK_BASE: ThemeColours = {
  main: "#050505",
  sidebar: "#181818",
  panel: "#202020",
  elevated: "#292929",
  border: "#303030",
  gridLine: "#1E1E1E",
  text: "#F2F2F2",
  textSecondary: "#B0B0B0",
  textMuted: "#858585",
};

const LIGHT_BASE: ThemeColours = {
  main: "#FAFAF7",
  sidebar: "#FFFFFF",
  panel: "#FFFFFF",
  elevated: "#F5F5F0",
  border: "#E6E2D8",
  gridLine: "#EEE9DC",
  text: "#23272E",
  textSecondary: "#5B6470",
  textMuted: "#858585",
};

export function baseColours(base: ThemeBase): ThemeColours {
  return { ...(base === "dark" ? DARK_BASE : LIGHT_BASE) };
}

export const FONT_PRESETS: { name: string; value: string }[] = [
  { name: "Inter / system", value: '"Inter", system-ui, -apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif' },
  { name: "Segoe UI", value: '"Segoe UI", system-ui, sans-serif' },
  { name: "Helvetica Neue", value: '"Helvetica Neue", Helvetica, Arial, sans-serif' },
  { name: "Georgia", value: 'Georgia, "Times New Roman", serif' },
  { name: "Iowan / serif", value: '"Iowan Old Style", Palatino, "Palatino Linotype", serif' },
  { name: "Mono", value: '"Cascadia Code", "SF Mono", Consolas, "Liberation Mono", monospace' },
  { name: "Rounded", value: 'Nunito, "Segoe UI", system-ui, sans-serif' },
];

export const HIGHLIGHT_PRESETS = ["#22D3EE", "#FFD166", "#4ADE80", "#F472B6", "#A78BFA", "#F97316"];
export const ACCENT_PRESETS = ["#FF940E", "#F5A524", "#F04E6E", "#C94BFF", "#7C5CFF", "#2E90FA", "#14B8A6", "#3DD68C", "#A3E635"];

const HEX = /^#([0-9a-f]{6})$/i;
const isHex = (v: unknown): v is string => typeof v === "string" && HEX.test(v.trim());

/** Clamp a font size to something readable. */
export function clampFontSize(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : 14;
  return Math.max(13, Math.min(18, Math.round(n)));
}

export function clampDim(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : 45;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * Validate and normalise a theme from JSON. Unknown fields are dropped,
 * colours are upper-cased, and a missing highlight falls back to the accent.
 * Returns the reason when the input cannot be salvaged.
 */
export function normaliseTheme(raw: unknown): { ok: true; theme: ThemeDefinition } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "A theme must be a JSON object." };
  const t = raw as Record<string, unknown>;
  const id = typeof t.id === "string" ? t.id.trim() : "";
  const name = typeof t.name === "string" ? t.name.trim() : "";
  if (!id) return { ok: false, error: "Theme is missing an \"id\"." };
  if (!/^[a-z0-9][a-z0-9-_]*$/i.test(id)) return { ok: false, error: `Theme id "${id}" must use letters, numbers, - and _.` };
  if (!name) return { ok: false, error: `Theme "${id}" is missing a "name".` };
  const base = t.base === "light" ? "light" : t.base === "dark" ? "dark" : null;
  if (!base) return { ok: false, error: `Theme "${id}" needs "base": "light" or "dark".` };
  if (!isHex(t.accent)) return { ok: false, error: `Theme "${id}" needs a 6-digit hex "accent".` };

  const coloursIn = (t.colours ?? {}) as Record<string, unknown>;
  const colours: Partial<ThemeColours> = {};
  for (const key of Object.keys(DARK_BASE) as (keyof ThemeColours)[]) {
    const v = coloursIn[key];
    if (v === undefined) continue;
    if (!isHex(v)) return { ok: false, error: `Theme "${id}" colour "${key}" must be a 6-digit hex.` };
    colours[key] = v.toUpperCase();
  }

  const bgIn = (t.background ?? {}) as Record<string, unknown>;
  let background: ThemeBackground | undefined;
  if (bgIn.mode !== undefined) {
    const mode = bgIn.mode === "solid" || bgIn.mode === "image" ? bgIn.mode : bgIn.mode === "none" ? "none" : null;
    if (!mode) return { ok: false, error: `Theme "${id}" background.mode must be "none", "solid" or "image".` };
    if (bgIn.colour !== undefined && !isHex(bgIn.colour)) {
      return { ok: false, error: `Theme "${id}" background.colour must be a 6-digit hex.` };
    }
    if (bgIn.image !== undefined && typeof bgIn.image !== "string") {
      return { ok: false, error: `Theme "${id}" background.image must be a path or data URL.` };
    }
    background = {
      mode,
      colour: typeof bgIn.colour === "string" ? bgIn.colour.toUpperCase() : undefined,
      image: typeof bgIn.image === "string" && bgIn.image ? bgIn.image : undefined,
      dim: bgIn.dim === undefined ? undefined : clampDim(bgIn.dim),
    };
  }

  const fontsIn = (t.fonts ?? {}) as Record<string, unknown>;
  const fonts: ThemeFonts = {};
  if (typeof fontsIn.sans === "string" && fontsIn.sans.trim()) fonts.sans = fontsIn.sans.trim();
  if (typeof fontsIn.heading === "string" && fontsIn.heading.trim()) fonts.heading = fontsIn.heading.trim();
  if (fontsIn.size !== undefined) fonts.size = clampFontSize(fontsIn.size);

  return {
    ok: true,
    theme: {
      id,
      name,
      base,
      accent: (t.accent as string).toUpperCase(),
      highlight: isHex(t.highlight) ? t.highlight.toUpperCase() : (t.accent as string).toUpperCase(),
      colours: Object.keys(colours).length ? colours : undefined,
      fonts: Object.keys(fonts).length ? fonts : undefined,
      background,
      builtin: t.builtin === true,
    },
  };
}

/** Parse a themes file (or a bare array of themes). */
export function parseThemesFile(raw: unknown): { ok: true; file: ThemesFile } | { ok: false; error: string } {
  const themesRaw = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as Record<string, unknown>).themes)
      ? ((raw as Record<string, unknown>).themes as unknown[])
      : null;
  if (!themesRaw) return { ok: false, error: "The file must contain a \"themes\" array." };
  const themes: ThemeDefinition[] = [];
  for (const item of themesRaw) {
    const r = normaliseTheme(item);
    if (!r.ok) return { ok: false, error: r.error };
    themes.push(r.theme);
  }
  if (themes.length === 0) return { ok: false, error: "No themes found in the file." };
  const seen = new Set<string>();
  for (const t of themes) {
    if (seen.has(t.id)) return { ok: false, error: `Duplicate theme id "${t.id}".` };
    seen.add(t.id);
  }
  const fileRaw = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  return {
    ok: true,
    file: {
      version: 1,
      backgroundsPath: typeof fileRaw.backgroundsPath === "string" ? fileRaw.backgroundsPath : undefined,
      themes,
    },
  };
}

/** Merge the theme's palette over its base, so a theme only lists changes. */
export function resolveColours(theme: ThemeDefinition): ThemeColours {
  return { ...baseColours(theme.base), ...(theme.colours ?? {}) };
}

export interface AppliedTheme {
  colours: ThemeColours;
  accent: string;
  highlight: string;
  fonts: Required<Pick<ThemeFonts, "sans" | "heading" | "size">>;
  background: Required<Pick<ThemeBackground, "mode" | "dim">> & Pick<ThemeBackground, "colour" | "image">;
}

/** Resolve a theme plus any per-user overrides into concrete values. */
export function resolveTheme(
  theme: ThemeDefinition,
  overrides?: {
    accent?: string;
    highlight?: string;
    font?: string;
    backgroundMode?: "none" | "solid" | "image" | "theme";
    backgroundColour?: string;
    backgroundImage?: string | null;
    backgroundDim?: number;
  },
): AppliedTheme {
  const o = overrides ?? {};
  const bg = theme.background ?? { mode: "none" as const };
  return {
    colours: resolveColours(theme),
    accent: isHex(o.accent) ? o.accent.toUpperCase() : theme.accent,
    highlight: isHex(o.highlight) ? o.highlight.toUpperCase() : (theme.highlight ?? theme.accent),
    fonts: {
      sans: o.font?.trim() || theme.fonts?.sans || FONT_PRESETS[0].value,
      heading: theme.fonts?.heading || o.font?.trim() || FONT_PRESETS[0].value,
      size: clampFontSize(theme.fonts?.size),
    },
    background: {
      mode: o.backgroundMode && o.backgroundMode !== "theme" ? o.backgroundMode : bg.mode,
      colour: (isHex(o.backgroundColour) ? o.backgroundColour : bg.colour)?.toUpperCase(),
      // null means "no local override" — keep the theme's own image.
      image: typeof o.backgroundImage === "string" ? o.backgroundImage : bg.image,
      dim: clampDim(o.backgroundDim ?? bg.dim),
    },
  };
}

/** Placeholder used when a theme references an image path. */
export function backgroundUrl(image: string | undefined, folder = "/themes/backgrounds"): string | null {
  if (!image) return null;
  if (image.startsWith("data:") || /^https?:/i.test(image)) return image;
  return `${folder.replace(/\/$/, "")}/${image.replace(/^\//, "")}`;
}

/** WCAG relative luminance, 0 (black) … 1 (white). */
export function luminance(hex: string): number {
  const n = normalizeHex(hex) ?? "#000000";
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const r = channel(parseInt(n.slice(1, 3), 16));
  const g = channel(parseInt(n.slice(3, 5), 16));
  const b = channel(parseInt(n.slice(5, 7), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function normalizeHex(value: string): string | null {
  const m = value.trim().match(/^#?([0-9a-f]{6})$/i);
  return m ? `#${m[1].toUpperCase()}` : null;
}

/** Ink colour that stays readable on the given accent. */
export function contrastInk(hex: string): string {
  return luminance(hex) > 0.55 ? "#0B0B0B" : "#FFFFFF";
}

export function rgba(hex: string, alpha: number): string {
  const n = normalizeHex(hex) ?? "#000000";
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${parseInt(n.slice(1, 3), 16)}, ${parseInt(n.slice(3, 5), 16)}, ${parseInt(n.slice(5, 7), 16)}, ${a})`;
}

/**
 * CSS custom properties for an applied theme. Every surface, text colour,
 * accent, highlight and font is emitted, so switching themes never leaks the
 * previous palette.
 */
export function themeVars(applied: AppliedTheme): Record<string, string> {
  const c = applied.colours;
  const bg = applied.background;
  const vars: Record<string, string> = {
    "--bg-main": c.main,
    "--bg-sidebar": c.sidebar,
    "--bg-toolbar": c.panel,
    "--bg-panel": c.panel,
    "--bg-elevated": c.elevated,
    "--border": c.border,
    "--grid-line": c.gridLine,
    "--text-primary": c.text,
    "--text-secondary": c.textSecondary,
    "--text-muted": c.textMuted,
    "--accent-orange": applied.accent,
    "--accent": applied.accent,
    "--focus": applied.accent,
    "--accent-ink": contrastInk(applied.accent),
    "--highlight": applied.highlight,
    "--font": applied.fonts.sans,
    "--font-heading": applied.fonts.heading,
    "--font-size": `${applied.fonts.size}px`,
    "--app-bg": bg.mode === "solid" && bg.colour ? bg.colour : c.main,
    "--app-bg-image": "none",
    "--app-bg-dim": "transparent",
    "--bg-sidebar-a": c.sidebar,
    "--bg-main-a": c.main,
    "--bg-panel-a": c.panel,
  };
  if (bg.mode === "image" && bg.image) {
    vars["--app-bg-image"] = `url("${bg.image}")`;
    vars["--app-bg-dim"] = `rgba(0, 0, 0, ${bg.dim / 100})`;
    vars["--bg-sidebar-a"] = rgba(c.sidebar, 0.82);
    vars["--bg-main-a"] = rgba(c.main, 0.35);
    vars["--bg-panel-a"] = rgba(c.panel, 0.72);
  } else if (bg.mode === "solid") {
    vars["--bg-main-a"] = rgba(c.main, 0.55);
    vars["--bg-sidebar-a"] = rgba(c.sidebar, 0.75);
    vars["--bg-panel-a"] = rgba(c.panel, 0.8);
  }
  return vars;
}

/** True when chrome should go translucent behind a wallpaper or tint. */
export function usesCustomBackground(mode: "none" | "solid" | "image"): boolean {
  return mode === "image" || mode === "solid";
}

/**
 * Applying a preset is meant to give you exactly that theme, so every manual
 * override is dropped. Use "Save current as theme…" to keep tweaks.
 */
export function withThemeApplied(current: AppearanceSettings, themeId: string): AppearanceSettings {
  return {
    ...current,
    themeId,
    accent: "",
    highlight: "",
    font: "",
    backgroundMode: "theme",
    backgroundColour: "",
    backgroundImage: null,
  };
}

/** Drop overrides but keep the currently selected theme. */
export function clearThemeOverrides(current: AppearanceSettings): AppearanceSettings {
  return withThemeApplied(current, current.themeId);
}
/** Ready-to-edit starter file shown by "Copy template". */
export function themeTemplate(): string {
  return JSON.stringify(
    {
      version: 1,
      backgroundsPath: "backgrounds",
      themes: [
        {
          id: "my-theme",
          name: "My Theme",
          base: "dark",
          accent: "#7C5CFF",
          highlight: "#22D3EE",
          colours: {
            main: "#050505",
            sidebar: "#181818",
            panel: "#202020",
            elevated: "#292929",
            border: "#303030",
            gridLine: "#1E1E1E",
            text: "#F2F2F2",
            textSecondary: "#B0B0B0",
            textMuted: "#858585",
          },
          fonts: {
            sans: '"Inter", system-ui, sans-serif',
            heading: '"Inter", system-ui, sans-serif',
            size: 14,
          },
          background: {
            mode: "image",
            image: "my-background.jpg",
            dim: 55,
          },
        },
      ],
    },
    null,
    2,
  );
}
