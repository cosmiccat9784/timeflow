import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  ACCENT_PRESETS,
  FONT_PRESETS,
  HIGHLIGHT_PRESETS,
  backgroundUrl,
  baseColours,
  clearThemeOverrides,
  contrastInk,
  normaliseTheme,
  parseThemesFile,
  resolveColours,
  resolveTheme,
  themeTemplate,
  themeVars,
  usesCustomBackground,
  withThemeApplied,
  type ThemeDefinition,
} from "./themes";

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

const minimal: ThemeDefinition = {
  id: "test-theme",
  name: "Test Theme",
  base: "dark",
  accent: "#7C5CFF",
  highlight: "#22D3EE",
};

describe("themes.json shipped with the app", () => {
  const file = () => JSON.parse(read("public/themes/themes.json"));
  const parsed = () => {
    const r = parseThemesFile(file());
    if (!r.ok) throw new Error(r.error);
    return r.file;
  };

  it("is valid JSON that parses", () => {
    const f = parsed();
    expect(f.version).toBe(1);
    expect(f.themes.length).toBeGreaterThanOrEqual(8);
  });

  it("contains built-in Dark and Light presets", () => {
    const ids = parsed().themes.map((t) => t.id);
    expect(ids).toContain("dark");
    expect(ids).toContain("light");
    expect(parsed().themes.find((t) => t.id === "dark")?.base).toBe("dark");
    expect(parsed().themes.find((t) => t.id === "light")?.base).toBe("light");
  });

  it("has unique ids and non-empty names", () => {
    const themes = parsed().themes;
    expect(new Set(themes.map((t) => t.id)).size).toBe(themes.length);
    for (const t of themes) expect(t.name.trim().length).toBeGreaterThan(0);
  });

  it("uses valid colours throughout", () => {
    for (const t of parsed().themes) {
      expect(t.accent).toMatch(/^#[0-9A-F]{6}$/);
      expect(t.highlight).toMatch(/^#[0-9A-F]{6}$/);
      for (const v of Object.values(t.colours ?? {})) expect(v).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it("every referenced background image exists in the backgrounds folder", () => {
    for (const t of parsed().themes) {
      const img = t.background?.image;
      if (!img) continue;
      expect(fs.existsSync(path.join(root, "public/themes/backgrounds", img)), `missing ${img}`).toBe(true);
    }
  });

  it("the backgrounds folder ships a README so users know what to add", () => {
    const readme = read("public/themes/backgrounds/README.md");
    expect(readme.toLowerCase()).toContain("background");
    expect(readme).toContain("themes.json");
  });

  it("every theme declares a background mode", () => {
    for (const t of parsed().themes) {
      expect(["none", "solid", "image"]).toContain(t.background?.mode);
    }
  });
});

describe("theme validation", () => {
  it("accepts a minimal valid theme", () => {
    const r = normaliseTheme(minimal);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.theme.id).toBe("test-theme");
      expect(r.theme.highlight).toBe("#22D3EE");
      expect(r.theme.builtin).toBe(false);
    }
  });

  it("requires id, name, base and accent", () => {
    expect(normaliseTheme({ ...minimal, id: "" }).ok).toBe(false);
    expect(normaliseTheme({ ...minimal, name: "  " }).ok).toBe(false);
    expect(normaliseTheme({ ...minimal, base: "blue" as never }).ok).toBe(false);
    expect(normaliseTheme({ ...minimal, accent: "orange" }).ok).toBe(false);
    expect(normaliseTheme(null).ok).toBe(false);
  });

  it("rejects unsafe ids", () => {
    expect(normaliseTheme({ ...minimal, id: "../evil" }).ok).toBe(false);
    expect(normaliseTheme({ ...minimal, id: "has space" }).ok).toBe(false);
  });

  it("rejects invalid colour overrides", () => {
    expect(normaliseTheme({ ...minimal, colours: { main: "black" } }).ok).toBe(false);
    expect(normaliseTheme({ ...minimal, background: { mode: "solid", colour: "nope" } }).ok).toBe(false);
  });

  it("rejects unknown background modes", () => {
    expect(normaliseTheme({ ...minimal, background: { mode: "video" } }).ok).toBe(false);
  });

  it("normalises hex to upper case and clamps sizing", () => {
    const r = normaliseTheme({
      ...minimal,
      accent: "#abcdef",
      colours: { main: "#010203" },
      fonts: { size: 99 },
      background: { mode: "image", image: "x.jpg", dim: 500 },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.theme.accent).toBe("#ABCDEF");
      expect(r.theme.colours?.main).toBe("#010203");
      expect(r.theme.fonts?.size).toBe(18);
      expect(r.theme.background?.dim).toBe(100);
    }
  });

  it("accepts a bare array as a themes file", () => {
    const r = parseThemesFile([minimal]);
    expect(r.ok).toBe(true);
  });

  it("rejects duplicate ids in one file", () => {
    expect(parseThemesFile({ themes: [minimal, minimal] }).ok).toBe(false);
  });

  it("rejects a file without themes", () => {
    expect(parseThemesFile({ version: 1 }).ok).toBe(false);
    expect(parseThemesFile("nope").ok).toBe(false);
  });
});

describe("resolving a theme", () => {
  it("merges palette over the base", () => {
    const dark = baseColours("dark");
    const light = baseColours("light");
    expect(dark.main).toBe("#050505");
    expect(light.main).toBe("#FAFAF7");
    const colours = resolveColours({
      ...minimal,
      colours: { main: "#123456" },
    });
    expect(colours.main).toBe("#123456");
    expect(colours.sidebar).toBe(dark.sidebar);
  });

  it("applies overrides on top of the theme", () => {
    const applied = resolveTheme({ ...minimal }, { accent: "#14B8A6", highlight: "#FFD166", font: "Georgia" });
    expect(applied.accent).toBe("#14B8A6");
    expect(applied.highlight).toBe("#FFD166");
    expect(applied.fonts.sans).toBe("Georgia");
  });

  it("ignores invalid overrides", () => {
    const applied = resolveTheme({ ...minimal }, { accent: "not-a-colour", highlight: "#zzzzzz" });
    expect(applied.accent).toBe(minimal.accent);
    expect(applied.highlight).toBe(minimal.highlight);
  });

  it("defaults fonts when the theme has none", () => {
    const applied = resolveTheme({ ...minimal });
    expect(applied.fonts.sans).toBe(FONT_PRESETS[0].value);
    expect(applied.fonts.size).toBe(14);
  });

  it("resolves background overrides and clamping", () => {
    const applied = resolveTheme(
      { ...minimal, background: { mode: "image", image: "a.jpg", dim: 30 } },
      { backgroundDim: 90 },
    );
    expect(applied.background.mode).toBe("image");
    expect(applied.background.image).toBe("a.jpg");
    expect(applied.background.dim).toBe(90);
  });

  it("emits every surface variable", () => {
    const vars = themeVars(resolveTheme({ ...minimal }));
    for (const key of [
      "--bg-main",
      "--bg-sidebar",
      "--bg-panel",
      "--bg-elevated",
      "--border",
      "--grid-line",
      "--text-primary",
      "--text-secondary",
      "--text-muted",
      "--accent-orange",
      "--accent",
      "--focus",
      "--accent-ink",
      "--highlight",
      "--font",
      "--font-heading",
      "--font-size",
    ]) {
      expect(vars[key], key).toBeTruthy();
    }
  });

  it("sets a readable ink for the accent", () => {
    const vars = themeVars(resolveTheme({ ...minimal, accent: "#A3E635" }));
    expect(vars["--accent-ink"]).toBe("#0B0B0B");
    expect(contrastInk("#050505")).toBe("#FFFFFF");
  });

  it("builds wallpaper variables for image backgrounds", () => {
    const vars = themeVars(resolveTheme({ ...minimal, background: { mode: "image", image: "bg.jpg", dim: 60 } }));
    expect(vars["--app-bg-image"]).toBe('url("bg.jpg")');
    expect(vars["--app-bg-dim"]).toBe("rgba(0, 0, 0, 0.6)");
    expect(vars["--bg-sidebar-a"]).toContain("rgba(");
  });

  it("keeps opaque surfaces for the none mode", () => {
    const vars = themeVars(resolveTheme({ ...minimal, background: { mode: "none" } }));
    expect(vars["--app-bg-image"]).toBe("none");
    expect(vars["--app-bg-dim"]).toBe("transparent");
  });

  it("reports translucent chrome correctly", () => {
    expect(usesCustomBackground("none")).toBe(false);
    expect(usesCustomBackground("solid")).toBe(true);
    expect(usesCustomBackground("image")).toBe(true);
  });
});

describe("background paths", () => {
  it("resolves relative paths against the themes folder", () => {
    expect(backgroundUrl("aurora.svg")).toBe("/themes/backgrounds/aurora.svg");
    expect(backgroundUrl("/aurora.svg")).toBe("/themes/backgrounds/aurora.svg");
    expect(backgroundUrl("aurora.svg", "themes/backgrounds")).toBe("themes/backgrounds/aurora.svg");
  });

  it("leaves data URLs and absolute URLs alone", () => {
    expect(backgroundUrl("data:image/png;base64,AA")).toBe("data:image/png;base64,AA");
    expect(backgroundUrl("https://x/y.jpg")).toBe("https://x/y.jpg");
  });

  it("returns null when there is no image", () => {
    expect(backgroundUrl(undefined)).toBeNull();
  });
});

describe("theme template", () => {
  it("is valid JSON that round-trips through the parser", () => {
    const parsed = parseThemesFile(JSON.parse(themeTemplate()));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.file.themes[0].id).toBe("my-theme");
      expect(parsed.file.themes[0].background?.mode).toBe("image");
    }
  });

  it("documents every supported field", () => {
    const obj = JSON.parse(themeTemplate()).themes[0];
    for (const key of ["id", "name", "base", "accent", "highlight", "colours", "fonts", "background"]) {
      expect(obj[key], key).toBeDefined();
    }
  });
});

describe("preset lists", () => {
  it("has enough accent and highlight choices", () => {
    expect(ACCENT_PRESETS.length).toBeGreaterThanOrEqual(8);
    expect(HIGHLIGHT_PRESETS.length).toBeGreaterThanOrEqual(6);
    for (const hex of [...ACCENT_PRESETS, ...HIGHLIGHT_PRESETS]) expect(hex).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it("offers font stacks", () => {
    expect(FONT_PRESETS.length).toBeGreaterThanOrEqual(5);
    for (const f of FONT_PRESETS) expect(f.value.length).toBeGreaterThan(3);
  });
});

describe("applying a preset clears overrides", () => {
  const loaded = {
    themeId: "midnight",
    accent: "#A3E635",
    highlight: "#FFD166",
    font: "Georgia, serif",
    backgroundMode: "image" as const,
    backgroundColour: "#123456",
    backgroundImage: "data:image/jpeg;base64,AAAA",
    backgroundDim: 80,
  };

  it("drops accent, highlight, font, wallpaper and tint", () => {
    const next = withThemeApplied(loaded, "forest");
    expect(next.themeId).toBe("forest");
    expect(next.accent).toBe("");
    expect(next.highlight).toBe("");
    expect(next.font).toBe("");
    expect(next.backgroundMode).toBe("theme");
    expect(next.backgroundImage).toBeNull();
  });

  it("clears the custom tint so the preset keeps its own colour", () => {
    expect(withThemeApplied(loaded, "forest").backgroundColour).toBe("");
  });

  it("resolves to the preset's own accent afterwards", () => {
    const court = parseThemesFile(JSON.parse(read("public/themes/themes.json")));
    if (!court.ok) throw new Error(court.error);
    const forest = court.file.themes.find((t) => t.id === "forest")!;
    const applied = resolveTheme(forest, withThemeApplied(loaded, "forest"));
    expect(applied.accent).toBe(forest.accent);
    expect(applied.background.mode).toBe(forest.background?.mode);
    expect(applied.background.colour).toBe(forest.background?.colour);
  });

  it("clearThemeOverrides keeps the selected theme", () => {
    const next = clearThemeOverrides(loaded);
    expect(next.themeId).toBe("midnight");
    expect(next.accent).toBe("");
    expect(next.backgroundMode).toBe("theme");
  });
});

describe("background paths resolve to a real URL", () => {
  it("preset images become absolute paths, not stylesheet-relative ones", () => {
    // A bare "aurora.jpg" in a CSS custom property resolves under /assets/
    // (the stylesheet's folder), which 404s. The loader must emit a rooted path.
    const res = parseThemesFile(JSON.parse(read("public/themes/themes.json")));
    if (!res.ok) throw new Error(res.error);
    const aurora = res.file.themes.find((t) => t.id === "aurora")!;
    const folder = `/themes/${(res.file.backgroundsPath ?? "backgrounds").replace(/^\/+/, "")}`;
    expect(backgroundUrl(aurora.background?.image, folder)).toBe("/themes/backgrounds/aurora.jpg");
  });

  it("the app loader uses a leading slash", () => {
    const app = read("src/App.tsx");
    expect(app).toContain("const folder = `/themes/");
  });

  it("imported themes get rooted paths too", () => {
    const view = read("src/components/ThemesView.tsx");
    expect(view).toContain('backgroundUrl(image, "/themes/backgrounds")');
  });
});

describe("accent contrast in the stylesheet", () => {
  const css = () => read("src/styles.css");

  it("accent-filled controls use the computed ink colour", () => {
    const sheet = css();
    expect(sheet).toContain("var(--accent-ink, #fff)");
    // Primary button, segmented control and day tabs must all follow it.
    const hits = sheet.match(/var\(--accent-ink, #fff\)/g) ?? [];
    expect(hits.length).toBeGreaterThanOrEqual(5);
  });

  it("no accent background still hard-codes white text", () => {
    const sheet = css();
    const offenders = sheet.split("\n").filter((line) =>
      /background:\s*var\(--accent-orange\)/.test(line) && /color:\s*#fff/.test(line),
    );
    expect(offenders).toEqual([]);
  });
});