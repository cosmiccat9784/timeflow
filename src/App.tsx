import { useEffect, useMemo, useRef, useState } from "react";
import type { Activity, Category, GlobalSettings, PersistedState, RestorePoint, Timetable, Weekday, WeekRecord } from "./types";
import { WEEKDAY_NAMES, WEEKDAY_SHORT, displayName, nowIso, uid } from "./types";
import { DEFAULT_CATEGORIES } from "./categories";
import { SLOT, formatDuration, formatTime } from "./time";
import { validateActivity, validateCategories } from "./validation";
import { UndoStack, type Snapshot } from "./undo";
import { computeMergedBlocks, type MergedBlock } from "./merge";
import { assignLanes, conflictsForCandidate, findConflicts } from "./conflicts";
import { allDayTotals, weekTotals } from "./totals";
import { defaultTimetable, defaultSettings, loadState, saveState, weekdayToday, minutesNow } from "./store";
import { sampleActivities } from "./sample";
import {
  currentWeekId, recordKey, freshWeekRecord, withCompletion, withMinutes,
  withDelivered, timerElapsedSec, formatElapsed,
} from "./records";
import { computeDueReminders } from "./reminders";
import { pickFile, saveFile, encodeText } from "./native";
import { activitiesToCsv } from "./exportCsv";
import { createBackup, parseBackup } from "./backup";
import { PlannerGrid, type EmptySlotRequest, type MenuRequest } from "./components/PlannerGrid";
import { CategoryMenu, EmptyMenu } from "./components/CategoryMenu";
import { ActivityEditor, draftFromActivity, type EditorDraft } from "./components/ActivityEditor";
import { SettingsPanel } from "./components/SettingsPanel";
import { EmptyState } from "./components/EmptyState";
import { Toast, type ToastData } from "./components/Toast";
import { ImportWizard, type ImportResult } from "./components/ImportWizard";
import { CategoryManager } from "./components/CategoryManager";
import { TodayView } from "./components/TodayView";
import { ProgressView } from "./components/ProgressView";
import { RecapModal, recapToCsv, type RecapData } from "./components/RecapModal";

interface PendingOp {
  label: string;
  next: Snapshot;
  conflicts: string;
}

function describeConflicts(names: Activity[], categories: Category[]): string {
  const uniq = [...new Set(names.map((a) => `“${displayName(a, categories)}” (${WEEKDAY_SHORT[a.weekday]} ${formatTime(a.startTime)}–${formatTime(a.endTime)})`))];
  return uniq.slice(0, 4).join("; ") + (uniq.length > 4 ? ` (+${uniq.length - 4} more)` : "");
}

function cloneSnapshot(s: Snapshot): Snapshot {
  return JSON.parse(JSON.stringify(s)) as Snapshot;
}

