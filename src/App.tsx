import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Activity, GlobalSettings, PersistedState, Weekday } from "./types";
import { WEEKDAY_NAMES, WEEKDAY_SHORT, nowIso, uid } from "./types";
import { DEFAULT_CATEGORIES } from "./categories";
import { defaultCategoryForName } from "./categories";
import { SLOT, formatDuration, formatTime } from "./time";
import { validateActivity } from "./validation";
import { UndoStack } from "./undo";
import { computeMergedBlocks, type MergedBlock } from "./merge";
import { assignLanes, conflictsForCandidate, findConflicts } from "./conflicts";
import { allDayTotals, weekTotals } from "./totals";
import { loadState, saveState, weekdayToday, minutesNow } from "./store";
import { sampleActivities } from "./sample";
import { PlannerGrid, type MenuRequest } from "./components/PlannerGrid";
import { CategoryMenu } from "./components/CategoryMenu";
import { ActivityEditor, draftFromActivity, type EditorDraft } from "./components/ActivityEditor";
import { SettingsPanel } from "./components/SettingsPanel";
import { EmptyState } from "./components/EmptyState";
import { Toast, type ToastData } from "./components/Toast";

interface PendingOp {
  label: string;
  next: Activity[];
  conflicts: string; // human-readable description
}

function describeConflicts(names: Activity[]): string {
  const uniq = [...new Set(names.map((a) => `“${a.name}” (${WEEKDAY_SHORT[a.weekday]} ${formatTime(a.startTime)}–${formatTime(a.endTime)})`))];
  return uniq.slice(0, 4).join("; ") + (uniq.length > 4 ? ` (+${uniq.length - 4} more)` : "");
}

