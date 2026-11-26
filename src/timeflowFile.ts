/**
 * `.timeflow` file format — one portable timetable.
 *
 * A `.timeflow` file is UTF-8 JSON containing exactly one timetable plus the
 * categories it references, so it can be opened on another machine (Windows,
 * macOS or Linux) without dragging the whole app backup along.
 *
 * Relationship to other formats:
 * - `timeflow-backup.json` = everything (all timetables, settings, records)
 * - `*.timeflow`           = one timetable, portable, readable JSON
 * - `*.csv` / `*.xlsx`     = spreadsheet interchange
 */

import type { Activity, Category, Deadline, Timetable } from "./types";
import { SCHEMA_VERSION } from "./types";
import { validateActivity, validateCategories, validateDeadline } from "./validation";

export const TIMEFLOW_FORMAT = "timeflow.timetable";
export const TIMEFLOW_FORMAT_VERSION = 1;
export const TIMEFLOW_EXTENSION = "timeflow";

export interface TimeflowFile {
  format: typeof TIMEFLOW_FORMAT;
  formatVersion: number;
  schemaVersion: number;
  appVersion: string;
  exportedAt: string;
  timetable: Timetable;
  /** Categories the timetable references, so colours and counting survive. */
  categories: Category[];
}

/** Only the categories actually used, so files stay small and self-contained. */
export function usedCategories(timetable: Timetable, categories: Category[]): Category[] {
  const used = new Set(timetable.activities.map((a) => a.categoryId));
  return categories.filter((c) => used.has(c.id)).map((c) => ({ ...c }));
}

export function createTimeflowFile(
  timetable: Timetable,
  categories: Category[],
  appVersion: string,
  now = new Date(),
): string {
  const file: TimeflowFile = {
    format: TIMEFLOW_FORMAT,
    formatVersion: TIMEFLOW_FORMAT_VERSION,
    schemaVersion: SCHEMA_VERSION,
    appVersion,
    exportedAt: now.toISOString(),
    timetable: {
      id: timetable.id,
      name: timetable.name,
      activities: timetable.activities,
      deadlines: timetable.deadlines ?? [],
    },
    categories: usedCategories(timetable, categories),
  };
  return JSON.stringify(file, null, 2);
}

export type ParseTimeflowResult =
  | { ok: true; timetable: Timetable; categories: Category[]; warnings: string[] }
  | { ok: false; error: string };

/**
 * Validate a `.timeflow` file. Nothing is applied unless every activity and
 * deadline passes the same rules the app enforces while editing.
 */
export function parseTimeflowFile(text: string): ParseTimeflowResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "That file is not valid JSON." };
  }
  if (!raw || typeof raw !== "object") return { ok: false, error: "That file is not a Time Flow timetable." };
  const obj = raw as Record<string, unknown>;
  if (obj.format !== TIMEFLOW_FORMAT) {
    return {
      ok: false,
      error: "That file is not a .timeflow timetable (missing \"format\": \"timeflow.timetable\").",
    };
  }
  const version = typeof obj.formatVersion === "number" ? obj.formatVersion : NaN;
  if (!Number.isInteger(version) || version < 1 || version > TIMEFLOW_FORMAT_VERSION) {
    return { ok: false, error: `Unsupported .timeflow version (${String(obj.formatVersion)}).` };
  }
  const tt = obj.timetable as Partial<Timetable> | undefined;
  if (!tt || typeof tt !== "object") return { ok: false, error: "The file has no timetable." };
  if (typeof tt.name !== "string" || !tt.name.trim()) return { ok: false, error: "The timetable has no name." };
  if (!Array.isArray(tt.activities)) return { ok: false, error: "The timetable has no activity list." };

  const categories = Array.isArray(obj.categories) ? (obj.categories as Category[]) : [];
  const warnings: string[] = [];
  if (categories.length === 0 && tt.activities.length > 0) {
    return { ok: false, error: "The timetable references categories but the file has none." };
  }
  for (const c of categories) {
    if (!c || typeof c !== "object") return { ok: false, error: "One of the categories is malformed." };
  }
  const categoryErrors = validateCategories(categories);
  if (categoryErrors.length > 0) {
    return { ok: false, error: `Category problem: ${categoryErrors[0].message}` };
  }
  for (const a of tt.activities) {
    if (!a || typeof a !== "object") return { ok: false, error: "One of the activities is malformed." };
    const errs = validateActivity(a as Activity, categories);
    if (errs.length > 0) {
      return {
        ok: false,
        error: `Activity "${(a as Activity).name || "(unnamed)"}" is invalid: ${errs[0].message}`,
      };
    }
  }
  const deadlines: Deadline[] = [];
  if (tt.deadlines !== undefined) {
    if (!Array.isArray(tt.deadlines)) return { ok: false, error: "The deadline list is malformed." };
    for (const d of tt.deadlines) {
      if (!d || typeof d !== "object") return { ok: false, error: "One of the deadlines is malformed." };
      const errs = validateDeadline(d as Deadline);
      if (errs.length > 0) {
        return { ok: false, error: `Deadline "${(d as Deadline).title ?? ""}" is invalid: ${errs[0].message}` };
      }
      deadlines.push(d as Deadline);
    }
  }

  return {
    ok: true,
    warnings,
    categories: categories.map((c) => ({ ...c })),
    timetable: {
      id: typeof tt.id === "string" && tt.id ? tt.id : `tt_import_${Date.now().toString(36)}`,
      name: tt.name.trim(),
      activities: (tt.activities as Activity[]).map((a) => ({ ...a })),
      deadlines,
    },
  };
}

export interface CategoryMerge {
  categories: Category[];
  /** Incoming category id → id that exists in the merged list. */
  remap: Record<string, string>;
  added: number;
}

/**
 * Merge imported categories into the current set: same id wins, otherwise a
 * same-name category is reused (so "Study" stays one category), otherwise the
 * imported one is appended.
 */
export function mergeCategories(current: Category[], incoming: Category[]): CategoryMerge {
  const categories = current.map((c) => ({ ...c }));
  const remap: Record<string, string> = {};
  let added = 0;
  for (const inc of incoming) {
    const byId = categories.find((c) => c.id === inc.id);
    if (byId) {
      remap[inc.id] = byId.id;
      continue;
    }
    const byName = categories.find((c) => c.name.trim().toLowerCase() === inc.name.trim().toLowerCase());
    if (byName) {
      remap[inc.id] = byName.id;
      continue;
    }
    categories.push({ ...inc });
    remap[inc.id] = inc.id;
    added++;
  }
  return { categories, remap, added };
}

/** Point every activity at the merged category ids. */
export function remapTimetable(timetable: Timetable, remap: Record<string, string>): Timetable {
  return {
    ...timetable,
    activities: timetable.activities.map((a) => ({ ...a, categoryId: remap[a.categoryId] ?? a.categoryId })),
  };
}

/** "School Week" → "School Week.timeflow"; strips characters Windows rejects. */
export function timeflowFileName(name: string): string {
  const safe = name
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .slice(0, 80);
  return `${safe || "Timetable"}.${TIMEFLOW_EXTENSION}`;
}

/** Make an imported name unique so two tabs never look identical. */
export function uniqueTimetableName(name: string, existing: string[]): string {
  const taken = new Set(existing.map((n) => n.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  const base = `${name} (opened)`;
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; i < 100; i++) {
    const candidate = `${name} (${i})`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${name} (${Date.now().toString(36)})`;
}
