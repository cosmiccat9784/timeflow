import { useState } from "react";
import type { AppearanceSettings } from "../types";
import {
  ACCENT_PRESETS,
  BACKGROUND_PRESETS,
  DEFAULT_APPEARANCE,
  fileToBackgroundDataUrl,
  normaliseHex,
  usesCustomBackground,
} from "../theme";
import { ColorPicker } from "./ColorPicker";
import { CustomSelect } from "./CustomSelect";

/** Accent colour, tinted background and wallpaper controls. */
export function AppearanceControls({
  appearance,
  onChange,
}: {
  appearance: AppearanceSettings;
  onChange: (next: AppearanceSettings) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const patch = (p: Partial<AppearanceSettings>) => onChange({ ...appearance, ...p });

  const pickImage = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const dataUrl = await fileToBackgroundDataUrl(file);
      onChange({ ...appearance, backgroundMode: "image", backgroundImage: dataUrl });
    } catch (e) {
      setError(e instanceof Error ? e.message : "That image could not be used.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="settings-row settings-row-stack">
        <span id="accent-label">Accent colour</span>
        <div className="swatch-row" role="radiogroup" aria-labelledby="accent-label">
          {ACCENT_PRESETS.map((p) => (
            <button
              key={p.value}
              type="button"
              role="radio"
              aria-checked={appearance.accent.toUpperCase() === p.value}
              aria-label={p.name}
              title={p.name}
              className={`swatch-btn${appearance.accent.toUpperCase() === p.value ? " current" : ""}`}
              style={{ background: p.value }}
              onClick={() => patch({ accent: p.value })}
            />
          ))}
          <ColorPicker
            value={appearance.accent}
            onChange={(v) => {
              const hex = normaliseHex(v);
              if (hex) patch({ accent: hex });
            }}
          />
          <button
            type="button"
            className="btn small"
            onClick={() => patch({ accent: DEFAULT_APPEARANCE.accent })}
          >
            Reset
          </button>
        </div>
      </div>

      <div className="settings-row">
        <label htmlFor="set-bg-mode">Background</label>
        <CustomSelect
          id="set-bg-mode"
          value={appearance.backgroundMode}
          options={[
            { value: "theme", label: "Match theme" },
            { value: "solid", label: "Solid colour" },
            { value: "image", label: "Custom image" },
          ]}
          onChange={(v) => patch({ backgroundMode: v as AppearanceSettings["backgroundMode"] })}
          ariaLabel="Background mode"
        />
      </div>

      {appearance.backgroundMode === "solid" && (
        <div className="settings-row settings-row-stack">
          <span id="bg-colour-label">Background colour</span>
          <div className="swatch-row" role="radiogroup" aria-labelledby="bg-colour-label">
            {BACKGROUND_PRESETS.map((p) => (
              <button
                key={p.value}
                type="button"
                role="radio"
                aria-checked={appearance.backgroundColour.toUpperCase() === p.value}
                aria-label={p.name}
                title={p.name}
                className={`swatch-btn${appearance.backgroundColour.toUpperCase() === p.value ? " current" : ""}`}
                style={{ background: p.value, borderColor: p.theme === "light" ? "#d9d5cb" : undefined }}
                onClick={() => patch({ backgroundColour: p.value })}
              />
            ))}
            <ColorPicker
              value={appearance.backgroundColour}
              onChange={(v) => {
                const hex = normaliseHex(v);
                if (hex) patch({ backgroundColour: hex });
              }}
            />
          </div>
        </div>
      )}

      {appearance.backgroundMode === "image" && (
        <>
          <div className="settings-row settings-row-stack">
            <span>Wallpaper</span>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <label className="btn" style={{ cursor: "pointer", margin: 0 }}>
                {appearance.backgroundImage ? "Choose another image…" : "Choose image…"}
                <input
                  type="file"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={(e) => void pickImage(e.target.files?.[0])}
                />
              </label>
              {appearance.backgroundImage && (
                <button
                  type="button"
                  className="btn small"
                  onClick={() => patch({ backgroundImage: null, backgroundMode: "theme" })}
                >
                  Remove
                </button>
              )}
              {busy && <span className="derived">Shrinking image…</span>}
            </div>
            {error && <div className="error-box" role="alert">{error}</div>}
            {!appearance.backgroundImage && !busy && (
              <p className="derived">Pick a photo or pattern. It is shrunk and stored locally — nothing is uploaded.</p>
            )}
          </div>
          <div className="settings-row">
            <label htmlFor="set-bg-dim">Dim wallpaper</label>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
              <input
                id="set-bg-dim"
                type="range"
                min={0}
                max={100}
                step={5}
                value={appearance.backgroundDim}
                onChange={(e) => patch({ backgroundDim: Number(e.target.value) })}
                style={{ flex: 1 }}
              />
              <span className="derived">{appearance.backgroundDim}%</span>
            </div>
          </div>
        </>
      )}

      {usesCustomBackground(appearance) && (
        <p className="derived">
          Panels become translucent so the background shows through. Print always uses plain paper.
        </p>
      )}
    </>
  );
}
