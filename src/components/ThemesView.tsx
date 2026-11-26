import { useMemo, useRef, useState } from "react";
import type { AppearanceSettings } from "../types";
import type { ThemeDefinition } from "../themes";
import {
  ACCENT_PRESETS,
  FONT_PRESETS,
  HIGHLIGHT_PRESETS,
  backgroundUrl,
  clearThemeOverrides,
  parseThemesFile,
  resolveColours,
  resolveTheme,
  themeTemplate,
  withThemeApplied,
} from "../themes";
import { ColorPicker } from "./ColorPicker";
import { CustomSelect } from "./CustomSelect";
import { fileToBackgroundDataUrl, normaliseHex } from "../theme";

/**
 * Themes page: pick a preset, tweak it live, import a JSON file or save your
 * own theme. Themes are data — see `public/themes/themes.json`.
 */
export function ThemesView({
  themes,
  appearance,
  onChange,
  onAddTheme,
  onDeleteTheme,
  onReload,
  loadError,
}: {
  themes: ThemeDefinition[];
  appearance: AppearanceSettings;
  onChange: (next: AppearanceSettings) => void;
  onAddTheme: (theme: ThemeDefinition) => void;
  onDeleteTheme: (id: string) => void;
  onReload: () => void;
  loadError: string | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);

  const active = themes.find((t) => t.id === appearance.themeId) ?? themes[0];
  const applied = useMemo(
    () =>
      active
        ? resolveTheme(active, {
            accent: appearance.accent || undefined,
            highlight: appearance.highlight || undefined,
            font: appearance.font || undefined,
            backgroundMode: appearance.backgroundMode === "theme" ? undefined : appearance.backgroundMode,
            backgroundColour: appearance.backgroundColour,
            backgroundImage: appearance.backgroundImage,
            backgroundDim: appearance.backgroundDim,
          })
        : null,
    [active, appearance],
  );

  const patch = (p: Partial<AppearanceSettings>) => onChange({ ...appearance, ...p });

  const applyTheme = (id: string) => {
    // A preset means exactly that look — drop any manual overrides.
    onChange(withThemeApplied(appearance, id));
    setNotice(null);
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setNotice(null);
    try {
      const text = await file.text();
      const parsed = parseThemesFile(JSON.parse(text));
      if (!parsed.ok) {
        setError(parsed.error);
        return;
      }
      for (const t of parsed.file.themes) {
        // Relative image paths are resolved against the shipped backgrounds
        // folder; data URLs and absolute URLs are left alone.
        const image = t.background?.image;
        const resolved = image && !/^(data:|https?:)/i.test(image)
          ? backgroundUrl(image, "/themes/backgrounds") ?? undefined
          : image;
        onAddTheme({
          ...t,
          builtin: false,
          background: t.background ? { ...t.background, image: resolved } : undefined,
        });
      }
      setNotice(`Imported ${parsed.file.themes.length} theme(s).`);
    } catch (e) {
      setError(e instanceof Error ? `Could not read that file: ${e.message}` : "Could not read that file.");
    }
  };

  const saveAs = () => {
    if (!active) return;
    const name = window.prompt("Name your theme", `${active.name} copy`);
    if (!name || !name.trim()) return;
    const id = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || `theme-${Date.now()}`;
    if (themes.some((t) => t.id === id)) {
      setError(`A theme called "${id}" already exists.`);
      return;
    }
    const next: ThemeDefinition = {
      ...active,
      id,
      name: name.trim(),
      builtin: false,
      accent: applied!.accent,
      highlight: applied!.highlight,
      fonts: { ...active.fonts, sans: applied!.fonts.sans, heading: applied!.fonts.heading, size: applied!.fonts.size },
      background: {
        mode: applied!.background.mode,
        colour: applied!.background.colour,
        image: applied!.background.image,
        dim: applied!.background.dim,
      },
    };
    onAddTheme(next);
    patch({ themeId: id, accent: "", highlight: "", font: "", backgroundMode: "theme", backgroundImage: null });
    setNotice(`Saved "${next.name}".`);
    setError(null);
  };

  const pickBackground = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const dataUrl = await fileToBackgroundDataUrl(file);
      patch({ backgroundMode: "image", backgroundImage: dataUrl });
    } catch (e) {
      setError(e instanceof Error ? e.message : "That image could not be used.");
    } finally {
      setBusy(false);
    }
  };

  const downloadTemplate = () => {
    const blob = new Blob([themeTemplate()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "my-theme.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  return (
    <div className="dash themes-page">
      <h2>Themes</h2>
      <p className="derived">
        Themes are plain JSON. Drop new files or background images into
        <code> public/themes/ </code> before building, or import a theme file below — imported
        themes are saved with your data.
      </p>

      {loadError && <div className="error-box" role="alert">{loadError}</div>}
      {error && <div className="error-box" role="alert">{error}</div>}
      {notice && <div className="notice" role="status">{notice}</div>}

      <h3>Presets</h3>
      <div className="theme-grid">
        {themes.map((t) => {
          const c = resolveColours(t);
          const selected = t.id === appearance.themeId;
          return (
            <div key={t.id} className={`theme-card${selected ? " selected" : ""}`}>
              <div className="theme-preview" style={{ background: c.main, borderColor: c.border }}>
                <span style={{ background: c.sidebar, borderColor: c.border }} />
                <span style={{ background: c.panel, borderColor: c.border }} />
                <i style={{ background: t.accent }} />
                <i style={{ background: t.highlight }} />
              </div>
              <div className="theme-card-row">
                <strong>{t.name}</strong>
                <span className="derived">{t.builtin ? "preset" : "custom"}</span>
              </div>
              <div className="theme-card-actions">
                <button
                  type="button"
                  className={`btn small${selected ? " primary" : ""}`}
                  onClick={() => applyTheme(t.id)}
                >
                  {selected ? "Applied" : "Apply"}
                </button>
                {!t.builtin && (
                  <button type="button" className="btn small danger" onClick={() => onDeleteTheme(t.id)}>
                    Delete
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="themes-actions">
        <button type="button" className="btn" onClick={() => importRef.current?.click()}>
          Import theme file…
        </button>
        <input
          ref={importRef}
          type="file"
          accept="application/json,.json"
          style={{ display: "none" }}
          onChange={(e) => void importFile(e.target.files?.[0])}
        />
        <button type="button" className="btn" onClick={downloadTemplate}>Download template</button>
        <button type="button" className="btn" onClick={onReload}>Reload presets</button>
        <button type="button" className="btn" onClick={saveAs} disabled={!active}>Save current as theme…</button>
        <button type="button" className="btn" onClick={() => { onChange(clearThemeOverrides(appearance)); setNotice("Overrides cleared — using the theme as shipped."); }}>Reset overrides</button>
      </div>

      {applied && (
        <>
          <h3>Customise “{active?.name}”</h3>
          <p className="derived">
            Overrides apply on top of the selected theme. Leave a colour blank to inherit it.
          </p>

          <div className="settings-row settings-row-stack">
            <span id="accent-label">Accent colour</span>
            <div className="swatch-row" role="radiogroup" aria-labelledby="accent-label">
              {ACCENT_PRESETS.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  role="radio"
                  aria-checked={applied.accent === hex}
                  aria-label={hex}
                  className={`swatch-btn${applied.accent === hex ? " current" : ""}`}
                  style={{ background: hex }}
                  onClick={() => patch({ accent: hex })}
                />
              ))}
              <ColorPicker value={applied.accent} onChange={(v) => { const h = normaliseHex(v); if (h) patch({ accent: h }); }} />
              <button type="button" className="btn small" onClick={() => patch({ accent: "" })}>Inherit</button>
            </div>
          </div>

          <div className="settings-row settings-row-stack">
            <span id="highlight-label">Highlight colour (selection, today)</span>
            <div className="swatch-row" role="radiogroup" aria-labelledby="highlight-label">
              {HIGHLIGHT_PRESETS.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  role="radio"
                  aria-checked={applied.highlight === hex}
                  aria-label={hex}
                  className={`swatch-btn${applied.highlight === hex ? " current" : ""}`}
                  style={{ background: hex }}
                  onClick={() => patch({ highlight: hex })}
                />
              ))}
              <ColorPicker value={applied.highlight} onChange={(v) => { const h = normaliseHex(v); if (h) patch({ highlight: h }); }} />
              <button type="button" className="btn small" onClick={() => patch({ highlight: "" })}>Inherit</button>
            </div>
          </div>

          <div className="settings-row">
            <label htmlFor="th-font">Font</label>
            <CustomSelect
              id="th-font"
              value={applied.fonts.sans}
              options={[
                ...(active?.fonts?.sans && !FONT_PRESETS.some((f) => f.value === active.fonts?.sans)
                  ? [{ value: active.fonts.sans, label: `${active.fonts.sans.split(",")[0].replace(/"/g, "")} (theme)` }]
                  : []),
                ...FONT_PRESETS.map((f) => ({ value: f.value, label: f.name })),
              ]}
              onChange={(v) => patch({ font: v })}
              ariaLabel="Font"
            />
          </div>

          <div className="settings-row">
            <label htmlFor="th-bg">Background</label>
            <CustomSelect
              id="th-bg"
              value={applied.background.mode}
              options={[
                { value: "none", label: "Theme surfaces" },
                { value: "solid", label: "Solid colour" },
                { value: "image", label: "Image" },
              ]}
              onChange={(v) => patch({ backgroundMode: v as AppearanceSettings["backgroundMode"] })}
              ariaLabel="Background"
            />
          </div>

          {applied.background.mode === "solid" && (
            <div className="settings-row settings-row-stack">
              <span>Background colour</span>
              <div className="swatch-row">
                <ColorPicker
                  value={applied.background.colour ?? applied.colours.main}
                  onChange={(v) => { const h = normaliseHex(v); if (h) patch({ backgroundColour: h, backgroundMode: "solid" }); }}
                />
                <button type="button" className="btn small" onClick={() => patch({ backgroundMode: "theme" })}>Inherit</button>
              </div>
            </div>
          )}

          {applied.background.mode === "image" && (
            <>
              <div className="settings-row settings-row-stack">
                <span>Wallpaper</span>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <label className="btn" style={{ cursor: "pointer", margin: 0 }}>
                    {applied.background.image ? "Choose another image…" : "Choose image…"}
                    <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => void pickBackground(e.target.files?.[0])} />
                  </label>
                  {applied.background.image && (
                    <button type="button" className="btn small" onClick={() => patch({ backgroundImage: null })}>Remove</button>
                  )}
                  {busy && <span className="derived">Shrinking image…</span>}
                </div>
                {applied.background.image?.startsWith("data:") && (
                  <img src={applied.background.image} alt="" className="theme-thumb" />
                )}
                {!applied.background.image && (
                  <p className="derived">The theme expects <code>{active?.background?.image ?? "an image"}</code> in <code>public/themes/backgrounds/</code>.</p>
                )}
              </div>
              <div className="settings-row">
                <label htmlFor="th-dim">Dim wallpaper</label>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flex: 1 }}>
                  <input
                    id="th-dim"
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={applied.background.dim}
                    onChange={(e) => patch({ backgroundDim: Number(e.target.value) })}
                    style={{ flex: 1 }}
                  />
                  <span className="derived">{applied.background.dim}%</span>
                </div>
              </div>
            </>
          )}

          <p className="derived">
            Applying a preset gives you exactly that theme and clears these overrides. Use “Save
            current as theme…” to keep your tweaks, or “Reset overrides” to return to the theme as
            shipped.
          </p>
        </>
      )}
    </div>
  );
}
