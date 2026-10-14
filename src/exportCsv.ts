import type { Activity, Category, Weekday } from "./types";
import { WEEKDAY_NAMES, WEEKDAY_SHORT } from "./types";
import { formatTime } from "./time";

// Flat CSV activity-list export + tolerant import (§17.2, §16.2).
// Headers: Name,Weekday,Start,End,Category,Subject,Notes,OptionalWork

const HEADERS = ["Name", "Weekday", "Start", "End", "Category", "Subject", "Notes", "OptionalWork"] as const;

function esc(cell: string): string {
  return /[",\n\r]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

function minutesToHHMM(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export function activitiesToCsv(activities: Activity[], categories: Category[]): string {
  const catName = (id: string) => categories.find((c) => c.id === id)?.name ?? id;
  const lines = [HEADERS.join(",")];
  const sorted = [...activities].sort((a, b) =>
    a.weekday !== b.weekday ? a.weekday - b.weekday : a.startTime - b.startTime,
  );
  for (const a of sorted) {
    lines.push([
      esc(a.name),
      esc(WEEKDAY_NAMES[a.weekday]),
      esc(minutesToHHMM(a.startTime)),
      esc(minutesToHHMM(a.endTime)),
      esc(catName(a.categoryId)),
      esc(a.subject ?? ""),
      esc(a.notes ?? ""),
      esc(a.optionalWorkOverride ?? "inherit"),
    ].join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

/** Minimal RFC-4180 reader: quotes, escaped quotes, CRLF/LF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      cell = "";
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
    } else if (ch !== "\r") cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c !== "")) rows.push(row);
  return rows;
}

export function weekdayFromCsvName(text: string): Weekday | null {
  const t = text.trim().toLowerCase();
  for (let i = 0; i < 7; i++) {
    if (WEEKDAY_NAMES[i].toLowerCase() === t || WEEKDAY_SHORT[i].toLowerCase() === t) return i as Weekday;
  }
  return null;
}

export function minutesFromCsvTime(text: string): number | null {
  const t = text.trim();
  let m = t.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?$/i);
  if (m) {
    let h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    const ap = m[3]?.toLowerCase();
    if (ap) {
      if (h < 1 || h > 12) return null;
      h = ap === "am" ? h % 12 : (h % 12) + 12;
    }
    if (h > 24 || min > 59) return null;
    return h * 60 + min;
  }
  m = t.match(/^(\d{1,2})\s*(am|pm)$/i);
  if (m) {
    let h = parseInt(m[1], 10);
    if (h < 1 || h > 12) return null;
    h = m[2].toLowerCase() === "am" ? h % 12 : (h % 12) + 12;
    return h * 60;
  }
  return null;
}

export function formatCsvDuration(minutes: number): string {
  return formatTime(minutes);
}
