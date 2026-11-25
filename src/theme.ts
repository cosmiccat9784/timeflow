/**
 * Appearance model: accent colour, tinted background or custom wallpaper.
 *
 * Everything here is pure so it can be unit tested without a DOM; the only
 * impure helper is `fileToBackgroundDataUrl`, which needs a canvas.
 */

export type BackgroundMode = "theme" | "solid" | "image";

export type { AppearanceSettings } from "./types";
import type { AppearanceSettings } from "./types";

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  themeId: "dark",
  accent: "",
  highlight: "",
  font: "",
  backgroundMode: "theme",
  backgroundColour: "#0B1220",
  backgroundImage: null,
  backgroundDim: 45,
};

export interface AccentPreset {
  name: string;
  value: string;
}

export const ACCENT_PRESETS: AccentPreset[] = [
  { name: "Orange", value: "#FF940E" },
  { name: "Amber", value: "#F5A524" },
  { name: "Rose", value: "#F04E6E" },
  { name: "Magenta", value: "#C94BFF" },
  { name: "Violet", value: "#7C5CFF" },
  { name: "Blue", value: "#2E90FA" },
  { name: "Teal", value: "#14B8A6" },
  { name: "Green", value: "#3DD68C" },
  { name: "Lime", value: "#A3E635" },
];

export interface BackgroundPreset {
  name: string;
  value: string;
  /** Which base theme this tint is designed to sit on. */
  theme: "dark" | "light";
}

export const BACKGROUND_PRESETS: BackgroundPreset[] = [
  { name: "Charcoal", value: "#050505", theme: "dark" },
  { name: "Graphite", value: "#141821", theme: "dark" },
  { name: "Midnight", value: "#0B1220", theme: "dark" },
  { name: "Ocean", value: "#04121A", theme: "dark" },
  { name: "Forest", value: "#0A1410", theme: "dark" },
  { name: "Plum", value: "#150A18", theme: "dark" },
  { name: "Wine", value: "#1A0A10", theme: "dark" },
  { name: "Paper", value: "#FAFAF7", theme: "light" },
  { name: "Sand", value: "#F4EFE6", theme: "light" },
  { name: "Mint", value: "#EDF6F2", theme: "light" },
  { name: "Rose", value: "#F7EEF0", theme: "light" },
  { name: "Sky", value: "#EEF3FA", theme: "light" },
];

const HEX = /^#?([0-9a-f]{6})$/i;

/** Accepts `#abc123`, returns `#ABC123`; anything else returns null. */
export function normaliseHex(value: string): string | null {
  const m = value.trim().match(HEX);
  return m ? `#${m[1].toUpperCase()}` : null;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const n = normaliseHex(hex) ?? "#000000";
  return {
    r: parseInt(n.slice(1, 3), 16),
    g: parseInt(n.slice(3, 5), 16),
    b: parseInt(n.slice(5, 7), 16),
  };
}

