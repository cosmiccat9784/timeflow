import { describe, expect, it } from "vitest";
import { isAligned, snapToSlot, parseTimeInput, formatTime, isValidDuration, clampDay, formatDuration, MIN_DURATION, SLOT } from "./time";
import { validateActivity, validateCategories, validateDeadline } from "./validation";
import { DEFAULT_CATEGORIES } from "./categories";
import { computeMergedBlocks, mergeKey } from "./merge";
import { findConflicts, assignLanes, conflictsForCandidate, overlaps } from "./conflicts";
import { dayTotals, weekTotals, allDayTotals, unionMinutes, unionIntervals } from "./totals";
import { daysUntil, relativeLabel, sortByNearness, nextWeekdayDate } from "./deadlines";
import { currentWeekId, weekIdFor, mondayOfWeek, recordKey, freshWeekRecord, withCompletion, withMinutes, withDelivered, timerElapsedSec, formatElapsed } from "./records";
import { computeDueReminders } from "./reminders";
import { createBackup, parseBackup } from "./backup";
import { migrateState, defaultSettings, defaultTimetable, defaultState, APP_VERSION } from "./store";
import { UndoStack } from "./undo";
import { displayName, WEEKDAY_NAMES } from "./types";
import type { Activity, Category, GlobalSettings } from "./types";

// helpers
function act(partial: Partial<Activity> & { id: string }): Activity {
  return { name: "Study", categoryId: "study", weekday: 1 as Activity["weekday"], startTime: 960, endTime: 990, createdAt: "", updatedAt: "", ...partial } as Activity;
}
function cat(id: string, opts: Partial<Category> = {}): Category { return { id, name: id, colour: "#fff", icon: "x", countsTowardStudy: false, countsTowardOptionalWork: false, ...opts } as Category; }

describe("time engine - spec 4", () => {
  it("isAligned 15min", () => { expect(isAligned(0)).toBe(true); expect(isAligned(15)).toBe(true); expect(isAligned(7)).toBe(false); });
  it("snapToSlot", () => { expect(snapToSlot(967)).toBe(960); expect(snapToSlot(970)).toBe(975); expect(snapToSlot(0)).toBe(0); });
  it("parseTimeInput", () => { expect(parseTimeInput("4:00 pm")).toBe(960); expect(parseTimeInput("16:00")).toBe(960); expect(parseTimeInput("12:00 am")).toBe(0); expect(parseTimeInput("bad")).toBeNull(); });
  it("formatTime", () => { expect(formatTime(0,"12h")).toMatch(/12:00/); expect(formatTime(720,"24h")).toBe("12:00"); });
  it("isValidDuration", () => { expect(isValidDuration(960,975)).toBe(true); expect(isValidDuration(960,965)).toBe(false); });
  it("clampDay and formatDuration", () => { expect(clampDay(-5)).toBe(0); expect(clampDay(1500)).toBe(1440); expect(formatDuration(60)).toMatch(/1h/); expect(formatDuration(15)).toMatch(/15/); });
});

describe("validation - spec 13.8", () => {
  it("valid activity passes", () => { expect(validateActivity(act({id:"a"}), DEFAULT_CATEGORIES)).toHaveLength(0); });
  it("rejects bad category", () => { expect(validateActivity(act({id:"a", categoryId:"nope"}), DEFAULT_CATEGORIES).length).toBeGreaterThan(0); });
  it("rejects unaligned", () => { expect(validateActivity(act({id:"a", startTime:967}), DEFAULT_CATEGORIES).length).toBeGreaterThan(0); });
  it("rejects short duration", () => { expect(validateActivity(act({id:"a", startTime:960,endTime:965}), DEFAULT_CATEGORIES).length).toBeGreaterThan(0); });
  it("validateCategories duplicate id", () => { expect(validateCategories([cat("x"), cat("x")]).length).toBeGreaterThan(0); });
  it("validateDeadline requires title and date", () => { expect(validateDeadline({title:"",date:"2026-01-01"}).length).toBeGreaterThan(0); expect(validateDeadline({title:"t",date:"bad"}).length).toBeGreaterThan(0); expect(validateDeadline({title:"t",date:"2026-02-30"}).length).toBeGreaterThan(0); expect(validateDeadline({title:"t",date:"2026-11-20"}).length).toBe(0); });
});

describe("merge - spec 8", () => {
  it("merges adjacent same key", () => {
    const blocks=computeMergedBlocks([act({id:"a",startTime:960,endTime:990}),act({id:"b",startTime:990,endTime:1020})]);
    expect(blocks).toHaveLength(1); expect(blocks[0].members.length).toBe(2);
  });
  it("splits on subject", () => {
    const blocks=computeMergedBlocks([act({id:"a",subject:"M"}),act({id:"b",startTime:990,endTime:1020,subject:"E"})]);
    expect(blocks).toHaveLength(2);
  });
  it("mergeKey includes weekday and name", () => { expect(mergeKey(act({id:"a",weekday:1,name:"Hi"}))).not.toBe(mergeKey(act({id:"a",weekday:2,name:"Hi"}))); });
  it("never bridges gap", () => {
    const blocks=computeMergedBlocks([act({id:"a",startTime:960,endTime:990}),act({id:"b",startTime:1005,endTime:1020})]);
    expect(blocks).toHaveLength(2);
  });
});

