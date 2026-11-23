import { describe, expect, it } from "vitest";
import {
  ACCENT_PRESETS,
  BACKGROUND_PRESETS,
  DEFAULT_APPEARANCE,
  accentVars,
  backgroundVars,
  clampDim,
  contrastInk,
  dataUrlBytes,
  fillAppearance,
  fitWithin,
  luminance,
  normaliseHex,
  rgba,
  usesCustomBackground,
} from "./theme";
import { defaultSettings, defaultState, migrateState } from "./store";

const BASE = { main: "#050505", sidebar: "#181818", panel: "#202020" };

describe("colour parsing", () => {
  it("normalises hex with or without a hash", () => {
    expect(normaliseHex("#ff940e")).toBe("#FF940E");
    expect(normaliseHex("ff940e")).toBe("#FF940E");
    expect(normaliseHex("  #FF940E  ")).toBe("#FF940E");
  });

  it("rejects malformed colours", () => {
    expect(normaliseHex("#fff")).toBeNull();
    expect(normaliseHex("red")).toBeNull();
    expect(normaliseHex("#gggggg")).toBeNull();
    expect(normaliseHex("")).toBeNull();
  });

  it("builds rgba strings and clamps alpha", () => {
    expect(rgba("#FF940E", 0.5)).toBe("rgba(255, 148, 14, 0.5)");
    expect(rgba("#FF940E", 2)).toBe("rgba(255, 148, 14, 1)");
    expect(rgba("#FF940E", -1)).toBe("rgba(255, 148, 14, 0)");
  });
});

describe("contrast", () => {
  it("computes luminance extremes", () => {
    expect(luminance("#000000")).toBeCloseTo(0, 5);
    expect(luminance("#FFFFFF")).toBeCloseTo(1, 5);
  });

  it("picks dark ink on bright accents", () => {
    expect(contrastInk("#A3E635")).toBe("#0B0B0B");
    expect(contrastInk("#FFFFFF")).toBe("#0B0B0B");
  });

  it("picks light ink on dark accents", () => {
    expect(contrastInk("#050505")).toBe("#FFFFFF");
    expect(contrastInk("#7C5CFF")).toBe("#FFFFFF");
  });

  it("every preset gets readable ink", () => {
    for (const p of ACCENT_PRESETS) {
      const ink = contrastInk(p.value);
      const ratio = Math.abs(luminance(p.value) - luminance(ink));
      expect(ratio).toBeGreaterThan(0.35);
    }
  });
});

describe("accent variables", () => {
  it("overrides every accent alias", () => {
    const v = accentVars("#2E90FA");
    expect(v["--accent-orange"]).toBe("#2E90FA");
    expect(v["--accent"]).toBe("#2E90FA");
    expect(v["--focus"]).toBe("#2E90FA");
    expect(v["--accent-ink"]).toBe("#FFFFFF");
  });

  it("falls back to the default for invalid input", () => {
    expect(accentVars("nope")["--accent-orange"]).toBe(DEFAULT_APPEARANCE.accent);
  });

  it("offers at least eight presets, all valid hex", () => {
    expect(ACCENT_PRESETS.length).toBeGreaterThanOrEqual(8);
    for (const p of ACCENT_PRESETS) expect(normaliseHex(p.value)).not.toBeNull();
  });
});

