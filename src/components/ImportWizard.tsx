import { useMemo, useState } from "react";
import type { Activity, Category, ClockFormat, Weekday } from "../types";
import { WEEKDAY_NAMES, uid, nowIso } from "../types";
import { analyzeExcel, type ImportProposal, type SheetPlan } from "../importExcel";
import { minutesFromCsvTime, parseCsv, weekdayFromCsvName } from "../exportCsv";
import { validateActivity } from "../validation";
import { formatTime } from "../time";
import { pickFile } from "../native";

// Guided import: file → sheet → preview/correct → mode → commit (§16.3).
// Nothing commits before the final step; invalid rows are flagged, never
// silently rounded, and excluded until explicitly fixed (§16.3, §4.4).

export interface ImportResult {
  activities: Activity[];
  mode: "replace" | "merge" | "new";
  newName: string;
  fileName: string;
  imported: number;
  skipped: number;
}

function csvToProposals(text: string, categories: Category[]): { proposals: ImportProposal[]; warnings: string[] } {
  const warnings: string[] = [];
  const rows = parseCsv(text);
  if (rows.length < 2) return { proposals: [], warnings: ["No data rows found."] };
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const find = (...names: string[]) => head.findIndex((h) => names.includes(h.replace(/[\s_]/g, "")));
  const iName = find("name", "activity", "title");
  const iDay = find("day", "weekday");
  const iStart = find("start", "starttime");
  const iEnd = find("end", "endtime");
  const iCat = find("category", "cat");
  const iSubj = find("subject");
  const iNotes = find("notes", "note");
  const iOpt = find("optionalwork", "optional", "ow");
  if (iDay === -1 || iStart === -1 || iEnd === -1) {
    return { proposals: [], warnings: ["CSV needs Day, Start and End columns (Name optional — blank uses the category)."] };
  }
  const catByName = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));
  const proposals: ImportProposal[] = rows.slice(1).map((r, k) => {
    const w: string[] = [];
    const day = weekdayFromCsvName(r[iDay] ?? "");
    if (day === null) w.push(`Unknown day "${r[iDay] ?? ""}".`);
    const start = minutesFromCsvTime(r[iStart] ?? "");
    const end = minutesFromCsvTime(r[iEnd] ?? "");
    if (start === null || end === null) w.push("Unreadable time — fix or exclude.");
    else if (start % 15 !== 0 || end % 15 !== 0) w.push("Off the 15-minute grid.");
    let categoryId = "other";
    const cn = (iCat >= 0 ? r[iCat] ?? "" : "").trim().toLowerCase();
    if (cn && catByName.has(cn)) categoryId = catByName.get(cn)!;
    else if (cn) w.push(`Unknown category "${r[iCat]}" — set to Other.`);
    const optRaw = (iOpt >= 0 ? r[iOpt] ?? "" : "").trim().toLowerCase();
    const optionalWorkOverride = /^(yes|true|1|y)$/.test(optRaw) ? "yes" as const : /^(no|false|0|n)$/.test(optRaw) ? "no" as const : "inherit" as const;
    return {
      key: `csv_${k}`,
      day: day ?? 0,
      start, end,
      name: iName >= 0 ? (r[iName] ?? "").trim() : "",
      categoryId,
      subject: iSubj >= 0 ? (r[iSubj] ?? "").trim() : "",
      notes: iNotes >= 0 ? (r[iNotes] ?? "").trim() : "",
      optionalWorkOverride,
      warnings: w,
      excluded: day === null || start === null || end === null,
      suggestedStart: start !== null && start % 15 !== 0 ? Math.round(start / 15) * 15 : null,
      suggestedEnd: end !== null && end % 15 !== 0 ? Math.round(end / 15) * 15 : null,
    };
  });
  const { proposals, warnings } = csvToProposals(text, categories);
  return { proposals, warnings };
}

