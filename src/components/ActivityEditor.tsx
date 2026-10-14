import { useEffect, useMemo, useRef, useState } from "react";
import type { Activity, Category, ClockFormat, Weekday } from "../types";
import { WEEKDAY_NAMES, uid, nowIso } from "../types";
import { formatTime } from "../time";
import { validateActivity } from "../validation";
import { categoryById } from "../categories";

export interface EditorDraft {
  /** Existing activity id, or null for a new activity. */
  activityId: string | null;
  name: string;
  categoryId: string;
  subject: string;
  weekday: Weekday;
  startTime: number;
  endTime: number;
  /** False until the user picks squares in the grid picker (new only). */
  timeSet: boolean;
  notes: string;
  optionalWorkOverride: "inherit" | "yes" | "no";
  startEnabled: boolean;
  endEnabled: boolean;
  startLead: number;
  endLead: number;
  /** >1 when opened from a merged visual block (§8.3). */
  memberCount: number;
}

export function draftFromActivity(a: Activity, memberCount = 1): EditorDraft {
  return {
    activityId: a.id,
    name: a.name,
    categoryId: a.categoryId,
    subject: a.subject ?? "",
    weekday: a.weekday,
    startTime: a.startTime,
    endTime: a.endTime,
    timeSet: true,
    notes: a.notes ?? "",
    optionalWorkOverride: a.optionalWorkOverride ?? "inherit",
    startEnabled: a.reminderPreferences?.startEnabled ?? true,
    endEnabled: a.reminderPreferences?.endEnabled ?? true,
    startLead: a.reminderPreferences?.startLeadMinutes ?? 5,
    endLead: a.reminderPreferences?.endLeadMinutes ?? 5,
    memberCount,
  };
}

export function draftToActivity(d: EditorDraft, categories: Category[]): Activity | null {
  const cat = categoryById(categories, d.categoryId);
  if (!cat) return null;
  const t = nowIso();
  return {
    id: d.activityId ?? uid("act"),
    name: d.name.trim(),
    categoryId: d.categoryId,
    subject: d.subject.trim() || undefined,
    weekday: d.weekday,
    startTime: d.startTime,
    endTime: d.endTime,
    notes: d.notes.trim() || undefined,
    optionalWorkOverride: d.optionalWorkOverride === "inherit" ? undefined : d.optionalWorkOverride,
    reminderPreferences: {
      startEnabled: d.startEnabled,
      endEnabled: d.endEnabled,
      startLeadMinutes: d.startLead,
      endLeadMinutes: d.endLead,
    },
    createdAt: t,
    updatedAt: t,
  };
}

function timeOptions(): number[] {
  const out: number[] = [];
  for (let t = 0; t <= 1440; t += 15) out.push(t);
  return out;
}

/**
 * Grid-based time picker for new activities: tap 15-minute squares to set
 * the range (first tap sets start, second tap extends the end). Occupied
 * squares are hatched but still selectable — overlaps stay allowed and are
 * flagged by the conflict flow rather than silently blocked.
 */