export default function App() {
  const [initial] = useState(() => loadState());
  const [state, setState] = useState<PersistedState>(initial.state);
  const { timetables, activeTimetableId, categories, settings } = state;
  const active = timetables.find((t) => t.id === activeTimetableId) ?? timetables[0];
  const activities = active.activities;

  const [screen, setScreen] = useState<"planner" | "today" | "progress">("planner");
  const [plannerView, setPlannerView] = useState<"week" | "day">(() =>
    typeof window !== "undefined" && window.innerWidth < 1024 ? "day" : "week",
  );
  const [visibleDay, setVisibleDay] = useState<Weekday>(() => weekdayToday());
  const [today, setToday] = useState<Weekday>(() => weekdayToday());
  const [nowMin, setNowMin] = useState(() => minutesNow());
  const [epochMs, setEpochMs] = useState(() => Date.now());
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuRequest | null>(null);
  const [emptyMenu, setEmptyMenu] = useState<EmptySlotRequest | null>(null);
  const [editor, setEditor] = useState<EditorDraft | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [catOpen, setCatOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [toast, setToast] = useState<ToastData | null>(null);
  const [announce, setAnnounce] = useState("");
  const [pending, setPending] = useState<PendingOp | null>(null);
  const [swapFrom, setSwapFrom] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<{ kind: "saved" | "saving" | "error"; text: string }>({ kind: "saved", text: "Saved" });
  const [showConflicts, setShowConflicts] = useState(false);
  const [recap, setRecap] = useState<RecapData | null>(null);

  const undoRef = useRef(new UndoStack());
  const [, force] = useState(0);
  const lastCategory = useRef<string>(settings.switchPair[0] ?? "study");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchX = useRef<number | null>(null);
  const deliveredSession = useRef(new Set<string>());
  const lastWeekRef = useRef(currentWeekId());
  const stateRef = useRef(state);
  stateRef.current = state;

  const curWeek = currentWeekId();
  const wkKey = recordKey(active.id, curWeek);
  const weekRecord: WeekRecord = state.weekRecords[wkKey] ?? freshWeekRecord(active.id, curWeek);

  // Current-time + rollover + reminder tick (30s).
  useEffect(() => {
    const tick = () => {
      setNowMin(minutesNow());
      setToday(weekdayToday());
      setEpochMs(Date.now());
      checkRollover();
      fireReminders();
    };
    const t = setInterval(tick, 30000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 1s tick while a timer runs (elapsed display + timestamp persistence).
  useEffect(() => {
    if (!state.activeTimer?.running) return;
    const t = setInterval(() => setEpochMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [state.activeTimer?.running]);

  // Persist a fresh week record the first time it is needed.
  useEffect(() => {
    if (!stateRef.current.weekRecords[wkKey]) {
      setState((s) => ({
        ...s,
        weekRecords: { ...s.weekRecords, [wkKey]: freshWeekRecord(active.id, curWeek) },
      }));
    }
    if (lastWeekRef.current !== curWeek) {
      lastWeekRef.current = curWeek;
      deliveredSession.current.clear();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wkKey]);

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

  // Global shortcuts: undo/redo (§9.1) + Escape cancels swap mode.
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
  }, [activities, timetables, categories]);

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
  const completedIds = useMemo(
    () => new Set(Object.entries(weekRecord.completed).filter(([, c]) => c.done).map(([id]) => id)),
    [weekRecord],
  );

  const say = (msg: string) => setAnnounce(msg);
  const nameOf = (a: Activity) => displayName(a, categories);

  // Routine success toasts respect the Settings toggle; errors always show.
  const showToastsRef = useRef(settings.showToasts);
  showToastsRef.current = settings.showToasts;
  const notify = (t: ToastData) => {
    if (showToastsRef.current) setToast(t);
  };

  const snap = (): Snapshot => ({
    timetables: stateRef.current.timetables,
    categories: stateRef.current.categories,
  });

  const withActive = (nextActivities: Activity[], base: Timetable[] = stateRef.current.timetables): Timetable[] =>
    base.map((t) => (t.id === active.id ? { ...t, activities: nextActivities } : t));

  // ---------- commit pipeline (atomic, validated, undoable) ----------

  /** Direct commit after validation. Returns error message or null. */
  const commit = (next: Snapshot, label: string): string | null => {
    for (const t of next.timetables) {
      for (const a of t.activities) {
        const errs = validateActivity(a, next.categories);
        if (errs.length > 0) return errs[0].message;
      }
    }
    if (validateCategories(next.categories).length > 0) return "Categories are invalid.";
    undoRef.current.checkpoint(label, snap());
    setState((s) => ({ ...s, timetables: next.timetables, categories: next.categories }));
    force((x) => x + 1);
    say(label);
    return null;
  };

  const commitActive = (nextActivities: Activity[], label: string, nextCategories: Category[] = categories): string | null =>
    commit({ timetables: withActive(nextActivities), categories: nextCategories }, label);

  /**
   * Commit that surfaces overlaps through the conflict prompt (§10.2)
   * instead of silently overwriting.
   */
  const commitWithConflictCheck = (
    next: Snapshot,
    changed: Activity[],
    label: string,
  ): void => {
    const activeNext = next.timetables.find((t) => t.id === active.id)?.activities ?? [];
    const others = activeNext.filter((a) => !changed.some((c) => c.id === a.id));
    const hit: Activity[] = [];
    for (const c of changed) hit.push(...conflictsForCandidate(c, others));
    if (hit.length === 0) {
      const err = commit(next, label);
      if (err) setToast({ message: err });
      else notify({ message: label, undoLabel: "Undo", onUndo: doUndo });
    } else {
      setPending({ label, next, conflicts: describeConflicts(hit, next.categories) });
    }
  };

  const doUndo = () => {
    const e = undoRef.current.performUndo(snap());
    if (!e) {
      setToast({ message: "Nothing to undo." });
      return;
    }
    setState((s) => ({ ...s, timetables: e.snapshot.timetables, categories: e.snapshot.categories }));
    setPending(null);
    say(`Undid: ${e.label}`);
    force((x) => x + 1);
  };

  const doRedo = () => {
    const e = undoRef.current.performRedo(snap());
    if (!e) {
      setToast({ message: "Nothing to redo." });
      return;
    }
    setState((s) => ({ ...s, timetables: e.snapshot.timetables, categories: e.snapshot.categories }));
    say(`Redid: ${e.label}`);
    force((x) => x + 1);
  };

  const patchSettings = (p: Partial<GlobalSettings>) =>
    setState((s) => ({ ...s, settings: { ...s.settings, ...p } }));

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

  const pushRestorePoint = (label: string) => {
    const rp: RestorePoint = {
      id: uid("rp"),
      label,
      at: nowIso(),
      ...cloneSnapshot(snap()),
    };
    setState((s) => ({ ...s, restorePoints: [rp, ...s.restorePoints].slice(0, 5) }));
  };

  // ---------- activity operations (active timetable) ----------

  const doQuickSwitch = (block: MergedBlock) => {
    const cur = block.members[0].categoryId;
    const [a, b] = settings.switchPair;
    const other = cur === a ? b : cur === b ? a : null;
    if (!other) return;
    const ids = new Set(block.members.map((m) => m.id));
    const next = activities.map((x) =>
      ids.has(x.id) ? { ...x, categoryId: other, updatedAt: nowIso() } : x,
    );
    const err = commitActive(next, `Switched ${nameOf(block.members[0])} to ${categories.find((c) => c.id === other)?.name ?? other}`);
    if (err) setToast({ message: err });
    else {
      lastCategory.current = other;
      notify({ message: "Switched. ", undoLabel: "Undo", onUndo: doUndo });
    }
  };

  const setBlockCategory = (block: MergedBlock, categoryId: string) => {
    const ids = new Set(block.members.map((m) => m.id));
    const next = activities.map((x) =>
      ids.has(x.id) ? { ...x, categoryId, updatedAt: nowIso() } : x,
    );
    const changed = next.filter((x) => ids.has(x.id));
    setMenu(null);
    commitWithConflictCheck({ timetables: withActive(next), categories }, changed, `Set category to ${categories.find((c) => c.id === categoryId)?.name ?? categoryId}`);
    lastCategory.current = categoryId;
  };

  const deleteBlock = (block: MergedBlock) => {
    const ids = new Set(block.members.map((m) => m.id));
    const next = activities.filter((x) => !ids.has(x.id));
    setMenu(null);
    const err = commitActive(next, `Deleted ${nameOf(block.members[0])}`);
    if (err) setToast({ message: err });
    else {
      if (selectedKey === block.key) setSelectedKey(null);
      notify({ message: "Deleted. ", undoLabel: "Undo", onUndo: doUndo });
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
    commitWithConflictCheck({ timetables: withActive(next), categories }, clones, `Duplicated ${nameOf(block.members[0])}`);
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
    commitWithConflictCheck({ timetables: withActive(next), categories }, moved, `Moved ${nameOf(block.members[0])} to ${WEEKDAY_NAMES[day]} ${formatTime(start)}`);
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
    commitWithConflictCheck({ timetables: withActive(next), categories }, [updated], `Resized ${nameOf(member)}`);
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
      setPending({ label: `Swapped ${nameOf(am)} and ${nameOf(bm)}`, next: { timetables: withActive(next), categories }, conflicts: describeConflicts(hit, categories) });
    } else {
      const err = commitActive(next, `Swapped ${nameOf(am)} and ${nameOf(bm)}`);
      notify(err ? { message: err } : { message: "Swapped. ", undoLabel: "Undo", onUndo: doUndo });
    }
    setSwapFrom(null);
  };

  // ---------- timetables (V1 §18) ----------

  const switchTimetable = (id: string) => {
    setSelectedKey(null);
    setState((s) => ({ ...s, activeTimetableId: id }));
    say(`Switched to ${timetables.find((t) => t.id === id)?.name ?? "timetable"}`);
  };

  const addTimetable = () => {
    const name = window.prompt("Timetable name:", `Timetable ${timetables.length + 1}`);
    if (!name?.trim()) return;
    const tt = defaultTimetable(name.trim());
    const err = commit({ timetables: [...timetables, tt], categories }, `Created timetable ${tt.name}`);
    if (err) setToast({ message: err });
    else {
      setState((s) => ({ ...s, activeTimetableId: tt.id }));
      notify({ message: `Created “${tt.name}”.`, undoLabel: "Undo", onUndo: doUndo });
    }
  };

  const renameTimetable = () => {
    const name = window.prompt("Rename timetable:", active.name);
    if (!name?.trim() || name.trim() === active.name) return;
    const err = commit(
      { timetables: timetables.map((t) => (t.id === active.id ? { ...t, name: name.trim() } : t)), categories },
      `Renamed timetable to ${name.trim()}`,
    );
    if (err) setToast({ message: err });
  };

  const deleteTimetable = () => {
    if (timetables.length <= 1) {
      setToast({ message: "Keep at least one timetable." });
      return;
    }
    if (!window.confirm(`Delete timetable “${active.name}” with its ${activities.length} activities? Categories are shared and stay.`)) return;
    const rest = timetables.filter((t) => t.id !== active.id);
    const err = commit({ timetables: rest, categories }, `Deleted timetable ${active.name}`);
    if (err) setToast({ message: err });
    else {
      setState((s) => ({ ...s, activeTimetableId: rest[0].id }));
      notify({ message: "Timetable deleted. ", undoLabel: "Undo", onUndo: doUndo });
    }
  };

  // ---------- categories (V1 §7.6) ----------

  const saveCategories = (next: Category[], remap: Record<string, string>): string | null => {
    const mapped = timetables.map((t) => ({
      ...t,
      activities: t.activities.map((a) =>
        remap[a.categoryId] ? { ...a, categoryId: remap[a.categoryId], updatedAt: nowIso() } : a,
      ),
    }));
    const err = commit({ timetables: mapped, categories: next }, "Updated categories");
    if (err) return err;
    setCatOpen(false);
    notify({ message: "Categories saved.", undoLabel: "Undo", onUndo: doUndo });
    return null;
  };

  // ---------- import / export / backup (V1 §§16–17) ----------

  const handleImportResult = (r: ImportResult) => {
    setImportOpen(false);
    pushRestorePoint(`Before import ${r.fileName}`);
    if (r.mode === "new") {
      const tt = { id: uid("tt"), name: r.newName, activities: r.activities };
      const err = commit({ timetables: [...timetables, tt], categories }, `Imported ${r.imported} into “${tt.name}”`);
      if (err) {
        setToast({ message: err });
        return;
      }
      setState((s) => ({ ...s, activeTimetableId: tt.id }));
    } else if (r.mode === "replace") {
      const err = commitActive(r.activities, `Imported ${r.imported} (replaced ${active.name})`);
      if (err) {
        setToast({ message: err });
        return;
      }
    } else {
      const next = [...activities, ...r.activities];
      const hit = r.activities.flatMap((c) => conflictsForCandidate(c, activities));
      if (hit.length > 0) {
        setPending({
          label: `Imported ${r.imported} (merged into ${active.name})`,
          next: { timetables: withActive(next), categories },
          conflicts: describeConflicts(hit, categories),
        });
      } else {
        const err = commitActive(next, `Imported ${r.imported} (merged into ${active.name})`);
        if (err) {
          setToast({ message: err });
          return;
        }
      }
    }
    notify({
      message: `Imported ${r.imported}${r.skipped > 0 ? `, ${r.skipped} row(s) skipped` : ""}.`,
      undoLabel: "Undo",
      onUndo: doUndo,
    });
  };

  const doExportXlsx = async () => {
    try {
      const { timetableToXlsx } = await import("./exportExcel");
      const bytes = await timetableToXlsx(active, categories);
      const r = await saveFile(
        `${active.name}.xlsx`,
        bytes,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      if (!r.ok) setToast({ message: r.error ?? "Export failed." });
      else notify({ message: "Excel exported." });
    } catch (e) {
      setToast({ message: e instanceof Error ? e.message : "Export failed." });
    }
  };

  const doExportCsv = async () => {
    const r = await saveFile(`${active.name}.csv`, encodeText(activitiesToCsv(activities, categories)), "text/csv");
    if (!r.ok) setToast({ message: r.error ?? "Export failed." });
    else notify({ message: "CSV exported." });
  };

  const doBackup = async () => {
    const r = await saveFile(
      `timeflow-backup-${new Date().toISOString().slice(0, 10)}.json`,
      encodeText(createBackup(stateRef.current)),
      "application/json",
    );
    if (!r.ok) setToast({ message: r.error ?? "Backup failed." });
    else notify({ message: "Backup saved." });
  };

  const doRestore = async () => {
    const f = await pickFile(["json"], "TimeFlow backup");
    if (!f) return;
    const parsed = parseBackup(new TextDecoder().decode(f.data));
    if (!parsed.ok) {
      setToast({ message: parsed.error });
      return;
    }
    if (!window.confirm(`Restore backup from ${parsed.data.exportedAt}? A restore point of the current data is saved first.`)) return;
    pushRestorePoint("Before JSON restore");
    const d = parsed.data;
    setState((s) => ({
      ...s,
      timetables: d.timetables,
      categories: d.categories,
      settings: { ...defaultSettings(), ...d.settings },
      subjects: d.subjects,
      weekRecords: d.weekRecords,
      activeTimer: null,
      activeTimetableId: d.timetables.some((t) => t.id === s.activeTimetableId)
        ? s.activeTimetableId
        : d.timetables[0].id,
    }));
    say("Backup restored");
    notify({ message: "Backup restored.", undoLabel: "Undo", onUndo: doUndo });
  };

  const restoreRestorePoint = (id: string) => {
    const rp = state.restorePoints.find((r) => r.id === id);
    if (!rp) return;
    if (!window.confirm(`Restore "${rp.label}" from ${new Date(rp.at).toLocaleString("en-AU")}? Current state stays in undo history.`)) return;
    const err = commit({ timetables: rp.timetables, categories: rp.categories }, `Restored ${rp.label}`);
    if (err) setToast({ message: err });
    else {
      setSettingsOpen(false);
      notify({ message: "Restore point applied. ", undoLabel: "Undo", onUndo: doUndo });
    }
  };

  // ---------- completion + timer (V2 §20) ----------

  const patchRecord = (rec: WeekRecord) =>
    setState((s) => ({
      ...s,
      weekRecords: { ...s.weekRecords, [recordKey(rec.timetableId, rec.weekId)]: rec },
    }));

  const toggleComplete = (activityId: string) => {
    const rec = stateRef.current.weekRecords[wkKey] ?? freshWeekRecord(active.id, curWeek);
    patchRecord(withCompletion(rec, activityId, !(rec.completed[activityId]?.done ?? false)));
  };

  const toggleBlockComplete = (block: MergedBlock) => {
    const rec = stateRef.current.weekRecords[wkKey] ?? freshWeekRecord(active.id, curWeek);
    const allDone = block.members.every((m) => rec.completed[m.id]?.done);
    let next = rec;
    for (const m of block.members) next = withCompletion(next, m.id, !allDone);
    patchRecord(next);
    setMenu(null);
  };

  const startTimer = (activityId: string) => {
    const s = stateRef.current;
    if (s.activeTimer?.running) {
      setToast({ message: "A timer is already running — finish or skip it first." });
      return;
    }
    const a = activities.find((x) => x.id === activityId);
    if (!a) return;
    const prev = s.activeTimer;
    setState((prev2) => ({
      ...prev2,
      activeTimer: {
        timetableId: active.id,
        activityId,
        startedAtEpochMs: Date.now(),
        accumulatedSec: prev && prev.activityId === activityId ? prev.accumulatedSec : 0,
        running: true,
        targetSec: Math.max(900, (a.endTime - a.startTime) * 60),
      },
    }));
    setMenu(null);
    say(`Timer started for ${nameOf(a)}`);
  };

  const pauseTimer = () => {
    const t = stateRef.current.activeTimer;
    if (!t?.running) return;
    const elapsed = timerElapsedSec(t, Date.now());
    setState((s) => (s.activeTimer ? { ...s, activeTimer: { ...s.activeTimer, running: false, accumulatedSec: elapsed } } : s));
  };

  const resumeTimer = () => {
    if (!stateRef.current.activeTimer || stateRef.current.activeTimer.running) return;
    setState((s) => (s.activeTimer ? { ...s, activeTimer: { ...s.activeTimer, running: true, startedAtEpochMs: Date.now() } } : s));
  };

  const finishTimer = () => {
    const t = stateRef.current.activeTimer;
    if (!t) return;
    const mins = Math.round(timerElapsedSec(t, Date.now()) / 60);
    const rec = stateRef.current.weekRecords[recordKey(t.timetableId, curWeek)] ?? freshWeekRecord(t.timetableId, curWeek);
    patchRecord(withMinutes(rec, t.activityId, mins));
    setState((s) => ({ ...s, activeTimer: null }));
    notify({ message: `Recorded ${formatDuration(mins)}.`, undoLabel: undefined, onUndo: undefined });
  };

  const extendTimer = () => {
    setState((s) => (s.activeTimer ? { ...s, activeTimer: { ...s.activeTimer, targetSec: s.activeTimer.targetSec + 900 } } : s));
  };

  const skipTimer = () => {
    setState((s) => ({ ...s, activeTimer: null }));
    say("Timer discarded");
  };

  // ---------- reminders (V2 §21) ----------

  const tryNotify = async (title: string, body: string) => {
    try {
      const { isPermissionGranted, requestPermission, sendNotification } = await import("@tauri-apps/plugin-notification");
      let granted = await isPermissionGranted();
      if (!granted) granted = (await requestPermission()) === "granted";
      if (granted) await sendNotification({ title, body });
    } catch {
      // In-app banner below is the reliable fallback.
    }
  };

  const fireReminders = () => {
    const s = stateRef.current;
    const tt = s.timetables.find((t) => t.id === s.activeTimetableId) ?? s.timetables[0];
    if (!tt) return;
    const wk = s.weekRecords[recordKey(tt.id, currentWeekId())];
    const due = computeDueReminders(tt.activities, s.categories, s.settings, wk, weekdayToday(), new Date(), deliveredSession.current);
    if (due.length === 0) return;
    for (const d of due) {
      deliveredSession.current.add(d.key);
      const rec = stateRef.current.weekRecords[recordKey(tt.id, currentWeekId())] ?? freshWeekRecord(tt.id, currentWeekId());
      patchRecord(withDelivered(rec, d.key));
      setToast({ message: `${d.title} — ${d.body}` });
      void tryNotify(d.title, d.body);
    }
  };

  const testNotification = () => {
    setToast({ message: "Test notification sent — check your system notifications and the banner here." });
    void tryNotify("TimeFlow", "Notifications are working on this device.");
  };

  // ---------- weekly rollover (V2 §22) ----------

  const checkRollover = () => {
    const s = stateRef.current;
    const cur = currentWeekId();
    if (!s.settings.lastRolloverWeekId) {
      patchSettings({ lastRolloverWeekId: cur });
      return;
    }
    if (s.settings.lastRolloverWeekId === cur) return;
    const prevId = s.settings.lastRolloverWeekId;
    const prevRecs = Object.values(s.weekRecords).filter((r) => r.weekId === prevId);
    const hasData = prevRecs.some((r) => Object.keys(r.completed).length > 0);
    let recapData: RecapData | null = null;
    if (hasData) {
      const rows: RecapData["rows"] = [];
      let planned = 0;
      let recorded = 0;
      let doneCount = 0;
      let count = 0;
      for (const t of s.timetables) {
        const rec = prevRecs.find((r) => r.timetableId === t.id);
        for (const a of t.activities) {
          const c = rec?.completed[a.id];
          const mins = c?.minutes ?? 0;
          rows.push({
            name: displayName(a, s.categories),
            day: WEEKDAY_NAMES[a.weekday],
            plannedMin: a.endTime - a.startTime,
            done: !!c?.done,
            minutes: mins,
          });
          if (s.categories.find((x) => x.id === a.categoryId)?.countsTowardStudy) {
            planned += a.endTime - a.startTime;
            recorded += mins;
          }
          if (c?.done) doneCount++;
          count++;
        }
      }
      recapData = { weekId: prevId, rows, plannedStudyMin: planned, recordedStudyMin: recorded, completedCount: doneCount, activityCount: count };
    }
    setState((prev) => {
      const keep: Record<string, WeekRecord> = {};
      for (const [k, r] of Object.entries(prev.weekRecords)) {
        if (r.weekId === cur) keep[k] = r;
      }
      return {
        ...prev,
        weekRecords: keep,
        settings: { ...prev.settings, lastRolloverWeekId: cur },
        activeTimer: null,
      };
    });
    if (recapData) setRecap(recapData);
  };

  const downloadRecap = async () => {
    if (!recap) return;
    const r = await saveFile(`timeflow-recap-${recap.weekId}.csv`, encodeText(recapToCsv(recap)), "text/csv");
    if (!r.ok) setToast({ message: r.error ?? "Download failed." });
  };

  // ---------- editor ----------

  /** + New button default: next quarter-hour if looking at today,
   *  otherwise the after-school default. Right-click/drag creation
   *  already pre-fills from the exact slot tapped. */
  const smartCreate = () => {
    const day = visibleDay;
    let start = day === weekdayToday()
      ? Math.ceil(minutesNow() / 15) * 15
      : 16 * 60;
    if (start > 1440 - 15) start = 1440 - 15;
    openCreate(day, start, Math.min(start + 60, 1440));
  };

  const openCreate = (day: Weekday, start: number, end: number) => {
    setEditor({
      activityId: null,
      name: "",
      categoryId: lastCategory.current,
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

  const saveFromEditor = (activity: Activity): string | null => {
    const isNew = !activities.some((x) => x.id === activity.id);
    const errs = validateActivity(activity, categories);
    if (errs.length > 0) return errs[0].message;
    if (isNew) {
      const withMeta: Activity = { ...activity, id: uid("act"), createdAt: nowIso(), updatedAt: nowIso() };
      const next = [...activities, withMeta];
      lastCategory.current = withMeta.categoryId;
      setEditor(null);
      commitWithConflictCheck({ timetables: withActive(next), categories }, [withMeta], `Created ${nameOf(withMeta)}`);
      return null;
    }
    const prev = activities.find((x) => x.id === activity.id);
    const updated: Activity = { ...activity, createdAt: prev?.createdAt ?? activity.createdAt, updatedAt: nowIso() };
    const next = activities.map((x) => (x.id === updated.id ? updated : x));
    lastCategory.current = updated.categoryId;
    // Merge-aware: renaming/splitting notice is automatic via re-render (§8.5).
    setEditor(null);
    commitWithConflictCheck({ timetables: withActive(next), categories }, [updated], `Edited ${nameOf(updated)}`);
    return null;
  };

  // ---------- sample / clear ----------

  const createSample = () => {
    const err = commitActive(sampleActivities(), "Created sample timetable");
    if (err) setToast({ message: err });
    else notify({ message: "Sample timetable created. ", undoLabel: "Undo", onUndo: doUndo });
  };

  const clearAll = () => {
    const err = commitActive([], "Removed all activities");
    if (err) setToast({ message: err });
    else notify({ message: "Removed all activities. ", undoLabel: "Undo", onUndo: doUndo });
    setSettingsOpen(false);
  };

  // ---------- menu actions ----------

  const menuBlock = menu ? blockByKey.get(menu.block.key) ?? menu.block : null;

  const openEditFor = (block: MergedBlock) => {
    setMenu(null);
    setEditor({ ...draftFromActivity(block.members[0], block.members.length) });
  };

  const openEditActivity = (a: Activity) => {
    setEditor(draftFromActivity(a, 1));
  };

  const splitBlock = (block: MergedBlock) => {
    // Records are never merged (§8.1); "split" scopes editing to the tail
    // portion so it can diverge independently.
    setMenu(null);
    const tail = block.members[block.members.length - 1];
    setEditor(draftFromActivity(tail, 1));
    say(`Split: editing ${nameOf(tail)} ${formatTime(tail.startTime)}–${formatTime(tail.endTime)} independently`);
  };

  // ---------- render ----------

  const empty = activities.length === 0;
  const timer = state.activeTimer;

  return (
    <div className="app">
      <aside className="sidebar" aria-label="Planner navigation">
        <div className="brand">TimeFlow<small>weekly timetable</small></div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="tt-switch">Timetable</label>
          <select id="tt-switch" value={active.id} onChange={(e) => switchTimetable(e.target.value)}>
            {timetables.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.activities.length})</option>)}
          </select>
          <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
            <button type="button" className="btn small" onClick={addTimetable} title="New timetable">＋</button>
            <button type="button" className="btn small" onClick={renameTimetable} title="Rename timetable">✎</button>
            <button type="button" className="btn small" onClick={deleteTimetable} title="Delete timetable">🗑</button>
          </div>
        </div>
        <div className="nav-group" role="group" aria-label="Views">
          <button type="button" className="nav-btn" aria-pressed={screen === "planner"} onClick={() => setScreen("planner")}>🗓 Planner</button>
          <button type="button" className="nav-btn" aria-pressed={screen === "today"} onClick={() => setScreen("today")}>● Today</button>
          <button type="button" className="nav-btn" aria-pressed={screen === "progress"} onClick={() => setScreen("progress")}>📈 Progress</button>
        </div>
        <div className="totals-card" aria-label="Weekly totals">
          <h3>This week · {active.name}</h3>
          <div className="totals-row"><span>📚 Study</span><strong>{formatDuration(week.study)}</strong></div>
          <div className="totals-row"><span>💼 Optional work</span><strong>{formatDuration(week.optionalWork)}</strong></div>
        </div>
        <div className="nav-group" role="group" aria-label="Data">
          <button type="button" className="nav-btn" onClick={() => setImportOpen(true)}>⬆ Import…</button>
          <button type="button" className="nav-btn" onClick={doExportXlsx}>⬇ Excel</button>
          <button type="button" className="nav-btn" onClick={doExportCsv}>⬇ CSV</button>
          <button type="button" className="nav-btn" onClick={doBackup}>💾 Backup</button>
          <button type="button" className="nav-btn" onClick={doRestore}>↩ Restore…</button>
        </div>
        <div className="nav-group">
          <button type="button" className="nav-btn" onClick={() => setCatOpen(true)}>🏷 Categories</button>
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
                  <li key={i}>{c.aName || "(unnamed)"} ↔ {c.bName || "(unnamed)"} ({WEEKDAY_SHORT[c.weekday]} {formatTime(c.overlapStart)}–{formatTime(c.overlapEnd)})</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </aside>

      <div className="main">
        <div className="toolbar" role="toolbar" aria-label="Planner toolbar">
          <h1>{screen === "planner" ? active.name : screen === "today" ? "Today" : "Progress"}</h1>
          {screen === "planner" && (
            <>
              <div className="segmented" role="group" aria-label="Week or day view">
                <button type="button" aria-pressed={plannerView === "week"} onClick={() => setPlannerView("week")}>Week</button>
                <button type="button" aria-pressed={plannerView === "day"} onClick={() => setPlannerView("day")}>Day</button>
              </div>
              <button type="button" className="btn" onClick={() => setVisibleDay(today)}>Today</button>
              <button
                type="button"
                className="btn"
                onClick={smartCreate}
              >
                ＋ New activity
              </button>
              <span className="derived" aria-live="polite">
                📚 {formatDuration(plannerView === "day" ? days[visibleDay].study : week.study)}
                {" · "}💼 {formatDuration(plannerView === "day" ? days[visibleDay].optionalWork : week.optionalWork)}
              </span>
            </>
          )}
          <span style={{ flex: 1 }} />
          {timer && screen !== "today" && (
            <button type="button" className="btn" onClick={() => setScreen("today")} title="Open timer">
              ⏱ {formatElapsed(timerElapsedSec(timer, epochMs))} · Finish…
            </button>
          )}
          <button type="button" className="btn" onClick={doUndo} disabled={!undoRef.current.canUndo} title="Undo (Ctrl+Z)">↩</button>
          <button type="button" className="btn" onClick={doRedo} disabled={!undoRef.current.canRedo} title="Redo">↪</button>
          <button type="button" className="btn" onClick={() => setSettingsOpen(true)}>⚙</button>
        </div>

        {swapFrom && (
          <div className="notice" role="alert" style={{ margin: "8px 14px 0" }}>
            Swap mode: click the activity to swap with “{swapFrom && blockByKey.get(swapFrom) ? nameOf(blockByKey.get(swapFrom)!.members[0]) : "…"}”.
            <button type="button" className="btn" style={{ marginLeft: 8 }} onClick={() => setSwapFrom(null)}>Cancel swap (Esc)</button>
          </div>
        )}

        <div className="notice" style={{ margin: "8px 14px 0" }} role="note">
          Tip: click to select · double-click to switch Study ↔ Personal instantly ·
          right-click (or long-press / Shift+F10) any block for all categories.
        </div>

        {screen === "planner" && (
          <div className="day-tabs" role="tablist" aria-label="Days">
            {WEEKDAY_SHORT.map((n, i) => (
              <button
                key={n}
                type="button"
                role="tab"
                aria-selected={visibleDay === i}
                onClick={() => { setVisibleDay(i as Weekday); setPlannerView("day"); }}
              >
                {n}
              </button>
            ))}
          </div>
        )}

        {screen === "planner" && empty ? (
          <EmptyState onCreateSample={createSample} onImport={() => setImportOpen(true)} />
        ) : screen === "planner" ? (
          <div
            className="grid-wrap"
            onTouchStart={(e) => { touchX.current = e.touches[0].clientX; }}
            onTouchEnd={(e) => {
              if (touchX.current === null || plannerView !== "day") return;
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
              view={plannerView}
              visibleDay={visibleDay}
              today={today}
              nowMinutes={nowMin}
              selectedBlockKey={selectedKey}
              conflictIds={conflictIds}
              lanesByDay={lanesByDay}
              dayMinutes={days}
              swapArmed={swapFrom !== null}
              completedIds={completedIds}
              timerActivityId={timer && timer.timetableId === active.id ? timer.activityId : null}
              onQuickSwitch={doQuickSwitch}
              onSelectBlock={(k) => setSelectedKey(k)}
              onOpenMenu={(m) => { setMenu(m); setSelectedKey(m.block.key); }}
              onEmptyMenu={(m: EmptySlotRequest) => setEmptyMenu(m)}
              onCreate={openCreate}
              onCommitMove={moveBlock}
              onCommitResize={resizeBlock}
              onEditBlock={openEditFor}
              onDeleteBlock={deleteBlock}
              onSwapTarget={(b) => { if (swapFrom) swapBlocks(swapFrom, b.key); }}
              onChangeDay={(d) => { setVisibleDay(d); if (plannerView === "week") setPlannerView("day"); }}
            />
          </div>
        ) : screen === "today" ? (
          <div className="grid-wrap">
            <TodayView
              activities={activities}
              categories={categories}
              record={weekRecord}
              timer={timer && timer.timetableId === active.id ? timer : null}
              epochMs={epochMs}
              clockFormat={settings.clockFormat}
              today={today}
              nowMin={nowMin}
              onToggleComplete={toggleComplete}
              onTimerStart={startTimer}
              onTimerPause={pauseTimer}
              onTimerResume={resumeTimer}
              onTimerFinish={finishTimer}
              onTimerExtend={extendTimer}
              onTimerSkip={skipTimer}
              onEdit={openEditActivity}
              onOpenPlanner={(d) => { setVisibleDay(d); setPlannerView("day"); setScreen("planner"); }}
            />
          </div>
        ) : (
          <div className="grid-wrap">
            <ProgressView
              activities={activities}
              categories={categories}
              record={weekRecord}
              clockFormat={settings.clockFormat}
            />
          </div>
        )}

        <nav className="bottom-tabs" aria-label="Primary">
          <button type="button" aria-pressed={screen === "planner"} onClick={() => setScreen("planner")}>Planner</button>
          <button type="button" aria-pressed={screen === "today"} onClick={() => setScreen("today")}>Today</button>
          <button type="button" aria-pressed={screen === "progress"} onClick={() => setScreen("progress")}>Progress</button>
          <button type="button" onClick={() => setSettingsOpen(true)}>Settings</button>
        </nav>
      </div>

      {menu && menuBlock && (
        <CategoryMenu
          menu={{ ...menu, block: menuBlock }}
          categories={categories}
          completed={menuBlock.members.every((m) => weekRecord.completed[m.id]?.done)}
          onSelectCategory={(id) => setBlockCategory(menuBlock, id)}
          onEdit={() => openEditFor(menuBlock)}
          onSplit={menuBlock.members.length > 1 ? () => splitBlock(menuBlock) : null}
          onDuplicate={() => duplicateBlock(menuBlock)}
          onDelete={() => deleteBlock(menuBlock)}
          onSwap={() => { setSwapFrom(menuBlock.key); setMenu(null); say("Swap mode: choose the second activity"); }}
          onToggleComplete={() => toggleBlockComplete(menuBlock)}
          onStartTimer={() => startTimer(menuBlock.members[0].id)}
          onClose={() => setMenu(null)}
        />
      )}

      {emptyMenu && (
        <EmptyMenu
          x={emptyMenu.x}
          y={emptyMenu.y}
          day={emptyMenu.day}
          timeLabel={formatTime(emptyMenu.start, settings.clockFormat)}
          onNew={() => {
            const { day, start } = emptyMenu;
            setEmptyMenu(null);
            openCreate(day, start, Math.min(start + 60, 1440));
          }}
          onClose={() => setEmptyMenu(null)}
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
              const err = commitActive(activities.filter((a) => a.id !== id), `Deleted ${nameOf(found)}`);
              notify(err ? { message: err } : { message: "Deleted. ", undoLabel: "Undo", onUndo: doUndo });
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
            commitWithConflictCheck({ timetables: withActive(next), categories }, [clone], `Duplicated ${nameOf(src)}`);
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
                  notify(err ? { message: err } : { message: `${pending.label} (kept overlap visible).`, undoLabel: "Undo", onUndo: doUndo });
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

      {importOpen && (
        <ImportWizard
          categories={categories}
          clockFormat={settings.clockFormat}
          activeName={active.name}
          onClose={() => setImportOpen(false)}
          onImport={handleImportResult}
        />
      )}

      {catOpen && (
        <CategoryManager
          categories={categories}
          activities={timetables.flatMap((t) => t.activities)}
          onSave={saveCategories}
          onClose={() => setCatOpen(false)}
        />
      )}

      {settingsOpen && (
        <SettingsPanel
          settings={settings}
          categories={categories}
          restorePoints={state.restorePoints}
          onChange={updateSettings}
          onClose={() => setSettingsOpen(false)}
          onClearAll={clearAll}
          onRestorePoint={restoreRestorePoint}
          onTestNotification={testNotification}
        />
      )}

      {recap && (
        <RecapModal
          recap={recap}
          onDownload={downloadRecap}
          onClose={() => setRecap(null)}
        />
      )}

      <Toast toast={toast} onDismiss={() => setToast(null)} />
      <div aria-live="polite" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
        {announce}
      </div>
    </div>
  );
}
