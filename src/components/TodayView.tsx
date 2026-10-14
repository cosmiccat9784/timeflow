import type { Activity, Category, ClockFormat, TimerState, Weekday, WeekRecord } from "../types";
import { WEEKDAY_NAMES, displayName } from "../types";
import { formatTime, formatDuration } from "../time";
import { categoryById } from "../categories";
import { countsAsStudy } from "../validation";
import { dayTotals } from "../totals";
import { formatElapsed, timerElapsedSec } from "../records";

// Today dashboard — spec §19. Current weekday at a glance: now, next,
// today's timeline with completion + timer actions.

export function TodayView({
  activities,
  categories,
  record,
  timer,
  epochMs,
  clockFormat,
  today,
  nowMin,
  onToggleComplete,
  onTimerStart,
  onTimerPause,
  onTimerResume,
  onTimerFinish,
  onTimerExtend,
  onTimerSkip,
  onEdit,
  onOpenPlanner,
}: {
  activities: Activity[];
  categories: Category[];
  record: WeekRecord;
  timer: TimerState | null;
  epochMs: number;
  clockFormat: ClockFormat;
  today: Weekday;
  nowMin: number;
  onToggleComplete: (id: string) => void;
  onTimerStart: (id: string) => void;
  onTimerPause: () => void;
  onTimerResume: () => void;
  onTimerFinish: () => void;
  onTimerExtend: () => void;
  onTimerSkip: () => void;
  onEdit: (a: Activity) => void;
  onOpenPlanner: (day: Weekday) => void;
}) {
  const todays = activities.filter((a) => a.weekday === today).sort((a, b) => a.startTime - b.startTime);
  const current = todays.filter((a) => a.startTime <= nowMin && nowMin < a.endTime);
  const upcoming = todays.filter((a) => a.startTime > nowMin);
  const next = upcoming[0];
  const nextStudy = upcoming.find((a) => countsAsStudy(a, categories));
  const totals = dayTotals(activities, categories, today);
  const doneMin = todays.reduce((s, a) => s + (record.completed[a.id]?.minutes ?? 0), 0);
  const doneCount = todays.filter((a) => record.completed[a.id]?.done).length;

  const timerFor = (id: string) => (timer && timer.activityId === id ? timer : null);
  const timerName = timer ? activities.find((a) => a.id === timer.activityId) : undefined;

  return (
    <div className="dash">
      <h2>{WEEKDAY_NAMES[today]} — today</h2>

      {timer && (
        <div className="timer-bar" role="status" aria-live="polite">
          <span className="timer-name">⏱ {timerName ? displayName(timerName, categories) : "Timer"}</span>
          <strong className="timer-elapsed">{formatElapsed(timerElapsedSec(timer, epochMs))}</strong>
          <span className="derived">target {formatDuration(timer.targetSec / 60)}</span>
          <div className="timer-actions">
            {timer.running
              ? <button type="button" className="btn small" onClick={onTimerPause}>Pause</button>
              : <button type="button" className="btn small" onClick={onTimerResume}>Resume</button>}
            <button type="button" className="btn small" onClick={onTimerFinish}>Finish</button>
            <button type="button" className="btn small" onClick={onTimerExtend}>+15 min</button>
            <button type="button" className="btn small" onClick={onTimerSkip}>Skip</button>
          </div>
        </div>
      )}

      <div className="dash-cards">
        <div className="dash-card">
          <h3>Now{current.length > 1 ? ` (${current.length})` : ""}</h3>
          {current.length === 0 ? (
            <p className="derived">Nothing scheduled — enjoy the gap.</p>
          ) : (
            current.map((a) => (
              <TodayRow
                key={a.id}
                a={a}
                categories={categories}
                clockFormat={clockFormat}
                done={!!record.completed[a.id]?.done}
                timerState={timerFor(a.id) ? (timer!.running ? "running" : "paused") : timer ? "busy" : "idle"}
                elapsed={timerFor(a.id) ? formatElapsed(timerElapsedSec(timer!, epochMs)) : null}
                onToggleComplete={() => onToggleComplete(a.id)}
                onTimerStart={() => onTimerStart(a.id)}
                onEdit={() => onEdit(a)}
              />
            ))
          )}
        </div>
        <div className="dash-card">
          <h3>Next</h3>
          {next ? (
            <>
              <p><strong>{displayName(next, categories)}</strong> at {formatTime(next.startTime, clockFormat)} ({formatDuration(next.startTime - nowMin)} to go)</p>
              {nextStudy && nextStudy.id !== next.id && (
                <p className="derived">Next study: {displayName(nextStudy, categories)} at {formatTime(nextStudy.startTime, clockFormat)}</p>
              )}
            </>
          ) : (
            <p className="derived">Nothing else today.</p>
          )}
          <h3 style={{ marginTop: 12 }}>Today's plan</h3>
          <p>📚 {formatDuration(totals.study)} planned · ✓ {formatDuration(doneMin)} recorded · {doneCount}/{todays.length} marked done</p>
          <button type="button" className="btn" onClick={() => onOpenPlanner(today)}>Open in planner</button>
        </div>
      </div>

      <h3>Timeline</h3>
      {todays.length === 0 ? (
        <p className="derived">No activities scheduled for {WEEKDAY_NAMES[today]}.</p>
      ) : (
        <ul className="timeline">
          {todays.map((a) => (
            <li key={a.id}>
              <TodayRow
                a={a}
                categories={categories}
                clockFormat={clockFormat}
                done={!!record.completed[a.id]?.done}
                timerState={timerFor(a.id) ? (timer!.running ? "running" : "paused") : timer ? "busy" : "idle"}
                elapsed={timerFor(a.id) ? formatElapsed(timerElapsedSec(timer!, epochMs)) : null}
                onToggleComplete={() => onToggleComplete(a.id)}
                onTimerStart={() => onTimerStart(a.id)}
                onEdit={() => onEdit(a)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TodayRow({
  a,
  categories,
  clockFormat,
  done,
  timerState,
  elapsed,
  onToggleComplete,
  onTimerStart,
  onEdit,
}: {
  a: Activity;
  categories: Category[];
  clockFormat: ClockFormat;
  done: boolean;
  timerState: "idle" | "running" | "paused" | "busy";
  elapsed: string | null;
  onToggleComplete: () => void;
  onTimerStart: () => void;
  onEdit: () => void;
}) {
  const cat = categoryById(categories, a.categoryId);
  return (
    <div className={`today-row${done ? " done" : ""}`}>
      <button
        type="button"
        className="check-btn"
        aria-pressed={done}
        aria-label={done ? `Mark ${displayName(a, categories)} not complete` : `Mark ${displayName(a, categories)} complete`}
        onClick={onToggleComplete}
      >
        {done ? "☑" : "☐"}
      </button>
      <span className="swatch" style={{ background: cat?.colour ?? "#eee" }} aria-hidden="true" />
      <span className="today-main">
        <strong>{displayName(a, categories)}</strong>
        <span className="derived"> {formatTime(a.startTime, clockFormat)}–{formatTime(a.endTime, clockFormat)}{cat ? ` · ${cat.name}` : ""}</span>
        {elapsed && <span className="timer-elapsed"> ⏱ {elapsed}</span>}
      </span>
      {timerState === "idle" && (
        <button type="button" className="btn small" onClick={onTimerStart}>Start</button>
      )}
      {timerState === "busy" && <span className="derived">timer busy</span>}
      <button type="button" className="btn small" onClick={onEdit}>Edit</button>
    </div>
  );
}
