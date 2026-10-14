// TimeFlow data model — spec §13.
// Schema v2: multiple timetables, week records, restore points, timer.
// Stable IDs + explicit schema version. Duration is derived, never stored.

export const SCHEMA_VERSION = 2;
export const STORAGE_KEY = "timeflow.v1.state";

/** Monday = 0 … Sunday = 6 (ISO-style, Monday-first per §3.5). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export const WEEKDAYS: Weekday[] = [0, 1, 2, 3, 4, 5, 6];
export const WEEKDAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;
export const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export interface Category {
  id: string;
  name: string;
  colour: string; // hex background
  icon: string; // emoji / glyph
  countsTowardStudy: boolean;
  countsTowardOptionalWork: boolean;
}

export type OptionalWorkOverride = "inherit" | "yes" | "no";

export interface ReminderPreferences {
  startEnabled: boolean;
  endEnabled: boolean;
  /** minutes before start / before end */
  startLeadMinutes: number;
  endLeadMinutes: number;
}

export interface Activity {
  id: string;
  name: string; // optional: blank displays the category name
  categoryId: string;
  subject?: string;
  weekday: Weekday;
  /** minutes from midnight, 15-min aligned, 0..1440 */
  startTime: number;
  endTime: number;
  notes?: string;
  optionalWorkOverride?: OptionalWorkOverride;
  reminderPreferences?: ReminderPreferences;
  createdAt: string;
  updatedAt: string;
}

export interface Timetable {
  id: string;
  name: string;
  activities: Activity[];
}

/** V2 week-specific record — separate from the repeating template (§13.6). */
export interface WeekRecord {
  timetableId: string;
  weekId: string; // yyyy-mm-dd of the week's Monday (local)
  completed: Record<string, { done: boolean; minutes: number }>;
  delivered: string[]; // fired reminder keys (duplicate prevention §21.4)
}

/** V2 persisted timer session (§20.4). Elapsed derives from timestamps. */
export interface TimerState {
  timetableId: string;
  activityId: string;
  startedAtEpochMs: number;
  accumulatedSec: number;
  running: boolean;
  targetSec: number;
}

/** V1 restore point before destructive operations (§16.3, §11.1). */
export interface RestorePoint {
  id: string;
  label: string;
  at: string;
  timetables: Timetable[];
  categories: Category[];
}

export type ClockFormat = "12h" | "24h";

export type Theme = "light" | "dark";

export interface QuietHours {
  start: number | null; // minutes from midnight, null = off
  end: number | null;
}

export interface ReminderDefaults {
  startLead: number;
  endLead: number;
  atEnd: boolean;
}

export interface GlobalSettings {
  visibleStartMinutes: number; // default 360 (06:00)
  visibleEndMinutes: number; // default 1320 (22:00)
  clockFormat: ClockFormat;
  theme: Theme;
  /** quick-switch pair, default [study, personal] */
  switchPair: [string, string];
  /** routine confirmation toasts (Switched, Deleted…); errors always show */
  showToasts: boolean;
  quietHours: QuietHours;
  reminderDefaults: ReminderDefaults;
  lastRolloverWeekId: string | null;
  appVersion: string;
}

export interface PersistedState {
  schemaVersion: number;
  timetables: Timetable[];
  activeTimetableId: string;
  categories: Category[];
  settings: GlobalSettings;
  subjects: string[];
  weekRecords: Record<string, WeekRecord>;
  restorePoints: RestorePoint[];
  activeTimer: TimerState | null;
  savedAt: string;
}

export function uid(prefix = "id"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Display name: explicit activity name, falling back to the category name.
 *  Names are optional — an unnamed block simply shows its category. */
export function displayName(
  activity: Pick<Activity, "name" | "categoryId">,
  categories: Category[],
): string {
  const n = activity.name.trim();
  if (n) return n;
  return categories.find((c) => c.id === activity.categoryId)?.name ?? "Untitled";
}

/** Effective counting for one activity given its category. */
export function effectiveCounts(
  activity: Pick<Activity, "optionalWorkOverride">,
  category: Category | undefined,
): { study: boolean; optionalWork: boolean } {
  const study = category?.countsTowardStudy === true;
  let optional = category?.countsTowardOptionalWork === true;
  if (activity.optionalWorkOverride === "yes") optional = true;
  else if (activity.optionalWorkOverride === "no") optional = false;
  return { study, optionalWork: optional };
}
