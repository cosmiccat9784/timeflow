import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { dayTotals, weekTotals, allDayTotals } from "./totals";
import { draftFromActivity, draftToActivity, type EditorDraft } from "./components/ActivityEditor";
import { createBackup, parseBackup } from "./backup";
import { defaultState, defaultSettings, migrateState } from "./store";
import { DEFAULT_CATEGORIES } from "./categories";
import { timetableToXlsx } from "./exportExcel";
import { analyzeExcel } from "./importExcel";
import { formatTimeOption, formatTime } from "./time";
import { validateCategories } from "./validation";
import type { Activity, Category, Timetable, Weekday } from "./types";

const root = process.cwd();
const readSrc = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

function act(partial: Partial<Activity> & { id: string }): Activity {
  return {
    name: "Study",
    categoryId: "study",
    weekday: 0 as Weekday,
    startTime: 960,
    endTime: 1020,
    createdAt: "",
    updatedAt: "",
    ...partial,
  };
}
const study = DEFAULT_CATEGORIES.find((c) => c.id === "study")!;

// ---------------------------------------------------------------- Bug 1
describe("Bug 1 — weekly totals must not union the same clock time across days", () => {
  it("counts 16:00–17:00 on Monday and Tuesday as two hours", () => {
    const activities = [
      act({ id: "m", weekday: 0, startTime: 960, endTime: 1020 }),
      act({ id: "t", weekday: 1, startTime: 960, endTime: 1020 }),
    ];
    expect(weekTotals(activities, DEFAULT_CATEGORIES).study).toBe(120);
  });

  it("still unions overlapping blocks inside one day", () => {
    const activities = [
      act({ id: "a", weekday: 0, startTime: 960, endTime: 1080 }),
      act({ id: "b", weekday: 0, startTime: 1020, endTime: 1140 }),
    ];
    expect(weekTotals(activities, DEFAULT_CATEGORIES).study).toBe(180);
  });

  it("week totals equal the sum of the per-day totals", () => {
    const activities = [
      act({ id: "1", weekday: 0, startTime: 360, endTime: 420 }),
      act({ id: "2", weekday: 1, startTime: 360, endTime: 480 }),
      act({ id: "3", weekday: 2, startTime: 540, endTime: 600, categoryId: "work" }),
      act({ id: "4", weekday: 3, startTime: 360, endTime: 390 }),
      act({ id: "5", weekday: 6, startTime: 600, endTime: 630 }),
    ];
    const days = allDayTotals(activities, DEFAULT_CATEGORIES);
    const week = weekTotals(activities, DEFAULT_CATEGORIES);
    let study = 0;
    let optional = 0;
    for (let d = 0; d < 7; d++) {
      study += days[d].study;
      optional += days[d].optionalWork;
    }
    expect(week.study).toBe(study);
    expect(week.optionalWork).toBe(optional);
  });

  it("keeps optional work separate across days", () => {
    const activities = [
      act({ id: "w1", weekday: 4, startTime: 960, endTime: 1020, categoryId: "work" }),
      act({ id: "w2", weekday: 5, startTime: 960, endTime: 1020, categoryId: "work" }),
    ];
    const t = weekTotals(activities, DEFAULT_CATEGORIES);
    expect(t.optionalWork).toBe(120);
    expect(t.study).toBe(0);
  });

  it("several categories in one day still union once", () => {
    const activities = [
      act({ id: "a", weekday: 0, startTime: 600, endTime: 660 }),
      act({ id: "b", weekday: 0, startTime: 600, endTime: 660 }),
    ];
    expect(dayTotals(activities, DEFAULT_CATEGORIES, 0).study).toBe(60);
    expect(weekTotals(activities, DEFAULT_CATEGORIES).study).toBe(60);
  });
});