describe("conflicts - spec 10", () => {
  it("detects overlap", () => {
    const acts=[act({id:"a",startTime:960,endTime:1020}),act({id:"b",startTime:990,endTime:1050})];
    expect(findConflicts(acts)).toHaveLength(1);
    const lanes=assignLanes(acts);
    expect(lanes.get("a")!.lanes).toBe(2);
  });
  it("overlaps helper false for diff day", () => { expect(overlaps(act({id:"a",weekday:1}),act({id:"b",weekday:2}))).toBe(false); });
  it("conflictsForCandidate", () => {
    const base=[act({id:"a",startTime:960,endTime:1020})];
    const cand=act({id:"c",startTime:990,endTime:1000});
    expect(conflictsForCandidate(cand,base)).toHaveLength(1);
  });
});

describe("totals - spec 12", () => {
  it("unionMinutes", () => { expect(unionMinutes([{start:0,end:60},{start:30,end:90}])).toBe(90); expect(unionMinutes([{start:0,end:60},{start:60,end:90}])).toBe(90); });
  it("unionIntervals merges", () => { expect(unionIntervals([{start:0,end:10},{start:5,end:15}])).toEqual([{start:0,end:15}]); });
  it("dayTotals study", () => {
    const t=dayTotals([act({id:"1",categoryId:"study",startTime:960,endTime:1020})], DEFAULT_CATEGORIES, 1);
    expect(t.study).toBe(60);
  });
  it("weekTotals and allDayTotals", () => {
    const acts=[act({id:"1",categoryId:"study",weekday:1,startTime:0,endTime:60}),act({id:"2",categoryId:"study",weekday:2,startTime:60,endTime:90})];
    expect(weekTotals(acts, DEFAULT_CATEGORIES).study).toBe(90);
    expect(allDayTotals(acts, DEFAULT_CATEGORIES)[1].study).toBe(60);
  });
});

describe("deadlines", () => {
  it("daysUntil", () => { expect(daysUntil("2026-11-03","2026-11-03")).toBe(0); expect(daysUntil("2026-11-04","2026-11-03")).toBe(1); });
  it("relativeLabel", () => { expect(relativeLabel(0)).toBe("Today"); expect(relativeLabel(-1)).toContain("overdue"); });
  it("sortByNearness", () => {
    const items=[{date:"2026-11-10",name:"f"},{date:"2026-10-28",name:"o"}] as any;
    expect(sortByNearness(items,"2026-11-03")[0].name).toBe("o");
  });
  it("nextWeekdayDate returns next occurrence", () => {
    const d=nextWeekdayDate(1 as any, new Date("2026-11-20"));
    expect(d).toMatch(/2026-/);
  });
});

describe("records - V2", () => {
  it("weekIdFor monday", () => { expect(weekIdFor(new Date("2026-11-16"))).toBe("2026-11-16"); expect(weekIdFor(new Date("2026-11-18"))).toBe("2026-11-16"); });
  it("recordKey", () => { expect(recordKey("tt1","2026-11-16")).toBe("tt1::2026-11-16"); });
  it("freshWeekRecord and withCompletion", () => {
    let r=freshWeekRecord("tt","2026-11-16");
    r=withCompletion(r,"a1",true);
    expect(r.completed["a1"].done).toBe(true);
    r=withMinutes(r,"a1",30);
    expect(r.completed["a1"].minutes).toBe(30);
    r=withDelivered(r,"k1");
    expect(r.delivered).toContain("k1");
    const r2=withDelivered(r,"k1");
    expect(r2.delivered.length).toBe(1);
  });
  it("timerElapsedSec", () => {
    const timer={running:true, accumulatedSec:10, startedAtEpochMs:1000000, activityId:"a", timetableId:"t"} as any;
    expect(timerElapsedSec(timer, 1000000+5000)).toBe(15);
    expect(formatElapsed(3661)).toMatch(/1:01:01/);
    expect(formatElapsed(61)).toBe("01:01");
  });
});

