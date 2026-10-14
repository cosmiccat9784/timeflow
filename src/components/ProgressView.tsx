import type { Activity, Category, ClockFormat, WeekRecord } from "../types";
import { WEEKDAY_NAMES, displayName } from "../types";
import { allDayTotals, weekTotals } from "../totals";
import { countsAsOptionalWork, countsAsStudy } from "../validation";
import { formatDuration } from "../time";

// Progress dashboard — spec §22.4. Planned vs completed, current week
// only; never invents unrecorded history (§22.4, Test 44).

export function ProgressView({
  activities,
  categories,
  record,
  clockFormat,
}: {
  activities: Activity[];
  categories: Category[];
  record: WeekRecord;
  clockFormat: ClockFormat;
}) {
  void clockFormat;
  const days = allDayTotals(activities, categories);
  const week = weekTotals(activities, categories);

  const countByDay: Record<number, number> = {};
  for (let d = 0; d < 7; d++) {
    countByDay[d] = 0;
  }
  const subjPlanned = new Map<string, number>();
  const subjDone = new Map<string, number>();
  let optDone = 0;

  for (const a of activities) {
    const c = record.completed[a.id];
    const mins = c?.minutes ?? 0;
    if (c?.done) countByDay[a.weekday]++;
    if (countsAsOptionalWork(a, categories)) optDone += mins;
    if (a.subject) {
      subjPlanned.set(a.subject, (subjPlanned.get(a.subject) ?? 0) + (a.endTime - a.startTime));
      if (mins > 0) subjDone.set(a.subject, (subjDone.get(a.subject) ?? 0) + mins);
    }
  }
  // Completed study minutes per day: sum of recorded minutes on
  // study-counting activities (union-exactness applies to planned totals;
  // actuals are explicitly recorded session minutes).
  const studyDoneByDay: Record<number, number> = {};
  for (let d = 0; d < 7; d++) studyDoneByDay[d] = 0;
  for (const a of activities) {
    if (!countsAsStudy(a, categories)) continue;
    studyDoneByDay[a.weekday] += record.completed[a.id]?.minutes ?? 0;
  }
  const totalDoneMin = Object.values(studyDoneByDay).reduce((s, v) => s + v, 0);
  const totalCount = activities.filter((a) => record.completed[a.id]?.done).length;

  return (
    <div className="dash">
      <h2>Progress — this week</h2>
      <p className="derived">
        📚 {formatDuration(week.study)} planned · {formatDuration(totalDoneMin)} recorded ·{" "}
        💼 {formatDuration(week.optionalWork)} planned optional · {formatDuration(optDone)} recorded ·{" "}
        {totalCount}/{activities.length} marked done
      </p>
      <h3>By day</h3>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr><th>Day</th><th>Planned study</th><th>Recorded study</th><th>Marked done</th></tr>
          </thead>
          <tbody>
            {[0, 1, 2, 3, 4, 5, 6].map((d) => (
              <tr key={d}>
                <td>{WEEKDAY_NAMES[d]}</td>
                <td>{formatDuration(days[d].study)}</td>
                <td>{formatDuration(studyDoneByDay[d])}</td>
                <td>{countByDay[d]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3>By subject</h3>
      {subjPlanned.size === 0 ? (
        <p className="derived">No subjects recorded yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>Subject</th><th>Planned</th><th>Recorded</th></tr>
            </thead>
            <tbody>
              {[...subjPlanned.entries()].sort().map(([s, p]) => (
                <tr key={s}>
                  <td>{s}</td>
                  <td>{formatDuration(p)}</td>
                  <td>{formatDuration(subjDone.get(s) ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <h3>Activity detail</h3>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr><th>Activity</th><th>Planned</th><th>Done</th><th>Recorded</th></tr>
          </thead>
          <tbody>
            {[...activities]
              .sort((a, b) => a.weekday - b.weekday || a.startTime - b.startTime)
              .map((a) => (
                <tr key={a.id}>
                  <td>{displayName(a, categories)}</td>
                  <td>{formatDuration(a.endTime - a.startTime)}</td>
                  <td>{record.completed[a.id]?.done ? "✓" : "—"}</td>
                  <td>{formatDuration(record.completed[a.id]?.minutes ?? 0)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
