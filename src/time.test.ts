import { describe, expect, it } from "vitest";
import { isAligned, snapToSlot, parseTimeInput, formatTime, isValidDuration } from "../time";

describe("15-minute grid engine (spec §4)", () => {
  it("accepts valid quarter-hour boundaries", () => {
    expect(isAligned(16 * 60)).toBe(true); // 4:00 pm
    expect(isAligned(16 * 60 + 15)).toBe(true);
    expect(isAligned(16 * 60 + 30)).toBe(true);
    expect(isAligned(16 * 60 + 45)).toBe(true);
  });

  it("rejects invalid times (Test 5)", () => {
    expect(isAligned(16 * 60 + 7)).toBe(false); // 4:07 pm
    expect(isAligned(16 * 60 + 22)).toBe(false);
    expect(isAligned(16 * 60 + 38)).toBe(false);
  });

  it("enforces the 15-minute minimum (Test 4)", () => {
    expect(isValidDuration(960, 965)).toBe(false); // 5 min
    expect(isValidDuration(960, 975)).toBe(true); // 15 min
    expect(isValidDuration(960, 967)).toBe(false); // unaligned
  });

  it("snaps drag previews to the nearest slot (Test 13)", () => {
    expect(snapToSlot(967)).toBe(960);
    expect(snapToSlot(970)).toBe(975);
  });

  it("parses user time input", () => {
    expect(parseTimeInput("4:00 pm")).toBe(960);
    expect(parseTimeInput("16:00")).toBe(960);
    expect(parseTimeInput("12:00 am")).toBe(0);
    expect(parseTimeInput("12:00 pm")).toBe(720);
    expect(parseTimeInput("24:00")).toBe(1440);
    expect(parseTimeInput("abc")).toBeNull();
  });

  it("formats en-AU 12h by default", () => {
    expect(formatTime(960, "12h")).toBe("4:00 pm");
    expect(formatTime(960, "24h")).toBe("16:00");
  });
});