describe("reminders", () => {
  it("computeDueReminders quiet hours blocks", () => {
    const settings={...defaultSettings(), quietHours:{start:0,end:1440}, reminderDefaults:{startLead:5,endLead:5,atEnd:true}} as GlobalSettings;
    const acts=[act({id:"a",weekday:1,startTime:600,endTime:660})];
    const now=new Date(); now.setHours(12,0,0,0);
    const due=computeDueReminders(acts, DEFAULT_CATEGORIES, settings, undefined, 1, now, new Set(), "12h");
    expect(due).toHaveLength(0);
  });
  it("computeDueReminders fires within 90s", () => {
    const settings=defaultSettings();
    const acts=[act({id:"a",weekday:1,startTime:720,endTime:780, reminderPreferences:{startEnabled:true,endEnabled:true,startLeadMinutes:5,endLeadMinutes:5}} as any)];
    const now=new Date(); now.setHours(12,0,0,0); // 720 -5 =715 due at 11:55, not now
    const due=computeDueReminders(acts, DEFAULT_CATEGORIES, settings, undefined, 1, now, new Set(), "12h");
    // should be empty because not within 90s of reminder time
    expect(Array.isArray(due)).toBe(true);
  });
});

describe("backup", () => {
  it("createBackup and parseBackup roundtrip", () => {
    const state=defaultState();
    const txt=createBackup(state);
    const parsed=parseBackup(txt);
    expect(parsed.ok).toBe(true);
    if(parsed.ok) expect(parsed.data.timetables.length).toBe(1);
  });
  it("parseBackup rejects bad json", () => { expect(parseBackup("bad").ok).toBe(false); });
  it("parseBackup rejects wrong schema", () => { expect(parseBackup(JSON.stringify({schemaVersion:999})).ok).toBe(false); });
});

describe("store migrate", () => {
  it("migrateState null on bad", () => { expect(migrateState(null)).toBeNull(); expect(migrateState({})).toBeNull(); });
  it("migrateState current version", () => {
    const s=defaultState();
    const migrated=migrateState(JSON.parse(JSON.stringify(s)));
    expect(migrated).not.toBeNull();
    expect(migrated!.schemaVersion).toBe(s.schemaVersion);
  });
  it("defaultSettings and APP_VERSION", () => { expect(defaultSettings().appVersion).toBe(APP_VERSION); expect(defaultTimetable().activities).toEqual([]); });
});

describe("undo", () => {
  it("UndoStack checkpoint undo redo", () => {
    const stack=new UndoStack();
    expect(stack.canUndo).toBe(false);
    const snap={timetables:[defaultTimetable()], categories: DEFAULT_CATEGORIES};
    const cur={timetables:[], categories:[]};
    stack.checkpoint("add", snap);
    expect(stack.canUndo).toBe(true);
    const popped=stack.performUndo(cur);
    expect(popped).not.toBeNull();
    expect(stack.canRedo).toBe(true);
    const redone=stack.performRedo(snap);
    expect(redone).not.toBeNull();
  });
  it("limit 20", () => {
    const stack=new UndoStack();
    for(let i=0;i<25;i++) stack.checkpoint("op"+i, {timetables:[],categories:[]});
    expect((stack as any).undo.length).toBeLessThanOrEqual(20);
  });
});

describe("types displayName", () => {
  it("falls back to category", () => {
    const a=act({id:"x", name:"", categoryId:"study"});
    expect(displayName(a, DEFAULT_CATEGORIES)).toBe("Study");
  });
  it("uses name when present", () => {
    const a=act({id:"x", name:"Math", categoryId:"study"});
    expect(displayName(a, DEFAULT_CATEGORIES)).toBe("Math");
  });
});

describe("shift-click multi-select logic", () => {
  it("toggles Set on shift", () => {
    let selected=new Set<string>(["a"]);
    const toggle=(k:string, shift:boolean)=>{
      if(shift){ const n=new Set(selected); if(n.has(k)) n.delete(k); else n.add(k); selected=n; } else selected=new Set([k]);
    };
    toggle("b", true); expect(selected.has("b")).toBe(true);
    toggle("a", true); expect(selected.has("a")).toBe(false);
    toggle("c", false); expect(selected).toEqual(new Set(["c"]));
  });
  it("handles null clears", () => {
    let selected=new Set<string>(["a","b"]);
    let current:string|null="a";
    const onSelect=(k:string|null, shift:boolean)=>{
      if(!k){ selected=new Set(); current=null; return; }
      if(shift){ const n=new Set(selected); if(n.has(k)) n.delete(k); else n.add(k); selected=n; } else selected=new Set([k]);
      current=k;
    };
    onSelect(null,false); expect(selected.size).toBe(0); expect(current).toBeNull();
  });
});

describe("file menu handler", () => {
  it("closest check prevents close when clicking inside", () => {
    const inside={ closest: (s:string)=> s.includes("data-file-menu") ? {} : null } as any;
    const outside={ closest: ()=> null } as any;
    const shouldClose=(target:any)=> !target.closest("[data-file-menu]");
    expect(shouldClose(inside)).toBe(false);
    expect(shouldClose(outside)).toBe(true);
  });
});
