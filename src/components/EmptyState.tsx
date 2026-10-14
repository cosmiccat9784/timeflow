/** First-launch empty state — spec §14. MVP shows sample creation only
 *  (no dead Import button, per §14.1). */
export function EmptyState({ onCreateSample }: { onCreateSample: () => void }) {
  return (
    <div className="empty" role="region" aria-label="Getting started">
      <div className="art" aria-hidden="true">🗓️</div>
      <h2>Plan your week, visually</h2>
      <p>
        TimeFlow is a repeating Monday-to-Sunday timetable. Create activities in
        15-minute blocks, click Study ↔ Personal to switch instantly, and see
        study totals update as you plan.
      </p>
      <p>Two ways to begin: start empty, or load a sample week to explore.</p>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" className="btn primary" onClick={onCreateSample}>
          Create Sample Timetable
        </button>
      </div>
      <p>
        <small>Excel import arrives in V1 — the guided preview will map your real spreadsheet here.</small>
      </p>
    </div>
  );
}
