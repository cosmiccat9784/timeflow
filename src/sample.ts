import type { Activity, Weekday } from "./types";
import { nowIso, uid } from "./types";

function base(
  name: string,
  categoryId: string,
  weekday: Weekday,
  sh: number,
  sm: number,
  eh: number,
  em: number,
  extra?: Partial<Activity>,
): Activity {
  const t = nowIso();
  return {
    id: uid("act"),
    name,
    categoryId,
    weekday,
    startTime: sh * 60 + sm,
    endTime: eh * 60 + em,
    createdAt: t,
    updatedAt: t,
    ...extra,
  };
}

// Spec §14.2 — ~15 realistic activities across default categories.
export function sampleActivities(): Activity[] {
  return [
    base("Mathematics homework", "study", 0, 16, 0, 17, 0, { subject: "Mathematics" }),
    base("Dinner", "meals", 0, 18, 0, 18, 30),
    base("Swimming", "sports", 0, 17, 30, 18, 0),
    base("English study", "study", 1, 16, 0, 17, 0, { subject: "English" }),
    base("Piano", "band", 1, 17, 0, 17, 30),
    base("Bus home", "transport", 1, 15, 30, 16, 0),
    base("Science revision", "study", 2, 16, 0, 17, 30, { subject: "Science" }),
    base("Drums", "band", 2, 18, 0, 18, 30),
    base("Personal time", "personal", 2, 19, 0, 20, 0),
    base("Mathematics homework", "study", 3, 16, 0, 17, 0, { subject: "Mathematics" }),
    base("Rest", "rest", 3, 20, 0, 21, 0),
    base("Extra shift", "work", 4, 17, 0, 19, 0),
    base("Swimming", "sports", 5, 9, 0, 10, 0),
    base("Personal time", "personal", 5, 10, 0, 11, 0),
    base("Family lunch", "meals", 6, 12, 0, 13, 0),
    base("Reading", "study", 6, 15, 0, 15, 30, { subject: "English" }),
  ];
}
