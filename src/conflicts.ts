import type { Activity } from "./types";

export interface Conflict {
  aId: string;
  bId: string;
  weekday: Activity["weekday"];
  overlapStart: number;
  overlapEnd: number;
  aName: string;
  bName: string;
}

export function overlaps(a: Activity, b: Activity): boolean {
  if (a.id === b.id || a.weekday !== b.weekday) return false;
  return a.startTime < b.endTime && b.startTime < a.endTime;
}

/** All pairwise conflicts in a timetable — spec §10. */
export function findConflicts(activities: Activity[]): Conflict[] {
  const out: Conflict[] = [];
  const sorted = [...activities].sort((x, y) =>
    x.weekday !== y.weekday ? x.weekday - y.weekday : x.startTime - y.startTime,
  );
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i];
      const b = sorted[j];
      if (a.weekday !== b.weekday) break;
      if (b.startTime >= a.endTime) break;
      if (overlaps(a, b)) {
        out.push({
          aId: a.id,
          bId: b.id,
          weekday: a.weekday,
          overlapStart: Math.max(a.startTime, b.startTime),
          overlapEnd: Math.min(a.endTime, b.endTime),
          aName: a.name,
          bName: b.name,
        });
      }
    }
  }
  return out;
}

/** Would `candidate` overlap anything (excluding itself)? */
export function conflictsForCandidate(
  candidate: Activity,
  activities: Activity[],
): Activity[] {
  return activities.filter((o) => o.id !== candidate.id && overlaps(candidate, o));
}

/**
 * Assign side-by-side lanes for overlapping activities within one day.
 * Returns map activityId → { lane, lanes } for rendering (§10.4).
 */
export function assignLanes(dayActivities: Activity[]): Map<string, { lane: number; lanes: number }> {
  const sorted = [...dayActivities].sort((a, b) => a.startTime - b.startTime || a.endTime - b.endTime);
  const result = new Map<string, { lane: number; lanes: number }>();
  // Cluster overlapping activities, then greedy-colour each cluster.
  let cluster: Activity[] = [];
  let clusterEnd = -1;
  const flush = () => {
    if (cluster.length === 0) return;
    const laneEnd: number[] = [];
    const assign = new Map<string, number>();
    for (const a of cluster) {
      let lane = laneEnd.findIndex((end) => end <= a.startTime);
      if (lane === -1) {
        lane = laneEnd.length;
        laneEnd.push(a.endTime);
      } else laneEnd[lane] = a.endTime;
      assign.set(a.id, lane);
    }
    for (const a of cluster)
      result.set(a.id, { lane: assign.get(a.id)!, lanes: laneEnd.length });
    cluster = [];
    clusterEnd = -1;
  };
  for (const a of sorted) {
    if (cluster.length > 0 && a.startTime >= clusterEnd) flush();
    cluster.push(a);
    clusterEnd = Math.max(clusterEnd, a.endTime);
  }
  flush();
  return result;
}
