import type { Weekday } from "./types";

// Deadline nearness within the repeating week (§3: no date-specific
// scheduling). "Nearest" = fewest days until that weekday from today:
// today → 0, tomorrow → 1, … six days out at most.

export function daysUntil(today: Weekday, day: Weekday): number {
  return (day - today + 7) % 7;
}

export function relativeLabel(daysAway: number): string {
  if (daysAway === 0) return "Today";
  if (daysAway === 1) return "Tomorrow";
  return `In ${daysAway} days`;
}

export function sortByNearness<T extends { weekday: Weekday }>(items: T[], today: Weekday): T[] {
  return [...items].sort((a, b) => daysUntil(today, a.weekday) - daysUntil(today, b.weekday));
}
