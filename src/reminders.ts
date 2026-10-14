import type { Activity, Category, GlobalSettings, Weekday, WeekRecord } from "./types";

// V2 reminder engine — spec §21. Computes which reminders are due right now.
// Keys embed the activity id + scheduled time so moved/deleted activities
// never fire stale reminders, and reopening never duplicates (§21.4).

export interface DueReminder {
  key: string;
  title: string;
  body: string;
}

function inQuietHours(nowMin: number, s: GlobalSettings): boolean {
  const { start, end } = s.quietHours;
  if (start === null || end === null) return false;
  if (start <= end) return nowMin >= start && nowMin < end;
  return nowMin >= start || nowMin < end;
}

function leadText(lead: number): string {
  return lead <= 0 ? "now" : `in ${lead} min`;
}

/**
 * Due = reminder time reached within the last 90 seconds, not yet delivered,
 * outside quiet hours. Call on a ~30s tick and after schedule edits.
 */
export function computeDueReminders(
  activities: Activity[],
  _categories: Category[],
  settings: GlobalSettings,
  record: WeekRecord | undefined,
  today: Weekday,
  now: Date,
  deliveredSession: Set<string>,
): DueReminder[] {
  void _categories;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const nowMs = now.getTime();
  if (inQuietHours(nowMin, settings)) return [];
  const delivered = new Set<string>([...(record?.delivered ?? []), ...deliveredSession]);
  const out: DueReminder[] = [];
  const d = settings.reminderDefaults;

  const consider = (
    activity: Activity,
    kind: "start" | "end" | "atend",
    atMin: number,
    title: string,
    body: string,
  ) => {
    const key = `${activity.id}:${kind}:${atMin}`;
    if (delivered.has(key)) return;
    const midnight = new Date(now);
    midnight.setHours(0, 0, 0, 0);
    const atMs = midnight.getTime() + atMin * 60000;
    const ageSec = (nowMs - atMs) / 1000;
    if (ageSec >= 0 && ageSec <= 90) out.push({ key, title, body });
  };

  for (const a of activities) {
    if (a.weekday !== today) continue;
    const r = a.reminderPreferences;
    const startOn = r?.startEnabled ?? true;
    const endOn = r?.endEnabled ?? true;
    const startLead = r?.startLeadMinutes ?? d.startLead;
    const endLead = r?.endLeadMinutes ?? d.endLead;
    const label = a.name.trim() || "Scheduled activity";
    if (startOn) {
      consider(a, "start", a.startTime - startLead,
        `▶ ${label} starts ${leadText(startLead)}`, label);
    }
    if (endOn) {
      consider(a, "end", a.endTime - endLead,
        `■ ${label} ends ${leadText(endLead)}`, label);
    }
    if (d.atEnd) {
      consider(a, "atend", a.endTime, `✓ ${label} finished`, label);
    }
  }
  return out;
}
