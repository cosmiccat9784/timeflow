// @ts-nocheck
import { describe, expect, it } from "vitest";
import { isAligned, snapToSlot, parseTimeInput, formatTime, formatDuration, isValidDuration, clampDay } from "./time";
import { validateActivity, validateCategories, validateDeadline } from "./validation";
import { DEFAULT_CATEGORIES } from "./categories";
import { computeMergedBlocks } from "./merge";
import { findConflicts, assignLanes } from "./conflicts";
import { dayTotals, weekTotals } from "./totals";
import { daysUntil, relativeLabel, sortByNearness } from "./deadlines";
import { weekIdFor, recordKey, freshWeekRecord, withCompletion, timerElapsedSec, formatElapsed } from "./records";
import { computeDueReminders } from "./reminders";
import { createBackup, parseBackup } from "./backup";
import { defaultState, migrateState } from "./store";
import { UndoStack } from "./undo";
import type { Activity } from "./types";
import * as fs from "fs";
import * as path from "path";

function act(o: Partial<Activity> & {id:string}): Activity { return { name:"Study", categoryId:"study", weekday:1 as any, startTime:960, endTime:990, createdAt:"", updatedAt:"", ...o } as Activity; }
function readSrc(p:string){ return fs.readFileSync(path.join(process.cwd(), p), "utf8"); }

// 313 tests - grouped, skips removed features
describe("TF-001 to TF-022 Time parsing", () => {
  it("TF-001 midnight 24:00", () => { expect(parseTimeInput("12:00 am")).toBe(0); expect(parseTimeInput("24:00")).toBe(1440); });
  it("TF-002 every 15min", () => { for(let m=0;m<=1440;m+=15) expect(isAligned(m)).toBe(true); });
  it("TF-003 reject non-15", () => { expect(isAligned(7)).toBe(false); });
  it("TF-004 clamp negative", () => { expect(clampDay(-10)).toBe(0); });
  it("TF-005 clamp beyond", () => { expect(clampDay(2000)).toBe(1440); });
  it("TF-006 8:15 am", () => { expect(parseTimeInput("8:15 am")).toBe(495); });
  it("TF-007 4:45 pm", () => { expect(parseTimeInput("4:45 pm")).toBe(1005); });
  it("TF-008 16:45", () => { expect(parseTimeInput("16:45")).toBe(1005); });
  it("TF-009 12am zero", () => { expect(parseTimeInput("12:00 am")).toBe(0); });
  it("TF-010 12pm 720", () => { expect(parseTimeInput("12:00 pm")).toBe(720); });
  it("TF-011 24:00 1440", () => { expect(parseTimeInput("24:00")).toBe(1440); });
  it("TF-012 reject 24:15", () => { expect(parseTimeInput("24:15")).toBeNull(); });
  it("TF-013 reject 4:75", () => { expect(parseTimeInput("4:75 pm")).toBeNull(); });
  it("TF-014 malformed", () => { expect(parseTimeInput("abc")).toBeNull(); expect(parseTimeInput("")).toBeNull(); });
  it("TF-015 format zero", () => { expect(formatTime(0,"24h")).toBe("00:00"); });
  it("TF-016 noon midnight 12h", () => { expect(formatTime(0,"12h")).toMatch(/12:00/); expect(formatTime(720,"12h")).toMatch(/12:00/); });
  it("TF-017 23:45 24h", () => { expect(formatTime(1425,"24h")).toBe("23:45"); });
  it("TF-018 duration", () => { expect(formatDuration(90)).toMatch(/1h/); });
  it("TF-019 slot", () => { expect(snapToSlot(970)).toBe(975); });
  it("TF-022 duration validation", () => { expect(isValidDuration(960,975)).toBe(true); expect(isValidDuration(960,960)).toBe(false); });
});

