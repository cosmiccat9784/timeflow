import { formatDuration } from "../time";

// Sunday-midnight weekly recap (§22.2): previous week's planned vs
// completed, optional CSV download, then week records clear.

export interface RecapData {
  weekId: string;
  rows: { name: string; day: string; plannedMin: number; done: boolean; minutes: number }[];
  plannedStudyMin: number;
  recordedStudyMin: number;
  completedCount: number;
  activityCount: number;
}

export function RecapModal({
  recap,
  onDownload,
  onClose,
}: {
  recap: RecapData;
  onDownload: () => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Weekly recap">
        <h2>Week wrapped up ({recap.weekId})</h2>
        <p>
          📚 {formatDuration(recap.plannedStudyMin)} planned · {formatDuration(recap.recordedStudyMin)} recorded ·{" "}
          {recap.completedCount}/{recap.activityCount} marked done.
        </p>
        <p className="derived">
          Starting a fresh week clears last week's checkmarks and timer minutes.
          Your repeating timetable stays exactly as it is.
        </p>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onDownload}>Download CSV recap</button>
          <button type="button" className="btn primary" onClick={onClose} autoFocus>Start new week</button>
        </div>
      </div>
    </div>
  );
}

export function recapToCsv(recap: RecapData): string {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = ["Activity,Day,PlannedMin,Done,RecordedMin"];
  for (const r of recap.rows) {
    lines.push([esc(r.name), esc(r.day), String(r.plannedMin), r.done ? "yes" : "no", String(r.minutes)].join(","));
  }
  return lines.join("\r\n") + "\r\n";
}
