import type { Category, GlobalSettings } from "../types";
import { APP_VERSION } from "../store";
import { formatTime } from "../time";

function timeOptions(): number[] {
  const out: number[] = [];
  for (let t = 0; t <= 1440; t += 60) out.push(t);
  return out;
}

/** Settings — spec §5.6. Only MVP-operational settings are interactive. */
export function SettingsPanel({
  settings,
  categories,
  onChange,
  onClose,
  onClearAll,
}: {
  settings: GlobalSettings;
  categories: Category[];
  onChange: (s: GlobalSettings) => void;
  onClose: () => void;
  onClearAll: () => void;
}) {
  return (
    <div className="modal-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Settings">
        <h2>Settings</h2>

        <div className="settings-row">
          <label htmlFor="set-vis-start">Visible day starts</label>
          <select
            id="set-vis-start"
            value={settings.visibleStartMinutes}
            onChange={(e) => onChange({ ...settings, visibleStartMinutes: Number(e.target.value) })}
          >
            {timeOptions().map((t) => (
              <option key={t} value={t}>{formatTime(t, settings.clockFormat)}</option>
            ))}
          </select>
        </div>
        <div className="settings-row">
          <label htmlFor="set-vis-end">Visible day ends</label>
          <select
            id="set-vis-end"
            value={settings.visibleEndMinutes}
            onChange={(e) => onChange({ ...settings, visibleEndMinutes: Number(e.target.value) })}
          >
            {timeOptions().map((t) => (
              <option key={t} value={t}>{formatTime(t, settings.clockFormat)}</option>
            ))}
          </select>
        </div>
        <p className="derived">Changing the visible range never deletes activities outside it (§3.4).</p>

        <div className="settings-row">
          <span id="clock-label">Clock format</span>
          <div role="radiogroup" aria-labelledby="clock-label" style={{ display: "flex", gap: 8 }}>
            <label><input type="radio" checked={settings.clockFormat === "12h"} onChange={() => onChange({ ...settings, clockFormat: "12h" })} /> 12-hour</label>
            <label><input type="radio" checked={settings.clockFormat === "24h"} onChange={() => onChange({ ...settings, clockFormat: "24h" })} /> 24-hour</label>
          </div>
        </div>

        <div className="settings-row">
          <label htmlFor="set-pair-a">Quick-switch pair (§7.4)</label>
          <div style={{ display: "flex", gap: 6 }}>
            <select
              id="set-pair-a"
              value={settings.switchPair[0]}
              onChange={(e) => onChange({ ...settings, switchPair: [e.target.value, settings.switchPair[1]] })}
            >
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <span aria-hidden="true">⇄</span>
            <select
              id="set-pair-b"
              aria-label="Quick-switch pair, second category"
              value={settings.switchPair[1]}
              onChange={(e) => onChange({ ...settings, switchPair: [settings.switchPair[0], e.target.value] })}
            >
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>

        <div className="settings-row">
          <span>Categories (V1)</span>
          <span className="derived">Rename, recolour & counting flags arrive with V1 category management.</span>
        </div>
        <div className="settings-row">
          <span>Reminders & timers (V2)</span>
          <span className="derived">Stored per activity now; notifications ship in V2.</span>
        </div>

        <div className="settings-row">
          <span>TimeFlow version</span>
          <span>{APP_VERSION} · schema v1 · English (Australia), week starts Monday</span>
        </div>

        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>Close</button>
          <button type="button" className="btn danger" onClick={onClearAll}>
            Remove all activities (undoable)
          </button>
        </div>
      </div>
    </div>
  );
}
