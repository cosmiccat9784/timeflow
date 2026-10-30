import type { Weekday } from "./types";

// Deadline nearness uses real calendar dates (yyyy-mm-dd, local).
// Deadlines are one-off: no repeating weekly rule, no date exceptions to
// the timetable itself — the repeating template stays date-free.

export function todayKey(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function toUtcMs(key: string): number {
  const [y, m, day] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, day);
}

/** Whole days from today until the date. Negative = overdue. */
export function daysUntil(dateStr: string, todayStr = todayKey()): number {
  return Math.round((toUtcMs(dateStr) - toUtcMs(todayStr)) / 86400000);
}

export function relativeLabel(days: number): string {
  if (days < -1) return `Overdue by ${-days} days`;
  if (days === -1) return "Yesterday · overdue";
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `In ${days} days`;
}

/** Nearest first: overdue (oldest first), then today, then future. */
export function sortByNearness<T extends { date: string }>(items: T[], todayStr = todayKey()): T[] {
  return [...items].sort((a, b) => toUtcMs(a.date) - toUtcMs(b.date));
}

/** Next occurrence of a weekday on/after `from` (for one-time migration). */
export function nextWeekdayDate(weekday: Weekday, from = new Date()): string {
  const dowMon0 = (from.getDay() + 6) % 7;
  const delta = (weekday - dowMon0 + 7) % 7;
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + delta);
  return todayKey(d);
}

/** "2026-11-03" → "Tue 3 Nov" (local, noon-safe). */
export function formatDateShort(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d, 12);
  return dt.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
}
