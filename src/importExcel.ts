import ExcelJS from "exceljs";
import type { Weekday } from "./types";
import { defaultCategoryForName } from "./categories";

// Excel import analyser — spec §16. Tuned against the real reference
// workbook (inspected 2026-10-14): one sheet, weekday section Mon–Fri with
// 15-min rows, weekend section Sat–Sun with hourly rows, colour legend,
// daily study/optional summaries. No merged cells — runs of repeated
// values form multi-slot activities. Nothing is silently rounded or
// dropped: every uncertainty becomes a proposal warning for the wizard.

export interface ImportProposal {
  key: string;
  day: Weekday;
  start: number | null;
  end: number | null;
  name: string;
  categoryId: string;
  subject: string;
  notes: string;
  optionalWorkOverride: "inherit" | "yes" | "no";
  warnings: string[];
  excluded: boolean;
  suggestedStart: number | null;
  suggestedEnd: number | null;
}

export interface SheetPlan {
  sheetName: string;
  proposals: ImportProposal[];
  warnings: string[]; // sheet-level: hidden rows/cols, assumed periods…
  skippedSummaries: number;
}

export interface TimeRange {
  start: number;
  end: number;
}

/** Fill RRGGBB → category id, from the reference legend. */
export const FILL_TO_CATEGORY: Record<string, string> = {
  FFE5E5: "band", // Extra-curricular @ School (pink)
  FFFDD0: "study", // Study/Homework/School (pale yellow)
  D6EAF8: "transport", // Transport (blue)
  D5F5E3: "band", // Extra-curricular out of school (mint)
  EADCF8: "rest", // Rest/Downtime (lavender)
};

const LEGEND_NAMES = new Set([
  "extra-curricular @ school",
  "study/homework/school",
  "transport",
  "extra-curricular out of school",
  "rest/downtime",
]);

const SKIP_LABELS = new Set(["study time:", "optional extra:", "key:", "time", "before school"]);

function normDay(text: string): Weekday | null {
  const t = text.trim().toLowerCase().replace(/[^a-z]/g, "");
  if (t.startsWith("mon")) return 0;
  if (t.startsWith("tue")) return 1;
  if (t.startsWith("wedn") || t.startsWith("wens") || t.startsWith("wed")) return 1 + 1 as Weekday; // tolerates "Wednsday"
  if (t.startsWith("thu")) return 3;
  if (t.startsWith("fri")) return 4;
  if (t.startsWith("sat")) return 5;
  if (t.startsWith("sun")) return 6;
  return null;
}

/** "3:30" + meridiem → minutes, or null. */
function sideToMinutes(num: string, mins: string, meridiem: "am" | "pm" | null): number | null {
  let h = parseInt(num, 10);
  const m = mins ? parseInt(mins, 10) : 0;
  if (Number.isNaN(h) || Number.isNaN(m) || m > 59) return null;
  if (meridiem) {
    if (h < 1 || h > 12) return null;
    h = meridiem === "am" ? h % 12 : (h % 12) + 12;
  } else {
    if (h > 24) return null;
    if (h === 24 && m !== 0) return null;
  }
  return h * 60 + m;
}

/**
 * Parse time labels: "3:30 - 3:45", "6 - 7 AM", "11 AM - 12 PM", "8-9 PM".
 * Bare hours without am/pm inherit the running period context (sheets like
 * the reference list afternoon times bare). Returns null when unparseable.
 */
export function parseTimeLabel(
  text: string,
  contextPM: boolean,
): { range: TimeRange | null; periodUsed: boolean } {
  const t = text.trim().replace(/\s+/g, " ");
  const parts = t.split("-").map((s) => s.trim());
  if (parts.length !== 2) return { range: null, periodUsed: false };
  const rightMer = /pm$/i.test(parts[1]) ? "pm" : /am$/i.test(parts[1]) ? "am" : null;
  const leftMer = /pm$/i.test(parts[0]) ? "pm" : /am$/i.test(parts[0]) ? "am" : null;
  const parseSide = (s: string, fallback: "am" | "pm" | null): number | null => {
    const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
    if (!m) return null;
    const mer = (m[3]?.toLowerCase() as "am" | "pm" | undefined) ?? fallback;
    return sideToMinutes(m[1], m[2] ?? "", mer);
  };
  // Propagate an explicit right-side meridiem to a bare left side.
  const effLeftFallback = leftMer ?? rightMer ?? (contextPM ? "pm" : null);
  const start = parseSide(parts[0], effLeftFallback);
  const end = parseSide(parts[1], rightMer ?? leftMer ?? (contextPM ? "pm" : null));
  if (start === null || end === null || end <= start) return { range: null, periodUsed: false };
  const periodUsed = leftMer === null && rightMer === null && contextPM;
  return { range: { start, end }, periodUsed };
}

