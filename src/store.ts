import type { Activity, Category, GlobalSettings, PersistedState, Timetable, Weekday } from "./types";
import { SCHEMA_VERSION, STORAGE_KEY, nowIso, uid } from "./types";
import { DEFAULT_CATEGORIES, DEFAULT_SWITCH_PAIR, LEGACY_CATEGORY_NAMES } from "./categories";
import { validateActivity, validateCategories } from "./validation";

export const APP_VERSION = "0.2.0";

export function defaultSettings(): GlobalSettings {
  return {
    visibleStartMinutes: 360,
    visibleEndMinutes: 1320,
    clockFormat: "12h",
    switchPair: [...DEFAULT_SWITCH_PAIR] as [string, string],
    showToasts: true,
    quietHours: { start: 1320, end: 420 }, // 10pm–7am default
    reminderDefaults: { startLead: 5, endLead: 5, atEnd: true },
    lastRolloverWeekId: null,
    appVersion: APP_VERSION,
  };
}

export function defaultTimetable(name = "My Week"): Timetable {
  return { id: uid("tt"), name, activities: [] };
}

export function defaultState(): PersistedState {
  const tt = defaultTimetable();
  return {
    schemaVersion: SCHEMA_VERSION,
    timetables: [tt],
    activeTimetableId: tt.id,
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
    settings: defaultSettings(),
    subjects: ["Mathematics", "English", "Piano"],
    weekRecords: {},
    restorePoints: [],
    activeTimer: null,
    savedAt: nowIso(),
  };
}

function fillSettings(s: Partial<GlobalSettings> | undefined): GlobalSettings {
  const d = defaultSettings();
  const merged: GlobalSettings = { ...d, ...(s ?? {}) };
  if (!Array.isArray(merged.switchPair) || merged.switchPair.length !== 2)
    merged.switchPair = [...DEFAULT_SWITCH_PAIR] as [string, string];
  if (typeof merged.showToasts !== "boolean") merged.showToasts = true;
  if (!merged.quietHours || typeof merged.quietHours !== "object")
    merged.quietHours = { ...d.quietHours };
  if (!merged.reminderDefaults || typeof merged.reminderDefaults !== "object")
    merged.reminderDefaults = { ...d.reminderDefaults };
  return merged;
}

function adoptSimpleLabels(categories: Category[]): Category[] {
  return categories.map((c) => {
    if (LEGACY_CATEGORY_NAMES[c.id] === c.name) {
      const fresh = DEFAULT_CATEGORIES.find((x) => x.id === c.id);
      if (fresh) return { ...c, name: fresh.name };
    }
    return c;
  });
}

/** Migrate older schemas → current. Never destroys last valid data (§13.9). */
export function migrateState(raw: unknown): PersistedState | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  try {
    if (r.schemaVersion === SCHEMA_VERSION) {
      const s = r as unknown as PersistedState;
      if (!Array.isArray(s.timetables) || s.timetables.length === 0) return null;
      if (!Array.isArray(s.categories)) return null;
      if (validateCategories(s.categories).length > 3) {
        s.categories = DEFAULT_CATEGORIES.map((c) => ({ ...c }));
      } else {
        s.categories = adoptSimpleLabels(s.categories);
      }
      s.settings = fillSettings(s.settings);
      if (!Array.isArray(s.subjects)) s.subjects = [];
      if (typeof s.weekRecords !== "object" || s.weekRecords === null) s.weekRecords = {};
      if (!Array.isArray(s.restorePoints)) s.restorePoints = [];
      if (!s.timetables.some((t) => t.id === s.activeTimetableId))
        s.activeTimetableId = s.timetables[0].id;
      return sanitizeState(s);
    }
    // v1 → v2: wrap the single timetable, add records/restore/timer fields.
    if (r.schemaVersion === 1) {
      const v1 = r as unknown as {
        timetable?: Timetable; categories?: Category[]; settings?: Partial<GlobalSettings>; subjects?: string[]
      };
      if (!v1.timetable || !Array.isArray(v1.timetable.activities)) return null;
      const s = defaultState();
      s.timetables = [{ ...v1.timetable }];
      s.activeTimetableId = s.timetables[0].id;
      if (Array.isArray(v1.categories) && validateCategories(v1.categories).length <= 3)
        s.categories = adoptSimpleLabels(v1.categories);
      s.settings = fillSettings(v1.settings);
      if (Array.isArray(v1.subjects)) s.subjects = v1.subjects;
      return sanitizeState(s);
    }
    return null;
  } catch {
    return null;
  }
}

export function sanitizeState(s: PersistedState): PersistedState {
  for (const t of s.timetables) {
    t.activities = t.activities.filter(
      (a) => validateActivity(a, s.categories).length === 0,
    );
  }
  return s;
}

/** Load from localStorage (works in browser dev + Tauri webview). */
export function loadState(): { state: PersistedState; fresh: boolean } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { state: defaultState(), fresh: true };
    const parsed: unknown = JSON.parse(raw);
    const migrated = migrateState(parsed);
    if (!migrated) {
      // Keep a rescue copy before resetting — never silently destroy (§13.9).
      try {
        localStorage.setItem(`${STORAGE_KEY}.corrupt.${Date.now()}`, raw);
      } catch { /* ignore */ }
      return { state: defaultState(), fresh: true };
    }
    return { state: sanitizeState(migrated), fresh: false };
  } catch {
    return { state: defaultState(), fresh: true };
  }
}

export interface SaveResult {
  ok: boolean;
  error?: string;
}

/** Atomic-feeling save: serialise first, single setItem, report failure (§11.4). */
export function saveState(state: PersistedState): SaveResult {
  try {
    const payload: PersistedState = { ...state, savedAt: nowIso() };
    const text = JSON.stringify(payload);
    localStorage.setItem(STORAGE_KEY, text);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "TimeFlow could not save your changes." };
  }
}

export function weekdayToday(): Weekday {
  // JS: 0=Sun..6=Sat → convert to Mon=0..Sun=6
  return ((new Date().getDay() + 6) % 7) as Weekday;
}

export function minutesNow(): number {
  const n = new Date();
  return n.getHours() * 60 + n.getMinutes();
}
