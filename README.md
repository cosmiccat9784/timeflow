# Time Flow — visual weekly timetable planner

Tauri 2 desktop app (Windows, macOS, Linux) for planning a **repeating
Monday-to-Sunday timetable** in 15-minute blocks. Editing is immediate and
visual: click to select, shift-click for a multi-selection, double-click
Study ↔ Personal to switch, drag to move, right-click / long-press for every
category.

> Full product specification: see the handover document (Time Flow product
> spec, §§1–31). This repo implements **MVP + V1 + V2** (version 0.3.x,
> schema v4). Owner-directed deviations from the spec are listed under
> “Deviations” below.

## MVP feature checklist

- [x] Weekly grid, Mon–Sun, 15-min slots, 06:00–22:00 default visible range (§3.4, §4)
- [x] 15-min alignment + 15-min minimum enforced on every edit path (§4.2, Tests 4–5)
- [x] Quick create (click / drag empty slots, autocomplete reuses category+subject)
- [x] Full editor: name, category, weekday, start/end, subject, notes, optional-work override, reminder prefs (§6.3)
- [x] One-click Study ↔ Personal switch, configurable pair, undoable, 5 s toast (§7.3, Tests 7–8)
- [x] Context menu: all categories + Edit / Split / Duplicate / Delete / Swap (§9.2, Test 9)
- [x] Drag-move with snap preview, atomic swap (§9.3–9.6, Tests 6, 13, 24)
- [x] Keyboard: arrows navigate, Enter edit/switch, M move-mode, Del delete, Shift+F10 menu
- [x] Visual merging of compatible adjacent blocks; records stay separate; split workflow (§8, Tests 11–12, 25)
- [x] Conflict dialog on write (Move anyway / Cancel) — overlap banners and edge resize were removed by request
- [x] Undo/redo ×20, atomic commits, autosave with failure feedback (§11, Tests 8, 18–19)
- [x] Union-of-interval study + optional-work totals, per day and per week (§12, Tests 15–17)
- [x] Empty state + 16-activity sample timetable, one-action removal (§14, Tests 1–2)
- [x] Responsive week/day views, day tabs, swipe, bottom tabs; light/dark; reduced-motion; focus/ARIA/live regions (§5, §15, §27, Test 21)
- [x] Offline-first, local persistence, schema version + safe migration (§13–§24, Tests 18, 22–23, 26)
- [x] Vitest unit tests for time/totals/merge/conflicts/validation/import/export/persistence
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
npm test              # vitest: engines, import/export, persistence, audit regressions
npx tsc --noEmit      # type check
```

### Desktop packages (native runners — §23.11)

```bash
npx tauri icon src-tauri/icons/icon.svg   # one-off: generate store icons
npm run tauri build                       # bundle for the current OS
```

| OS | Output | Notes |
|---|---|---|
| Windows | `.exe` NSIS installer (per-user) | Data in per-user app-data dir; offline after install |
| macOS | `.dmg` (min 11.0, universal) | Ad-hoc signed automatically — see below |
| Linux | `.AppImage` + `.deb` | Tested on Ubuntu 22.04 |

CI (`.github/workflows/build.yml`) runs tests, bump the patch version, then
builds each bundle on its native runner and uploads artifacts.

### Opening the macOS build

The DMG is **ad-hoc signed** (not notarised — that needs a paid Apple Developer
ID). macOS therefore shows *“Time Flow is damaged and can’t be opened”* or
*“unidentified developer”* the first time.

If you see **damaged**, the download was quarantined before the signature was
applied. Clear the attribute once:

```bash
xattr -dr com.apple.quarantine "/Applications/Time Flow.app"
open "/Applications/Time Flow.app"
```

If you see **unidentified developer**, right-click the app → **Open** →
**Open**, or allow it in System Settings → Privacy & Security → *Open Anyway*.

The `.dmg` is a universal binary, so the same file runs on Apple Silicon and
Intel Macs.

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
  deadlines.ts    dated deadlines + relative labels
  records.ts      week records + timer helpers
  reminders.ts    due-reminder engine (quiet hours, visible window)
  backup.ts       JSON backup validation
  exportCsv.ts    CSV read/write
  exportExcel.ts  styled XLSX writer (visual sheet + flat Data sheet)
  importExcel.ts  XLSX analyser (reference layout + flat Data sheet)
  native.ts       Tauri/browser file dialogs
  sample.ts       §14 sample timetable
  components/
    PlannerGrid.tsx    grid + gesture state machine (§4, §5, §9, §10)
    ActivityEditor.tsx full editor + tap-to-set time picker (§6.3–6.4)
    CategoryMenu.tsx   context menu (§9.2)
    SettingsPanel.tsx  visible range, clock, switch pair, reminders (§5.6)
    CustomSelect.tsx   dark listbox (keyboard + type-ahead)
    CategoryManager.tsx, ImportWizard.tsx, TodayView.tsx, ProgressView.tsx,
    PrioritiesView.tsx, RecapModal.tsx, Toast.tsx, EmptyState.tsx, ColorPicker.tsx
  App.tsx         commit pipeline: validate → conflict-check → undoable commit
src-tauri/
  src/main.rs     Tauri 2: dialog/fs/notification/store plugins
  tauri.conf.json bundle targets nsis/dmg/appimage/deb, ad-hoc macOS signing
  capabilities/default.json
```