export function isDurationText(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (/^(study time|optional extra|key)\s*:?$/.test(t)) return true;
  return /^(\d+\s*(hrs?|hours?|mins?|minutes?)\s*)+$/.test(t) && /\d/.test(t);
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (value instanceof Date) return "";
  if (typeof value === "object") {
    const v = value as unknown as Record<string, unknown>;
    if (Array.isArray(v.richText)) {
      return (v.richText as { text?: string }[]).map((r) => r.text ?? "").join("");
    }
    if (typeof v.text === "string") return v.text;
    if (typeof v.result === "number") return String(v.result);
    if (typeof v.result === "string") return v.result;
  }
  return "";
}

function cellFillRgb(cell: ExcelJS.Cell): string | null {
  try {
    const fill = cell.fill as { type?: string; pattern?: string; fgColor?: { argb?: string } } | undefined;
    const argb = fill?.fgColor?.argb;
    if (!argb || argb.length !== 8) return null;
    const rgb = argb.slice(2).toUpperCase();
    if (rgb === "000000") return null;
    return rgb;
  } catch {
    return null;
  }
}

function colLetter(col: number): string {
  let s = "";
  let n = col;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

interface GridCell {
  text: string;
  fill: string | null;
}

/** Vertical merge ranges "D5:D8" → per-column row spans. Best effort. */
function mergeSpans(ws: ExcelJS.Worksheet): Map<string, { startRow: number; endRow: number }> {
  const out = new Map<string, { startRow: number; endRow: number }>();
  try {
    const model = (ws as unknown as { model?: { merges?: string[] } }).model;
    for (const ref of model?.merges ?? []) {
      const m = ref.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
      if (!m || m[1] !== m[3]) continue;
      out.set(`${m[1]}:${m[2]}`, { startRow: parseInt(m[2], 10), endRow: parseInt(m[4], 10) });
    }
  } catch { /* ignore */ }
  return out;
}

export async function analyzeExcel(data: Uint8Array): Promise<SheetPlan[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data as unknown as ArrayBuffer);
  const plans: SheetPlan[] = [];
  wb.eachSheet((ws) => plans.push(analyzeSheet(ws)));
  return plans;
}

