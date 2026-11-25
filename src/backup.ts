import type { Category, PersistedState, Timetable } from "./types";
import { SCHEMA_VERSION } from "./types";
import { DEFAULT_CATEGORIES } from "./categories";
import { validateActivity, validateCategories, validateDeadline } from "./validation";
import { APP_VERSION } from "./store";

// Complete JSON backup + validated restore (§17.3). Failed restores never
// touch existing data — validation happens fully before commit.

export interface BackupData {
  schemaVersion: number;
  appVersion: string;
  exportedAt: string;
  timetables: Timetable[];
  categories: Category[];
  settings: PersistedState["settings"];
  customThemes?: PersistedState["customThemes"];
  subjects: string[];
  weekRecords: PersistedState["weekRecords"];
}

export function createBackup(state: PersistedState): string {
  const data: BackupData = {
    schemaVersion: SCHEMA_VERSION,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    timetables: state.timetables,
    categories: state.categories,
    settings: state.settings,
    customThemes: state.customThemes ?? [],
    subjects: state.subjects,
    weekRecords: state.weekRecords,
  };
  return JSON.stringify(data, null, 2);
}

export function parseBackup(text: string): { ok: true; data: BackupData } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "This file could not be read as JSON." };
  }
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "The backup file is not compatible with this version." };
  const b = raw as Record<string, unknown>;
  const version = typeof b.schemaVersion === "number" ? b.schemaVersion : NaN;
  if (!Number.isInteger(version) || version < 1 || version > SCHEMA_VERSION) {
    return { ok: false, error: `Unsupported backup version (${String(b.schemaVersion)}). Time Flow supports schema v1–v${SCHEMA_VERSION}.` };
  }
  const data = b as unknown as BackupData;
  if (!Array.isArray(data.timetables) || data.timetables.length === 0)
    return { ok: false, error: "The backup contains no timetables." };
  if (!Array.isArray(data.categories) || validateCategories(data.categories).length > 0)
    return { ok: false, error: "The backup contains invalid categories." };
  for (const t of data.timetables) {
    if (typeof t.id !== "string" || typeof t.name !== "string" || !Array.isArray(t.activities))
      return { ok: false, error: `Timetable "${String((t as Timetable)?.name ?? "?")}" is malformed.` };
    for (const a of t.activities) {
      if (validateActivity(a, data.categories).length > 0)
        return { ok: false, error: `Activity "${a.name || "(unnamed)"}" in "${t.name}" is invalid — restore aborted, nothing changed.` };
    }
    if (t.deadlines !== undefined) {
      if (!Array.isArray(t.deadlines))
        return { ok: false, error: `Deadlines in "${t.name}" are malformed — restore aborted, nothing changed.` };
      for (const d of t.deadlines) {
        if (!d || typeof d !== "object" || validateDeadline(d as { title: string; date: string }).length > 0)
          return { ok: false, error: `A deadline in "${t.name}" is invalid — restore aborted, nothing changed.` };
      }
    } else {
      t.deadlines = [];
    }
  }
  if (typeof data.settings !== "object" || data.settings === null)
    return { ok: false, error: "The backup settings are malformed." };
  if (!Array.isArray(data.subjects)) data.subjects = [];
  if (!Array.isArray(data.customThemes)) data.customThemes = [];
  if (typeof data.weekRecords !== "object" || data.weekRecords === null) data.weekRecords = {};
  data.schemaVersion = SCHEMA_VERSION;
  return { ok: true, data };
}

export function blankCategoriesFallback(): Category[] {
  return DEFAULT_CATEGORIES.map((c) => ({ ...c }));
}
