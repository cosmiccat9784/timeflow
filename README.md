# TimeFlow — visual weekly timetable planner

Tauri 2 desktop app (Windows, macOS, Linux) for planning a **repeating
Monday-to-Sunday timetable** in 15-minute blocks. Editing feels immediate and
visual: click Study ↔ Personal to switch instantly, drag to move, resize from
the edges, right-click / long-press for every category.

> Full product specification: see the handover document (TimeFlow product
> spec, §§1–31). This repo implements **MVP** completely and carries the
> architectural foundations for **V1** (Excel/CSV import-export, JSON backup,
> categories, multiple timetables) and **V2** (timers, reminders, progress).

## MVP feature checklist

- [x] Weekly grid, Mon–Sun, 15-min slots, 06:00–22:00 default visible range (§3.4, §4)
- [x] 15-min alignment + 15-min minimum enforced on every edit path (§4.2, Tests 4–5)
- [x] Quick create (click / drag empty slots, autocomplete reuses category+subject)
- [x] Full editor: name, category, weekday, start/end, subject, notes, optional-work override, reminder prefs (§6.3)
- [x] One-click Study ↔ Personal switch, configurable pair, undoable, 5 s toast (§7.3, Tests 7–8)
- [x] Context menu: all categories + Edit / Split / Duplicate / Delete / Swap (§9.2, Test 9)
- [x] Drag-move (snap preview), top/bottom resize, atomic swap (§9.3–9.6, Tests 6, 13, 24)
- [x] Keyboard: arrows navigate, Enter edit/switch, M move-mode, Del delete, Shift+F10 menu, Ctrl/Cmd+Z redo (§9.7, Test 20)
- [x] Visual merging of compatible adjacent blocks; records stay separate; split workflow (§8, Tests 11–12, 25)
- [x] Overlap detection, conflict dialog (Move anyway / Cancel), lane rendering, flagged banner (§10, Test 14)
- [x] Undo/redo ×20, atomic commits, autosave with failure feedback (§11, Tests 8, 18–19)
- [x] Union-of-interval study + optional-work totals, daily + weekly (§12, Tests 15–17)
- [x] Empty state + 16-activity sample timetable, one-action removal (§14, Tests 1–2)
- [x] Responsive week/day views, day tabs, swipe, bottom tabs; light UI; reduced-motion; focus/ARIA/live regions (§5, §15, §27, Test 21)
- [x] Offline-first, local persistence, schema version + safe migration (§13–§24, Tests 18, 22–23, 26)
- [x] Vitest unit tests for time/totals/merge/conflicts/validation
- [x] Tauri 2 packaging config + CI for Windows/macOS/Linux (§23)

## Getting started

### Prerequisites

| Tool | Version | Install |
|---|---|---|
| Node.js | 20+ | https://nodejs.org |
| Rust | stable | https://rustup.rs |
| Tauri system deps (Linux) | — | `sudo apt install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libfuse2` |

### Run in development

```bash
npm install
npm run tauri dev     # Vite on :1420 inside the Tauri window
# …or web-only preview:
npm run dev           # plain browser, same app (persistence via localStorage)
```

### Tests

```bash
npm test              # vitest: time, totals, merge, conflicts, validation
```

### Desktop packages (native runners — §23.11)

```bash
npx tauri icon src-tauri/icons/icon.svg   # one-off: generate store icons
npm run tauri build                       # bundle for the current OS
```

| OS | Output | Notes |
|---|---|---|
| Windows | `.exe` NSIS installer (per-user) | Data in per-user app-data dir; offline after install |
| macOS | `.dmg` (min 11.0) | Document signing/notarisation per release |
| Linux | `.AppImage` + `.deb` | Tested on Ubuntu 22.04; `.rpm` optional (V1) |

CI (`.github/workflows/build.yml`) runs tests, then builds each bundle on its
native runner and uploads artifacts.

## Project structure

```
src/
  types.ts        §13 data model (ids, schema version, no stored duration)
  categories.ts   §7 defaults + name→category heuristics
  time.ts         §4  15-min engine (align/snap/format/parse)
  validation.ts   §13.8 write validation (whole-write reject)
  totals.ts       §12 union-of-interval study/optional-work totals
  merge.ts        §8  visual-merge detection (records never combined)
  conflicts.ts    §10 overlap detection + lane assignment
  undo.ts         §11 20-entry snapshot history
  store.ts        persistence, autosave, migration (§11.4, §13.9, §23.6)
  sample.ts       §14 sample timetable
  components/
    PlannerGrid.tsx    grid + gesture state machine (§4, §5, §9, §10)
    ActivityBlock logic lives here (presentational blocks + delegated input)
    ActivityEditor.tsx full editor (§6.3–6.4)
    CategoryMenu.tsx   context menu (§9.2)
    SettingsPanel.tsx  visible range, clock, switch pair (§5.6)
    EmptyState.tsx     first launch (§14)
    Toast.tsx          save/switch feedback + Undo (§11.2)
  App.tsx         commit pipeline: validate → conflict-check → undoable commit
src-tauri/
  src/main.rs     Tauri 2: dialog/fs/notification/store plugins, app_version,
                  test_notification commands (notification UI lands in V2)
  tauri.conf.json bundle targets nsis/dmg/appimage/deb, per-user install
  capabilities/default.json
```

### Key architecture decisions

- **One gesture state machine** (`PlannerGrid`): click-vs-drag threshold (6 px),
  500 ms long-press → menu, 250 ms touch hold → drag, resize engages
  immediately. Gestures can't interfere (§9.1).
- **Atomic commits** (`App.commit`): every logical write validated whole;
  failure rejects everything, previous data intact (§11.3, §13.8).
- **Conflict flow** (`commitWithConflictCheck`): overlaps surface a dialog —
  *Move anyway* (kept visible + flagged) or *Cancel* (unchanged). Swap is
  never offered as a generic fix; the explicit ⇄ menu action validates both
  positions atomically (§9.6, §10.2).
- **Totals** use interval unions so overlaps count once (§12.3).
- **Storage**: `localStorage` key `timeflow.v1.state` works in dev browsers
  *and* the Tauri webview (per-user data dir, survives restart/upgrade).
  `tauri-plugin-store` is wired for the V1 move to file-backed settings/backups;
  schema migrations keep a rescue copy of corrupt payloads (§13.9).

## Roadmap (kept, not dropped — §2)

- **V1**: Excel/CSV import with guided preview (§16), XLSX/CSV export + JSON
  backup (§17), category management (§7.6), multiple timetables (§18).
  Stubs: `test_notification`/`app_version` commands, reminder prefs stored per
  activity, `subjects` list, `switchPair` setting.
- **V2**: completion, timer, reminders/quiet hours, today/progress dashboards,
  Sunday-midnight rollover (§§19–22). Reminder prefs + lead times are already
  stored so V2 scheduling has the data it needs.

## Acceptance tests

- Unit: `npm test` covers Tests 4–5 (alignment/minimum), 11–12 (merge/split),
  14 (overlap+lanes), 15–17 (totals incl. union + override), 26 (validation).
- Manual: follow spec §28.1 Tests 1–26 in the running app (empty state →
  sample → create → switch → undo → menu → edit/delete → merge → move/resize →
  overlap → totals → restart → failed-write → keyboard → responsive → offline →
  midnight → swap → merged-switch → invalid writes), then §28.4 packaging
  Tests 45–52 per OS.

## Privacy

Local-first, no accounts, no network calls, no analytics. Imports treated as
untrusted input; macros never executed; formulas never evaluated (§24).
