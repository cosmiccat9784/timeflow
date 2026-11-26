import { describe, expect, it } from "vitest";
import { closeTab, cycleTab, moveTab, openTab, pruneTabs, unopenedTimetables } from "./tabs";

const ids = ["a", "b", "c", "d"];

describe("tab pruning", () => {
  it("drops ids that no longer exist", () => {
    expect(pruneTabs(["a", "zz", "b"], ids, "a").open).toEqual(["a", "b"]);
  });

  it("deduplicates", () => {
    expect(pruneTabs(["a", "a", "b"], ids, "a").open).toEqual(["a", "b"]);
  });

  it("falls back to the first timetable when nothing is open", () => {
    const s = pruneTabs([], ids, "c");
    expect(s.open).toEqual(["c"]);
    expect(s.activeId).toBe("c");
  });

  it("appends the active timetable if it was missing", () => {
    const s = pruneTabs(["a"], ids, "d");
    expect(s.open).toEqual(["a", "d"]);
    expect(s.activeId).toBe("d");
  });

  it("survives an empty timetable list", () => {
    expect(pruneTabs([], [], "")).toEqual({ open: [], activeId: "" });
  });

  it("moves to the first tab when the active one was deleted", () => {
    const s = pruneTabs(["a", "b"], ["a", "b"], "gone");
    expect(s.activeId).toBe("a");
    expect(s.open).toEqual(["a", "b"]);
  });
});

describe("opening tabs", () => {
  it("appends and focuses a new tab", () => {
    expect(openTab({ open: ["a"], activeId: "a" }, "b")).toEqual({ open: ["a", "b"], activeId: "b" });
  });

  it("focuses an already-open tab without duplicating", () => {
    expect(openTab({ open: ["a", "b"], activeId: "a" }, "b")).toEqual({ open: ["a", "b"], activeId: "b" });
  });

  it("lists timetables not yet open", () => {
    expect(unopenedTimetables(ids, { open: ["a", "c"], activeId: "a" })).toEqual(["b", "d"]);
  });
});

describe("closing tabs", () => {
  it("focuses the right neighbour when closing the active tab", () => {
    const s = closeTab({ open: ["a", "b", "c"], activeId: "b" }, "b");
    expect(s.open).toEqual(["a", "c"]);
    expect(s.activeId).toBe("c");
  });

  it("falls back to the left neighbour at the end of the strip", () => {
    const s = closeTab({ open: ["a", "b", "c"], activeId: "c" }, "c");
    expect(s.activeId).toBe("b");
  });

  it("keeps the active tab when closing an inactive one", () => {
    const s = closeTab({ open: ["a", "b", "c"], activeId: "b" }, "a");
    expect(s).toEqual({ open: ["b", "c"], activeId: "b" });
  });

  it("refuses to close the last tab", () => {
    const s = { open: ["a"], activeId: "a" };
    expect(closeTab(s, "a")).toBe(s);
  });

  it("ignores unknown ids", () => {
    const s = { open: ["a", "b"], activeId: "a" };
    expect(closeTab(s, "zz")).toBe(s);
  });
});

describe("keyboard cycling", () => {
  it("cycles forward and wraps", () => {
    expect(cycleTab({ open: ["a", "b", "c"], activeId: "c" }, 1).activeId).toBe("a");
  });

  it("cycles backward and wraps", () => {
    expect(cycleTab({ open: ["a", "b", "c"], activeId: "a" }, -1).activeId).toBe("c");
  });

  it("does nothing with a single tab", () => {
    const s = { open: ["a"], activeId: "a" };
    expect(cycleTab(s, 1)).toBe(s);
  });
});

describe("reordering", () => {
  it("moves a tab before another", () => {
    expect(moveTab(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
    expect(moveTab(["a", "b", "c"], "a", "c")).toEqual(["b", "a", "c"]);
  });

  it("is a no-op for the same id or unknown ids", () => {
    expect(moveTab(["a", "b"], "a", "a")).toEqual(["a", "b"]);
    expect(moveTab(["a", "b"], "zz", "a")).toEqual(["a", "b"]);
    expect(moveTab(["a", "b"], "a", "zz")).toEqual(["a", "b"]);
  });

  it("never loses or duplicates a tab", () => {
    const out = moveTab(["a", "b", "c", "d"], "b", "d");
    expect(out).toHaveLength(4);
    expect(new Set(out).size).toBe(4);
  });
});
