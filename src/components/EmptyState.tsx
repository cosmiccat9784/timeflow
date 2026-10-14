/** First-launch empty state — spec §14. Sample creation + Excel/CSV
 *  import (V1) are both offered here. */
export function EmptyState({ onCreateSample, onImport }: { onCreateSample: () => void; onImport: () => void }) {
  return (
    <div className="empty" role="region" aria-label="Getting started">
      <div className="art" aria-hidden="true">🗓️</div>
      <h2>Plan your week, visually</h2>
      <p>
        TimeFlow is a repeating Monday-to-Sunday timetable. Create activities in
        15-minute blocks, double-click Study ↔ Personal to switch instantly, and see
        study totals update as you plan.
      </p>
      <p>Begin with a sample week, your empty timetable, or an existing spreadsheet.</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
        <button type="button" className="btn primary" onClick={onCreateSample}>
          Create Sample Timetable
        </button>
        <button type="button" className="btn" onClick={onImport}>
          Import Excel / CSV
        </button>
      </div>
    </div>
  );
}
