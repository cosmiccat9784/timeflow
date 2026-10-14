import { useState } from "react";
import type { Activity, Category } from "../types";
import { uid } from "../types";

// V1 category management (§7.6): create, rename, recolour, re-icon,
// counting flags. Deleting a category in use requires a replacement —
// activities are remapped, never orphaned.

export function CategoryManager({
  categories,
  activities,
  onSave,
  onClose,
}: {
  categories: Category[];
  activities: Activity[];
  onSave: (categories: Category[], remap: Record<string, string>) => string | null;
  onClose: () => void;
}) {
  const [list, setList] = useState<Category[]>(() => categories.map((c) => ({ ...c })));
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [replacement, setReplacement] = useState<string>("");
  const [remap, setRemap] = useState<Record<string, string>>({});

  const usedBy = (id: string) => activities.filter((a) => a.categoryId === id).length;

  const patch = (id: string, p: Partial<Category>) =>
    setList((prev) => prev.map((c) => (c.id === id ? { ...c, ...p } : c)));

  const setCounting = (id: string, kind: "study" | "neither" | "optional") =>
    patch(id, {
      countsTowardStudy: kind === "study",
      countsTowardOptionalWork: kind === "optional",
    });

  const addCategory = () => {
    const n = list.length + 1;
    setList((prev) => [
      ...prev,
      { id: uid("cat"), name: `Category ${n}`, colour: "#E8EAF6", icon: "▫️", countsTowardStudy: false, countsTowardOptionalWork: false },
    ]);
  };

  const confirmDelete = (id: string) => {
    const rep = replacement || list.find((c) => c.id !== id)?.id;
    if (!rep) {
      setError("A replacement category is required.");
      return;
    }
    setRemap((prev) => ({ ...prev, [id]: rep }));
    setList((prev) => prev.filter((c) => c.id !== id));
    setPendingDelete(null);
    setReplacement("");
  };

  const save = () => {
    const names = new Set<string>();
    for (const c of list) {
      if (!c.name.trim()) {
        setError("Every category needs a name.");
        return;
      }
      const key = c.name.trim().toLowerCase();
      if (names.has(key)) {
        setError(`Duplicate category name: "${c.name}".`);
        return;
      }
      names.add(key);
      if (c.countsTowardStudy && c.countsTowardOptionalWork) {
        setError(`"${c.name}" cannot count toward both study and optional work.`);
        return;
      }
    }
    const err = onSave(list.map((c) => ({ ...c, name: c.name.trim() })), remap);
    if (err) setError(err);
  };

  return (
    <div className="modal-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal wide" role="dialog" aria-modal="true" aria-label="Manage categories">
        <h2>Categories</h2>
        {error && <div className="error-box" role="alert">{error}</div>}
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>Icon</th><th>Name</th><th>Colour</th><th>Counts toward</th><th>Used by</th><th></th></tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id}>
                  <td><input value={c.icon} onChange={(e) => patch(c.id, { icon: e.target.value })} aria-label={`Icon for ${c.name}`} size={3} /></td>
                  <td><input value={c.name} onChange={(e) => patch(c.id, { name: e.target.value })} aria-label="Category name" size={16} /></td>
                  <td>
                    <input type="color" value={c.colour} onChange={(e) => patch(c.id, { colour: e.target.value })} aria-label={`Colour for ${c.name}`} />
                    <span className="swatch" style={{ background: c.colour, display: "inline-block", width: 16, height: 16, borderRadius: 4, marginLeft: 6, verticalAlign: "middle" }} aria-hidden="true" />
                  </td>
                  <td>
                    <select
                      value={c.countsTowardStudy ? "study" : c.countsTowardOptionalWork ? "optional" : "neither"}
                      onChange={(e) => setCounting(c.id, e.target.value as "study" | "neither" | "optional")}
                      aria-label={`Counting for ${c.name}`}
                    >
                      <option value="study">📚 Study</option>
                      <option value="neither">Neither</option>
                      <option value="optional">💼 Optional work</option>
                    </select>
                  </td>
                  <td>{usedBy(c.id)}</td>
                  <td>
                    <button type="button" className="btn small danger" onClick={() => { setPendingDelete(c.id); setReplacement(list.find((x) => x.id !== c.id)?.id ?? ""); }}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {pendingDelete && (
          <div className="notice" role="alert">
            “{list.find((c) => c.id === pendingDelete)?.name}” is used by {usedBy(pendingDelete)} activit{usedBy(pendingDelete) === 1 ? "y" : "ies"}.
            Move them to{" "}
            <select value={replacement} onChange={(e) => setReplacement(e.target.value)} aria-label="Replacement category">
              {list.filter((c) => c.id !== pendingDelete).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>{" "}
            <button type="button" className="btn small" onClick={() => confirmDelete(pendingDelete)}>Confirm delete</button>{" "}
            <button type="button" className="btn small" onClick={() => setPendingDelete(null)}>Keep</button>
          </div>
        )}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={addCategory}>＋ Add category</button>
          <button type="button" className="btn primary" onClick={save}>Save categories</button>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
