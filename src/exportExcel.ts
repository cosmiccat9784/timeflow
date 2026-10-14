import ExcelJS from "exceljs";
import type { Category, Timetable, Weekday } from "./types";
import { WEEKDAY_NAMES } from "./types";
import { allDayTotals } from "./totals";
import { formatDuration } from "./time";

// Familiar weekly-timetable XLSX export (§17.1): weekday section with
// 15-minute rows, weekend section with hourly rows when needed, category
// fills, legend, and daily study/optional summaries computed by our rules.

function argb(hex: string): string {
  const h = hex.replace("#", "").toUpperCase();
  return h.length === 6 ? `FF${h}` : "FFFFFFFF";
}

function label12(start: number, end: number): string {
  const f = (m: number) => {
    const h24 = Math.floor(m / 60) % 24;
    const ap = h24 < 12 ? "AM" : "PM";
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    return `${h12}:${String(m % 60).padStart(2, "0")}`;
  };
  return `${f(start)} - ${f(end)}`;
}

function thinBorder(): Partial<ExcelJS.Borders> {
  const s = { style: "thin" as const, color: { argb: "FFD8D2C4" } };
  return { top: s, left: s, bottom: s, right: s };
}

export async function timetableToXlsx(
  timetable: Timetable,
  categories: Category[],
): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "TimeFlow";
  const ws = wb.addWorksheet("Timetable");
  const catOf = (id: string) => categories.find((c) => c.id === id);

  ws.columns = [
    { width: 18 },
    { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 },
  ];

  let row = 1;
  const head = (labels: string[]) => {
    labels.forEach((t, i) => {
      const c = ws.getCell(row, i + 1);
      c.value = t;
      c.font = { bold: true };
      c.alignment = { horizontal: "center", vertical: "middle" };
    });
    row++;
  };

  const writeSection = (days: Weekday[], stepMin: number) => {
    const acts = timetable.activities.filter((a) => days.includes(a.weekday));
    if (acts.length === 0) return;
    head(["Time", ...days.map((d) => WEEKDAY_NAMES[d])]);
    let lo = Math.min(...acts.map((a) => a.startTime));
    let hi = Math.max(...acts.map((a) => a.endTime));
    lo = Math.floor(lo / 60) * 60;
    hi = Math.ceil(hi / 60) * 60;
    const rows: number[] = [];
    for (let t = lo; t < hi; t += stepMin) rows.push(t);
    // Map activity → row span.
    const startRow = row;
    for (const t of rows) {
      ws.getCell(row, 1).value = label12(t, t + stepMin);
      ws.getCell(row, 1).alignment = { horizontal: "center", vertical: "middle" };
      row++;
    }
    for (const a of acts) {
      const col = days.indexOf(a.weekday) + 2;
      const r1 = startRow + Math.round((a.startTime - lo) / stepMin);
      const r2 = startRow + Math.round((a.endTime - lo) / stepMin) - 1;
      if (r2 < r1) continue;
      const cat = catOf(a.categoryId);
      for (let r = r1; r <= r2; r++) {
        const c = ws.getCell(r, col);
        c.value = a.name.trim() || cat?.name || "";
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(cat?.colour ?? "#E0E0E0") } };
        c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
        c.border = thinBorder();
      }
      if (r2 > r1) {
        try {
          ws.mergeCells(r1, col, r2, col);
        } catch { /* ignore */ }
      }
    }
    // Daily summaries from our own union totals.
    const totals = allDayTotals(timetable.activities, categories);
    row++;
    ws.getCell(row, 1).value = "Study Time:";
    ws.getCell(row, 1).font = { bold: true };
    days.forEach((d, i) => {
      ws.getCell(row, i + 2).value = formatDuration(totals[d].study);
    });
    row++;
    ws.getCell(row, 1).value = "Optional Extra:";
    ws.getCell(row, 1).font = { bold: true };
    days.forEach((d, i) => {
      ws.getCell(row, i + 2).value = formatDuration(totals[d].optionalWork);
    });
    row += 2;
  };

  writeSection([0, 1, 2, 3, 4], 15);
  const weekend = timetable.activities.filter((a) => a.weekday === 5 || a.weekday === 6);
  if (weekend.length > 0) writeSection([5, 6], 60);

  // Legend.
  ws.getCell(row, 1).value = "Key:";
  ws.getCell(row, 1).font = { bold: true };
  row++;
  for (const c of categories) {
    ws.getCell(row, 1).value = `${c.icon} ${c.name}`;
    ws.getCell(row, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(c.colour) } };
    row++;
  }

  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as unknown as ArrayBuffer);
}
