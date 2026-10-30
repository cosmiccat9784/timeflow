import { describe, expect, it } from "vitest";
import { daysUntil, relativeLabel, sortByNearness } from "./deadlines";

describe("dated deadlines (one-off, calendar-based)", () => {
  it("counts whole days, negative when overdue", () => {
    expect(daysUntil("2026-11-03", "2026-11-03")).toBe(0);
    expect(daysUntil("2026-11-04", "2026-11-03")).toBe(1);
    expect(daysUntil("2026-10-30", "2026-11-03")).toBe(-4);
  });

  it("labels relative days including overdue", () => {
    expect(relativeLabel(-3)).toBe("Overdue by 3 days");
    expect(relativeLabel(-1)).toBe("Yesterday · overdue");
    expect(relativeLabel(0)).toBe("Today");
    expect(relativeLabel(1)).toBe("Tomorrow");
    expect(relativeLabel(5)).toBe("In 5 days");
  });

  it("sorts oldest-overdue first, then today, then future", () => {
    const items = [
      { date: "2026-11-10", name: "future" },
      { date: "2026-10-28", name: "old-overdue" },
      { date: "2026-11-03", name: "today" },
      { date: "2026-11-01", name: "recent-overdue" },
    ];
    expect(sortByNearness(items, "2026-11-03").map((i) => i.name)).toEqual([
      "old-overdue",
      "recent-overdue",
      "today",
      "future",
    ]);
  });
});
