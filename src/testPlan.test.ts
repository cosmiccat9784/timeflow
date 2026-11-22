import { describe, expect, it } from "vitest";
import { isAligned, snapToSlot, parseTimeInput, formatTime, formatDuration, isValidDuration, clampDay, SLOT } from "./time";
import { validateActivity, validateCategories, validateDeadline } from "./validation";
import { DEFAULT_CATEGORIES } from "./categories";
import { computeMergedBlocks } from "./merge";
import { findConflicts, assignLanes, overlaps } from "./conflicts";
import { dayTotals, weekTotals, unionMinutes } from "./totals";
import { daysUntil, relativeLabel, sortByNearness, nextWeekdayDate } from "./deadlines";
import { mondayOfWeek, weekIdFor, currentWeekId, recordKey, freshWeekRecord, withCompletion, withMinutes, withDelivered, timerElapsedSec, formatElapsed } from "./records";
import { computeDueReminders } from "./reminders";
import { createBackup, parseBackup } from "./backup";
import { migrateState, defaultSettings, defaultState, APP_VERSION } from "./store";
import { UndoStack } from "./undo";
import { displayName } from "./types";
import type { Activity } from "./types";
import * as fs from "fs";
import * as path from "path";

function act(o: Partial<Activity> & {id:string}): Activity {
  return { name:"Study", categoryId:"study", weekday:1 as Activity["weekday"], startTime:960, endTime:990, createdAt:"", updatedAt:"", ...o } as Activity;
}
function readSrc(p:string){ return fs.readFileSync(path.join(process.cwd(), p), "utf8"); }

describe("TF Time parsing 001-022", () => {
  it("TF-001 midnight and 24:00", () => { expect(parseTimeInput("12:00 am")).toBe(0); expect(parseTimeInput("24:00")).toBe(1440); });
  it("TF-002 every 15min", () => { for(let m=0;m<=1440;m+=15) expect(isAligned(m)).toBe(true); });
  it("TF-003 reject non-15", () => { expect(isAligned(7)).toBe(false); expect(isAligned(22)).toBe(false); });
  it("TF-006-008 parse 12/24h", () => { expect(parseTimeInput("8:15 am")).toBe(495); expect(parseTimeInput("4:45 pm")).toBe(1005); expect(parseTimeInput("16:45")).toBe(1005); });
  it("TF-009 12am zero", () => { expect(parseTimeInput("12:00 am")).toBe(0); });
  it("TF-010 12pm 720", () => { expect(parseTimeInput("12:00 pm")).toBe(720); });
  it("TF-015-018 format", () => { expect(formatTime(0,"12h")).toMatch(/12:00/); expect(formatDuration(60)).toMatch(/1h/); });
  it("TF-022 duration", () => { expect(isValidDuration(960,975)).toBe(true); expect(isValidDuration(960,965)).toBe(false); });
  it("TF-004 clamp", () => { expect(clampDay(-5)).toBe(0); expect(clampDay(1500)).toBe(1440); });
  it("TF-019 slot labels", () => { expect(snapToSlot(970)).toBe(975); });
});

describe("TF Activity validation 023-046 P0", () => {
  it("TF-023 valid", () => { expect(validateActivity(act({id:"a"}), DEFAULT_CATEGORIES)).toHaveLength(0); });
  it("TF-024 empty name allowed", () => { expect(validateActivity(act({id:"a", name:""}), DEFAULT_CATEGORIES)).toHaveLength(0); });
  it("TF-025 bad category", () => { expect(validateActivity(act({id:"a", categoryId:"nope"}), DEFAULT_CATEGORIES).length).toBeGreaterThan(0); });
  it("TF-026 weekday bounds", () => { expect(validateActivity(act({id:"a", weekday: -1 as any}), DEFAULT_CATEGORIES).length).toBeGreaterThan(0); });
  it("TF-030 end equal start", () => { expect(validateActivity(act({id:"a", startTime:960, endTime:960}), DEFAULT_CATEGORIES).length).toBeGreaterThan(0); });
  it("TF-034 short duration", () => { expect(validateActivity(act({id:"a", startTime:960, endTime:965}), DEFAULT_CATEGORIES).length).toBeGreaterThan(0); });
  it("TF-038 override", () => { expect(validateActivity(act({id:"a", optionalWorkOverride:"bad" as any}), DEFAULT_CATEGORIES).length).toBeGreaterThan(0); });
  it("TF-040 reminder lead", () => { expect(validateActivity(act({id:"a", reminderPreferences:{startEnabled:true,endEnabled:true,startLeadMinutes:-1,endLeadMinutes:5} as any}), DEFAULT_CATEGORIES).length).toBeGreaterThan(0); });
});

