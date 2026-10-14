import type { Activity } from "./types";

export interface MergedBlock {
  key: string;
  weekday: Activity["weekday"];
  startTime: number;
  endTime: number;
  members: Activity[];
}

/**
 * Visual merge engine — spec §8.
 * Compatible activities (same day, name, category, subject, reminder
 * config, override + exact adjacency) render as one continuous block.
 * Underlying records are NEVER combined.
 * Note: merging keys on the raw name, so two adjacent unnamed blocks of
 * the same category merge (both display the category name) — intended.
 */
function reminderKey(a: Activity): string {
  const r = a.reminderPreferences;
  if (!r) return "r:none";
  return `r:${r.startEnabled ? 1 : 0},${r.endEnabled ? 1 : 0},${r.startLeadMinutes},${r.endLeadMinutes}`;
}

export function mergeKey(a: Activity): string {
  return [
    a.weekday,
    a.name.trim().toLowerCase(),
    a.categoryId,
    (a.subject ?? "").trim().toLowerCase(),
    reminderKey(a),
    a.optionalWorkOverride ?? "inherit",
  ].join("|");
}

export function computeMergedBlocks(activities: Activity[]): MergedBlock[] {
  const sorted = [...activities].sort((a, b) =>
    a.weekday !== b.weekday
      ? a.weekday - b.weekday
      : a.startTime !== b.startTime
        ? a.startTime - b.startTime
        : a.endTime - b.endTime,
  );
  const blocks: MergedBlock[] = [];
  for (const a of sorted) {
    const last = blocks[blocks.length - 1];
    if (
      last &&
      last.weekday === a.weekday &&
      last.endTime === a.startTime &&
      mergeKey(last.members[0]) === mergeKey(a)
    ) {
      last.members.push(a);
      last.endTime = a.endTime;
    } else {
      blocks.push({
        key: `blk_${a.id}`,
        weekday: a.weekday,
        startTime: a.startTime,
        endTime: a.endTime,
        members: [a],
      });
    }
  }
  return blocks;
}

/** All members of a block switch categories together (§8.3). */
export function blockCategory(block: MergedBlock): string {
  return block.members[0].categoryId;
}
