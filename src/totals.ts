import type { Activity, Category, Weekday } from "./types";
import { countsAsOptionalWork, countsAsStudy } from "./validation";

export interface Interval {
  start: number;
  end: number;
}

/** Merge overlapping/contiguous intervals → union. Spec §12.3. */
export function unionIntervals(intervals: Interval[]): Interval[] {
  const sorted = intervals
    .filter((i) => i.end > i.start)
    .sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const cur of sorted) {
    const last = out[out.length - 1];
    if (!last || cur.start > last.end) out.push({ ...cur });
    else last.end = Math.max(last.end, cur.end);
  }
  return out;
}

export function unionMinutes(intervals: Interval[]): number {
  return unionIntervals(intervals).reduce((sum, i) => sum + (i.end - i.start), 0);
}

export type TotalsKind = "study" | "optionalWork";

function intervalsFor(
  activities: Activity[],
  categories: Category[],
  weekday: Weekday | null,
  kind: TotalsKind,
): Interval[] {
  return activities
    .filter((a) => weekday === null || a.weekday === weekday)
    .filter((a) =>
      kind === "study" ? countsAsStudy(a, categories) : countsAsOptionalWork(a, categories),
    )
    .map((a) => ({ start: a.startTime, end: a.endTime }));
}

/** Union-based minutes for one day (no double-counting overlaps). */
export function dayTotals(
  activities: Activity[],
  categories: Category[],
  weekday: Weekday,
): { study: number; optionalWork: number } {
  return {
    study: unionMinutes(intervalsFor(activities, categories, weekday, "study")),
    optionalWork: unionMinutes(intervalsFor(activities, categories, weekday, "optionalWork")),
  };
}

export function weekTotals(
  activities: Activity[],
  categories: Category[],
): { study: number; optionalWork: number } {
  return {
    study: unionMinutes(intervalsFor(activities, categories, null, "study")),
    optionalWork: unionMinutes(intervalsFor(activities, categories, null, "optionalWork")),
  };
}

export function allDayTotals(
  activities: Activity[],
  categories: Category[],
): Record<number, { study: number; optionalWork: number }> {
  const out: Record<number, { study: number; optionalWork: number }> = {};
  for (let d = 0; d < 7; d++)
    out[d] = dayTotals(activities, categories, d as Weekday);
  return out;
}