export function rgba(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** WCAG relative luminance, 0 (black) … 1 (white). */
export function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Ink colour that stays readable on the given accent. */
export function contrastInk(hex: string): string {
  return luminance(hex) > 0.55 ? "#0B0B0B" : "#FFFFFF";
}

/** Clamp a stored dim value into 0–100. */
export function clampDim(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : DEFAULT_APPEARANCE.backgroundDim;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Repair whatever was persisted into a valid appearance object. */
export function fillAppearance(raw: Partial<AppearanceSettings> | undefined): AppearanceSettings {
  const a = raw ?? {};
  const mode: BackgroundMode =
    a.backgroundMode === "solid" || a.backgroundMode === "image" ? a.backgroundMode : "theme";
  return {
    themeId: typeof a.themeId === "string" && /^[a-z0-9][a-z0-9-_]*$/i.test(a.themeId) ? a.themeId : DEFAULT_APPEARANCE.themeId,
    // Empty string means "inherit from the theme".
    accent: a.accent ? normaliseHex(a.accent) ?? "" : "",
    highlight: a.highlight ? normaliseHex(a.highlight) ?? "" : "",
    font: typeof a.font === "string" ? a.font.trim() : "",
    backgroundMode: mode,
    backgroundColour: normaliseHex(a.backgroundColour ?? "") ?? DEFAULT_APPEARANCE.backgroundColour,
    backgroundImage: typeof a.backgroundImage === "string" && a.backgroundImage.startsWith("data:")
      ? a.backgroundImage
      : null,
    backgroundDim: clampDim(a.backgroundDim),
  };
}

/** True when the persisted appearance still uses shipped defaults. */
export function isDefaultAppearance(a: AppearanceSettings): boolean {
  return (
    a.themeId === DEFAULT_APPEARANCE.themeId &&
    !a.accent &&
    !a.highlight &&
    !a.font &&
    a.backgroundMode === "theme" &&
    !a.backgroundImage
  );
}

export interface ThemeVars {
  [name: `--${string}`]: string;
}

/**
 * CSS custom properties for the accent. Overriding `--accent-orange` recolours
 * every control that already references it.
 */
export function accentVars(accent: string): ThemeVars {
  const fallback = "#FF940E";
  const value = normaliseHex(accent) ?? fallback;
  return {
    "--accent-orange": value,
    "--accent": value,
    "--focus": value,
    "--accent-ink": contrastInk(value),
  };
}

/**
 * CSS custom properties for the background layer.
 * `base` is the theme's own background so "theme" mode is a no-op.
 */
export function backgroundVars(
  appearance: AppearanceSettings,
  base: { main: string; sidebar: string; panel: string },
): ThemeVars {
  const vars: ThemeVars = {
    "--app-bg": base.main,
    "--app-bg-image": "none",
    "--app-bg-dim": "transparent",
    "--bg-sidebar-a": base.sidebar,
    "--bg-main-a": base.main,
    "--bg-panel-a": base.panel,
  };
  if (appearance.backgroundMode === "image" && appearance.backgroundImage) {
    vars["--app-bg-image"] = `url("${appearance.backgroundImage}")`;
    vars["--app-bg-dim"] = `rgba(0, 0, 0, ${clampDim(appearance.backgroundDim) / 100})`;
    vars["--bg-sidebar-a"] = rgba(base.sidebar, 0.82);
    vars["--bg-main-a"] = rgba(base.main, 0.35);
    vars["--bg-panel-a"] = rgba(base.panel, 0.72);
  } else if (appearance.backgroundMode === "solid") {
    const colour = normaliseHex(appearance.backgroundColour) ?? DEFAULT_APPEARANCE.backgroundColour;
    vars["--app-bg"] = colour;
    // Panels sit on the tint rather than replacing it.
    vars["--bg-main-a"] = rgba(colour, 0.55);
    vars["--bg-sidebar-a"] = rgba(colour, 0.75);
    vars["--bg-panel-a"] = rgba(colour, 0.8);
  }
  return vars;
}

/** True when the app should switch to translucent chrome. */
export function usesCustomBackground(a: AppearanceSettings): boolean {
  return a.backgroundMode === "image" || a.backgroundMode === "solid";
}

/**
 * Largest image that fits `maxDim` on its longest edge, preserving aspect
 * ratio and never upscaling.
 */
export function fitWithin(width: number, height: number, maxDim = 1920): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  const scale = Math.min(1, maxDim / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Rough byte size of a data URL payload (base64 → bytes). */
export function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  if (comma === -1) return 0;
  const b64 = dataUrl.slice(comma + 1);
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - padding);
}

const MAX_IMAGE_BYTES = 1_400_000;

/**
 * Read a user-selected image, downscale it to at most 1920 px and encode it as
 * a JPEG data URL small enough for localStorage.
 */
export async function fileToBackgroundDataUrl(file: File, maxDim = 1920): Promise<string> {
  const bitmap = await loadBitmap(file);
  const target = fitWithin(bitmap.width, bitmap.height, maxDim);
  const canvas = document.createElement("canvas");
  canvas.width = target.width;
  canvas.height = target.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This device cannot process images.");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap as CanvasImageSource, 0, 0, target.width, target.height);
  let quality = 0.82;
  let dataUrl = canvas.toDataURL("image/jpeg", quality);
  while (dataUrlBytes(dataUrl) > MAX_IMAGE_BYTES && quality > 0.35) {
    quality -= 0.12;
    dataUrl = canvas.toDataURL("image/jpeg", quality);
  }
  if (dataUrlBytes(dataUrl) > MAX_IMAGE_BYTES) {
    throw new Error("That image is too large even after shrinking. Try a smaller one.");
  }
  return dataUrl;
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      // fall through to the <img> path
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("That file could not be read as an image."));
      img.src = url;
    });
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}