// ---------------------------------------------------------------- Bug 2
describe("Bug 2 — global reminder lead defaults reach new activities", () => {
  const base = (): EditorDraft => ({
    activityId: null,
    name: "",
    categoryId: "study",
    subject: "",
    weekday: 0,
    startTime: 600,
    endTime: 660,
    timeSet: true,
    notes: "",
    optionalWorkOverride: "inherit",
    startEnabled: true,
    endEnabled: true,
    startLead: 10,
    endLead: 15,
    memberCount: 1,
  });
  const defaults = { startLead: 10, endLead: 15 };

  it("does not persist reminderPreferences when values match the global defaults", () => {
    const a = draftToActivity(base(), DEFAULT_CATEGORIES, defaults)!;
    expect(a.reminderPreferences).toBeUndefined();
  });

  it("persists overrides when the user changes a lead", () => {
    const a = draftToActivity({ ...base(), startLead: 30 }, DEFAULT_CATEGORIES, defaults)!;
    expect(a.reminderPreferences?.startLeadMinutes).toBe(30);
  });

  it("persists a disabled reminder", () => {
    const a = draftToActivity({ ...base(), startEnabled: false }, DEFAULT_CATEGORIES, defaults)!;
    expect(a.reminderPreferences?.startEnabled).toBe(false);
  });

  it("draftFromActivity seeds leads from settings when the activity has none", () => {
    const d = draftFromActivity(act({ id: "x" }), 1, defaults);
    expect(d.startLead).toBe(10);
    expect(d.endLead).toBe(15);
  });

  it("draftFromActivity keeps explicit activity leads", () => {
    const a = act({
      id: "x",
      reminderPreferences: {
        startEnabled: true,
        endEnabled: true,
        startLeadMinutes: 30,
        endLeadMinutes: 0,
      },
    });
    const d = draftFromActivity(a, 1, defaults);
    expect(d.startLead).toBe(30);
    expect(d.endLead).toBe(0);
  });

  it("App seeds new activities from settings.reminderDefaults, not a hard-coded 5", () => {
    const app = readSrc("src/App.tsx");
    expect(app).toContain("startLead: settings.reminderDefaults.startLead");
    expect(app).toContain("endLead: settings.reminderDefaults.endLead");
    expect(app).not.toMatch(/startLead:\s*5,\s*\n\s*endLead:\s*5/);
  });
});

// ---------------------------------------------------------------- Bug 3
describe("Bug 3 — import conflict must not show a false success toast", () => {
  it("returns from the conflict branch before notifying", () => {
    const app = readSrc("src/App.tsx");
    const start = app.indexOf("const handleImportResult");
    const end = app.indexOf("const doExportXlsx");
    const body = app.slice(start, end);
    const pendingAt = body.indexOf("setPending(");
    expect(pendingAt).toBeGreaterThan(-1);
    // The first thing after the conflict branch must be a return, so notify
    // is only reachable when the import actually committed.
    const afterPending = body.slice(body.indexOf("conflicts: describeConflicts"));
    const returnAt = afterPending.indexOf("return;");
    const notifyAt = afterPending.indexOf("notify({");
    expect(returnAt).toBeGreaterThan(-1);
    expect(returnAt).toBeLessThan(notifyAt);
  });
});

// ---------------------------------------------------------------- Bug 4
describe("Bug 4 — restoring a backup is undoable", () => {
  it("routes the restore through commit with a labelled checkpoint", () => {
    const app = readSrc("src/App.tsx");
    const body = app.slice(app.indexOf("const doRestore"), app.indexOf("const restoreRestorePoint"));
    expect(body).toContain('commit({ timetables: d.timetables, categories: d.categories }, "Restored backup")');
  });
});

