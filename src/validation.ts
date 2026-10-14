import type { Activity, Category } from "./types";
import { effectiveCounts } from "./types";
import { isAligned, MIN_DURATION } from "./time";

export interface ValidationError {
  field: string;
  message: string;
}

/**
 * Validate a full logical write — spec §13.8.
 * Returns errors; empty = valid. Never mutates input.
 */
export function validateActivity(
  activity: Activity,
  categories: Category[],
): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!activity.name || !activity.name.trim())
    errors.push({ field: "name", message: "Activity name is required." });
  if (!categories.some((c) => c.id === activity.categoryId))
    errors.push({ field: "categoryId", message: "The selected category does not exist." });
  if (!Number.isInteger(activity.weekday) || activity.weekday < 0 || activity.weekday > 6)
    errors.push({ field: "weekday", message: "Weekday must be Monday–Sunday." });
  const { startTime: s, endTime: e } = activity;
  if (!(s >= 0 && e <= 1440))
    errors.push({ field: "time", message: "Times must be within 00:00–24:00 of the same day." });
  if (!(e > s))
    errors.push({ field: "endTime", message: "End time must be after start time." });
  else {
    if (!isAligned(s))
      errors.push({ field: "startTime", message: "Start time must use a 15-minute increment (e.g. 4:00 pm, 4:15 pm)." });
    if (!isAligned(e))
      errors.push({ field: "endTime", message: "End time must use a 15-minute increment (e.g. 5:00 pm)." });
    if (e - s < MIN_DURATION)
      errors.push({ field: "duration", message: "Minimum activity duration is 15 minutes." });
  }
  const cat = categories.find((c) => c.id === activity.categoryId);
  if (cat && cat.countsTowardStudy && cat.countsTowardOptionalWork)
    errors.push({ field: "categoryId", message: "A category cannot count toward both study and optional work." });
  if (activity.optionalWorkOverride && !["inherit", "yes", "no"].includes(activity.optionalWorkOverride))
    errors.push({ field: "optionalWorkOverride", message: "Invalid optional-work override." });
  if (activity.reminderPreferences) {
    const r = activity.reminderPreferences;
    for (const v of [r.startLeadMinutes, r.endLeadMinutes]) {
      if (!Number.isInteger(v) || v < 0 || v > 120)
        errors.push({ field: "reminder", message: "Reminder lead time must be 0–120 minutes." });
    }
  }
  return errors;
}

export function validateCategories(categories: Category[]): ValidationError[] {
  const errors: ValidationError[] = [];
  const ids = new Set<string>();
  for (const c of categories) {
    if (!c.id || ids.has(c.id)) errors.push({ field: "id", message: `Duplicate or missing category id: ${c.id}` });
    ids.add(c.id);
    if (!c.name.trim()) errors.push({ field: "name", message: "Category name is required." });
    if (c.countsTowardStudy && c.countsTowardOptionalWork)
      errors.push({ field: c.id, message: `Category "${c.name}" cannot count toward both study and optional work.` });
  }
  return errors;
}

/** Effective study flag used by totals engine. */
export function countsAsStudy(a: Activity, categories: Category[]): boolean {
  const cat = categories.find((c) => c.id === a.categoryId);
  return effectiveCounts(a, cat).study;
}

export function countsAsOptionalWork(a: Activity, categories: Category[]): boolean {
  const cat = categories.find((c) => c.id === a.categoryId);
  return effectiveCounts(a, cat).optionalWork;
}