describe("TF Deadlines 097-119", () => {
  it("TF-097 valid date", () => { expect(validateDeadline({title:"t", date:"2026-11-20"}).length).toBe(0); });
  it("TF-098 missing title", () => { expect(validateDeadline({title:"", date:"2026-11-20"}).length).toBeGreaterThan(0); });
  it("TF-105 daysUntil zero", () => { expect(daysUntil("2026-11-03","2026-11-03")).toBe(0); });
  it("TF-113 Today label", () => { expect(relativeLabel(0)).toBe("Today"); });
  it("TF-116 sort", () => { const items=[{date:"2026-11-10",name:"f"} as any,{date:"2026-10-28",name:"o"} as any]; expect(sortByNearness(items,"2026-11-03")[0].name).toBe("o"); });
  it("TF-118 next weekday", () => { expect(nextWeekdayDate(1 as any, new Date("2026-11-20"))).toMatch(/2026-/); });
});

describe("TF Week records 120-146 P0", () => {
  it("TF-120 monday", () => { expect(weekIdFor(new Date("2026-11-16"))).toBe("2026-11-16"); });
  it("TF-124 record keys distinct", () => { expect(recordKey("a","2026-11-16")).not.toBe(recordKey("b","2026-11-16")); });
  it("TF-126 fresh", () => { const r=freshWeekRecord("tt","2026-11-16"); expect(r.completed).toEqual({}); });
  it("TF-127 completion", () => { let r=freshWeekRecord("tt","2026-11-16"); r=withCompletion(r,"a",true); expect(r.completed["a"].done).toBe(true); });
  it("TF-138 timer", () => { const t={running:true, accumulatedSec:10, startedAtEpochMs:1000000, activityId:"a", timetableId:"t"} as any; expect(timerElapsedSec(t,1000000+5000)).toBe(15); });
  it("TF-141 formatElapsed", () => { expect(formatElapsed(3661)).toMatch(/1:01:01/); });
});

describe("TF Reminders 147-170 - with visible window", () => {
  it("TF-162 quiet hours suppress", () => {
    const s={...defaultSettings(), quietHours:{start:0,end:1440}, reminderDefaults:{startLead:5,endLead:5,atEnd:true}} as any;
    const acts=[act({id:"a", weekday:1, startTime:600, endTime:660})];
    const now=new Date(); now.setHours(12,0,0,0);
    expect(computeDueReminders(acts, DEFAULT_CATEGORIES, s, undefined, 1, now, new Set(), "12h")).toHaveLength(0);
  });
  it("reminders respect visible window", () => {
    const s={...defaultSettings(), visibleStartMinutes:360, visibleEndMinutes:1320, reminderDefaults:{startLead:5,endLead:5,atEnd:true}} as any;
    const acts=[act({id:"a", weekday:1, startTime:60, endTime:120})]; // 1am outside 6am-10pm
    const now=new Date(); now.setHours(1,0,0,0);
    // even if due, should be suppressed because outside visible window
    const due=computeDueReminders(acts, DEFAULT_CATEGORIES, s, undefined, 1, now, new Set(), "12h");
    expect(due.length).toBe(0);
  });
});

describe("TF Persistence 171-182", () => {
  it("TF-171 default state", () => { expect(defaultState().timetables.length).toBe(1); });
  it("TF-173 malformed JSON", () => { expect(migrateState(null)).toBeNull(); });
  it("TF-180 defaults", () => { expect(defaultSettings().appVersion).toBe(APP_VERSION); });
  it("TF- backup roundtrip", () => { const s=defaultState(); const txt=createBackup(s); expect(parseBackup(txt).ok).toBe(true); });
});