### Key architecture decisions

- **One gesture state machine** (`PlannerGrid`): click-vs-drag threshold (6 px),
  500 ms long-press → menu, 250 ms touch hold → drag. Gestures can't interfere
  (§9.1). Edge-resize was removed by request.
- **Atomic commits** (`App.commit`): every logical write validated whole;
  failure rejects everything, previous data intact (§11.3, §13.8).
- **Conflict flow** (`commitWithConflictCheck`): overlaps surface a dialog —
  *Move anyway* or *Cancel*. Blocks are never blocked from overlapping, and no
  overlap banner is drawn.
- **Totals** union intervals **per day**, then sum the days, so the same clock
  time on different weekdays counts each time (§12.3).
- **Storage**: `localStorage` key `timeflow.v1.state` works in dev browsers
  *and* the Tauri webview (per-user data dir, survives restart/upgrade).
  Schema v4 holds multiple timetables, categories, settings, week records,
  restore points and the running timer; v1–v3 states migrate losslessly with a
  rescue copy of corrupt payloads (§13.9).
- **Excel**: `exceljs` reads fills/merges for import and writes styled
  workbooks for export. The export also writes a flat **Data** sheet so the
  app's own workbook re-imports exactly.

## V1 — import, export, management

- Deadlines (dated since 0.3.1): all-day exam/assignment entries with real
  calendar dates — no repeating weekday pins. The Priorities tab orders them
  nearest-first (overdue, today, future) with a clear-past action; Today shows
  what's due; schema v3 weekday pins auto-migrate to their next occurrence.
  Per-timetable, undoable, in JSON backups.

- [x] Excel import tuned to the real reference workbook (weekday/weekend sections, repeated-cell runs, legend fills, summary exclusion, fuzzy days, PM assumption flagged)
- [x] CSV import into the same guided preview
- [x] Guided flow: file → sheet → preview/correct (invalid times need explicit fix or exclusion) → replace/merge/new-timetable
- [x] Restore point before every import; undoable
- [x] XLSX export (visual grid + flat Data sheet), CSV export, JSON backup/restore with validation
- [x] Category manager: add/rename/recolour/re-icon/counting, delete with mandatory replacement
- [x] Multiple named timetables (create/rename/delete/switch, shared categories+settings)

## V2 — tracking, reminders, progress

- [x] Explicit completion per activity (current week only)
- [x] Study timer: start/pause/resume/finish/+15/skip, timestamp-persisted across restarts, no double-counting
- [x] Reminders: start/end/at-end with lead times (global defaults honoured), quiet hours, visible-window gating, in-app banner + native notification attempt, duplicate-proof keys, honest test button
- [x] Today dashboard (now/next/timeline/totals) and Progress dashboard (planned vs recorded, by day/subject)
- [x] Sunday-midnight rollover: recap modal with CSV download, then only week records clear — template untouched

## Deviations (owner-directed, override the spec)

- **Click selects; double-click switches.** Spec §7.3/§9.1 single-click switching
  moved to double-click (keyboard: Enter edits, S switches) to stop accidental
  changes. One-gesture switching is preserved.
- **Shift-click multi-select** with a bulk *Delete selected* action.
- **Names optional.** Spec §6.4 required names; blank activities display their
  category instead.
- **Simpler default labels.** Sport / Study / Work / Meals / Extracurricular
  instead of the longer §7.2 names. Stored timetables adopt them only where the
  user never renamed the category.
- **Dark mode.** Spec §29 deferred it; implemented on request. Toggle in the
  sidebar or Settings → Appearance (fresh installs follow the OS preference).
  Every dropdown is a custom dark listbox; no native `<select>` remains.
- **No edge-resize, no overlap banner.** Both were removed by request.
- **No tip banner.** Removed by request; the shortcuts remain in the tooltips
  and the File menu.

## Acceptance tests

- Automated: `npm test` covers time alignment/minimum, merge/split, overlap
  detection, per-day and per-week totals, validation, deadlines, week records,
  reminders, backup/restore incl. old schemas, XLSX round-trip, dropdown
  keyboard behaviour, removed-feature guards and the macOS packaging contract.
- Manual: follow spec §28.1 Tests 1–26 in the running app (empty state →
  sample → create → switch → undo → menu → edit/delete → merge → move →
  totals → restart → failed-write → keyboard → responsive → offline →
  midnight → swap → merged-switch → invalid writes), then §28.4 packaging
  Tests 45–52 per OS.

## Privacy

Local-first, no accounts, no network calls, no analytics. Imports treated as
untrusted input; macros never executed; formulas never evaluated (§24).
