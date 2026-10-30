import { useState } from "react";
import { daysUntil, formatDateShort, relativeLabel, sortByNearness, todayKey } from "../deadlines";
import type { Deadline } from "../types";

// Priorities tab: one-off dated deadlines (exams, assignments...), nearest
// first — overdue at the top, then today, then future. Calendar dates, not
// repeating weekdays: an exam happens once.

interface Draft {
  title: string;
  date: string;
  subject: string;
  notes: string;
}

const blankDraft = (d: string): Draft => ({ title: "", date: d, subject: "", notes: "" });

export function PrioritiesView({
  deadlines,
  subjects,
  onAdd,
  onUpdate,
  onDelete,
  onClearPast,
}: {
  deadlines: Deadline[];
  subjects: string[];
  onAdd: (d: Draft) => void;
  onUpdate: (id: string, patch: Partial<Deadline>) => void;
  onDelete: (id: string) => void;
  onClearPast: () => void;
}) {
  const today = todayKey();
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(blankDraft(today));
  const [error, setError] = useState<string | null>(null);

  const ordered = sortByNearness(deadlines, today);
  const pastCount = deadlines.filter((d) => d.date < today).length;

  const startNew = () => {
    setDraft(blankDraft(today));
    setEditingId(null);
    setError(null);
    setFormOpen(true);
  };

  const startEdit = (d: Deadline) => {
    setDraft({ title: d.title, date: d.date, subject: d.subject ?? "", notes: d.notes ?? "" });
    setEditingId(d.id);
    setError(null);
    setFormOpen(true);
  };

  const validDate = (s: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const [y, m, day] = s.split("-").map(Number);
    const dt = new Date(y, m - 1, day);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === day;
  };

  const save = () => {
    if (!draft.title.trim()) {
      setError("Give the deadline a title.");
      return;
    }
    if (!validDate(draft.date)) {
      setError("Pick a valid calendar date.");
      return;
    }
    if (editingId) onUpdate(editingId, { title: draft.title.trim(), date: draft.date, subject: draft.subject.trim() || undefined, notes: draft.notes.trim() || undefined });
    else onAdd(draft);
    setFormOpen(false);
    setEditingId(null);
  };

  return (
    <div className="dash">
      <h2>Priorities</h2>
      <p className="derived">Exams, assignments and other one-off deadlines — nearest first. Dates are calendar days, not repeating weekdays.</p>
      {!formOpen && (
        <div className="modal-actions" style={{ marginBottom: 12 }}>
          <button type="button" className="btn primary" onClick={startNew}>＋ New deadline</button>
          {pastCount > 0 && (
            <button type="button" className="btn" onClick={onClearPast}>
              Clear {pastCount} past
            </button>
          )}
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
              <label htmlFor="dl-date">Date (required)</label>
              <input id="dl-date" type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
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
            const away = daysUntil(d.date, today);
            const overdue = away < 0;
            return (
              <li key={d.id} className={`today-row${overdue ? " overdue" : ""}`}>
                <span className="rank" aria-hidden="true">{i + 1}</span>
                <span className="today-main">
                  <strong>{d.title}</strong>
                  <span className="derived"> {formatDateShort(d.date)} · {relativeLabel(away)}{d.subject ? ` · ${d.subject}` : ""}{d.notes ? ` — ${d.notes}` : ""}</span>
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