export default function App() {
  const [initial] = useState(() => loadState());
  const [state, setState] = useState<PersistedState>(initial.state);
  const { timetable, categories, settings } = state;
  const activities = timetable.activities;

  const [view, setView] = useState<"week" | "day">(() =>
    typeof window !== "undefined" && window.innerWidth < 1024 ? "day" : "week",
  );
  const [visibleDay, setVisibleDay] = useState<Weekday>(() => weekdayToday());
  const [today, setToday] = useState<Weekday>(() => weekdayToday());
  const [nowMin, setNowMin] = useState(() => minutesNow());
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuRequest | null>(null);
  const [editor, setEditor] = useState<EditorDraft | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toast, setToast] = useState<ToastData | null>(null);
  const [announce, setAnnounce] = useState("");
  const [pending, setPending] = useState<PendingOp | null>(null);
  const [swapFrom, setSwapFrom] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<{ kind: "saved" | "saving" | "error"; text: string }>({ kind: "saved", text: "Saved" });
  const [hintUsed, setHintUsed] = useState(false);
  const [showConflicts, setShowConflicts] = useState(false);

  const undoRef = useRef(new UndoStack());
  const [, force] = useState(0);
  const lastCategory = useRef<string>(settings.switchPair[0] ?? "study");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchX = useRef<number | null>(null);

  // Current-time line ticks + day rollover.
  useEffect(() => {
    const t = setInterval(() => {
      setNowMin(minutesNow());
      setToday(weekdayToday());
    }, 60000);
    return () => clearInterval(t);
  }, []);

  // Autosave (debounced, non-blocking) — §11.4.
  useEffect(() => {
    setSaveStatus({ kind: "saving", text: "Saving…" });
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const r = saveState(state);
      if (r.ok) setSaveStatus({ kind: "saved", text: `Saved ${new Date().toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" })}` });
      else setSaveStatus({ kind: "error", text: "TimeFlow could not save your changes. Keep this window open and export a backup if needed." });
    }, 400);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [state]);

  // Global undo/redo shortcuts (§9.1) + Escape cancels swap mode.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSwapFrom(null);
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        doUndo();
      } else if ((e.key.toLowerCase() === "y") || (e.key.toLowerCase() === "z" && e.shiftKey)) {
        e.preventDefault();
        doRedo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activities]);

  // ---------- derived ----------

  const blocks = useMemo(() => computeMergedBlocks(activities), [activities]);
  const blockByKey = useMemo(() => new Map(blocks.map((b) => [b.key, b])), [blocks]);
  const conflicts = useMemo(() => findConflicts(activities), [activities]);
  const conflictIds = useMemo(() => {
    const s = new Set<string>();
    for (const c of conflicts) { s.add(c.aId); s.add(c.bId); }
    return s;
  }, [conflicts]);
  const lanesByDay = useMemo(() => {
    const m = new Map<number, Map<string, { lane: number; lanes: number }>>();
    for (let d = 0; d < 7; d++) {
      const dayActs = activities.filter((a) => a.weekday === d);
      if (dayActs.length) m.set(d, assignLanes(dayActs));
    }
    return m;
  }, [activities]);
  const days = useMemo(() => allDayTotals(activities, categories), [activities, categories]);
  const week = useMemo(() => weekTotals(activities, categories), [activities, categories]);
  const existingNames = useMemo(() => [...new Set(activities.map((a) => a.name))].sort(), [activities]);
  const existingSubjects = useMemo(
    () => [...new Set([...state.subjects, ...activities.map((a) => a.subject ?? "").filter(Boolean)])],
    [activities, state.subjects],
  );

  const say = (msg: string) => setAnnounce(msg);

  // ---------- commit pipeline (atomic, validated, undoable) ----------

  /** Direct commit after validation. Returns error message or null. */
  const commit = useCallback((next: Activity[], label: string): string | null => {
    for (const a of next) {
      const errs = validateActivity(a, categories);
      if (errs.length > 0) return errs[0].message;
    }
    undoRef.current.checkpoint(label, activities);
    setState((s) => ({ ...s, timetable: { ...s.timetable, activities: next } }));
    force((x) => x + 1);
    say(label);
    return null;
  }, [activities, categories]);

  /**
   * Commit that surfaces overlaps through the conflict prompt (§10.2)
   * instead of silently overwriting. `others` excludes the new/edited rows.
   */
  const commitWithConflictCheck = useCallback((
    next: Activity[],
    changed: Activity[],
    label: string,
  ): void => {
    const others = next.filter((a) => !changed.some((c) => c.id === a.id));
    const hit: Activity[] = [];
    for (const c of changed) hit.push(...conflictsForCandidate(c, others));
    if (hit.length === 0) {
      const err = commit(next, label);
      if (err) setToast({ message: err });
      else setToast({ message: label, undoLabel: "Undo", onUndo: doUndo });
    } else {
      setPending({ label, next, conflicts: describeConflicts(hit) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commit]);

  const doUndo = useCallback(() => {
    const e = undoRef.current.performUndo(activities);
    if (!e) {
      setToast({ message: "Nothing to undo." });
      return;
    }
    setState((s) => ({ ...s, timetable: { ...s.timetable, activities: e.activities } }));
    setPending(null);
    say(`Undid: ${e.label}`);
    force((x) => x + 1);
  }, [activities]);

  const doRedo = useCallback(() => {
    const e = undoRef.current.performRedo(activities);
    if (!e) {
      setToast({ message: "Nothing to redo." });
      return;
    }
    setState((s) => ({ ...s, timetable: { ...s.timetable, activities: e.activities } }));
    say(`Redid: ${e.label}`);
    force((x) => x + 1);
  }, [activities]);

  const updateSettings = (s: GlobalSettings) => {
    if (s.visibleEndMinutes <= s.visibleStartMinutes) {
      setToast({ message: "Visible end time must be after start time." });
      return;
    }
    if (s.switchPair[0] === s.switchPair[1]) {
      setToast({ message: "Quick-switch needs two different categories." });
      return;
    }
    setState((prev) => ({ ...prev, settings: s }));
  };

  // ---------- operations ----------

  const doQuickSwitch = (block: MergedBlock) => {
    const cur = block.members[0].categoryId;
    const [a, b] = settings.switchPair;
    const other = cur === a ? b : cur === b ? a : null;
    if (!other) return;
    const ids = new Set(block.members.map((m) => m.id));
    const next = activities.map((x) =>
      ids.has(x.id) ? { ...x, categoryId: other, updatedAt: nowIso() } : x,
    );
    const err = commit(next, `Switched ${block.members[0].name} to ${categories.find((c) => c.id === other)?.name ?? other}`);
    if (err) setToast({ message: err });
    else {
      lastCategory.current = other;
      setToast({ message: "Switched. ", undoLabel: "Undo", onUndo: doUndo });
    }
  };

  const setBlockCategory = (block: MergedBlock, categoryId: string) => {
    const ids = new Set(block.members.map((m) => m.id));
    const next = activities.map((x) =>
      ids.has(x.id) ? { ...x, categoryId, updatedAt: nowIso() } : x,
    );
    const changed = next.filter((x) => ids.has(x.id));
    setMenu(null);
    commitWithConflictCheck(next, changed, `Set category to ${categories.find((c) => c.id === categoryId)?.name ?? categoryId}`);
    lastCategory.current = categoryId;
  };

  const deleteBlock = (block: MergedBlock) => {
    const ids = new Set(block.members.map((m) => m.id));
    const next = activities.filter((x) => !ids.has(x.id));
    setMenu(null);
    const err = commit(next, `Deleted ${block.members[0].name}`);
    if (err) setToast({ message: err });
    else {
      if (selectedKey === block.key) setSelectedKey(null);
      setToast({ message: "Deleted. ", undoLabel: "Undo", onUndo: doUndo });
    }
  };

  const duplicateBlock = (block: MergedBlock) => {
    const dur = block.endTime - block.startTime;
    const start = block.endTime;
    const end = start + dur;
    if (end > 1440) {
      setToast({ message: "No room to duplicate directly after this block (day ends at midnight)." });
      return;
    }
    const t = nowIso();
    const clones: Activity[] = block.members.map((m) => {
      const off = m.startTime - block.startTime;
      return { ...m, id: uid("act"), startTime: start + off, endTime: start + off + (m.endTime - m.startTime), createdAt: t, updatedAt: t };
    });
    const next = [...activities, ...clones];
    setMenu(null);
    commitWithConflictCheck(next, clones, `Duplicated ${block.members[0].name}`);
  };

  const moveBlock = (blockKey: string, day: Weekday, start: number) => {
    const block = blockByKey.get(blockKey);
    if (!block) return;
    const offset = start - block.startTime;
    const dayMove = day - block.weekday;
    const t = nowIso();
    const moved = block.members.map((m) => ({
      ...m,
      weekday: ((m.weekday + dayMove + 7) % 7) as Weekday,
      startTime: m.startTime + offset,
      endTime: m.endTime + offset,
      updatedAt: t,
    }));
    // Day-boundary guard (§3.3): never store a cross-midnight activity.
    if (moved.some((m) => m.startTime < 0 || m.endTime > 1440)) {
      setToast({ message: "That move would cross midnight. Activities must stay within one day." });
      return;
    }
    const next = activities.map((x) => moved.find((m) => m.id === x.id) ?? x);
    commitWithConflictCheck(next, moved, `Moved ${block.members[0].name} to ${WEEKDAY_NAMES[day]} ${formatTime(start)}`);
  };

  const resizeBlock = (blockKey: string, edge: "top" | "bottom", time: number) => {
    const block = blockByKey.get(blockKey);
    if (!block) return;
    const member = edge === "top" ? block.members[0] : block.members[block.members.length - 1];
    const start = edge === "top" ? time : member.startTime;
    const end = edge === "bottom" ? time : member.endTime;
    if (end - start < SLOT) {
      setToast({ message: "Minimum activity duration is 15 minutes." });
      return;
    }
    if (start < 0 || end > 1440) {
      setToast({ message: "Resizing must stay within 00:00–24:00 of the same day." });
      return;
    }
    const updated: Activity = { ...member, startTime: start, endTime: end, updatedAt: nowIso() };
    const errs = validateActivity(updated, categories);
    if (errs.length > 0) {
      setToast({ message: errs[0].message });
      return;
    }
    const next = activities.map((x) => (x.id === member.id ? updated : x));
    commitWithConflictCheck(next, [updated], `Resized ${member.name}`);
  };

  /** Atomic swap: each takes the other's start position, keeps own duration (§9.6). */
  const swapBlocks = (aKey: string, bKey: string) => {
    const a = blockByKey.get(aKey);
    const b = blockByKey.get(bKey);
    if (!a || !b || aKey === bKey) return;
    const am = a.members[0];
    const bm = b.members[0];
    if (a.members.length > 1 || b.members.length > 1) {
      setToast({ message: "Swap works on single activities — split merged blocks first." });
      return;
    }
    const aDur = am.endTime - am.startTime;
    const bDur = bm.endTime - bm.startTime;
    const a2: Activity = { ...am, weekday: bm.weekday, startTime: bm.startTime, endTime: bm.startTime + aDur, updatedAt: nowIso() };
    const b2: Activity = { ...bm, weekday: am.weekday, startTime: am.startTime, endTime: am.startTime + bDur, updatedAt: nowIso() };
    if (a2.endTime > 1440 || b2.endTime > 1440) {
      setToast({ message: "Swap does not fit within the day boundary." });
      return;
    }
    for (const c of [a2, b2]) {
      const errs = validateActivity(c, categories);
      if (errs.length > 0) {
        setToast({ message: `Swap rejected: ${errs[0].message}` });
        return; // atomic: nothing changes (§9.6, §11.3)
      }
    }
    const next = activities.map((x) => (x.id === am.id ? a2 : x.id === bm.id ? b2 : x));
    const rest = next.filter((x) => x.id !== a2.id && x.id !== b2.id);
    const hit = [...conflictsForCandidate(a2, rest), ...conflictsForCandidate(b2, rest)];
    if (hit.length > 0) {
      setPending({ label: `Swapped ${am.name} and ${bm.name}`, next, conflicts: describeConflicts(hit) });
    } else {
      const err = commit(next, `Swapped ${am.name} and ${bm.name}`);
      setToast(err ? { message: err } : { message: "Swapped. ", undoLabel: "Undo", onUndo: doUndo });
    }
    setSwapFrom(null);
  };

  // ---------- editor ----------

  const openCreate = (day: Weekday, start: number, end: number) => {
    const names = existingNames;
    setEditor({
      activityId: null,
      name: "",
      categoryId: names.length > 0 ? lastCategory.current : defaultCategoryForName(""),
      subject: "",
      weekday: day,
      startTime: start,
      endTime: end,
      notes: "",
      optionalWorkOverride: "inherit",
      startEnabled: true,
      endEnabled: true,
      startLead: 5,
      endLead: 5,
      memberCount: 1,
    });
  };

  /** Autocomplete reuse lives inside the editor (§6.2): typing a known
   *  name restores its category/subject unless the user picked one. */

  const saveFromEditor = (activity: Activity): string | null => {
    const isNew = !activities.some((x) => x.id === activity.id);
    const errs = validateActivity(activity, categories);
    if (errs.length > 0) return errs[0].message;
    let next: Activity[];
    if (isNew) {
      const withMeta: Activity = { ...activity, id: uid("act"), createdAt: nowIso(), updatedAt: nowIso() };
      next = [...activities, withMeta];
      lastCategory.current = withMeta.categoryId;
      setEditor(null);
      commitWithConflictCheck(next, [withMeta], `Created ${withMeta.name}`);
      return null;
    }
    const prev = activities.find((x) => x.id === activity.id);
    const updated: Activity = { ...activity, createdAt: prev?.createdAt ?? activity.createdAt, updatedAt: nowIso() };
    next = activities.map((x) => (x.id === updated.id ? updated : x));
    lastCategory.current = updated.categoryId;
    // Merge-aware: renaming/splitting notice is automatic via re-render (§8.5).
    setEditor(null);
    commitWithConflictCheck(next, [updated], `Edited ${updated.name}`);
    return null;
  };

  // ---------- sample / clear ----------

  const createSample = () => {
    const err = commit(sampleActivities(), "Created sample timetable");
    if (err) setToast({ message: err });
    else setToast({ message: "Sample timetable created. ", undoLabel: "Undo", onUndo: doUndo });
  };

  const clearAll = () => {
    const err = commit([], "Removed all activities");
    if (err) setToast({ message: err });
    else setToast({ message: "Removed all activities. ", undoLabel: "Undo", onUndo: doUndo });
    setSettingsOpen(false);
  };

  // ---------- menu actions ----------

  const menuBlock = menu ? blockByKey.get(menu.block.key) ?? menu.block : null;

  const openEditFor = (block: MergedBlock) => {
    setMenu(null);
    setEditor({ ...draftFromActivity(block.members[0], block.members.length) });
  };

  const splitBlock = (block: MergedBlock) => {
    // Records are never merged (§8.1); "split" scopes editing to the tail
    // portion so it can diverge independently.
    setMenu(null);
    const tail = block.members[block.members.length - 1];
    setEditor(draftFromActivity(tail, 1));
    say(`Split: editing ${tail.name} ${formatTime(tail.startTime)}–${formatTime(tail.endTime)} independently`);
  };

  // ---------- render ----------

  const empty = activities.length === 0;

  return (
    <div className="app">
      <aside className="sidebar" aria-label="Planner navigation">
        <div className="brand">TimeFlow<small>weekly timetable</small></div>
        <div className="timetable-name">{timetable.name}</div>
        <div className="nav-group" role="group" aria-label="Views">
          <button type="button" className="nav-btn" aria-pressed={view === "week"} onClick={() => setView("week")}>🗓 Week view</button>
          <button type="button" className="nav-btn" aria-pressed={view === "day"} onClick={() => setView("day")}>📄 Day view</button>
          <button type="button" className="nav-btn" onClick={() => { setVisibleDay(today); }}>● Today ({WEEKDAY_SHORT[today]})</button>
        </div>
        <div className="totals-card" aria-label="Weekly totals">
          <h3>This week</h3>
          <div className="totals-row"><span>📚 Study</span><strong>{formatDuration(week.study)}</strong></div>
          <div className="totals-row"><span>💼 Optional work</span><strong>{formatDuration(week.optionalWork)}</strong></div>
        </div>
        <div className="nav-group">
          <button type="button" className="nav-btn" onClick={() => setSettingsOpen(true)}>⚙ Settings</button>
          <button type="button" className="nav-btn" onClick={doUndo} disabled={!undoRef.current.canUndo}>
            ↩ Undo{undoRef.current.undoLabel ? `: ${undoRef.current.undoLabel}` : ""}
          </button>
          <button type="button" className="nav-btn" onClick={doRedo} disabled={!undoRef.current.canRedo}>↪ Redo</button>
        </div>
        <div className={`save-status${saveStatus.kind === "error" ? " error" : ""}`} role="status">{saveStatus.text}</div>
        {conflicts.length > 0 && (
          <div className="totals-card" role="alert">
            <h3>⚠ {conflicts.length} overlap{conflicts.length > 1 ? "s" : ""}</h3>
            <button type="button" className="btn" onClick={() => setShowConflicts((v) => !v)} aria-expanded={showConflicts}>
              {showConflicts ? "Hide details" : "Show details"}
            </button>
            {showConflicts && (
              <ul>
                {conflicts.slice(0, 8).map((c, i) => (
                  <li key={i}>{c.aName} ↔ {c.bName} ({WEEKDAY_SHORT[c.weekday]} {formatTime(c.overlapStart)}–{formatTime(c.overlapEnd)})</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </aside>

      <div className="main">
        <div className="toolbar" role="toolbar" aria-label="Planner toolbar">
          <h1>{timetable.name}</h1>
          <div className="segmented" role="group" aria-label="Week or day view">
            <button type="button" aria-pressed={view === "week"} onClick={() => setView("week")}>Week</button>
            <button type="button" aria-pressed={view === "day"} onClick={() => setView("day")}>Day</button>
          </div>
          <button type="button" className="btn" onClick={() => setVisibleDay(today)}>Today</button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              const anchor = visibleDay;
              const start = 16 * 60;
              openCreate(anchor, start, start + 60);
            }}
          >
            ＋ New activity
          </button>
          <span className="derived" aria-live="polite">
            📚 {formatDuration(view === "day" ? days[visibleDay].study : week.study)}
            {" · "}💼 {formatDuration(view === "day" ? days[visibleDay].optionalWork : week.optionalWork)}
          </span>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn" onClick={doUndo} disabled={!undoRef.current.canUndo} title="Undo (Ctrl+Z)">↩</button>
          <button type="button" className="btn" onClick={doRedo} disabled={!undoRef.current.canRedo} title="Redo">↪</button>
          <button type="button" className="btn" onClick={() => setSettingsOpen(true)}>⚙</button>
        </div>

        {swapFrom && (
          <div className="notice" role="alert" style={{ margin: "8px 14px 0" }}>
            Swap mode: click the activity to swap with “{blockByKey.get(swapFrom)?.members[0].name ?? "…"}”.
            <button type="button" className="btn" style={{ marginLeft: 8 }} onClick={() => setSwapFrom(null)}>Cancel swap (Esc)</button>
          </div>
        )}

        {!hintUsed && !empty && (
          <div className="notice" style={{ margin: "8px 14px 0" }} role="note">
            Tip: click a <strong>Study ↔ Personal</strong> block to switch it instantly.
            Right-click (or long-press / Shift+F10) any block for all categories.
          </div>
        )}

        <div className="day-tabs" role="tablist" aria-label="Days">
          {WEEKDAY_SHORT.map((n, i) => (
            <button
              key={n}
              type="button"
              role="tab"
              aria-selected={visibleDay === i}
              onClick={() => { setVisibleDay(i as Weekday); setView("day"); }}
            >
              {n}
            </button>
          ))}
        </div>

        {empty ? (
          <EmptyState onCreateSample={createSample} />
        ) : (
          <div
            className="grid-wrap"
            onTouchStart={(e) => { touchX.current = e.touches[0].clientX; }}
            onTouchEnd={(e) => {
              if (touchX.current === null || view !== "day") return;
              const dx = e.changedTouches[0].clientX - touchX.current;
              touchX.current = null;
              if (Math.abs(dx) < 60) return;
              setVisibleDay(((visibleDay + (dx < 0 ? 1 : 6)) % 7) as Weekday);
            }}
          >
            <PlannerGrid
              blocks={blocks}
              categories={categories}
              settings={settings}
              clockFormat={settings.clockFormat}
              view={view}
              visibleDay={visibleDay}
              today={today}
              nowMinutes={nowMin}
              selectedBlockKey={selectedKey}
              conflictIds={conflictIds}
              lanesByDay={lanesByDay}
              dayMinutes={days}
              swapArmed={swapFrom !== null}
              hintShown={hintUsed}
              onQuickSwitch={doQuickSwitch}
              onSelectBlock={(k) => {
                setSelectedKey(k);
                if (k && !hintUsed) {
                  setHintUsed(true);
                  setToast({ message: "That category isn't in the quick-switch pair — right-click for all categories, or press Enter to edit." });
                }
              }}
              onOpenMenu={(m) => { setMenu(m); setSelectedKey(m.block.key); }}
              onCreate={openCreate}
              onCommitMove={moveBlock}
              onCommitResize={resizeBlock}
              onEditBlock={openEditFor}
              onDeleteBlock={deleteBlock}
              onSwapTarget={(b) => { if (swapFrom) swapBlocks(swapFrom, b.key); }}
              onChangeDay={(d) => { setVisibleDay(d); if (view === "week") setView("day"); }}
              onHintUsed={() => setHintUsed(true)}
            />
          </div>
        )}

        <nav className="bottom-tabs" aria-label="Primary">
          <button type="button" aria-pressed={view === "week"} onClick={() => setView("week")}>Week</button>
          <button type="button" aria-pressed={view === "day"} onClick={() => setView("day")}>Day</button>
          <button type="button" onClick={() => setVisibleDay(today)}>Today</button>
          <button type="button" onClick={() => setSettingsOpen(true)}>Settings</button>
        </nav>
      </div>

      {menu && menuBlock && (
        <CategoryMenu
          menu={{ ...menu, block: menuBlock }}
          categories={categories}
          onSelectCategory={(id) => setBlockCategory(menuBlock, id)}
          onEdit={() => openEditFor(menuBlock)}
          onSplit={menuBlock.members.length > 1 ? () => splitBlock(menuBlock) : null}
          onDuplicate={() => duplicateBlock(menuBlock)}
          onDelete={() => deleteBlock(menuBlock)}
          onSwap={() => { setSwapFrom(menuBlock.key); setMenu(null); say("Swap mode: choose the second activity"); }}
          onClose={() => setMenu(null)}
        />
      )}

      {editor && (
        <ActivityEditor
          initial={editor}
          activities={activities}
          categories={categories.length ? categories : DEFAULT_CATEGORIES}
          clockFormat={settings.clockFormat}
          existingNames={existingNames}
          existingSubjects={existingSubjects}
          onSave={saveFromEditor}
          onCancel={() => setEditor(null)}
          onDelete={editor.activityId ? () => {
            const id = editor.activityId!;
            const found = activities.find((a) => a.id === id);
            setEditor(null);
            if (found) {
              const err = commit(activities.filter((a) => a.id !== id), `Deleted ${found.name}`);
              setToast(err ? { message: err } : { message: "Deleted. ", undoLabel: "Undo", onUndo: doUndo });
            }
          } : undefined}
          onDuplicate={editor.activityId ? () => {
            const src = activities.find((a) => a.id === editor.activityId);
            if (!src) return;
            const t = nowIso();
            const clone: Activity = { ...src, id: uid("act"), startTime: Math.min(src.startTime + (src.endTime - src.startTime), 1440 - 15), endTime: Math.min(src.endTime + (src.endTime - src.startTime), 1440), createdAt: t, updatedAt: t };
            if (clone.endTime - clone.startTime < 15) {
              setToast({ message: "No room to duplicate this activity." });
              return;
            }
            const next = [...activities, clone];
            setEditor(null);
            commitWithConflictCheck(next, [clone], `Duplicated ${src.name}`);
          } : undefined}
        />
      )}

      {pending && (
        <div className="modal-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) setPending(null); }}>
          <div className="modal" role="alertdialog" aria-modal="true" aria-label="Scheduling conflict" aria-describedby="conflict-desc">
            <h2>These activities overlap</h2>
            <p id="conflict-desc">{pending.conflicts}</p>
            <p className="derived">TimeFlow keeps overlaps visible and counts shared time once. Choose how to proceed — nothing has changed yet.</p>
            <div className="modal-actions">
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  const err = commit(pending.next, pending.label);
                  setPending(null);
                  setToast(err ? { message: err } : { message: `${pending.label} (kept overlap visible).`, undoLabel: "Undo", onUndo: doUndo });
                }}
              >
                Move anyway
              </button>
              <button type="button" className="btn" autoFocus onClick={() => { setPending(null); say("Change cancelled, schedule unchanged"); }}>
                Cancel (keep previous schedule)
              </button>
            </div>
          </div>
        </div>
      )}

      {settingsOpen && (
        <SettingsPanel
          settings={settings}
          categories={categories}
          onChange={updateSettings}
          onClose={() => setSettingsOpen(false)}
          onClearAll={clearAll}
        />
      )}

      <Toast toast={toast} onDismiss={() => setToast(null)} />
      <div aria-live="polite" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
        {announce}
      </div>
    </div>
  );
}