function analyzeSheet(ws: ExcelJS.Worksheet): SheetPlan {
  const warnings: string[] = [];
  const proposals: ImportProposal[] = [];
  let skippedSummaries = 0;
  const maxRow = Math.min(ws.rowCount, 500);
  const maxCol = Math.min(ws.columnCount, 60);

  // Materialise text + fills; note hidden rows/cols.
  const grid = new Map<string, GridCell>();
  const hiddenRows = new Set<number>();
  const hiddenCols = new Set<number>();
  for (let r = 1; r <= maxRow; r++) {
    const row = ws.getRow(r);
    if (row.hidden) hiddenRows.add(r);
    for (let c = 1; c <= maxCol; c++) {
      if (r === 1 && ws.getColumn(c).hidden) hiddenCols.add(c);
      const cell = ws.getCell(r, c);
      const text = cellText(cell.value).trim();
      if (text !== "") grid.set(`${r}:${c}`, { text, fill: cellFillRgb(cell) });
    }
  }
  const merges = mergeSpans(ws);

  // Header row: first row (1..10) holding ≥2 weekday names.
  let headerRow = -1;
  const dayCols: { weekday: Weekday; col: number }[] = [];
  for (let r = 1; r <= 10 && headerRow === -1; r++) {
    const found: { weekday: Weekday; col: number }[] = [];
    for (let c = 1; c <= maxCol; c++) {
      const g = grid.get(`${r}:${c}`);
      if (!g) continue;
      const d = normDay(g.text);
      if (d !== null) found.push({ weekday: d, col: c });
    }
    if (found.length >= 2) {
      headerRow = r;
      dayCols.push(...found);
    }
  }
  if (headerRow === -1) {
    return { sheetName: ws.name, proposals, warnings: ["No weekday header row found — nothing to import from this sheet."], skippedSummaries };
  }
  if (hiddenRows.size > 0 || hiddenCols.size > 0)
    warnings.push(`Hidden ${hiddenRows.size} row(s) / ${hiddenCols.size} column(s) — excluded unless you unhide them first.`);

  // Period context: explicit pm anywhere → bare hours read as PM.
  let contextPM = false;
  for (const [, g] of grid) {
    if (/\bpm\b/i.test(g.text)) {
      contextPM = true;
      break;
    }
  }
  if (contextPM) warnings.push("Times without am/pm are assumed PM (explicit PM labels found) — verify in the preview.");

  // Row time labels per day column: nearest non-empty cell to the left.
  const labelFor = (r: number, dayCol: number): { text: string; range: TimeRange | null; periodUsed: boolean } | null => {
    for (let c = dayCol - 1; c >= 1; c--) {
      const g = grid.get(`${r}:${c}`);
      if (!g) continue;
      const parsed = parseTimeLabel(g.text, contextPM);
      if (parsed.range) return { text: g.text, range: parsed.range, periodUsed: parsed.periodUsed };
      return null; // first non-empty cell isn't a time → no label
    }
    return null;
  };

  const consumed = new Set<string>(); // merge top-left cells already expanded
  let key = 0;

  for (const { weekday, col } of dayCols) {
    if (hiddenCols.has(col)) {
      warnings.push(`Column ${colLetter(col)} (${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][weekday]}) is hidden — skipped.`);
      continue;
    }
    // Collect rows with content.
    const rows: { r: number; text: string; fill: string | null }[] = [];
    for (let r = headerRow + 1; r <= maxRow; r++) {
      if (hiddenRows.has(r)) continue;
      const g = grid.get(`${r}:${col}`);
      if (g && g.text !== "") rows.push({ r, text: g.text, fill: g.fill });
    }
    // Group consecutive same-name rows into runs.
    let i = 0;
    while (i < rows.length) {
      const name = rows[i].text;
      // Skip summary/legend cells.
      if (isDurationText(name) || LEGEND_NAMES.has(name.toLowerCase()) || SKIP_LABELS.has(name.toLowerCase())) {
        skippedSummaries++;
        i++;
        continue;
      }
      let j = i;
      while (j + 1 < rows.length && rows[j + 1].r === rows[j].r + 1 && rows[j + 1].text.toLowerCase() === name.toLowerCase()) j++;
      // Extend across merged ranges.
      const addr = `${colLetter(col)}:${rows[j].r}`;
      const span = merges.get(addr);
      const runRows = rows.slice(i, j + 1);
      const firstLab = labelFor(runRows[0].r, col);
      let lastLab = labelFor(runRows[runRows.length - 1].r, col);
      // Merged vertical range: end from the span's last row.
      if (span && span.endRow > runRows[runRows.length - 1].r) {
        lastLab = labelFor(span.endRow, col);
        consumed.add(addr);
      }
      // Next row's start as fallback end.
      const nextLab = labelFor(runRows[runRows.length - 1].r + 1, col);

      const warningsRow: string[] = [];
      let start: number | null = firstLab?.range?.start ?? null;
      let end: number | null = lastLab?.range?.end ?? nextLab?.range?.start ?? null;
      if (end === null && start !== null) end = start + 15;
      if (firstLab?.periodUsed) warningsRow.push(`Start time assumed PM from "${firstLab.text}".`);
      if (start === null || end === null) {
        warningsRow.push("No readable time on this row — set the time explicitly.");
      } else {
        if (start % 15 !== 0 || end % 15 !== 0) {
          warningsRow.push(`Time ${fmt(start)}–${fmt(end)} is off the 15-minute grid.`);
        }
        if (end - start < 15) warningsRow.push("Duration under 15 minutes.");
      }

      // Category: explicit "extra work" name wins (reference colours it
      // study-yellow), then legend fill, then name heuristics.
      const fill = runRows[0].fill;
      let categoryId: string;
      if (/extra\s*work|overtime/i.test(name)) categoryId = "work";
      else if (fill && FILL_TO_CATEGORY[fill]) categoryId = FILL_TO_CATEGORY[fill];
      else {
        categoryId = "other";
        const guess = defaultCategoryForName(name);
        if (guess !== "personal" && guess !== "other") categoryId = guess;
        else if (/swim|sport|piano|drum|band|music|dinner|lunch|shower|scout|transport|bus|train|rest|study|homework|revision|recap|reorganize|typing|duo/i.test(name))
          categoryId = guess === "other" ? "other" : guess;
        if (fill) warningsRow.push(`Colour #${fill} isn't in the legend — category guessed from the name.`);
      }

      proposals.push({
        key: `imp_${key++}`,
        day: weekday,
        start,
        end,
        name,
        categoryId,
        subject: "",
        notes: "",
        optionalWorkOverride: "inherit",
        warnings: warningsRow,
        excluded: false,
        suggestedStart: start !== null && start % 15 !== 0 ? Math.round(start / 15) * 15 : null,
        suggestedEnd: end !== null && end % 15 !== 0 ? Math.round(end / 15) * 15 : null,
      });
      i = j + 1;
    }
  }

  // Overlap warnings across proposals.
  const byDay = new Map<number, ImportProposal[]>();
  for (const p of proposals) {
    if (p.start === null || p.end === null) continue;
    if (!byDay.has(p.day)) byDay.set(p.day, []);
    byDay.get(p.day)!.push(p);
  }
  for (const list of byDay.values()) {
    const sorted = [...list].sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
    for (let k = 1; k < sorted.length; k++) {
      if ((sorted[k].start ?? 0) < (sorted[k - 1].end ?? 0)) {
        sorted[k].warnings.push(`Overlaps "${sorted[k - 1].name}" — kept as a flagged conflict.`);
      }
    }
  }

  return { sheetName: ws.name, proposals, warnings, skippedSummaries };
}

function fmt(m: number): string {
  const h24 = Math.floor(m / 60) % 24;
  const mm = String(m % 60).padStart(2, "0");
  const ap = h24 < 12 ? "am" : "pm";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${mm} ${ap}`;
}
