import { describe, expect, it } from "vitest";
import type { Activity } from "./types";
import { computeMergedBlocks } from "./merge";
import { findConflicts, assignLanes } from "./conflicts";
import { validateActivity } from "./validation";
import { DEFAULT_CATEGORIES } from "./categories";

function act(partial: Partial<Activity> & { id: string }): Activity {
  return {
    name: "Study", categoryId: "study", weekday: 1, startTime: 960, endTime: 990,
    createdAt: "", updatedAt: "", ...partial,
  };
}

describe("visual merging (spec §8, Tests 11–12)", () => {
  it("merges adjacent compatible activities, keeps separate records", () => {
    const blocks = computeMergedBlocks([
      act({ id: "a", startTime: 960, endTime: 990 }),
      act({ id: "b", startTime: 990, endTime: 1020 }),
    ]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].members.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("splits when subject differs (Test 12)", () => {
    const blocks = computeMergedBlocks([
      act({ id: "a", startTime: 960, endTime: 990, subject: "Maths" }),
      act({ id: "b", startTime: 990, endTime: 1020, subject: "English" }),
    ]);
    expect(blocks).toHaveLength(2);
  });

  it("never bridges a gap", () => {
    const blocks = computeMergedBlocks([
      act({ id: "a", startTime: 960, endTime: 990 }),
      act({ id: "b", startTime: 1005, endTime: 1020 }),
    ]);
    expect(blocks).toHaveLength(2);
  });
});

describe("conflicts (spec §10, Test 14)", () => {
  it("detects overlaps and lanes them side by side", () => {
    const acts = [
      act({ id: "a", startTime: 960, endTime: 1020 }),
      act({ id: "b", startTime: 990, endTime: 1050 }),
    ];
    expect(findConflicts(acts)).toHaveLength(1);
    const lanes = assignLanes(acts);
    expect(lanes.get("a")!.lanes).toBe(2);
    expect(lanes.get("b")!.lanes).toBe(2);
    expect(lanes.get("a")!.lane).not.toBe(lanes.get("b")!.lane);
  });

  it("ignores back-to-back activities", () => {
    expect(findConflicts([
      act({ id: "a", startTime: 960, endTime: 990 }),
      act({ id: "b", startTime: 990, endTime: 1020 }),
    ])).toHaveLength(0);
  });
});

describe("write validation (spec §13.8, Test 26)", () => {
  it("rejects invalid times, bad categories and cross-midnight ranges", () => {
    expect(validateActivity(act({ id: "x", startTime: 967, endTime: 990 }), DEFAULT_CATEGORIES).length).toBeGreaterThan(0);
    expect(validateActivity(act({ id: "x", categoryId: "nope" }), DEFAULT_CATEGORIES).length).toBeGreaterThan(0);
    expect(validateActivity(act({ id: "x", startTime: 1020, endTime: 960 }), DEFAULT_CATEGORIES).length).toBeGreaterThan(0);
    expect(validateActivity(act({ id: "x", startTime: 960, endTime: 965 }), DEFAULT_CATEGORIES).length).toBeGreaterThan(0);
    expect(validateActivity(act({ id: "x" }), DEFAULT_CATEGORIES)).toHaveLength(0);
  });
});