function TimeRangePicker({
  weekday,
  start,
  end,
  active,
  activities,
  clockFormat,
  onPick,
}: {
  weekday: Weekday;
  start: number;
  end: number;
  active: boolean;
  activities: Activity[];
  clockFormat: ClockFormat;
  onPick: (start: number, end: number) => void;
}) {
  const [anchor, setAnchor] = useState<number | null>(null);

  useEffect(() => setAnchor(null), [weekday]);

  const occupied = useMemo(() => {
    const set = new Set<number>();
    for (const a of activities) {
      if (a.weekday !== weekday) continue;
      for (let t = a.startTime; t < a.endTime; t += 15) set.add(t);
    }
    return set;
  }, [activities, weekday]);

  const tap = (t: number) => {
    const a = anchor;
    if (a === null || t < a) {
      setAnchor(t);
      onPick(t, Math.min(t + 15, 1440));
    } else {
      onPick(a, Math.min(t + 15, 1440));
    }
  };

  const hours: number[] = [];
  for (let h = 0; h < 24; h++) hours.push(h);

  return (
    <div className="slot-picker" role="group" aria-label="Choose start and end time on the grid">
      {hours.map((h) => (
        <div key={h} className="slot-hour">
          <span className="slot-hour-label" aria-hidden="true">{formatTime(h * 60, clockFormat)}</span>
          <div className="slot-btns">
            {[0, 1, 2, 3].map((q) => {
              const t = h * 60 + q * 15;
              const selected = active && t >= start && t < end;
              const busy = occupied.has(t);
              return (
                <button
                  key={t}
                  type="button"
                  className={`slot-btn${busy ? " occupied" : ""}`}
                  aria-pressed={selected}
                  aria-label={`${formatTime(t, clockFormat)}${busy ? ", overlaps an existing activity" : ""}${selected ? ", selected" : ""}`}
                  title={formatTime(t, clockFormat)}
                  onClick={() => tap(t)}
                >
                  :{String(q * 15).padStart(2, "0")}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Full activity editor — spec §6.3. All edits validated before commit. */
export function ActivityEditor({
  initial,
  activities,
  categories,
  clockFormat,
  existingNames,
  existingSubjects,
  onSave,
  onCancel,
  onDelete,
  onDuplicate,
}: {
  initial: EditorDraft;
  activities: Activity[];
  categories: Category[];
  clockFormat: ClockFormat;
  existingNames: string[];
  existingSubjects: string[];
  onSave: (activity: Activity) => string | null;
  onCancel: () => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
}) {
  const [d, setD] = useState<EditorDraft>(initial);
  const [error, setError] = useState<string | null>(null);
  const categoryTouched = useRef(false);
  const set = <K extends keyof EditorDraft>(k: K, v: EditorDraft[K]) =>
    setD((prev) => ({ ...prev, [k]: v }));

  // Escape closes the editor without saving (§27).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  /** Typing a known activity name reuses its category/subject (§6.2). */
  const onNameChange = (value: string) => {
    setD((prev) => {
      const next = { ...prev, name: value };
      if (prev.activityId === null && !categoryTouched.current) {
        const match = activities.find(
          (a) => a.name.toLowerCase() === value.trim().toLowerCase(),
        );
        if (match) {
          next.categoryId = match.categoryId;
          if (!next.subject.trim() && match.subject) next.subject = match.subject;
        }
      }
      return next;
    });
  };

  const previewErrors = useMemo(() => {
    if (d.activityId === null && !d.timeSet)
      return [{ field: "time", message: "Tap the grid below to choose the time." }];
    const a = draftToActivity(d, categories);
    if (!a) return [{ field: "categoryId", message: "The selected category does not exist." }];
    return validateActivity(a, categories);
  }, [d, categories]);

  const duration = d.endTime - d.startTime;

  const commit = () => {
    if (d.activityId === null && !d.timeSet) {
      setError("Tap the grid to choose a start and end time first.");
      return;
    }
    const a = draftToActivity(d, categories);
    if (!a) {
      setError("The selected category does not exist.");
      return;
    }
    const errs = validateActivity(a, categories);
    if (errs.length > 0) {
      // Show message, leave original unchanged (§6.4).
      setError(errs[0].message);
      return;
    }
    const err = onSave(a);
    if (err) setError(err);
  };

  return (
    <div className="modal-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={d.activityId ? "Edit activity" : "New activity"}>
        <h2>{d.activityId ? "Edit activity" : "New activity"}</h2>
        {d.memberCount > 1 && (
          <div className="notice" role="note">
            This block shows {d.memberCount} adjacent activities. You are editing one
            of them — saving a differing name, category or reminder may split the
            visual block. Use the menu's Split action to work on one portion
            independently.
          </div>
        )}
        {error && <div className="error-box" role="alert">{error}</div>}
        <div className="field">
          <label htmlFor="ed-name">Activity name (optional — blank uses the category)</label>
          <input
            id="ed-name"
            autoFocus
            value={d.name}
            list="ed-names"
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="e.g. Mathematics homework, or blank for just “Study”"
          />
          <datalist id="ed-names">
            {existingNames.slice(0, 50).map((n) => <option key={n} value={n} />)}
          </datalist>
        </div>
        <div className="form-row">
          <div className="field">
            <label htmlFor="ed-cat">Category (required)</label>
            <select id="ed-cat" value={d.categoryId} onChange={(e) => { categoryTouched.current = true; set("categoryId", e.target.value); }}>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="ed-day">Weekday (required)</label>
            <select id="ed-day" value={d.weekday} onChange={(e) => set("weekday", Number(e.target.value) as Weekday)}>
              {WEEKDAY_NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}
            </select>
          </div>
        </div>
        {d.activityId === null ? (
          <div className="field">
            <label id="ed-grid-label">Time — tap a square to set the start, tap another to extend the end</label>
            <TimeRangePicker
              weekday={d.weekday}
              start={d.startTime}
              end={d.endTime}
              active={d.timeSet}
              activities={activities}
              clockFormat={clockFormat}
              onPick={(startTime, endTime) => setD((prev) => ({ ...prev, startTime, endTime, timeSet: true }))}
            />
          </div>
        ) : (
          <div className="form-row">
            <div className="field">
              <label htmlFor="ed-start">Start (15-min steps)</label>
              <select id="ed-start" value={d.startTime} onChange={(e) => set("startTime", Number(e.target.value))}>
                {timeOptions().map((t) => (
                  <option key={t} value={t}>{formatTime(t, clockFormat)}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="ed-end">End (15-min steps)</label>
              <select id="ed-end" value={d.endTime} onChange={(e) => set("endTime", Number(e.target.value))}>
                {timeOptions().map((t) => (
                  <option key={t} value={t}>{formatTime(t, clockFormat)}</option>
                ))}
              </select>
            </div>
          </div>
        )}
        <p className="derived" aria-live="polite">
          Duration: {duration >= 0 ? `${Math.floor(duration / 60)}h ${duration % 60}m` : "—"}
          {previewErrors.length > 0 && ` — ⚠ ${previewErrors[0].message}`}
        </p>
        <div className="form-row">
          <div className="field">
            <label htmlFor="ed-subject">Subject (optional)</label>
            <input id="ed-subject" value={d.subject} list="ed-subjects" onChange={(e) => set("subject", e.target.value)} placeholder="e.g. Mathematics" />
            <datalist id="ed-subjects">
              {existingSubjects.slice(0, 50).map((n) => <option key={n} value={n} />)}
            </datalist>
          </div>
          <div className="field">
            <label htmlFor="ed-ow">Optional-work counting</label>
            <select id="ed-ow" value={d.optionalWorkOverride} onChange={(e) => set("optionalWorkOverride", e.target.value as EditorDraft["optionalWorkOverride"])}>
              <option value="inherit">Follow category default</option>
              <option value="yes">Count as optional work</option>
              <option value="no">Do not count as optional work</option>
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor="ed-notes">Notes (optional)</label>
          <textarea id="ed-notes" rows={2} value={d.notes} onChange={(e) => set("notes", e.target.value)} />
        </div>
        <fieldset style={{ border: "1px solid var(--line)", borderRadius: 8, marginBottom: 10 }}>
          <legend>Reminders (V2 scheduling — stored now, fired in V2)</legend>
          <label style={{ display: "flex", gap: 8, alignItems: "center", minHeight: 44 }}>
            <input type="checkbox" checked={d.startEnabled} onChange={(e) => set("startEnabled", e.target.checked)} style={{ width: 22, height: 22 }} />
            Remind before start
            <select value={d.startLead} onChange={(e) => set("startLead", Number(e.target.value))} aria-label="Minutes before start">
              {[0, 5, 10, 15, 30].map((m) => <option key={m} value={m}>{m} min</option>)}
            </select>
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "center", minHeight: 44 }}>
            <input type="checkbox" checked={d.endEnabled} onChange={(e) => set("endEnabled", e.target.checked)} style={{ width: 22, height: 22 }} />
            Remind before end
            <select value={d.endLead} onChange={(e) => set("endLead", Number(e.target.value))} aria-label="Minutes before end">
              {[0, 5, 10, 15, 30].map((m) => <option key={m} value={m}>{m} min</option>)}
            </select>
          </label>
        </fieldset>
        <div className="modal-actions">
          <button type="button" className="btn primary" onClick={commit}>Save</button>
          <button type="button" className="btn" onClick={onCancel}>Cancel (Esc)</button>
          {onDuplicate && <button type="button" className="btn" onClick={onDuplicate}>Duplicate</button>}
          {onDelete && <button type="button" className="btn danger" onClick={onDelete}>Delete</button>}
        </div>
      </div>
    </div>
  );
}
