import { describe, expect, it } from "vitest";
import { parseTimeLabel, isDurationText } from "./importExcel";
import { activitiesToCsv, parseCsv, weekdayFromCsvName, minutesFromCsvTime } from "./exportCsv";
import type { Activity } from "./types";
import { DEFAULT_CATEGORIES } from "./categories";

describe("reference workbook time labels (spec §16, inspected 2026-10-14)", () => {
  it("parses 15-minute ranges", () => {
    expect(parseTimeLabel("3:30 - 3:45", true).range).toEqual({ start: 930, end: 945 });
  });

  it("parses hourly weekend labels with shared meridiem", () => {
    expect(parseTimeLabel("6 - 7 AM", false).range).toEqual({ start: 360, end: 420 });
    expect(parseTimeLabel("11 AM - 12 PM", false).range).toEqual({ start: 660, end: 720 });
    expect(parseTimeLabel("8-9 PM", false).range).toEqual({ start: 1200, end: 1260 });
  });

  it("assumes PM for bare times when the sheet uses PM", () => {
    const r = parseTimeLabel("3:30 - 3:45", true);
    expect(r.range?.start).toBe(930);
    expect(r.periodUsed).toBe(true);
  });

  it("rejects non-times like Before School", () => {
    expect(parseTimeLabel("Before School", true).range).toBeNull();
    expect(parseTimeLabel("Study Time:", true).range).toBeNull();
  });

  it("detects summary cells", () => {
    expect(isDurationText("1 hr 15 min")).toBe(true);
    expect(isDurationText("1hr")).toBe(true);
    expect(isDurationText("2 hrs")).toBe(true);
    expect(isDurationText("0 min")).toBe(true);
    expect(isDurationText("Study Time:")).toBe(true);
    expect(isDurationText("Band")).toBe(false);
  });
});

describe("CSV export/import round trip (§17.2)", () => {
  const acts: Activity[] = [
    {
      id: "a1", name: 'Piano, "advanced"', categoryId: "band", weekday: 1,
      startTime: 1020, endTime: 1050, subject: "Music", notes: "line1\nline2",
      createdAt: "", updatedAt: "",
    },
    {
      id: "a2", name: "", categoryId: "work", weekday: 4,
      startTime: 1020, endTime: 1140, optionalWorkOverride: "yes",
      createdAt: "", updatedAt: "",
    },
  ];

  it("escapes commas, quotes and newlines", () => {
    const csv = activitiesToCsv(acts, DEFAULT_CATEGORIES);
    const rows = parseCsv(csv);
    expect(rows[0]).toEqual(["Name", "Weekday", "Start", "End", "Category", "Subject", "Notes", "OptionalWork"]);
    expect(rows[1][0]).toBe('Piano, "advanced"');
    expect(rows[1][6]).toBe("line1\nline2");
    expect(rows[2][0]).toBe("");
    expect(rows).toHaveLength(3);
  });

  it("parses days and times", () => {
    expect(weekdayFromCsvName("Tuesday")).toBe(1);
    expect(weekdayFromCsvName("sat")).toBe(5);
    expect(weekdayFromCsvName("Funday")).toBeNull();
    expect(minutesFromCsvTime("17:00")).toBe(1020);
    expect(minutesFromCsvTime("5:00 pm")).toBe(1020);
    expect(minutesFromCsvTime("abc")).toBeNull();
  });
});
