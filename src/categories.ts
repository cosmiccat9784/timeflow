import type { Category } from "./types";

// Spec §7.2 default categories. Colours are soft pastels with dark text.
export const DEFAULT_CATEGORIES: Category[] = [
  { id: "study", name: "Study/Homework", colour: "#FFF3B0", icon: "📚", countsTowardStudy: true, countsTowardOptionalWork: false },
  { id: "personal", name: "Personal", colour: "#B2DFDB", icon: "🌿", countsTowardStudy: false, countsTowardOptionalWork: false },
  { id: "transport", name: "Transport", colour: "#BBDEFB", icon: "🚌", countsTowardStudy: false, countsTowardOptionalWork: false },
  { id: "sports", name: "Sports/Swimming", colour: "#FFCC80", icon: "🏊", countsTowardStudy: false, countsTowardOptionalWork: false },
  { id: "band", name: "Extracurricular/Band", colour: "#B9F6CA", icon: "🎵", countsTowardStudy: false, countsTowardOptionalWork: false },
  { id: "rest", name: "Rest", colour: "#D1C4E9", icon: "😴", countsTowardStudy: false, countsTowardOptionalWork: false },
  { id: "work", name: "Work/Extra Work", colour: "#FFE082", icon: "💼", countsTowardStudy: false, countsTowardOptionalWork: true },
  { id: "meals", name: "Meals/Routine", colour: "#F5F5F5", icon: "🍽️", countsTowardStudy: false, countsTowardOptionalWork: false },
  { id: "other", name: "Other", colour: "#E0E0E0", icon: "▫️", countsTowardStudy: false, countsTowardOptionalWork: false },
];

export const DEFAULT_SWITCH_PAIR: [string, string] = ["study", "personal"];

export function categoryById(categories: Category[], id: string): Category | undefined {
  return categories.find((c) => c.id === id);
}

/** Category whose name best matches a known activity (Piano/Drums → band). */
export function defaultCategoryForName(name: string): string {
  const n = name.trim().toLowerCase();
  if (/piano|drums|band|music|guitar|violin/.test(n)) return "band";
  if (/swim|sport|run|gym|football|cricket|tennis/.test(n)) return "sports";
  if (/bus|train|transport|drive|travel/.test(n)) return "transport";
  if (/dinner|lunch|breakfast|meal|shower|routine/.test(n)) return "meals";
  if (/sleep|rest|break|nap/.test(n)) return "rest";
  if (/work|shift|job/.test(n)) return "work";
  if (/homework|study|maths|math|english|science|revision|assignment|reading/.test(n)) return "study";
  return "personal";
}
