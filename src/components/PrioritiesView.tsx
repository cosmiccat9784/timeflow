import { useState } from "react";
import type { Deadline, Weekday } from "../types";
import { WEEKDAY_NAMES } from "../types";
import { daysUntil, relativeLabel, sortByNearness } from "../deadlines";

// Priorities tab: all-day deadlines (exams, assignments…) ordered by
// nearness within the repeating week — nearest first. No dates involved:
// nearness is days-until that weekday from today.

interface Draft {
  title: string;
  weekday: Weekday;
  subject: string;
  notes: string;
}

const blankDraft: Draft = { title: "", weekday: 4, subject: "", notes: "" };

export function PrioritiesView({
  deadlines,
  subjects,
  today,
  onAdd,
  onUpdate,
  onDelete,
}: {
  deadlines: Deadline[];
  subjects: string[];
  today: Weekday;
  onAdd: (d: Draft) => void;
  onUpdate: (id: string, patch: Partial<Deadline>) => void;
  onDelete: (id: string) => void;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(blankDraft);
  const [error, setError] = useState<string | null>(null);

  const ordered = sortByNearness(deadlines, today);

  const startNew = () => {
    setDraft(blankDraft);
    setEditingId(null);
    setError(null);
    setFormOpen(true);
  };

  const startEdit = (d: Deadline) => {
    setDraft({ title: d.title, weekday: d.weekday, subject: d.subject ?? "", notes: d.notes ?? "" });
    setEditingId(d.id);
    setError(null);
    setFormOpen(true);
  };

  const save = () => {
    if (!draft.title.trim()) {
      setError("Give the deadline a title.");
      return;
    }
    if (editingId) onUpdate(editingId, { title: draft.title.trim(), weekday: draft.weekday, subject: draft.subject.trim() || undefined, notes: draft.notes.trim() || undefined });
    else onAdd(draft);
    setFormOpen(false);
    setEditingId(null);
  };

  return (
    <div className="dash">
      <h2>Priorities</h2>
      <p className="derived">Exams, assignments and other all-day deadlines — nearest first. Times are weekdays in your repeating week, not calendar dates.</p>
      {!formOpen && (
        <div className="modal-actions" style={{ marginBottom: 12 }}>
          <button type="button" className="btn primary" onClick={startNew}>＋ New deadline</button>
        </div>
      )}
      {formOpen && (
        <div className="dash-card" style={{ marginBottom: 12 }}>
          <h3>{editingId ? "Edit deadline" : "New deadline"}</h3>
          {error && <div className="error-box" role="alert">{error}</div>}
          <div className="field">
            <label htmlFor="dl-title">Title (required)</label>
            <input id="dl-title" autoFocus value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="e.g. Maths exam" />
          </div>
          <div className="form-row">
            <div className="field">
              <label htmlFor="dl-day">Day</label>
              <select id="dl-day" value={draft.weekday} onChange={(e) => setDraft({ ...draft, weekday: Number(e.target.value) as Weekday })}>
                {WEEKDAY_NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="dl-subject">Subject (optional)</label>
              <input id="dl-subject" value={draft.subject} list="dl-subjects" onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
              <datalist id="dl-subjects">
                {subjects.slice(0, 50).map((s) => <option key={s} value={s} />)}
              </datalist>
            </div>
          </div>
          <div className="field">
            <label htmlFor="dl-notes">Notes (optional)</label>
            <textarea id="dl-notes" rows={2} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
          </div>
          <div className="modal-actions">
            <button type="button" className="btn primary" onClick={save}>Save</button>
            <button type="button" className="btn" onClick={() => setFormOpen(false)}>Cancel</button>
          </div>
        </div>
      )}
      {ordered.length === 0 ? (
        <p className="derived">No deadlines yet — add exams or assignments with ＋ New deadline.</p>
      ) : (
        <ol className="timeline">
          {ordered.map((d, i) => {
            const away = daysUntil(today, d.weekday);
            return (
              <li key={d.id} className="today-row">
                <span className="rank" aria-hidden="true">{i + 1}</span>
                <span className="today-main">
                  <strong>{d.title}</strong>
                  <span className="derived"> {WEEKDAY_NAMES[d.weekday]} · {relativeLabel(away)}{d.subject ? ` · ${d.subject}` : ""}{d.notes ? ` — ${d.notes}` : ""}</span>
                </span>
                <button type="button" className="btn small" onClick={() => startEdit(d)}>Edit</button>
                <button type="button" className="btn small" onClick={() => onDelete(d.id)}>Delete</button>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
