import { describe, expect, it } from "vitest";
import { daysUntil, relativeLabel, sortByNearness } from "../deadlines";

describe("deadline nearness (repeating week, no dates)", () => {
  it("counts forward to the weekday", () => {
    expect(daysUntil(1, 1)).toBe(0); // Tuesday → Tuesday
    expect(daysUntil(1, 2)).toBe(1);
    expect(daysUntil(1, 0)).toBe(6); // Tuesday → next Monday
    expect(daysUntil(6, 0)).toBe(1); // Sunday → Monday
  });

  it("labels relative days", () => {
    expect(relativeLabel(0)).toBe("Today");
    expect(relativeLabel(1)).toBe("Tomorrow");
    expect(relativeLabel(4)).toBe("In 4 days");
  });

  it("sorts nearest first", () => {
    const items = [
      { weekday: 0 as const, name: "mon" },
      { weekday: 4 as const, name: "fri" },
      { weekday: 2 as const, name: "wed" },
    ];
    // Today = Tuesday: Wed (1), Fri (3), Mon (6).
    expect(sortByNearness(items, 1).map((i) => i.name)).toEqual(["wed", "fri", "mon"]);
  });
});
