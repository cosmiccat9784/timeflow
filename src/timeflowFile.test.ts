import { describe, expect, it } from "vitest";
import {
  TIMEFLOW_FORMAT,
  createTimeflowFile,
  mergeCategories,
  parseTimeflowFile,
  remapTimetable,
  timeflowFileName,
  uniqueTimetableName,
  usedCategories,
} from "./timeflowFile";
import { DEFAULT_CATEGORIES } from "./categories";
import type { Category, Timetable } from "./types";

const study = DEFAULT_CATEGORIES.find((c) => c.id === "study")!;
const work = DEFAULT_CATEGORIES.find((c) => c.id === "work")!;
const personal = DEFAULT_CATEGORIES.find((c) => c.id === "personal")!;

const timetable: Timetable = {
  id: "tt_1",
  name: "School Week",
  deadlines: [
    { id: "d1", title: "Maths exam", date: "2026-12-01", createdAt: "", updatedAt: "" },
  ],
  activities: [
    { id: "a1", name: "Homework", categoryId: "study", weekday: 0, startTime: 960, endTime: 1020, createdAt: "", updatedAt: "" },
    { id: "a2", name: "", categoryId: "work", weekday: 2, startTime: 600, endTime: 660, subject: "Shift", createdAt: "", updatedAt: "" },
  ],
};

describe(".timeflow file round trip", () => {
  const text = () => createTimeflowFile(timetable, DEFAULT_CATEGORIES, "9.9.9");

  it("writes the documented format envelope", () => {
    const f = JSON.parse(text());
    expect(f.format).toBe(TIMEFLOW_FORMAT);
    expect(f.formatVersion).toBe(1);
    expect(f.schemaVersion).toBeGreaterThanOrEqual(1);
    expect(f.appVersion).toBe("9.9.9");
    expect(typeof f.exportedAt).toBe("string");
    expect(f.timetable.name).toBe("School Week");
    expect(f.categories).toBeDefined();
  });

  it("only embeds categories the timetable uses", () => {
    const f = JSON.parse(text());
    const ids = f.categories.map((c: Category) => c.id).sort();
    expect(ids).toEqual(["study", "work"]);
  });

  it("round-trips activities, order and deadlines", () => {
    const parsed = parseTimeflowFile(text());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.timetable.name).toBe("School Week");
    expect(parsed.timetable.activities).toHaveLength(2);
    expect(parsed.timetable.activities[0]).toMatchObject({ id: "a1", startTime: 960, endTime: 1020 });
    expect(parsed.timetable.activities[1].subject).toBe("Shift");
    expect(parsed.timetable.deadlines).toHaveLength(1);
    expect(parsed.timetable.deadlines[0].title).toBe("Maths exam");
    expect(parsed.categories.map((c) => c.id).sort()).toEqual(["study", "work"]);
  });

  it("is human-readable JSON with a newline-indented body", () => {
    expect(text().split("\n").length).toBeGreaterThan(10);
  });
});

