import type { Category } from "./types";

// Spec §7.2 default categories. Colours are soft pastels with dark text.
// Labels stay general (Sport, not Sports/Swimming) — specifics belong in
// the activity name, notes or subject, not the category.
export const DEFAULT_CATEGORIES: Category[] = [
  { id: "study", name: "Study", colour: "#FFF3B0", icon: "📚", countsTowardStudy: true, countsTowardOptionalWork: false },
  { id: "personal", name: "Personal", colour: "#B2DFDB", icon: "🌿", countsTowardStudy: false, countsTowardOptionalWork: false },
  { id: "transport", name: "Transport", colour: "#BBDEFB", icon: "🚌", countsTowardStudy: false, countsTowardOptionalWork: false },
  { id: "sports", name: "Sport", colour: "#FFCC80", icon: "🏊", countsTowardStudy: false, countsTowardOptionalWork: false },
  { id: "band", name: "Extracurricular", colour: "#B9F6CA", icon: "🎵", countsTowardStudy: false, countsTowardOptionalWork: false },
  { id: "rest", name: "Rest", colour: "#D1C4E9", icon: "😴", countsTowardStudy: false, countsTowardOptionalWork: false },
  { id: "work", name: "Work", colour: "#FFE082", icon: "💼", countsTowardStudy: false, countsTowardOptionalWork: true },
  { id: "meals", name: "Meals", colour: "#F5F5F5", icon: "🍽️", countsTowardStudy: false, countsTowardOptionalWork: false },
  { id: "other", name: "Other", colour: "#E0E0E0", icon: "▫️", countsTowardStudy: false, countsTowardOptionalWork: false },
];

/** Previous default names, so stored timetables can adopt the new labels
 *  only where the user never renamed the category themselves. */
export const LEGACY_CATEGORY_NAMES: Record<string, string> = {
  study: "Study/Homework",
  sports: "Sports/Swimming",
  band: "Extracurricular/Band",
  work: "Work/Extra Work",
  meals: "Meals/Routine",
};

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
