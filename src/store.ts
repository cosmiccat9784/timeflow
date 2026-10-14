import type { Activity, GlobalSettings, PersistedState, Timetable, Weekday } from "./types";
import { SCHEMA_VERSION, STORAGE_KEY, nowIso, uid } from "./types";
import { DEFAULT_CATEGORIES, DEFAULT_SWITCH_PAIR } from "./categories";
import { validateActivity, validateCategories } from "./validation";

export const APP_VERSION = "0.1.0";

export function defaultSettings(): GlobalSettings {
  return {
    visibleStartMinutes: 360,
    visibleEndMinutes: 1320,
    clockFormat: "12h",
    switchPair: [...DEFAULT_SWITCH_PAIR] as [string, string],
    showToasts: true,
    appVersion: APP_VERSION,
  };
}

export function defaultTimetable(): Timetable {
  return { id: uid("tt"), name: "My Week", activities: [] };
}

export function defaultState(): PersistedState {
  return {
    schemaVersion: SCHEMA_VERSION,
    timetable: defaultTimetable(),
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
    settings: defaultSettings(),
    subjects: ["Mathematics", "English", "Piano", "Swimming"],
    savedAt: nowIso(),
  };
}

/** Migrate older schemas → current. Never destroys last valid data (§13.9). */
export function migrateState(raw: unknown): PersistedState | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  try {
    if (r.schemaVersion === SCHEMA_VERSION) {
      const s = r as unknown as PersistedState;
      if (!Array.isArray(s.timetable?.activities)) return null;
      if (!Array.isArray(s.categories)) return null;
      if (validateCategories(s.categories).length > 3) {
        // Too broken to trust wholesale — fall back to defaults for categories
        s.categories = DEFAULT_CATEGORIES.map((c) => ({ ...c }));
      }
      // Forward-fill settings added in later versions.
      if (typeof s.settings.showToasts !== "boolean") s.settings.showToasts = true;
      return sanitizeState(s);
    }
    // v0 (pre-release, no schemaVersion): best-effort upgrade
    if (r.schemaVersion === undefined && Array.isArray((r as { activities?: unknown }).activities)) {
      const legacy = r as { activities: Activity[] };
      const s = defaultState();
      s.timetable.activities = legacy.activities.filter(
        (a) => validateActivity(a, s.categories).length === 0,
      );
      return s;
    }
    return null;
  } catch {
    return null;
  }
}

export function sanitizeState(s: PersistedState): PersistedState {
  s.timetable.activities = s.timetable.activities.filter(
    (a) => validateActivity(a, s.categories).length === 0,
  );
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