// ---------------------------------------------------------------- Bug 5
describe("Bug 5 — XLSX export round-trips through the importer", () => {
  const timetable: Timetable = {
    id: "tt",
    name: "Round trip",
    deadlines: [],
    activities: [
      act({ id: "a1", name: "Mathematics homework", weekday: 0, startTime: 1020, endTime: 1065, subject: "Mathematics" }),
      act({ id: "a2", name: "", weekday: 2, startTime: 600, endTime: 660, categoryId: "work" }),
      act({ id: "a3", name: "Piano", weekday: 5, startTime: 720, endTime: 780, categoryId: "band" }),
    ],
  };

  it("writes a Data sheet that the analyser reads exactly", async () => {
    const bytes = await timetableToXlsx(timetable, DEFAULT_CATEGORIES);
    const plans = await analyzeExcel(bytes);
    const data = plans.find((p) => p.sheetName === "Data");
    expect(data).toBeDefined();
    expect(data!.proposals).toHaveLength(3);

    const first = data!.proposals[0];
    expect(first.name).toBe("Mathematics homework");
    expect(first.day).toBe(0);
    expect(first.start).toBe(1020);
    expect(first.end).toBe(1065);
    expect(first.subject).toBe("Mathematics");

    const second = data!.proposals[1];
    expect(second.name).toBe("");
    expect(second.day).toBe(2);
    expect(second.start).toBe(600);

    const third = data!.proposals[2];
    expect(third.day).toBe(5);
    expect(third.start).toBe(720);
  });

  it("does not produce junk rows such as durations or weekday headers", async () => {
    const bytes = await timetableToXlsx(timetable, DEFAULT_CATEGORIES);
    const plans = await analyzeExcel(bytes);
    const data = plans.find((p) => p.sheetName === "Data")!;
    for (const p of data.proposals) {
      expect(p.name).not.toMatch(/^\d+\s*(h|hr|hrs|m|min)$/i);
      expect(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]).not.toContain(p.name);
    }
  });

  it("encodes the optional-work override", async () => {
    const tt: Timetable = {
      id: "t2",
      name: "OW",
      deadlines: [],
      activities: [act({ id: "x", weekday: 1, startTime: 600, endTime: 660, optionalWorkOverride: "yes" })],
    };
    const bytes = await timetableToXlsx(tt, DEFAULT_CATEGORIES);
    const plans = await analyzeExcel(bytes);
    const data = plans.find((p) => p.sheetName === "Data")!;
    expect(data.proposals[0].optionalWorkOverride).toBe("yes");
  });
});

// ---------------------------------------------------------------- Bug 6
describe("Bug 6 — old schema backups can be restored", () => {
  const mk = (schemaVersion: number) => {
    const s = defaultState();
    return JSON.stringify({ ...JSON.parse(createBackup(s)), schemaVersion });
  };

  it("accepts schema v1 through v4", () => {
    for (const v of [1, 2, 3, 4]) {
      const r = parseBackup(mk(v));
      expect(r.ok, `schema v${v} should be accepted`).toBe(true);
    }
  });

  it("upgrades the accepted payload to the current schema version", () => {
    const r = parseBackup(mk(1));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.schemaVersion).toBe(4);
  });

  it("rejects a future or nonsensical schema version", () => {
    expect(parseBackup(mk(99)).ok).toBe(false);
    expect(parseBackup(mk(0)).ok).toBe(false);
  });

  it("the migrated payload still passes migrateState", () => {
    const r = parseBackup(mk(2));
    expect(r.ok).toBe(true);
    if (r.ok) {
      const migrated = migrateState(JSON.parse(JSON.stringify(r.data)));
      expect(migrated).not.toBeNull();
    }
  });
});

// ---------------------------------------------------------------- Bug 7
describe("Bug 7 — restore validates deadlines", () => {
  const withDeadline = (deadline: unknown) => {
    const s = defaultState();
    const payload = JSON.parse(createBackup(s));
    payload.timetables[0].deadlines = [deadline];
    return JSON.stringify(payload);
  };

  it("accepts a valid deadline", () => {
    expect(parseBackup(withDeadline({ id: "d1", title: "Exam", date: "2026-11-30", createdAt: "", updatedAt: "" })).ok).toBe(true);
  });

  it("rejects an impossible date", () => {
    expect(parseBackup(withDeadline({ id: "d1", title: "Exam", date: "2026-02-30", createdAt: "", updatedAt: "" })).ok).toBe(false);
  });

  it("rejects a missing title", () => {
    expect(parseBackup(withDeadline({ id: "d1", title: "  ", date: "2026-11-30", createdAt: "", updatedAt: "" })).ok).toBe(false);
  });

  it("rejects a non-array deadlines field", () => {
    expect(parseBackup(withDeadline("not-an-array")).ok).toBe(false);
  });

  it("defaults missing deadlines to an empty array", () => {
    const s = defaultState();
    const payload = JSON.parse(createBackup(s));
    delete payload.timetables[0].deadlines;
    const r = parseBackup(JSON.stringify(payload));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.timetables[0].deadlines).toEqual([]);
  });
});

