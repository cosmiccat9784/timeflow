// TimeFlow data model — see spec §13.
// Stable IDs + explicit schema version. Duration is derived, never stored.

export const SCHEMA_VERSION = 1;
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
  icon: string; // emoji / glyph (MVP); V1 allows custom icon sets
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
  name: string;
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

export type ClockFormat = "12h" | "24h";

export interface GlobalSettings {
  visibleStartMinutes: number; // default 360 (06:00)
  visibleEndMinutes: number; // default 1320 (22:00)
  clockFormat: ClockFormat;
  /** quick-switch pair, default [study, personal] */
  switchPair: [string, string];
  /** routine confirmation toasts (Switched, Deleted…); errors always show */
  showToasts: boolean;
  appVersion: string;
}

export interface PersistedState {
  schemaVersion: number;
  timetable: Timetable;
  categories: Category[];
  settings: GlobalSettings;
  subjects: string[];
  savedAt: string;
}

export function uid(prefix = "id"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
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