describe("TF Totals/conflicts - overlaps removed visually but logic still tested", () => {
  it("TF-067 single study", () => { const t=dayTotals([act({id:"1", categoryId:"study", startTime:960, endTime:1020})], DEFAULT_CATEGORIES, 1); expect(t.study).toBe(60); });
  it("TF-069 no double count", () => { const t=dayTotals([act({id:"1", categoryId:"study", startTime:960, endTime:1020}), act({id:"2", categoryId:"study", startTime:960, endTime:1020})], DEFAULT_CATEGORIES, 1); expect(t.study).toBe(60); });
  // Overlaps visual border removed - skip visual test, keep logic
  it.skip("TF-088 visual lane - skipped, overlaps border removed", () => {});
  it("TF-091 merge adjacent", () => { const b=computeMergedBlocks([act({id:"a", startTime:960, endTime:990}), act({id:"b", startTime:990, endTime:1020})]); expect(b).toHaveLength(1); });
  it("TF-095 no bridge gap", () => { const b=computeMergedBlocks([act({id:"a", startTime:960, endTime:990}), act({id:"b", startTime:1005, endTime:1020})]); expect(b).toHaveLength(2); });
});

describe("TF UI - removed features should not exist", () => {
  it("tip banner removed", () => { const app=readSrc("src/App.tsx"); expect(app).not.toContain("Tip: click to select"); });
  it("overlaps card removed", () => { const app=readSrc("src/App.tsx"); expect(app).not.toContain("2 OVERLAPS"); expect(app).not.toContain("Show details"); });
  it("resize handles removed", () => { const grid=readSrc("src/components/PlannerGrid.tsx"); expect(grid).not.toContain("resize-handle"); });
  it("V2 labels removed", () => { const ed=readSrc("src/components/ActivityEditor.tsx"); expect(ed).not.toContain("stored now, fired in V2"); expect(ed).not.toContain("V2 scheduling"); });
});

describe("TF Print one page", () => {
  it("print CSS single page", () => {
    const css=readSrc("src/styles.css");
    expect(css).toContain("@media print");
    expect(css).toContain("zoom: 0.75");
    expect(css).toContain("size: A4 landscape");
    expect(css).not.toContain("Ã");
  });
});

describe("TF Settings and ActivityEditor visible window", () => {
  it("settings modal larger", () => { const css=readSrc("src/styles.css"); expect(css).toContain("min(760px"); });
  it("ActivityEditor shows only visible hours", () => {
    const ed=readSrc("src/components/ActivityEditor.tsx");
    expect(ed).toContain("visibleStart");
    expect(ed).toContain("visibleEnd");
    expect(ed).toContain("Clear selection");
  });
  it("edit uses same picker as new", () => {
    const ed=readSrc("src/components/ActivityEditor.tsx");
    // both branches should have TimeRangePicker
    const count=(ed.match(/<TimeRangePicker/g)||[]).length;
    expect(count).toBeGreaterThanOrEqual(2);
  });
});

describe("TF Esc closes menu before focus", () => {
  it("App.tsx Esc handler checks menus before focus", () => {
    const app=readSrc("src/App.tsx");
    expect(app).toContain("if (menu) { setMenu(null)");
    expect(app).toContain("if (focusMode) { setFocusMode(false)");
    // ensure menu check comes before focusMode
    expect(app.indexOf("if (menu)")).toBeLessThan(app.indexOf("if (focusMode)"));
  });
});

describe("TF Offline Inter", () => {
  it("no googleapis", () => { const css=readSrc("src/styles.css"); expect(css).not.toContain("fonts.googleapis.com"); });
});

describe("TF Undo", () => {
  it("checkpoint", () => {
    const s=new UndoStack(); const snap={timetables:[], categories:[]};
    s.checkpoint("add", snap as any); expect(s.canUndo).toBe(true);
  });
});