export function ImportWizard({
  categories,
  clockFormat,
  activeName,
  onClose,
  onImport,
}: {
  categories: Category[];
  clockFormat: ClockFormat;
  activeName: string;
  onClose: () => void;
  onImport: (r: ImportResult) => void;
}) {
  const [stage, setStage] = useState<"file" | "review" | "mode">("file");
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [plans, setPlans] = useState<SheetPlan[]>([]);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [proposals, setProposals] = useState<ImportProposal[]>([]);
  const [sheetWarnings, setSheetWarnings] = useState<string[]>([]);
  const [mode, setMode] = useState<"replace" | "merge" | "new">("merge");
  const [newName, setNewName] = useState("Imported Week");
  const [busy, setBusy] = useState(false);

  const loadFile = async () => {
    setError(null);
    setBusy(true);
    try {
      const picked = await pickFile(["xlsx", "csv"], "Timetable files");
      if (!picked) {
        setBusy(false);
        return;
      }
      setFileName(picked.name);
      if (/\.csv$/i.test(picked.name)) {
        const text = new TextDecoder().decode(picked.data);
        const { proposals: p, warnings } = csvToProposals(text, categories);
        setProposals(p);
        setSheetWarnings(warnings);
        setPlans([]);
        setStage("review");
      } else {
        const found = await analyzeExcel(picked.data);
        if (found.length === 0) {
          setError("No worksheets found in this workbook.");
        } else {
          setPlans(found);
          const best = found.reduce((b, c, i) => (c.proposals.length > found[b].proposals.length ? i : b), 0);
          setSheetIdx(best);
          setProposals(found[best].proposals);
          setSheetWarnings(found[best].warnings);
          setStage("review");
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "This file could not be read.");
    }
    setBusy(false);
  };

  const pickSheet = (i: number) => {
    setSheetIdx(i);
    setProposals(plans[i].proposals);
    setSheetWarnings(plans[i].warnings);
  };

  const patch = (key: string, p: Partial<ImportProposal>) =>
    setProposals((prev) => prev.map((x) => (x.key === key ? { ...x, ...p } : x)));

  const parseHM = (text: string): number | null => {
    const t = text.trim();
    let m = t.match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i);
    if (m) {
      let h = parseInt(m[1], 10);
      const min = parseInt(m[2], 10);
      const ap = m[3]?.toLowerCase();
      if (ap) {
        if (h < 1 || h > 12 || min > 59) return null;
        h = ap === "am" ? h % 12 : (h % 12) + 12;
      } else if (h > 24 || min > 59) return null;
      return h * 60 + min;
    }
    m = t.match(/^(\d{1,2})\s*(am|pm)$/i);
    if (m) {
      let h = parseInt(m[1], 10);
      if (h < 1 || h > 12) return null;
      h = m[2].toLowerCase() === "am" ? h % 12 : (h % 12) + 12;
      return h * 60;
    }
    return null;
  };

  const validity = (p: ImportProposal): string | null => {
    if (p.excluded) return "excluded";
    if (p.start === null || p.end === null) return "Set a valid time or exclude.";
    if (p.end <= p.start) return "End must be after start.";
    if (p.start % 15 !== 0 || p.end % 15 !== 0) return "Must use 15-minute steps.";
    if (p.end - p.start < 15) return "Minimum 15 minutes.";
    return null;
  };

  const counts = useMemo(() => {
    const inc = proposals.filter((p) => !p.excluded);
    const valid = inc.filter((p) => validity(p) === null);
    return { included: inc.length, valid: valid.length, invalid: inc.length - valid.length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposals]);

  const commit = () => {
    const t = nowIso();
    const activities: Activity[] = [];
    let skipped = 0;
    for (const p of proposals) {
      if (p.excluded || validity(p) !== null) {
        if (!p.excluded) skipped++;
        continue;
      }
      const a: Activity = {
        id: uid("act"),
        name: p.name.trim(),
        categoryId: categories.some((c) => c.id === p.categoryId) ? p.categoryId : "other",
        subject: p.subject.trim() || undefined,
        weekday: p.day,
        startTime: p.start!,
        endTime: p.end!,
        notes: p.notes.trim() || undefined,
        optionalWorkOverride: p.optionalWorkOverride === "inherit" ? undefined : p.optionalWorkOverride,
        createdAt: t,
        updatedAt: t,
      };
      if (validateActivity(a, categories).length > 0) {
        skipped++;
        continue;
      }
      activities.push(a);
    }
    onImport({ activities, mode, newName: newName.trim() || "Imported Week", fileName, imported: activities.length, skipped });
  };

  return (
    <div className="modal-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal wide" role="dialog" aria-modal="true" aria-label="Import timetable">
        <h2>Import timetable</h2>
        <p className="derived">Steps: file → preview & correct → import mode. Nothing changes until Import.</p>
        {error && <div className="error-box" role="alert">{error}</div>}

        {stage === "file" && (
          <div className="modal-actions">
            <button type="button" className="btn primary" onClick={loadFile} disabled={busy}>
              {busy ? "Reading…" : "Choose Excel or CSV file"}
            </button>
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
          </div>
        )}

        {stage === "review" && (
          <>
            <p><strong>{fileName}</strong></p>
            {plans.length > 1 && (
              <div className="field">
                <label htmlFor="imp-sheet">Worksheet</label>
                <select id="imp-sheet" value={sheetIdx} onChange={(e) => pickSheet(Number(e.target.value))}>
                  {plans.map((p, i) => <option key={p.sheetName} value={i}>{p.sheetName} ({p.proposals.length} found)</option>)}
                </select>
              </div>
            )}
            {sheetWarnings.length > 0 && (
              <div className="notice" role="note">
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {sheetWarnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </div>
            )}
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr><th>Use</th><th>Day</th><th>Start</th><th>End</th><th>Name</th><th>Category</th><th>Warnings</th></tr>
                </thead>
                <tbody>
                  {proposals.map((p) => {
                    const err = validity(p);
                    return (
                      <tr key={p.key} className={err && err !== "excluded" ? "row-invalid" : ""}>
                        <td><input type="checkbox" checked={!p.excluded} onChange={(e) => patch(p.key, { excluded: !e.target.checked })} aria-label={`Include ${p.name || "activity"}`} style={{ width: 22, height: 22 }} /></td>
                        <td>
                          <select value={p.day} onChange={(e) => patch(p.key, { day: Number(e.target.value) as Weekday })} aria-label="Day">
                            {WEEKDAY_NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}
                          </select>
                        </td>
                        <td><input value={p.start === null ? "" : formatTime(p.start, clockFormat)} onChange={(e) => { const v = parseHM(e.target.value); patch(p.key, { start: v }); }} aria-label="Start time" size={10} /></td>
                        <td><input value={p.end === null ? "" : formatTime(p.end, clockFormat)} onChange={(e) => { const v = parseHM(e.target.value); patch(p.key, { end: v }); }} aria-label="End time" size={10} /></td>
                        <td><input value={p.name} onChange={(e) => patch(p.key, { name: e.target.value })} aria-label="Activity name" size={14} placeholder="(blank = category)" /></td>
                        <td>
                          <select value={p.categoryId} onChange={(e) => patch(p.key, { categoryId: e.target.value })} aria-label="Category">
                            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                        </td>
                        <td className="warn-cell">
                          {p.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
                          {p.suggestedStart !== null && (
                            <button type="button" className="btn small" onClick={() => patch(p.key, { start: p.suggestedStart, suggestedStart: null })}>Use {formatTime(p.suggestedStart!, clockFormat)}</button>
                          )}
                          {p.suggestedEnd !== null && (
                            <button type="button" className="btn small" onClick={() => patch(p.key, { end: p.suggestedEnd, suggestedEnd: null })}>Use {formatTime(p.suggestedEnd!, clockFormat)}</button>
                          )}
                          {err && err !== "excluded" && <div className="row-err">{err}</div>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="derived" aria-live="polite">{counts.valid} valid · {counts.invalid} need fixing · {proposals.length - counts.included} excluded</p>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setStage("file")}>Back</button>
              <button type="button" className="btn primary" onClick={() => setStage("mode")} disabled={counts.valid === 0}>Continue</button>
              <button type="button" className="btn" onClick={onClose}>Cancel</button>
            </div>
          </>
        )}

        {stage === "mode" && (
          <>
            <div className="field" role="radiogroup" aria-label="Import mode">
              <label><input type="radio" checked={mode === "merge"} onChange={() => setMode("merge")} /> Merge into “{activeName}” ({counts.valid} activities added)</label>
              <label><input type="radio" checked={mode === "replace"} onChange={() => setMode("replace")} /> Replace “{activeName}” (a restore point is saved first)</label>
              <label><input type="radio" checked={mode === "new"} onChange={() => setMode("new")} /> Create a new timetable</label>
            </div>
            {mode === "new" && (
              <div className="field">
                <label htmlFor="imp-name">New timetable name</label>
                <input id="imp-name" value={newName} onChange={(e) => setNewName(e.target.value)} />
              </div>
            )}
            <p className="derived">{counts.valid} will be imported{counts.invalid > 0 ? `, ${counts.invalid} invalid row(s) skipped` : ""}. Replace mode keeps a one-click restore point.</p>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setStage("review")}>Back</button>
              <button type="button" className="btn primary" onClick={commit}>Import</button>
              <button type="button" className="btn" onClick={onClose}>Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