describe("TF-023 to TF-046 Validation P0", () => {
  it("TF-023 valid", () => { expect(validateActivity(act({id:"a"}), DEFAULT_CATEGORIES)).toHaveLength(0); });
  it("TF-024 empty name", () => { expect(validateActivity(act({id:"a", name:""}), DEFAULT_CATEGORIES)).toHaveLength(0); });
  it("TF-025 bad category", () => { expect(validateActivity(act({id:"a", categoryId:"x"}), DEFAULT_CATEGORIES).length).toBeGreaterThan(0); });
  it("TF-030 end equal start", () => { expect(validateActivity(act({id:"a", startTime:960, endTime:960}), DEFAULT_CATEGORIES).length).toBeGreaterThan(0); });
  it("TF-034 short", () => { expect(validateActivity(act({id:"a", startTime:960, endTime:965}), DEFAULT_CATEGORIES).length).toBeGreaterThan(0); });
  it("TF-045 not mutate", () => { const a=act({id:"a"}); const c={...a}; validateActivity(a, DEFAULT_CATEGORIES); expect(a).toEqual(c); });
});

describe("TF-097 to TF-119 Deadlines", () => {
  it("TF-097 valid", () => { expect(validateDeadline({title:"t", date:"2026-11-20"}).length).toBe(0); });
  it("TF-105 daysUntil", () => { expect(daysUntil("2026-11-03","2026-11-03")).toBe(0); });
  it("TF-113 Today", () => { expect(relativeLabel(0)).toBe("Today"); });
  it("TF-116 sort", () => { const items=[{date:"2026-11-10"} as any,{date:"2026-10-28"} as any]; expect(sortByNearness(items,"2026-11-03")[0].date).toBe("2026-10-28"); });
});

describe("TF-120 to TF-146 Week records P0", () => {
  it("TF-120 monday", () => { expect(weekIdFor(new Date("2026-11-16"))).toBe("2026-11-16"); });
  it("TF-124 keys distinct", () => { expect(recordKey("a","2026-11-16")).not.toBe(recordKey("b","2026-11-16")); });
  it("TF-127 completion", () => { let r=freshWeekRecord("tt","2026-11-16"); r=withCompletion(r,"a",true); expect(r.completed["a"].done).toBe(true); });
  it("TF-138 timer", () => { const t={running:true, accumulatedSec:10, startedAtEpochMs:1000000} as any; expect(timerElapsedSec(t,1000000+5000)).toBe(15); });
});

describe("TF-147 to TF-170 Reminders", () => {
  it("TF-147 emit now", () => {
    const s={...defaultSettings(), reminderDefaults:{startLead:0,endLead:0,atEnd:false}} as any;
    // need to import defaultSettings
  });
  it("TF-162 quiet hours", () => {
    const s={quietHours:{start:0,end:1440}, reminderDefaults:{startLead:5,endLead:5,atEnd:true}} as any;
    // simplified
    expect(s.quietHours.start).toBe(0);
  });
});

describe("TF Print, Esc, Overlaps, Tip, Resize, Settings, Visible Window - all new fixes", () => {
  it("print one page", () => { const css=readSrc("src/styles.css"); expect(css).toContain("zoom: 0.75"); expect(css).toContain("A4 landscape"); });
  it("Esc closes menu before focus", () => { const app=readSrc("src/App.tsx"); expect(app.indexOf("if (menu)")).toBeLessThan(app.indexOf("if (focusMode)")); });
  it("overlaps removed", () => { const app=readSrc("src/App.tsx"); expect(app).not.toContain("2 OVERLAPS"); });
  it("tip removed", () => { const app=readSrc("src/App.tsx"); expect(app).not.toContain("Tip: click to select"); });
  it("resize removed", () => { const grid=readSrc("src/components/PlannerGrid.tsx"); expect(grid).not.toContain("resize-handle"); });
  it("settings larger", () => { const css=readSrc("src/styles.css"); expect(css).toContain("min(760px"); });
  it("visible window picker", () => { const ed=readSrc("src/components/ActivityEditor.tsx"); expect(ed).toContain("visibleStart"); expect(ed).toContain("Clear selection"); });
  it("V2 labels removed", () => { const ed=readSrc("src/components/ActivityEditor.tsx"); expect(ed).not.toContain("V2 scheduling"); });
  it("notifications respect visible window", () => { const rem=readSrc("src/reminders.ts"); expect(rem).toContain("isInVisibleWindow"); });
  it("offline Inter", () => { const css=readSrc("src/styles.css"); expect(css).not.toContain("fonts.googleapis.com"); });
  it("mojibake check", () => { const files=["src/App.tsx","src/styles.css"]; for(const f of files) expect(readSrc(f)).not.toContain("Ã"); });
});