describe("background variables", () => {
  it("theme mode is a no-op", () => {
    const v = backgroundVars({ ...DEFAULT_APPEARANCE, backgroundMode: "theme" }, BASE);
    expect(v["--app-bg"]).toBe(BASE.main);
    expect(v["--app-bg-image"]).toBe("none");
    expect(v["--app-bg-dim"]).toBe("transparent");
  });

  it("solid mode tints the surfaces", () => {
    const v = backgroundVars({ ...DEFAULT_APPEARANCE, backgroundMode: "solid", backgroundColour: "#0B1220" }, BASE);
    expect(v["--app-bg"]).toBe("#0B1220");
    expect(v["--bg-main-a"]).toContain("rgba(");
    expect(v["--app-bg-image"]).toBe("none");
  });

  it("image mode sets the wallpaper and a dim veil", () => {
    const v = backgroundVars(
      { ...DEFAULT_APPEARANCE, backgroundMode: "image", backgroundImage: "data:image/jpeg;base64,AAAA", backgroundDim: 60 },
      BASE,
    );
    expect(v["--app-bg-image"]).toContain("data:image/jpeg");
    expect(v["--app-bg-dim"]).toBe("rgba(0, 0, 0, 0.6)");
    expect(v["--bg-sidebar-a"]).toContain("rgba(");
  });

  it("image mode without an image falls back to the theme", () => {
    const v = backgroundVars({ ...DEFAULT_APPEARANCE, backgroundMode: "image", backgroundImage: null }, BASE);
    expect(v["--app-bg-image"]).toBe("none");
  });

  it("clamps the dim value", () => {
    const v = backgroundVars(
      { ...DEFAULT_APPEARANCE, backgroundMode: "image", backgroundImage: "data:image/png;base64,AA", backgroundDim: 500 },
      BASE,
    );
    expect(v["--app-bg-dim"]).toBe("rgba(0, 0, 0, 1)");
  });

  it("reports whether chrome should go translucent", () => {
    expect(usesCustomBackground({ ...DEFAULT_APPEARANCE, backgroundMode: "theme" })).toBe(false);
    expect(usesCustomBackground({ ...DEFAULT_APPEARANCE, backgroundMode: "solid" })).toBe(true);
    expect(usesCustomBackground({ ...DEFAULT_APPEARANCE, backgroundMode: "image" })).toBe(true);
  });

  it("presets are valid and cover both themes", () => {
    expect(BACKGROUND_PRESETS.length).toBeGreaterThanOrEqual(10);
    for (const p of BACKGROUND_PRESETS) expect(normaliseHex(p.value)).not.toBeNull();
    expect(BACKGROUND_PRESETS.some((p) => p.theme === "dark")).toBe(true);
    expect(BACKGROUND_PRESETS.some((p) => p.theme === "light")).toBe(true);
  });
});

describe("appearance migration", () => {
  it("fills defaults when missing", () => {
    expect(fillAppearance(undefined)).toEqual(DEFAULT_APPEARANCE);
  });

  it("repairs an invalid accent and mode", () => {
    const a = fillAppearance({ accent: "purple", backgroundMode: "nope" as never });
    expect(a.accent).toBe(DEFAULT_APPEARANCE.accent);
    expect(a.backgroundMode).toBe("theme");
  });

  it("keeps a valid custom accent", () => {
    expect(fillAppearance({ accent: "#14b8a6" }).accent).toBe("#14B8A6");
  });

  it("rejects non-data URLs for the wallpaper", () => {
    expect(fillAppearance({ backgroundImage: "https://example.com/a.jpg" }).backgroundImage).toBeNull();
    expect(fillAppearance({ backgroundImage: "data:image/png;base64,AA" }).backgroundImage).toBe("data:image/png;base64,AA");
  });

  it("clamps dim values", () => {
    expect(clampDim(-20)).toBe(0);
    expect(clampDim(300)).toBe(100);
    expect(clampDim("x")).toBe(DEFAULT_APPEARANCE.backgroundDim);
    expect(clampDim(44.6)).toBe(45);
  });

  it("default settings include the appearance block", () => {
    expect(defaultSettings().appearance).toEqual(DEFAULT_APPEARANCE);
  });

  it("migrated state gains appearance defaults", () => {
    const s = defaultState();
    delete (s.settings as { appearance?: unknown }).appearance;
    const migrated = migrateState(JSON.parse(JSON.stringify(s)));
    expect(migrated?.settings.appearance).toEqual(DEFAULT_APPEARANCE);
  });

  it("migrated state keeps a custom accent", () => {
    const s = defaultState();
    s.settings.appearance = { ...DEFAULT_APPEARANCE, accent: "#C94BFF", backgroundMode: "solid", backgroundColour: "#0A1410" };
    const migrated = migrateState(JSON.parse(JSON.stringify(s)));
    expect(migrated?.settings.appearance.accent).toBe("#C94BFF");
    expect(migrated?.settings.appearance.backgroundMode).toBe("solid");
  });
});

describe("wallpaper sizing", () => {
  it("scales down the longest edge", () => {
    expect(fitWithin(3840, 2160, 1920)).toEqual({ width: 1920, height: 1080 });
    expect(fitWithin(2160, 3840, 1920)).toEqual({ width: 1080, height: 1920 });
  });

  it("never upscales", () => {
    expect(fitWithin(800, 600, 1920)).toEqual({ width: 800, height: 600 });
  });

  it("handles degenerate dimensions", () => {
    expect(fitWithin(0, 0)).toEqual({ width: 0, height: 0 });
  });

  it("estimates data URL payload size", () => {
    expect(dataUrlBytes("data:image/jpeg;base64,AAAA")).toBe(3);
    expect(dataUrlBytes("nope")).toBe(0);
  });
});
