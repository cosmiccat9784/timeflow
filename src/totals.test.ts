import { describe, expect, it } from "vitest";
import type { Activity } from "../types";
import { DEFAULT_CATEGORIES } from "../categories";
import { dayTotals, unionMinutes } from "../totals";

function act(id: string, cat: string, day: number, s: number, e: number): Activity {
  return {
    id, name: `A-${id}`, categoryId: cat, weekday: day as Activity["weekday"],
    startTime: s, endTime: e, createdAt: "", updatedAt: "",
  };
}

describe("union-of-interval totals (spec §12, Tests 15–17)", () => {
  it("counts a single study hour once", () => {
    const t = dayTotals([act("1", "study", 1, 960, 1020)], DEFAULT_CATEGORIES, 1);
    expect(t.study).toBe(60);
    expect(t.optionalWork).toBe(0);
  });

  it("does not double-count identical overlaps (Test 16)", () => {
    const t = dayTotals(
      [act("1", "study", 1, 960, 1020), act("2", "study", 1, 960, 1020)],
      DEFAULT_CATEGORIES, 1,
    );
    expect(t.study).toBe(60);
  });

  it("unions partial overlaps: 4:00–5:00 + 4:30–5:30 = 90 min", () => {
    expect(unionMinutes([{ start: 960, end: 1020 }, { start: 990, end: 1050 }])).toBe(90);
  });

  it("keeps optional work separate from study (Test 17)", () => {
    const t = dayTotals(
      [act("1", "study", 1, 960, 1020), act("2", "work", 1, 1020, 1080)],
      DEFAULT_CATEGORIES, 1,
    );
    expect(t.study).toBe(60);
    expect(t.optionalWork).toBe(60);
  });

  it("honours the optional-work override", () => {
    const a = { ...act("1", "personal", 1, 960, 1020), optionalWorkOverride: "yes" as const };
    const t = dayTotals([a], DEFAULT_CATEGORIES, 1);
    expect(t.optionalWork).toBe(60);
    expect(t.study).toBe(0);
  });
});
