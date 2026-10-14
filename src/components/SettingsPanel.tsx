import type { Category, GlobalSettings, RestorePoint } from "../types";
import { APP_VERSION } from "../store";
import { formatTime } from "../time";

function timeOptions(): number[] {
  const out: number[] = [];
  for (let t = 0; t <= 1440; t += 60) out.push(t);
  return out;
}

function toHHMM(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

function fromHHMM(s: string): number | null {
  const m = s.match(/^(\d{2}):(\d{2})$/);
  if (!m) return null;
  const v = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  return v >= 0 && v <= 1439 ? v : null;
}

/** Settings — spec §5.6. Planner, notification (V2) and data controls. */
export function SettingsPanel({
  settings,
  categories,
  restorePoints,
  onChange,
  onClose,
  onClearAll,
  onRestorePoint,
  onTestNotification,
}: {
  settings: GlobalSettings;
  categories: Category[];
  restorePoints: RestorePoint[];
  onChange: (s: GlobalSettings) => void;
  onClose: () => void;
  onClearAll: () => void;
  onRestorePoint: (id: string) => void;
  onTestNotification: () => void;
}) {
  const qh = settings.quietHours;
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
          <label htmlFor="set-toasts">Confirmation popups</label>
          <input
            id="set-toasts"
            type="checkbox"
            checked={settings.showToasts}
            onChange={(e) => onChange({ ...settings, showToasts: e.target.checked })}
            style={{ width: 22, height: 22 }}
          />
        </div>

        <h3>Reminders</h3>
        <div className="settings-row">
          <label htmlFor="set-lead-start">Before start (min)</label>
          <select
            id="set-lead-start"
            value={settings.reminderDefaults.startLead}
            onChange={(e) => onChange({ ...settings, reminderDefaults: { ...settings.reminderDefaults, startLead: Number(e.target.value) } })}
          >
            {[0, 5, 10, 15, 30].map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div className="settings-row">
          <label htmlFor="set-lead-end">Before end (min)</label>
          <select
            id="set-lead-end"
            value={settings.reminderDefaults.endLead}
            onChange={(e) => onChange({ ...settings, reminderDefaults: { ...settings.reminderDefaults, endLead: Number(e.target.value) } })}
          >
            {[0, 5, 10, 15, 30].map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div className="settings-row">
          <label htmlFor="set-atend">Reminder at end</label>
          <input
            id="set-atend"
            type="checkbox"
            checked={settings.reminderDefaults.atEnd}
            onChange={(e) => onChange({ ...settings, reminderDefaults: { ...settings.reminderDefaults, atEnd: e.target.checked } })}
            style={{ width: 22, height: 22 }}
          />
        </div>
        <div className="settings-row">
          <label htmlFor="set-qh">Quiet hours</label>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              id="set-qh"
              type="checkbox"
              checked={qh.start !== null}
              onChange={(e) => onChange({
                ...settings,
                quietHours: e.target.checked ? { start: 1320, end: 420 } : { start: null, end: null },
              })}
              style={{ width: 22, height: 22 }}
              aria-label="Enable quiet hours"
            />
            <input
              type="time"
              value={qh.start === null ? "22:00" : toHHMM(qh.start)}
              disabled={qh.start === null}
              onChange={(e) => { const v = fromHHMM(e.target.value); if (v !== null) onChange({ ...settings, quietHours: { ...qh, start: v } }); }}
              aria-label="Quiet hours start"
            />
            <span aria-hidden="true">–</span>
            <input
              type="time"
              value={qh.end === null ? "07:00" : toHHMM(qh.end)}
              disabled={qh.end === null}
              onChange={(e) => { const v = fromHHMM(e.target.value); if (v !== null) onChange({ ...settings, quietHours: { ...qh, end: v } }); }}
              aria-label="Quiet hours end"
            />
          </div>
        </div>
        <div className="settings-row">
          <span>Notifications</span>
          <button type="button" className="btn" onClick={onTestNotification}>Send test notification</button>
        </div>
        <p className="derived">Reminders appear in-app while TimeFlow runs, plus a system notification where the OS allows it. Delivery limits per platform are honest: background delivery with the app fully closed is not guaranteed.</p>

        <h3>Restore points</h3>
        {restorePoints.length === 0 ? (
          <p className="derived">None yet — one is saved automatically before every import or restore.</p>
        ) : (
          <ul>
            {restorePoints.map((r) => (
              <li key={r.id} style={{ marginBottom: 6 }}>
                {r.label} <span className="derived">({new Date(r.at).toLocaleString("en-AU")})</span>{" "}
                <button type="button" className="btn small" onClick={() => onRestorePoint(r.id)}>Restore</button>
              </li>
            ))}
          </ul>
        )}

        <div className="settings-row">
          <span>TimeFlow version</span>
          <span>{APP_VERSION} · schema v2 · English (Australia), week starts Monday</span>
        </div>

        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>Close</button>
          <button type="button" className="btn danger" onClick={onClearAll}>
            Remove all activities in this timetable (undoable)
          </button>
        </div>
      </div>
    </div>
  );
}
