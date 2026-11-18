import type { Category } from "./types";

// Spec §7.2 default categories — colours match the new Morgen-inspired
// activity palette (green/blue/purple/red/orange) with a dark-card + stripe look.
export const DEFAULT_CATEGORIES: Category[] = [
  { id: "study", name: "Study", colour: "#65D84A", icon: "📚", countsTowardStudy: true, countsTowardOptionalWork: false },
  { id: "personal", name: "Personal", colour: "#168FE5", icon: "🌿", countsTowardStudy: false, countsTowardOptionalWork: false },
  { id: "transport", name: "Transport", colour: "#3AA0FF", icon: "🚌", countsTowardStudy: false, countsTowardOptionalWork: false },
  { id: "sports", name: "Sport", colour: "#FF940E", icon: "🏊", countsTowardStudy: false, countsTowardOptionalWork: false },
  { id: "band", name: "Extracurricular", colour: "#B45AFF", icon: "🎵", countsTowardStudy: false, countsTowardOptionalWork: false },
  { id: "rest", name: "Rest", colour: "#F04444", icon: "😴", countsTowardStudy: false, countsTowardOptionalWork: false },
  { id: "work", name: "Work", colour: "#C792FF", icon: "💼", countsTowardStudy: false, countsTowardOptionalWork: true },
  { id: "meals", name: "Meals", colour: "#858585", icon: "🍽️", countsTowardStudy: false, countsTowardOptionalWork: false },
  { id: "other", name: "Other", colour: "#555555", icon: "▫️", countsTowardStudy: false, countsTowardOptionalWork: false },
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