// ---------------------------------------------------------------- Bug 8
describe("Bug 8 — a running timer stays reachable after switching timetables", () => {
  it("Today receives the timer regardless of which timetable owns it", () => {
    const app = readSrc("src/App.tsx");
    expect(app).toContain("timer={timer}");
    expect(app).not.toContain("timer={timer && timer.timetableId === active.id ? timer : null}");
  });

  it("the toolbar chip switches to the owning timetable before opening Today", () => {
    const app = readSrc("src/App.tsx");
    const body = app.slice(app.indexOf("timer && screen !== \"today\""));
    expect(body).toContain("switchTimetable(timer.timetableId)");
    expect(body).toContain('setScreen("today")');
  });

  it("finishing records minutes against the timer's own timetable", () => {
    const app = readSrc("src/App.tsx");
    expect(app).toContain("recordKey(t.timetableId, curWeek)");
  });
});

// ---------------------------------------------------------------- Bug 9
describe("Bug 9 — cancelling a save dialog is not reported as success", () => {
  it("saveFile distinguishes cancellation from success", () => {
    const src = readSrc("src/native.ts");
    expect(src).toContain("cancelled: true");
    expect(src).not.toContain("user cancelled — not an error");
  });

  it("every export path early-returns on cancellation", () => {
    const app = readSrc("src/App.tsx");
    const cancels = app.match(/if \(r\.cancelled\) return;/g) ?? [];
    expect(cancels.length).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------- Bug 10
describe("Bug 10 — Settings shows the real schema version", () => {
  it("uses SCHEMA_VERSION, not a hard-coded v2", () => {
    const src = readSrc("src/components/SettingsPanel.tsx");
    expect(src).toContain("schema v{SCHEMA_VERSION}");
    expect(src).not.toContain("schema v2");
  });
});

// ---------------------------------------------------------------- Bug 11
describe("Bug 11 — midnight is unambiguous in the time pickers", () => {
  it("labels the end-of-day option distinctly", () => {
    expect(formatTimeOption(1440, "12h")).toBe("Midnight (end of day)");
    expect(formatTimeOption(1440, "24h")).toBe("Midnight (end of day)");
  });

  it("keeps ordinary labels and leaves start-of-day alone", () => {
    expect(formatTimeOption(0, "12h")).toBe(formatTime(0, "12h"));
    expect(formatTimeOption(600, "24h")).toBe("10:00");
  });

  it("the two midnight entries no longer collide", () => {
    expect(formatTimeOption(0, "12h")).not.toBe(formatTimeOption(1440, "12h"));
  });
});

// ---------------------------------------------------------------- Bug 12
describe("Bug 12 — the time picker follows the visible range", () => {
  it("the editor receives the configured visible window", () => {
    const app = readSrc("src/App.tsx");
    expect(app).toContain("visibleStart={settings.visibleStartMinutes}");
    expect(app).toContain("visibleEnd={settings.visibleEndMinutes}");
  });

  it("the picker starts at the visible start hour and stops at the visible end", () => {
    const src = readSrc("src/components/ActivityEditor.tsx");
    expect(src).toContain("Math.floor(visibleStart/60)");
    expect(src).toContain("Math.ceil(visibleEnd/60)");
  });

  it("the second tap includes the tapped quarter", () => {
    // 16:00 → 17:00 is 16:00–17:15, i.e. the end is the tapped slot + 15.
    const src = readSrc("src/components/ActivityEditor.tsx");
    expect(src).toContain("onPick(a, Math.min(t + 15, 1440))");
  });

  it("offers a way to clear the selection", () => {
    expect(readSrc("src/components/ActivityEditor.tsx")).toContain("Clear selection");
  });
});

// ---------------------------------------------------------------- Bug 13
describe("Bug 13 — the test-notification button tells the truth", () => {
  it("tryNotify reports whether a system notification was delivered", () => {
    const app = readSrc("src/App.tsx");
    expect(app).toContain("Promise<boolean>");
    expect(app).toContain("if (!granted) return false;");
    expect(app).toContain("return true;");
  });

  it("the toast reflects a blocked or failed delivery", () => {
    const app = readSrc("src/App.tsx");
    const body = app.slice(app.indexOf("const testNotification"), app.indexOf("const testNotification") + 900);
    expect(body).toContain("if (sent)");
    expect(body).toContain("blocked");
  });
});

// ---------------------------------------------------------------- Bug 14
describe("Bug 14 — removing every activity asks first", () => {
  it("clearAll confirms and reports the count", () => {
    const app = readSrc("src/App.tsx");
    const body = app.slice(app.indexOf("const clearAll"), app.indexOf("const clearAll") + 700);
    expect(body).toContain("window.confirm");
    expect(body).toMatch(/Remove all \$\{count\} activities/);
  });

  it("does nothing when the timetable is already empty", () => {
    const app = readSrc("src/App.tsx");
    expect(app).toContain("This timetable has no activities.");
  });
});

// ---------------------------------------------------------------- Bug 15
describe("Bug 15 — shift-click selection drives a real bulk action", () => {
  it("a bulk delete handler exists and is wired to the selection", () => {
    const app = readSrc("src/App.tsx");
    expect(app).toContain("const deleteSelected");
    expect(app).toContain("onClick={deleteSelected}");
    expect(app).toContain("selectedKeys.size > 1");
  });

  it("bulk delete commits once with an undo label", () => {
    const app = readSrc("src/App.tsx");
    const body = app.slice(app.indexOf("const deleteSelected"), app.indexOf("const deleteSelected") + 1400);
    expect(body).toContain("commitActive(next");
    expect(body).toContain("Deleted ${ids.size} activities");
  });
});

// ---------------------------------------------------------------- Bug 18
describe("Bug 18 — custom dropdowns are keyboard navigable", () => {
  const src = () => readSrc("src/components/CustomSelect.tsx");

  it("supports arrow keys, Home and End", () => {
    const s = src();
    expect(s).toContain('case "ArrowDown"');
    expect(s).toContain('case "ArrowUp"');
    expect(s).toContain('case "Home"');
    expect(s).toContain('case "End"');
  });

  it("commits with Enter or Space and closes with Escape", () => {
    const s = src();
    expect(s).toContain('case "Enter"');
    expect(s).toContain('case "Escape"');
    expect(s).toContain("commit(active)");
  });

  it("has type-ahead", () => {
    expect(src()).toContain("typeahead");
  });

  it("opens from the trigger with the arrow keys", () => {
    expect(src()).toContain("openList()");
  });

  it("moves focus into the open list so keys work immediately", () => {
    expect(src()).toContain("listRef.current?.focus()");
  });
});

// ------------------------------------------------------- removed features
describe("Removed features stay removed", () => {
  it("no resize handles are rendered", () => {
    expect(readSrc("src/components/PlannerGrid.tsx")).not.toContain("resize-handle");
  });

  it("no tip banner and no overlap card", () => {
    const app = readSrc("src/App.tsx");
    expect(app).not.toContain("Tip: click to select");
    expect(app).not.toContain("2 OVERLAPS");
  });

  it("no V2 scheduling labels", () => {
    const editor = readSrc("src/components/ActivityEditor.tsx");
    expect(editor).not.toContain("stored now");
    expect(editor).not.toContain("V2 scheduling");
  });

  it("no native select elements remain", () => {
    const dir = path.join(root, "src");
    const walk = (d: string): string[] =>
      fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)],
      );
    for (const f of walk(dir).filter((f) => f.endsWith(".tsx"))) {
      const src = fs.readFileSync(f, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      expect(src, `${f} must not use <select>`).not.toMatch(/<select\b/);
    }
  });
});

// ------------------------------------------------------ data integrity
describe("Data integrity across the whole state", () => {
  it("a backup of default state round-trips unchanged", () => {
    const s = defaultState();
    const r = parseBackup(createBackup(s));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.timetables).toHaveLength(1);
      expect(r.data.categories).toHaveLength(s.categories.length);
    }
  });

  it("validation rejects a backup with an invalid activity", () => {
    const s = defaultState();
    const payload = JSON.parse(createBackup(s));
    payload.timetables[0].activities = [act({ id: "bad", startTime: 967, endTime: 990 })];
    expect(parseBackup(JSON.stringify(payload)).ok).toBe(false);
  });

  it("default settings keep the documented defaults", () => {
    const d = defaultSettings();
    expect(d.visibleStartMinutes).toBe(360);
    expect(d.visibleEndMinutes).toBe(1320);
    expect(d.showToasts).toBe(true);
  });

  it("categories cannot count toward both totals", () => {
    const bad: Category = { ...study, id: "bad", name: "Bad", countsTowardStudy: true, countsTowardOptionalWork: true };
    const errs = validateCategories([...DEFAULT_CATEGORIES, bad]);
    expect(errs.length).toBeGreaterThan(0);
  });
});