describe(".timeflow validation", () => {
  const good = () => JSON.parse(createTimeflowFile(timetable, DEFAULT_CATEGORIES, "1.0.0"));

  it("rejects non-JSON", () => {
    expect(parseTimeflowFile("nope").ok).toBe(false);
  });

  it("rejects a plain JSON backup", () => {
    const r = parseTimeflowFile(JSON.stringify({ schemaVersion: 4, timetables: [] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("timeflow.timetable");
  });

  it("rejects an unknown format version", () => {
    const f = good();
    f.formatVersion = 99;
    expect(parseTimeflowFile(JSON.stringify(f)).ok).toBe(false);
  });

  it("rejects a nameless timetable", () => {
    const f = good();
    f.timetable.name = "  ";
    expect(parseTimeflowFile(JSON.stringify(f)).ok).toBe(false);
  });

  it("rejects missing categories when activities exist", () => {
    const f = good();
    f.categories = [];
    expect(parseTimeflowFile(JSON.stringify(f)).ok).toBe(false);
  });

  it("rejects an unaligned activity", () => {
    const f = good();
    f.timetable.activities[0].startTime = 967;
    const r = parseTimeflowFile(JSON.stringify(f));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("Homework");
  });

  it("rejects an unknown category", () => {
    const f = good();
    f.timetable.activities[0].categoryId = "nope";
    expect(parseTimeflowFile(JSON.stringify(f)).ok).toBe(false);
  });

  it("rejects a bad deadline date", () => {
    const f = good();
    f.timetable.deadlines[0].date = "2026-02-30";
    expect(parseTimeflowFile(JSON.stringify(f)).ok).toBe(false);
  });

  it("accepts a file with no deadlines key", () => {
    const f = good();
    delete f.timetable.deadlines;
    const r = parseTimeflowFile(JSON.stringify(f));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.timetable.deadlines).toEqual([]);
  });

  it("does not mutate the parsed source object", () => {
    const f = good();
    const before = JSON.stringify(f);
    parseTimeflowFile(JSON.stringify(f));
    expect(JSON.stringify(f)).toBe(before);
  });
});

describe("category merging on open", () => {
  it("keeps existing categories and maps by id", () => {
    const m = mergeCategories(DEFAULT_CATEGORIES, [study]);
    expect(m.remap[study.id]).toBe(study.id);
    expect(m.added).toBe(0);
    expect(m.categories).toHaveLength(DEFAULT_CATEGORIES.length);
  });

  it("reuses a same-name category instead of duplicating it", () => {
    const renamed: Category = { ...study, id: "cat_from_file", name: "Study" };
    const m = mergeCategories(DEFAULT_CATEGORIES, [renamed]);
    expect(m.remap["cat_from_file"]).toBe(study.id);
    expect(m.added).toBe(0);
  });

  it("appends genuinely new categories", () => {
    const extra: Category = {
      id: "cat_choir",
      name: "Choir",
      colour: "#123456",
      icon: "🎤",
      countsTowardStudy: false,
      countsTowardOptionalWork: false,
    };
    const m = mergeCategories(DEFAULT_CATEGORIES, [extra]);
    expect(m.remap["cat_choir"]).toBe("cat_choir");
    expect(m.added).toBe(1);
    expect(m.categories.some((c) => c.id === "cat_choir")).toBe(true);
  });

  it("does not mutate the current category list", () => {
    const before = JSON.stringify(DEFAULT_CATEGORIES);
    mergeCategories(DEFAULT_CATEGORIES, [{ ...work, id: "x", name: "Brand new" }]);
    expect(JSON.stringify(DEFAULT_CATEGORIES)).toBe(before);
  });

  it("rewrites activity category ids through the map", () => {
    const m = mergeCategories(DEFAULT_CATEGORIES, [{ ...study, id: "cat_from_file", name: "Study" }]);
    const tt = remapTimetable(
      { ...timetable, activities: [{ ...timetable.activities[0], categoryId: "cat_from_file" }] },
      m.remap,
    );
    expect(tt.activities[0].categoryId).toBe(study.id);
  });

  it("leaves unknown ids untouched", () => {
    const tt = remapTimetable(timetable, {});
    expect(tt.activities[0].categoryId).toBe("study");
  });

  it("usedCategories ignores unused ones", () => {
    const used = usedCategories(timetable, DEFAULT_CATEGORIES).map((c) => c.id);
    expect(used).toEqual(["study", "work"]);
    expect(used).not.toContain(personal.id);
  });
});

describe("file names", () => {
  it("appends the extension", () => {
    expect(timeflowFileName("School Week")).toBe("School Week.timeflow");
  });

  it("strips characters Windows rejects", () => {
    expect(timeflowFileName('A/B\\C:D*E?F"G<H>I|J')).toBe("ABCDEFGHIJ.timeflow");
  });

  it("trims trailing dots and spaces", () => {
    expect(timeflowFileName("Term 1. ")).toBe("Term 1.timeflow");
  });

  it("falls back when the name is empty", () => {
    expect(timeflowFileName("   ")).toBe("Timetable.timeflow");
    expect(timeflowFileName("...")).toBe("Timetable.timeflow");
  });

  it("caps absurdly long names", () => {
    expect(timeflowFileName("x".repeat(200)).length).toBeLessThanOrEqual(90);
  });
});

describe("unique tab names", () => {
  it("keeps a free name unchanged", () => {
    expect(uniqueTimetableName("School Week", ["Other"])).toBe("School Week");
  });

  it("suffixes a duplicate", () => {
    expect(uniqueTimetableName("School Week", ["School Week"])).toBe("School Week (opened)");
    expect(uniqueTimetableName("School Week", ["School Week", "School Week (opened)"])).toBe("School Week (2)");
  });

  it("is case-insensitive", () => {
    expect(uniqueTimetableName("school week", ["School Week"])).toBe("school week (opened)");
  });
});
