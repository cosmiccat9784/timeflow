import type { TimerState, WeekRecord } from "./types";

// V2 week-record + timer helpers. Week identity is the local Monday date
// (yyyy-mm-dd); date-specific scheduling is NOT introduced — the id is only
// a retention boundary for week records (§3.5, §22).

export function mondayOfWeek(d: Date): Date {
  const c = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dowMon0 = (c.getDay() + 6) % 7;
  c.setDate(c.getDate() - dowMon0);
  c.setHours(0, 0, 0, 0);
  return c;
}

export function weekIdFor(d: Date): string {
  const m = mondayOfWeek(d);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${m.getFullYear()}-${p(m.getMonth() + 1)}-${p(m.getDate())}`;
}

export function currentWeekId(now = new Date()): string {
  return weekIdFor(now);
}

export function recordKey(timetableId: string, weekId: string): string {
  return `${timetableId}::${weekId}`;
}

export function freshWeekRecord(timetableId: string, weekId: string): WeekRecord {
  return { timetableId, weekId, completed: {}, delivered: [] };
}

export function withCompletion(
  record: WeekRecord,
  activityId: string,
  done: boolean,
): WeekRecord {
  const prev = record.completed[activityId] ?? { done: false, minutes: 0 };
  return {
    ...record,
    completed: { ...record.completed, [activityId]: { ...prev, done } },
  };
}

export function withMinutes(
  record: WeekRecord,
  activityId: string,
  minutes: number,
): WeekRecord {
  const prev = record.completed[activityId] ?? { done: false, minutes: 0 };
  return {
    ...record,
    completed: { ...record.completed, [activityId]: { ...prev, minutes: prev.minutes + minutes } },
  };
}

export function withDelivered(record: WeekRecord, key: string): WeekRecord {
  if (record.delivered.includes(key)) return record;
  return { ...record, delivered: [...record.delivered, key] };
}

export function completedMinutes(record: WeekRecord | undefined): number {
  if (!record) return 0;
  return Object.values(record.completed).reduce((s, c) => s + c.minutes, 0);
}

export function completedCount(record: WeekRecord | undefined): number {
  if (!record) return 0;
  return Object.values(record.completed).filter((c) => c.done).length;
}

/** Elapsed seconds from persisted timestamps — survives restarts (§20.4). */
export function timerElapsedSec(timer: TimerState, nowEpochMs: number): number {
  if (!timer.running) return timer.accumulatedSec;
  return timer.accumulatedSec + Math.max(0, Math.floor((nowEpochMs - timer.startedAtEpochMs) / 1000));
}

export function formatElapsed(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}
