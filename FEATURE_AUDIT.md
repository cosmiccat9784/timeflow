# Time Flow — Complete Feature Audit

**Audited revision:** `8607c59` (“Dark-ify all dropdowns: CustomSelect everywhere, no native selects left”), app version **0.3.7**, schema **v4**.
**Audit date:** 22 November 2026.
**Scope:** the entire Time Flow Tauri/React application in this repository — `src/`, `src-tauri/`, build/CI configuration, tests, and release setup.
**Explicitly excluded:** `MinecraftTransitNetwork`, `MTNProbe`, `MTNProbeB`, and all Minecraft-related assets/folders. Nothing in those folders was read or tested.

---

## How this audit was done

| Method | What it covers |
|---|---|
| Full source review | Every non-Minecraft source file: `App.tsx`, all 15 components, all engine/util modules, tests, CSS, Tauri Rust/config, Vite config, CI workflow, README. |
| Automated tests | `npm test` — **10 files, 189 passed, 1 skipped**. |
| Production build | `npm run build` — **passes** (`tsc` + Vite, exit 0). One warning: main JS chunk is 1.2 MB (355 kB gzip). |
| Live app testing | App run under Vite at `http://localhost:1420/`; every major screen, menu, modal and dialog exercised through the browser (real DOM events and real React handlers). |
| Data inspection | `localStorage` state and downloaded CSV/JSON/XLSX files inspected directly. |

### Status legend

| Icon | Meaning |
|---|---|
| ✅ | Works — **empirically verified** in the running app. |
| 🟢 | Works — **code-verified**; not exercised in this environment (e.g. needs a system clock change, native OS dialog, or mobile viewport). |
| ⚠️ | Works, but with a real caveat/limitation (described). |
| ❌ | Broken, incorrect, or misleading behaviour (reproduced). |
| 🚫 | Intentionally removed/hidden — tests or code assert it should not exist. |
| ❓ | Cannot be verified in this environment. |

> **Note on the moving target:** the repository was edited and committed by the owner during the audit (versions 0.3.1 → 0.3.7, native `<select>` → `CustomSelect`, removal of resize handles/overlap banner). Runtime checks were re-run on the final HEAD for the affected screens. Where runtime evidence came from the immediately preceding 0.3.6 build and the code did not change, it is marked 🟢 rather than ✅.

---

## 1. Verdict at a glance

Time Flow is a genuinely complete, well-structured local-first planner. The core editing loop (grid → editor → save → undo), multiple timetables, categories, import/export/backup, deadlines, timer, reminders, dashboards and theming all work and are pleasant to use.

It is **not** bug-free. The most important problems found:

| # | Severity | Problem | Where |
|---|---|---|---|
| 1 | **High** | Weekly study/optional totals are wrong whenever the same clock-time is used on more than one weekday. They union intervals across all seven days. Sample week shows **2 h** instead of **5 h**. | `src/totals.ts:55-63` |
| 2 | **High** | Settings → Reminders lead times are dead for all normal activities. New/edited activities hard-code **5/5** and always store `reminderPreferences`, so the global 10/15 defaults are never consulted. | `App.tsx:917-918`, `ActivityEditor.tsx:44-45,64-69` |
| 3 | **Medium** | Merging an import that conflicts shows **“Imported N.”** *while the conflict dialog is still open*. Cancelling the dialog imports nothing but leaves the false success toast. | `App.tsx:562-601` |
| 4 | **Medium** | Restore shows an **Undo** toast, but Undo does not restore the pre-restore state — it undoes the previous ordinary action (verified). A restore point is saved, so recovery is possible via Settings. | `App.tsx:635-660` vs `307-317` |
| 5 | **Medium** | Excel export → Excel import does **not** round-trip. Re-importing the app’s own workbook produced 31 proposals, only 11 valid, with junk rows named “1h”, “0m”, “Saturday” and wrong category guesses. | `exportExcel.ts` vs `importExcel.ts` |
| 6 | **Medium** | JSON restore rejects every backup whose schema version is not exactly v4, even though `migrateState` supports v1–v3. Old backups cannot be restored. | `backup.ts:44-46` |
| 7 | **Medium-Low** | Restore does not validate deadlines (activities and categories are validated, deadlines are not). | `backup.ts:52-63` |
| 8 | **Medium-Low** | Timer started in timetable A keeps showing in the toolbar after switching to timetable B, but Today hides its timer bar → the timer cannot be finished. | `App.tsx:1069` vs `1165` |
| 9 | **Low** | In packaged Tauri builds, cancelling a save dialog reports success, so “Excel exported.” / “CSV exported.” / “Backup saved.” toast even though nothing was written. | `native.ts:67` |
| 10 | **Low** | Settings footer says **“schema v2”** although the schema is v4. | `SettingsPanel.tsx:203` |
| 11 | **Low** | Midnight is labelled “12:00 am”/“00:00” in two different dropdown entries (0 and 1440), so the two options are indistinguishable. | `time.ts:26-34`, `SettingsPanel.tsx:6-10` |
| 12 | **Low** | New-activity time picker ignores the user’s visible-range setting (always 06:00–22:00) and the second tap includes the tapped quarter (tap 17:00 → end 17:15). | `ActivityEditor.tsx:92-94,122-130`, `App.tsx:1249-1256` |
| 13 | **Low** | “Send test notification” always claims success, even when the browser/OS permission is denied (verified: `Notification.permission === "denied"`). | `App.tsx:780-783` |
| 14 | **Low** | “Remove all activities in this timetable” executes immediately with **no confirmation** (undoable, but easy to trigger). | `App.tsx:956-961` |
| 15 | **Low** | Shift-click multi-select only highlights blocks; there is no bulk action attached to the selection. | `App.tsx:1136-1145` |
| 16 | **Low** | Reminders only fire for the **active** timetable, only while the app is running, and only within a 90-second window checked every 30 s. | `App.tsx:764-778`, `reminders.ts:26-65` |
| 17 | **Low** | README still advertises drag-resize, overlap banner/flagged blocks, “no network calls” and old versions/schema that no longer match the code. | `README.md` |
| 18 | **Low** | Custom dropdowns have no arrow-key option navigation or type-ahead (listbox roles but buttons only). Native selects are gone, so this is the only dropdown experience. | `CustomSelect.tsx` |

---

## 2. Feature inventory — every screen and control

### 2.1 App shell, boot and persistence

| Feature | Status | Detail |
|---|---|---|
| Boot from `localStorage` (`timeflow.v1.state`) | ✅ | State loads and survives reload. |
| First-run defaults | ✅ | One empty timetable, 9 categories, light/dark from OS preference, visible 06:00–22:00, 12-hour clock, switch pair Study↔Personal, leads 5/5, quiet hours 22:00–07:00. |
| Autosave | ✅ | Debounced ~400 ms; sidebar status shows “Saving…” then “Saved h:mm”. |
| Save-failure message | 🟢 | Writes a red “Time Flow could not save…” status if `localStorage.setItem` throws. |
| Schema version + migration v1→v4 | 🟢 | `migrateState` handles v1, v2, v3, v4; corrupt payload is copied to `…corrupt.<ts>` before resetting. |
| Weekly records | 🟢 | Per timetable + ISO week (Monday date); completion, minutes and delivered reminder keys. |
| Restore points | ✅ | Max 5, created before imports, JSON restores and restore-point restores; visible in Settings with Restore buttons. |
| Running timer persistence | 🟢 | Stored in state with timestamps; elapsed is derived, so a reload keeps counting. |
| Undo history | ✅ | 20 snapshots; in-memory only (cleared on reload). |
| Archive/pruning on rollover | 🟢 | Old week records are deleted after the recap (latest week only). |

### 2.2 Sidebar

| Control | Status | Detail |
|---|---|---|
| “Timetable” dropdown | ✅ | Custom listbox; options are `Name (activity count)`. Switching clears selection and announces the switch. |
| `＋` New timetable | ✅ | `window.prompt` with default “Timetable N”; creates and switches; undoable. |
| `✎` Rename timetable | ✅ | Prompt prefilled with current name; no-op on blank/unchanged. |
| `🗑` Delete timetable | ✅ | Confirm includes activity count; refuses to delete the last one (“Keep at least one timetable.”); undoable. |
| Views: 🗓 Planner / ● Today / 📌 Priorities / 📈 Progress | ✅ | Each switches the main screen; active item highlighted. |
| “This week · Name” totals card | ❌ | Displays weekly Study and Optional-work totals, but the numbers are wrong when the same times recur on multiple days (see Bug 1). Per-day numbers are correct. |
| 🏷 Categories | ✅ | Opens the category manager. |
| ⚙ Settings | ✅ | Opens Settings. |
| 🌙 Dark mode / ☀ Light mode | ✅ | Toggles instantly; label flips; theme persisted. |
| Save status | ✅ | Live “Saving…”/“Saved…” text. |
| Brand/logo block | 🚫 | CSS contains `.brand` styling, but `App.tsx` renders no brand element (dead CSS). |

### 2.3 Planner toolbar

| Control | Status | Detail |
|---|---|---|
| `File ▾` | ✅ | Opens the File menu; closes on outside click or Escape. |
| Screen title | ✅ | Timetable name in Planner; “Today”/“Priorities”/“Progress” elsewhere. |
| Week / Day segmented control | ✅ | Day view shows one column; Week shows all seven. |
| `Today` | ✅ | Sets the visible day to today (and keeps current view). |
| `＋ New activity` | ⚠️ | Opens the editor with **no time preset**; Save shows “Tap the grid to choose a start and end time first.” until a slot is tapped. (Slot-click creation does prefill.) |
| Study/optional totals beside the buttons | ❌ | Day view uses correct day totals; Week view uses the buggy weekly union. |
| Timer chip (`⏱ … · Finish…`) | ⚠️ | Appears on all non-Today screens when any timer exists (even one belonging to another timetable); click opens Today. See Bug 8. |
| `↩` Undo / `↪` Redo | ✅ | Disabled when empty; tooltips “Undo (Ctrl+Z)”, “Redo”. |
| `🖨` Print | ✅ | Calls `window.print()`; print stylesheet hides chrome and prints a clean landscape timetable. |
| `⛶` Focus mode | ✅ | Adds `.app.focus` (hides sidebar/toolbar/tabs), shows “✕ Exit focus (Esc)”; F11 also toggles. |
| `⚙` Settings | ✅ | Toolbar gear opens the same Settings dialog. |

### 2.4 File menu

| Item | Status | Detail |
|---|---|---|
| `⬇ Import…` | ✅ | Opens the import wizard. |
| `⬆ Excel` | ⚠️ | Downloads a styled `.xlsx` (verified 8,106 bytes for the sample). Toast “Excel exported.” In Tauri, cancelling the save dialog still toasts success. |
| `⬆ CSV` | ⚠️ | Downloads a UTF-8 CSV (verified headers and rows). Same cancel caveat as Excel. |
| `💾 Backup` | ⚠️ | Downloads `timeflow-backup-YYYY-MM-DD.json` (verified schemaVersion 4, full data). Same cancel caveat. |
| `↩ Restore…` | ⚠️ | File picker → validation → confirm → restore point → apply → “Backup restored.” + Undo. Verified end-to-end. Undo does not undo the restore (Bug 4); old-schema backups are rejected (Bug 6); deadlines unvalidated (Bug 7). |
| `🖨 Print…` | ✅ | Same as the print button. |
| `↩ Undo: <label>` | ✅ | Label describes the last commit, e.g. “Undo: Deleted deadline Audit deadline”. Disabled when empty. |
| `↪ Redo` | ✅ | Re-applies the undone commit. |

### 2.5 Weekly/day grid (Planner)

| Interaction/feature | Status | Detail |
|---|---|---|
| Mon–Sun columns with per-day headers | ✅ | Header shows day name, orange border on today, and per-day study (and optional-work when > 0). |
| Hour ruler | ✅ | Labels every hour from ceil(visible start) to visible end. |
| Auto-fit row height | ✅ | Rows stretch to fill the window down to a 14 px minimum, then scroll. |
| Click empty slot | ✅ | Opens New activity preset to 60 minutes from the clicked slot. |
| Drag empty slot | 🟢 | Live preview; creates the dragged range (minimum 15 min) on release. |
| Right-click empty slot | ✅ | Menu “Monday · 08:00 → ＋ New activity here”. |
| Long-press empty slot (touch/mouse 500 ms) | 🟢 | Same empty-slot menu. |
| Click block | ✅ | Selects it (orange outline). |
| Shift-click block | ⚠️ | Adds to a visual multi-selection; **no bulk operation exists**. |
| Double-click Study/Personal block | ✅ | Instantly switches to the paired category (verified Study→Personal and back). |
| Drag block | 🟢 | Snap-to-15-min move, including across days; live preview; midnight-crossing rejected with a toast. |
| Resize block by dragging edges | 🚫 | Removed. No resize handles are rendered; `edge` is always `null`. CSS rules remain (dead). Tests assert handles must not exist. |
| Conflict highlighting on blocks / banner | 🚫 | Removed. `conflictIds` is passed but unused; `hasConflict` is hard-coded `false`; tests assert the overlap card is gone. |
| Overlap lane rendering | 🟢 | Overlapping activities are laid side-by-side (greedy lane assignment). |
| “Now” line | 🟢 | Red line on today’s column between visible start/end. |
| Blocks clipped at visible bounds | 🟢 | Flat top/bottom edge + accessible description (“continues before/after the visible range”). |
| Completion checkbox on block | ✅ | Only Study/optional-work blocks get it; toggling marks done, adds ✓ badge, dims block. |
| Timer badge on block | 🟢 | ⏱ badge on the activity whose timer is running (only for the active timetable). |
| Merged blocks | ✅ | Adjacent identical activities render as one block with member dividers and “×N merged — switches together”. Duplicate produced a 2 h merged block. |
| Block keyboard: Enter | ✅ | Opens the editor. |
| `S` | ✅ | Switches Study↔Personal (only when the block belongs to the configured pair). |
| `M` + arrows + Enter | 🟢 | Keyboard move mode with preview; Escape cancels. |
| Delete / Backspace | 🟢 | Deletes the focused block (undo toast). |
| Shift+F10 / ContextMenu key | 🟢 | Opens the category menu at the block. |
| Arrow Up/Down/Left/Right | 🟢 | Moves focus between blocks / days. |
| Drag threshold / long-press / touch-hold | ✅ (code) | 6 px move, 500 ms long-press, 250 ms touch hold; prevents gesture cross-talk. |
| Touch swipe in Day view | 🟢 | Horizontal swipe > 60 px changes the day. |
| Empty state | ✅ | “Plan your week, visually” with **Create Sample Timetable** and **Import Excel / CSV**. |

### 2.6 Activity editor (New / Edit dialog)

Every field, in order:

| Field / control | Status | Detail / options |
|---|---|---|
| Name (text, optional) | ✅ | Placeholder “e.g. Mathematics homework, or blank for just ‘Study’”. Datalist of up to 50 existing names. Typing an exact known name copies its category and (if empty) subject for new activities. |
| Category — **CustomSelect** | ✅ | 9 options: 📚 Study, 🌿 Personal, 🚌 Transport, 🏊 Sport, 🎵 Extracurricular, 😴 Rest, 💼 Work, 🍽️ Meals, ▫️ Other. Marked required. Selecting manually disables name-based auto-category. |
| Weekday — **CustomSelect** | ✅ | 7 options: Monday … Sunday. Defaults to today (or the clicked column). |
| Time picker — grid of 15-min squares | ⚠️ | New activities: must tap to set. Existing: tap to adjust. Range is **always 06:00–22:00** (component defaults) even if Settings says 07:00–23:00. First tap = start + 15 min; second tap (later) sets end **to tapped slot + 15 min** (tap 17:00 → 17:15). “Clear selection” resets. Occupied slots are hatched but still selectable. |
| Start / End — **CustomSelect** (25… actually 97 options, 0–1440 step 15) | 🚫 (hidden) | Present in the DOM inside a `display:none` row for existing activities. Unreachable in the UI. Dead controls; time changes go through the picker. |
| Duration + inline validation | ✅ | Shows “Duration: Xh Ym” and the first validation warning live. |
| Subject (text, optional) | ✅ | Datalist from stored subjects + activity subjects. |
| Optional-work counting — **CustomSelect** | ✅ | 3 options: Follow category default / Count as optional work / Do not count as optional work. |
| Notes (textarea, optional) | ✅ | 2 rows. |
| Remind before start (checkbox) + lead **CustomSelect** | ⚠️ | Checkbox works; lead options 0/5/10/15/30 min. Defaults to **5**, ignoring Settings 10/15 (Bug 2). |
| Remind before end (checkbox) + lead **CustomSelect** | ⚠️ | Same; default 5. |
| Save | ✅ | Validates whole activity; errors appear in a red box and the dialog stays open. On success commits with conflict dialog if needed. |
| Cancel (Esc) | ✅ | Closes without saving; Escape also works. |
| Duplicate | ✅ | Existing activities only; clones immediately after (clamped to midnight); merged-block aware. |
| Delete | ✅ | Existing only; deletes with “Deleted.” + Undo toast. |
| Merged-block notice | 🟢 | Explains you are editing one member of a merged visual block and that a differing edit may split it. |
| Validation rules | ✅ | Category exists; weekday 0–6; 0 ≤ start < end ≤ 1440; 15-min alignment; ≥ 15 min; category cannot count to study and optional simultaneously; override ∈ inherit/yes/no; reminder lead 0–120. |

### 2.7 Category context menu (right-click / long-press on a block)

| Item | Status | Detail |
|---|---|---|
| Category list | ✅ | All 9 categories with colour swatch, icon, current ✓. Selecting one commits the change (with conflict check). |
| ✏️ Edit… (Enter) | ✅ | Opens the editor for the first member. |
| ✓ Mark complete / ○ Mark not complete | ✅ | Only shown for Study/optional-work blocks. Toggles every member of a merged block. |
| ⏱ Start timer | 🟢 | Starts a timer for the first member; refuses if another timer is running. |
| ✂️ Split block (N parts) | 🟢 | Only for merged blocks. Opens the editor scoped to the tail member; saving a differing name/category/reminder breaks the visual merge (records were never merged). |
| ⧉ Duplicate | ✅ | Clones the block immediately after the current end; toast + Undo. |
| ⇄ Swap with another… | 🟢 | Enters swap mode (banner “Swap mode: click the activity to swap with …”). Swap is atomic and validates both sides; merged blocks are rejected. |
| 🗑 Delete | ✅ | Deletes all members; “Deleted.” + Undo. |
| Placement / dismissal | ✅ | Repositioned to stay on-screen; first item focused; closes on outside click/Escape. |
| Arrow-key navigation inside menu | ❌ | Not implemented (only first-item focus + Escape). |

**Empty-slot menu:** “Monday · 08:00” + “＋ New activity here” → opens editor preset with a 60-minute range.

### 2.8 Category manager (Settings-adjacent dialog)

| Control | Status | Detail |
|---|---|---|
| Table columns | ✅ | Icon, Name, Colour, Counts toward, Used by, Delete. |
| Icon (text input) | ✅ | Free text/emoji. |
| Name (text input) | ✅ | Required; duplicate names blocked on save. |
| Colour | ✅ | 8 preset swatches + native colour picker. |
| Counts toward — **CustomSelect** | ✅ | 3 options: 📚 Study / Neither / 💼 Optional work. Verified changing and discarding. |
| Used by | ✅ | Counts activities across **all** timetables. |
| Delete | ✅ | Shows “‘X’ is used by N activities. Move them to [Replacement CustomSelect]”; Confirm delete / Keep. Replacement cannot be the deleted category. |
| `＋ Add category` | ✅ | Adds “Category N” with neutral colour/icon. |
| `Save categories` | ✅ | Validates non-empty unique names and not-both counting; remaps activities from deleted categories; commit + Undo. |
| `Cancel` / backdrop / Escape | ✅ | Discards all draft edits (verified). |
| Empty category list | ⚠️ | The manager allows deleting down to zero categories (no guard); the editor then falls back to `DEFAULT_CATEGORIES`. Untested destructively. |

### 2.9 Settings dialog

| Control | Status | Detail |
|---|---|---|
| Visible day starts — **CustomSelect** | ✅ | 25 options, 0 → 1440 in 60-min steps. Changes grid immediately. |
| Visible day ends — **CustomSelect** | ⚠️ | Same 25 options. Must be > start or a toast rejects it. Midnight duplicates (0 / 1440) share the label “12:00 am” (or “00:00”). |
| Note under range | ✅ | “Changing the visible range never deletes activities outside it (§3.4).” True — they are merely hidden (verified: a 06:30 activity disappeared from a 07:00 start grid while still counted in the timetable). |
| Clock format | ✅ | 12-hour / 24-hour radios; updates all times. |
| Quick-switch pair | ✅ | Two **CustomSelects** (all categories) + ⇄. Choosing the same category twice is rejected: “Quick-switch needs two different categories.” |
| Appearance | ✅ | Light / Dark radios; persisted. |
| Confirmation popups | ✅ | Checkbox. Off suppresses routine toasts (verified: a category change produced no toast); errors still shown. |
| Reminders → Before start (min) — **CustomSelect** | ⚠️ | Options 0/5/10/15/30. Stored but **ignored** by editor-created activities (Bug 2). |
| Reminders → Before end (min) — **CustomSelect** | ⚠️ | Same. |
| Reminder at end | ✅ (code) | Global “finished” reminder toggle; respected by `computeDueReminders`. |
| Quiet hours (enable checkbox + start/end `type=time`) | ✅ (code) | Default 22:00–07:00; disabling stores `null/null`; inputs disabled when off. No reminder fires inside quiet hours. |
| Notifications → Send test notification | ⚠️ | Always toasts “Test notification sent — check your system notifications and the banner here.”, even when permission is denied (verified). In Tauri it also attempts a native notification. |
| Restore points | ✅ | List of up to 5 with label, locale date/time and Restore. Verified applying one; Undo afterwards reverted that restore (commit-based). |
| Version footer | ❌ | “0.3.7 · **schema v2** · English (Australia), week starts Monday” — schema is v4. Locale/week-start claim is correct but hard-coded. |
| Close | ✅ | Also closes on backdrop click and Escape. |
| Remove all activities in this timetable (undoable) | ⚠️ | Deletes all activities in the active timetable immediately (no confirm), closes Settings, toast + Undo. |

### 2.10 Today dashboard

| Feature | Status | Detail |
|---|---|---|
| “<Weekday> — today” heading | ✅ | Uses the real current weekday. |
| Timer bar | ✅ | Shows activity name, elapsed `mm:ss`/`h:mm:ss`, target, and Pause/Resume, Finish, +15 min, Skip. Verified pause, resume, extend (target 1 h → 1 h 15 m) and finish. |
| Now card | ✅ | Lists activities whose start ≤ now < end, or “Nothing scheduled — enjoy the gap.” |
| Next card | ✅ | Next activity + time-to-go, or “Nothing else today.”; also “Next study: …” when the next study block isn’t the next block. |
| Today’s plan | ⚠️ | Planned study (day union), recorded minutes, “N/M marked done”. Completing a block increments marked-done but **does not** add recorded minutes; only the timer records minutes (finish rounds to whole minutes; verified “Recorded 0m.” for a sub-minute run). |
| Open in planner | ✅ | Switches to Planner → Day view on today. |
| Due deadlines | 🟢 | Lists deadlines dated today or earlier with relative labels. |
| Timeline list | ✅ | Each row: completion checkbox (Study/optional only), colour swatch, name, time range, category, optional running elapsed; Start and Edit buttons. |
| Timer for another timetable | ❌ | Toolbar shows the timer, but Today receives `null` unless `timer.timetableId === active.id`, so the bar (and Finish) disappears after switching timetables (Bug 8). |

### 2.11 Priorities dashboard

| Feature | Status | Detail |
|---|---|---|
| Sorted deadline list | ✅ | Nearest first; overdue at top, red border; rank circles. |
| Overdue/today/upcoming labels | ✅ | “Overdue by N days”, “Yesterday · overdue”, “Today”, “Tomorrow”, “In N days”. |
| `＋ New deadline` | ✅ | Opens an inline card form. |
| Form: Title (required) | ✅ | Validation: “Give the deadline a title.” |
| Form: Date (required, `type=date`) | ✅ | Defaults to today; invalid calendar dates rejected. |
| Form: Subject (optional) | ✅ | Datalist of known subjects. |
| Form: Notes (optional) | ✅ | Textarea. |
| Save / Cancel | ✅ | Verified add (“Audit deadline”, “In 9 days”, toast + Undo). |
| Edit | ✅ | Prefills title/date/subject/notes; verified. |
| Delete | ✅ | Verified; “Deadline deleted.” + Undo. |
| `Clear N past` | 🟢 | Only shown when past deadlines exist; commits “Cleared N past deadlines” with Undo. |
| Empty state | ✅ | “No deadlines yet — add exams or assignments with ＋ New deadline.” |

### 2.12 Progress dashboard

| Feature | Status | Detail |
|---|---|---|
| Header summary | ❌ | “📚 X planned · Y recorded · 💼 Z planned optional · W recorded · N/M marked done”. The planned study/optional numbers use the buggy weekly union (sample: **2 h** instead of 5 h). |
| By day table | ✅ | Day / Planned study / Recorded study / Marked done. Per-day values are correct (sample Mon 1 h, Tue 1 h, Wed 1h30, Thu 1 h, Fri 0, Sat 0, Sun 30m). |
| By subject table | ⚠️ | Planned = sum of all activities with that subject (regardless of study/optional counting); Recorded = timer minutes for that subject. Empty state “No subjects recorded yet.” |
| Activity detail table | ✅ | Every activity with Planned / Done ✓/— / Recorded. |
| Historical weeks | 🚫 | Only the current week is shown; old records are deleted at rollover. |

### 2.13 Weekly rollover and recap

| Feature | Status | Detail |
|---|---|---|
| Rollover check | 🟢 | Runs every 30 s; compares `settings.lastRolloverWeekId` with the current Monday. First run just records the current week. |
| Recap modal | 🟢 | “Week wrapped up (weekId)”, planned study, recorded study, done/activity count, explanation, **Download CSV recap**, **Start new week**. |
| Recap CSV | 🟢 | `Activity,Day,PlannedMin,Done,RecordedMin`, CRLF, quoted where needed. |
| Cleanup | 🟢 | Clears checkmarks/minutes for prior weeks, clears the running timer, keeps the repeating timetable intact. |
| Data retention | ⚠️ | Once dismissed, the old week record is gone; only the optional CSV remains. No history screen. |

### 2.14 Reminders and notifications

| Feature | Status | Detail |
|---|---|---|
| Start reminder | 🟢 | Fires at `start − lead` within a 90-second window; duplicate-proof key `activityId:start:atMin`. |
| End reminder | 🟢 | Fires at `end − lead`. |
| “Finished” reminder | 🟢 | Global `atEnd` toggle, fires at `end`. |
| Quiet hours | 🟢 | Suppresses all reminders inside the window (handles overnight ranges). |
| Visible-window gating | 🟢 | Activities entirely outside the visible range do not notify. |
| Delivered tracking | 🟢 | Stored in the week record + session set, so reloads don’t duplicate. |
| In-app banner | 🟢 | Toast with title/body. |
| Native notification | 🟢 | Dynamic import of `@tauri-apps/plugin-notification`; requests permission; silently falls back to the toast in a browser or if denied. |
| Test button | ⚠️ | See Bug 13. |
| Only active timetable | ⚠️ | Reminders for other timetables never fire. |
| App must be running | ⚠️ | Explicitly documented in Settings; no background service. Missed if the app sleeps > 90 s. |
| Global lead defaults | ❌ | Ignored by editor-created activities (Bug 2). Imported/sample activities without `reminderPreferences` do use them. |

### 2.15 Timers

| Feature | Status | Detail |
|---|---|---|
| Start | ✅ | From Today row or context menu; target = max(15 min, activity duration); refuses while a timer runs (“A timer is already running — finish or skip it first.”). |
| Pause / Resume | ✅ | Accumulates seconds; 1-second display tick while running. |
| +15 min | ✅ | Extends `targetSec` by 900 s. |
| Finish | ✅ | Rounds elapsed to whole minutes, adds to the week record, clears the timer, toast “Recorded Xm.” **No Undo offered.** |
| Skip | 🟢 | Discards the timer with an announcement, records nothing. |
| Survives reload | 🟢 | Timestamps persisted; elapsed resumes. |
| Toolbar chip | ⚠️ | Shown on all non-Today screens whenever a timer exists; not filtered by timetable. |
| Today bar visibility | ❌ | Hidden when the timer belongs to another timetable (Bug 8). |

### 2.16 Undo / redo / toasts

| Feature | Status | Detail |
|---|---|---|
| Undo (toolbar, File menu, Ctrl/Cmd+Z) | ✅ | 20-entry snapshot stack; restores timetables + categories; announces “Undid: label”. Verified. |
| Redo (toolbar, File menu, Ctrl+Y / Shift+Ctrl+Z) | ✅ | Verified re-applying a delete. |
| Undo labels | ✅ | File menu shows “Undo: <label>”. |
| Toast | ✅ | Bottom-centre, 6 s, Undo button, dismiss ✕; routine toasts respect the Settings toggle. |
| Undo coverage | ⚠️ | Covers timetables/categories (activities, deadlines, timetable/category edits). Does **not** cover settings, week-record completion/minutes, timer state, or JSON restore. |
| Restore Undo | ❌ | Misleading (Bug 4). |

### 2.17 Import wizard

**Stage 1 — file**
| Control | Status | Detail |
|---|---|---|
| Choose Excel or CSV file | ✅ | Native picker in Tauri; hidden file input in browser. Shows “Reading…” while busy. |
| Cancel | ✅ | Closes the wizard. |
| Error box | ✅ | Reports unreadable files / no worksheets. |

**Stage 2 — review**
| Control | Status | Detail |
|---|---|---|
| File name display | ✅ | e.g. `audit-test.csv`. |
| Worksheet dropdown | ✅ (code) | **CustomSelect**, shown only when the workbook has > 1 analyzable sheet. |
| Sheet-level warnings | ✅ | Yellow notice list (e.g. “Times without am/pm are assumed PM…”, hidden rows/columns, colour not in legend). |
| Per-row Include checkbox | ✅ | Excludes/includes a row. |
| Per-row Day — **CustomSelect** | ✅ | 7 weekdays. |
| Per-row Start / End (text inputs) | ✅ | Accept `16:00`, `4:00 pm`, `4pm`; invalid text clears the value and flags the row. |
| Per-row Name (text) | ✅ | Blank = category name. |
| Per-row Category — **CustomSelect** | ✅ | 9 categories. |
| Warnings column | ✅ | ⚠ messages, “Use h:mm” suggestion buttons for off-grid times, row error text. Invalid rows are red. |
| Counts footer | ✅ | “N valid · M need fixing · K excluded”. |
| Continue | ✅ | Disabled when 0 valid. |
| Back / Cancel | ✅ | Return to file stage / close. |

**Stage 3 — mode**
| Control | Status | Detail |
|---|---|---|
| Merge into “<active>” | ✅ | Adds imported activities; conflict dialog appears if any overlap. Verified success and conflict paths. |
| Replace “<active>” | 🟢 | Restore point saved first, then replaces the active timetable’s activities. |
| Create a new timetable | ✅ | Verified: creates “Imported Week” (or typed name) with the imported rows, switches to it. |
| New timetable name | ✅ | Text input, default “Imported Week”. (Automation could not drive React’s value tracker, but code is straightforward and works with real typing.) |
| Import | ✅ | Commits; toast “Imported N.” + Undo. |
| Back / Cancel | ✅ | Return to review / close. |

**Import behaviour**
| Item | Status | Detail |
|---|---|---|
| CSV parser | ✅ | RFC-4180-ish: quotes, escaped quotes, CRLF/LF, skips blank rows. |
| CSV required columns | ✅ | Day, Start, End (case/space/underscore tolerant); Name/Subject/Notes/OptionalWork optional. |
| Weekday parsing | ✅ | Full or short English names, case-insensitive. |
| Time parsing | ✅ | 24-hour, 12-hour with am/pm, bare hour + am/pm; 15-min grid checked; 24:00 accepted as 1440. |
| Category matching | ✅ | Case-insensitive by name; unknown → Other + warning. |
| Optional-work parsing | ✅ | yes/true/1/y → yes; no/false/0/n → no; anything else inherit. |
| Restore point before import | ✅ | “Before import <file>”. |
| Merge conflict flow | ⚠️ | Conflict dialog lists up to 4 overlaps; “Move anyway” commits, “Cancel” leaves schedule unchanged. False success toast (Bug 3). |
| Excel analyser | ⚠️ | Designed for the “reference workbook” layout (weekday header row + left time labels + legend fills). It handles fuzzy day names, merged runs, summary exclusion, PM assumptions. **It does not successfully read the app’s own XLSX export** (Bug 5). |

### 2.18 Export / backup / restore details

| Feature | Status | Detail |
|---|---|---|
| CSV export | ✅ | `Name,Weekday,Start,End,Category,Subject,Notes,OptionalWork`; 24-hour times; sorted by day/time; escaped fields; trailing CRLF. |
| XLSX export | ✅ | Sheet “Timetable”: Mon–Fri 15-min section, Sat–Sun hourly section, merged activity cells, category fills, “Study Time:”/“Optional Extra:” daily summaries, legend. |
| JSON backup | ✅ | `schemaVersion`, `appVersion`, `exportedAt`, timetables (with deadlines), categories, settings, subjects, weekRecords. |
| Backup validation | ✅ | JSON parse, schema equality, non-empty timetables, category validation, per-activity validation, settings object; `subjects`/`weekRecords` defaulted. |
| Backup deadline validation | ❌ | Not performed (Bug 7). |
| Schema migration on restore | ❌ | Not used; only v4 accepted (Bug 6). |
| Restore point before restore | ✅ | “Before JSON restore”. |
| Restore confirm | ✅ | “Restore backup from <date>? A restore point of the current data is saved first.” |
| Restore application | ✅ | Replaces timetables/categories/settings/subjects/weekRecords; clears timer; keeps active timetable when possible. |
| Restore toast/Undo | ❌ | Undo does not revert the restore (Bug 4). |
| Nested version field | ⚠️ | `settings.appVersion` in backups was observed as “0.3.1” while the file says 0.3.6/0.3.7 — stale field, cosmetic. |

### 2.19 Themes, focus, print, responsive

| Feature | Status | Detail |
|---|---|---|
| Light theme | ✅ | `data-theme="light"` variables; background observed `rgb(250,250,247)`. |
| Dark theme | ✅ | Background observed `rgb(5,5,5)`; custom controls/checkboxes/selects are themed. |
| OS theme on first run | 🟢 | `prefers-color-scheme`. |
| Focus mode | ✅ | `.app.focus` hidden chrome + exit button; F11/Esc. |
| Print layout | ✅ (call) | `window.print()` verified; print CSS hides UI and prints landscape A4 with title, grid, legend colours. Actual pagination not inspected. |
| Responsive < 1024 px | 🟢 | CSS hides sidebar, shows day tabs + bottom tabs (Planner/Today/Priorities/Progress/Settings); grid starts in Day view. **Not runtime-verified** — the controlled browser viewport was 1296 px wide. |
| Mobile feature gaps | ⚠️ | With the sidebar hidden, timetable create/rename/delete/switch and Categories become unreachable on < 1024 px (Settings and theme remain reachable). |
| Reduced motion | 🟢 | `@media (prefers-reduced-motion: reduce)` disables animations/transitions. |
| Fonts offline | ✅ | System-font fallback stack; tests assert no Google Fonts import. |

### 2.20 Native shell, packaging, CI

| Feature | Status | Detail |
|---|---|---|
| Tauri 2 shell | 🟢 | Window 1440×900 (min 360×560), plugins: dialog, fs, notification, store. |
| Capabilities | 🟢 | `core`, `dialog`, `fs`, `notification`, `store` defaults. |
| Native save/open dialogs | 🟢 | Used when `__TAURI_INTERNALS__` exists; browser falls back to input/download. Cancel reports success (Bug 9). |
| Rust commands | 🟢 | `app_version` and `test_notification` exist but the frontend calls the JS plugins instead — dead code. |
| Bundle targets | 🟢 | NSIS (per-user), DMG (macOS 11+), AppImage, DEB. |
| Icons | ⚠️ | `src-tauri/icons` contains only `icon.svg` + README; CI runs `npx tauri icon …` to generate the referenced PNG/ICO/ICNS before building. A local `tauri build` without that step will fail on missing icons. |
| CI | 🟢 | Push/PR: unit tests on Ubuntu; native builds for Windows NSIS, macOS DMG, Linux AppImage/DEB; artifacts uploaded. A `version` job auto-bumps the patch version on `main` and rewrites `package.json`, `tauri.conf.json`, `store.ts`. |
| Release artifact | ⚠️ | `release/Time Flow_0.3.1_x64-setup.exe` exists locally but is gitignored (older version). |

---

## 3. Complete dropdown inventory

All dropdowns are now the custom `CustomSelect` listbox (no native `<select>` remains in `src/`). A custom dropdown opens on click, shows a scrollable list, closes on selection/outside click/Escape, and highlights the current option. It has **no arrow-key navigation or type-ahead**.

| # | Dropdown | Location | Options | Default | Status |
|---|---|---|---|---|---|
| 1 | Timetable | Sidebar | One per timetable, `Name (count)` | Active | ✅ |
| 2 | Category | Activity editor | 9 categories | Last used / matched name / Study | ✅ |
| 3 | Weekday | Activity editor | Monday … Sunday (7) | Today / clicked day | ✅ |
| 4 | Start (15-min steps) | Activity editor (hidden) | 0–1440 step 15 (97) | Activity start | 🚫 hidden/dead |
| 5 | End (15-min steps) | Activity editor (hidden) | 0–1440 step 15 (97) | Activity end | 🚫 hidden/dead |
| 6 | Optional-work counting | Activity editor | Follow default / Count / Do not count (3) | inherit | ✅ |
| 7 | Minutes before start | Activity editor | 0/5/10/15/30 (5) | 5 (bug: not Settings) | ⚠️ |
| 8 | Minutes before end | Activity editor | 0/5/10/15/30 (5) | 5 (bug: not Settings) | ⚠️ |
| 9 | Visible day starts | Settings | 0–1440 step 60 (25) | 06:00 | ✅ |
| 10 | Visible day ends | Settings | 0–1440 step 60 (25) | 22:00 | ⚠️ duplicate midnight label |
| 11 | Quick-switch first category | Settings | 9 categories | Study | ✅ |
| 12 | Quick-switch second category | Settings | 9 categories | Personal | ✅ |
| 13 | Before start (min) | Settings | 0/5/10/15/30 (5) | 5 (default settings) | ⚠️ stored but ignored |
| 14 | Before end (min) | Settings | 0/5/10/15/30 (5) | 5 | ⚠️ stored but ignored |
| 15 | Counting for <category> | Category manager | Study / Neither / Optional work (3) | per category | ✅ |
| 16 | Replacement category | Category manager (delete flow) | Every other category | First other | ✅ |
| 17 | Worksheet | Import wizard (review) | One per analyzable sheet | Sheet with most rows | 🟢 |
| 18 | Day (per row) | Import wizard (review) | Monday … Sunday (7) | Parsed day | ✅ |
| 19 | Category (per row) | Import wizard (review) | 9 categories | Parsed/guessed | ⚠️ Excel guesses often wrong (Bug 5) |

**Radios / checkboxes / other pickers (for completeness):**

| Control | Location | Options | Status |
|---|---|---|---|
| Clock format | Settings | 12-hour / 24-hour | ✅ |
| Appearance | Settings | Light / Dark | ✅ |
| Reminder at end | Settings | on/off | ✅ |
| Quiet hours enable | Settings | on/off + two `time` inputs | ✅ |
| Confirmation popups | Settings | on/off | ✅ |
| Import mode | Import wizard | Merge / Replace / New timetable | ✅ |
| Include row | Import wizard | per-row checkbox | ✅ |
| Start/end reminder + lead | Activity editor | two checkboxes + two dropdowns | ⚠️ |
| Colour | Category manager | 8 swatches + native colour input | ✅ |
| Deadline date | Priorities | native date input | ✅ |
| Timer actions | Today | Pause/Resume, Finish, +15, Skip | ✅ |

---

## 4. Bug and gap register (detail + evidence)

### Bug 1 — Weekly totals count the same clock time only once across different days (High)
`weekTotals()` calls `intervalsFor(..., weekday = null, ...)` and then unions **all seven days together**. Two study blocks at 16:00–17:00 on Monday and Tuesday are treated as one interval, so the week reports 1 h instead of 2 h.

**Reproduced with the sample week:** sidebar and Week toolbar show **📚 2h**; per-day headers sum to **5h** (Mon 1 h + Tue 1 h + Wed 1 h 30 + Thu 1 h + Sun 30 m). Progress’s “By subject” table also sums to 5 h while its header says 2 h. Optional work shows 2 h because it only occurs on Friday.

**Affected:** sidebar “This week”, Planner Week toolbar totals, Progress header. Day totals and the By-day table are correct.
**Fix:** compute week totals by summing `dayTotals` for 0–6 (each day unions its own overlaps), rather than one global union.
**Files:** `src/totals.ts:55-63`; callers `App.tsx:231,1011-1012,1063-1064`, `ProgressView.tsx:23,59-60`.
**Test gap:** `totals.test.ts` only tests `dayTotals`/`unionMinutes`; there is no `weekTotals` test.

### Bug 2 — Global reminder lead defaults are dead (High)
`openCreate` hard-codes `startLead: 5, endLead: 5`; `draftFromActivity` falls back to 5; `draftToActivity` always writes a `reminderPreferences` object. Result: Settings → Reminders → 10/15 never reaches a normal activity.

**Reproduced:** Settings showed 10/15; a newly created activity stored `{startLeadMinutes: 5, endLeadMinutes: 5}`. `reminders.ts` only uses the global defaults when `reminderPreferences` is absent, which the editor never produces.
**Files:** `App.tsx:903-921`, `ActivityEditor.tsx:30-48,64-69`.
**Fix:** initialise from `settings.reminderDefaults` and omit `reminderPreferences` when values are still at the global defaults (or make the editor’s default track Settings).

### Bug 3 — Import merge conflict shows a false success toast (Medium)
`handleImportResult` opens the conflict dialog but execution continues to `notify({ message: "Imported N." })` unconditionally.

**Reproduced:** importing a clashing CSV showed the “Scheduling conflict” dialog and simultaneously “Imported 2.” with Undo. Choosing “Cancel (keep previous schedule)” left the schedule unchanged while the success toast remained.
**Files:** `App.tsx:579-601` (notify at 596 runs for the pending branch too).
**Fix:** move `notify` into the non-conflict branches / after `commit(pending.next…)`.

### Bug 4 — Undo after a JSON restore does not undo the restore (Medium)
`doRestore` applies with `setState` (no checkpoint) but still shows an Undo toast. `doUndo` therefore pops the previous ordinary commit.

**Reproduced:** after restoring a backup, the File menu’s Undo label referred to the previous action (“Set category to Personal”); clicking Undo reverted that action, not the restore, and enabled Redo. A restore point is correctly saved before restoring, so recovery is possible via Settings → Restore points.
**Files:** `App.tsx:635-660` vs `307-317`.
**Fix:** route the restore through `commit` (or checkpoint manually) and remove the Undo toast if it cannot undo.

### Bug 5 — XLSX export → import does not round-trip (Medium)
The importer expects one weekday header row with time labels in the column to the left and a colour legend. The exporter writes two stacked sections (Mon–Fri, then Sat–Sun) with a legend and summary rows.

**Reproduced:** importing the app’s own exported `My Week.xlsx` produced 31 proposals — 11 valid, 20 needing fixes. Rows named “1h”, “0m”, “Saturday” appeared, “Mathematics homework” was guessed as **Work**, and colour warnings appeared for every row (“Colour #65D84A isn’t in the legend…”). The weekend section’s Saturday/Sunday columns overlap the Monday/Tuesday columns.
**Files:** `exportExcel.ts:56-121`, `importExcel.ts:212-343`.
**Fix (options):** teach the analyser to detect multiple header sections and skip summary rows like “1h”/“0m”; or export a flat data sheet (CSV-shaped) alongside the visual sheet; or document that XLSX export is one-way and CSV is the round-trip format.

### Bug 6 — Restore rejects old schema versions (Medium)
`parseBackup` requires `schemaVersion === SCHEMA_VERSION` (4). The app’s own migration code supports v1–v3, but restore never reaches it.

**Effect:** users cannot restore backups made by 0.2.x/0.3.0–0.3.3 even though migrations exist.
**Files:** `backup.ts:44-46`; `store.ts:70-124`.
**Fix:** accept ≥1 and run `migrateState`/sanitisation on the backup payload before applying.

### Bug 7 — Restore does not validate deadlines (Medium-Low)
Activities and categories are validated; `timetables[].deadlines` are copied as-is. A hand-edited/older backup can introduce deadlines with invalid dates, which bypass `validateDeadline` because restore uses `setState` rather than `commit`.

**Files:** `backup.ts:52-63`, `App.tsx:645-657`.

### Bug 8 — Timer becomes unfinishable after switching timetables (Medium-Low)
The toolbar chip renders whenever `timer` exists, but TodayView receives `timer && timer.timetableId === active.id ? timer : null`. Start a timer in My Week, switch to another timetable, click the chip → Today shows no timer bar, so Finish/Skip/+15 are unavailable until switching back.

**Files:** `App.tsx:1069-1073` vs `1165`.
**Fix:** show the bar with a “belongs to <timetable>” note and finish against the timer’s own timetable, or hide the chip.

### Bug 9 — Save-dialog cancel is treated as success (Low, Tauri only)
`saveFile` returns `{ ok: true }` when the native save dialog is cancelled, so exports/backup toast success even though nothing was written.

**Files:** `native.ts:63-73` (line 67).
**Fix:** return a distinct `cancelled` result and suppress the success toast.

### Bug 10 — Settings version footer is stale (Low)
“0.3.7 · schema v2” — actual `SCHEMA_VERSION = 4`. Also hard-codes “English (Australia), week starts Monday”.
**Files:** `SettingsPanel.tsx:203`, `types.ts:5`.

### Bug 11 — Midnight is ambiguous in time dropdowns (Low)
`formatTime(1440)` → “12:00 am” (12h) or “00:00” (24h), identical to `formatTime(0)`. Settings’ visible start/end lists include both 0 and 1440 (25 options), so two indistinguishable entries exist.
**Files:** `time.ts:26-34`, `SettingsPanel.tsx:6-10`.

### Bug 12 — New-activity picker ignores visible range; second tap is inclusive (Low)
`ActivityEditor` is not passed `visibleStart`/`visibleEnd`, so the picker always uses 360/1320 (06:00–22:00) even when Settings says 07:00–23:00. `tap()` uses `onPick(a, t + 15)`, so tapping 16:00 then 17:00 yields 16:00–17:15 (confirmed: end `1035`).
**Files:** `ActivityEditor.tsx:92-94,122-130`, `App.tsx:1249-1256`.

### Bug 13 — Test notification always claims success (Low)
The toast is shown before/independent of permission. Verified with `Notification.permission === "denied"`: toast still said “Test notification sent…”.
**Files:** `App.tsx:780-783`.

### Bug 14 — “Remove all activities” has no confirmation (Low)
Settings’ danger button commits immediately. It is undoable, but a mis-click wipes the active timetable.
**Files:** `App.tsx:956-961`.

### Bug 15 — Multi-select is cosmetic (Low)
Shift-click builds `selectedKeys`, but nothing consumes it except the selected outline. There is no bulk delete/move/categorise.
**Files:** `App.tsx:1136-1145`, `PlannerGrid.tsx:458`.

### Bug 16 — Reminder delivery constraints (Low / by design)
Only the active timetable is checked; reminders fire only while the app runs; the due window is 90 s with a 30 s tick. Sleeping the machine or closing the app misses reminders. Settings text discloses the “app closed” limitation but not the active-timetable or 90-second details.
**Files:** `App.tsx:764-778`, `reminders.ts:26-65`.

### Bug 17 — README drift (Low)
- Claims “resize from the edges” and “top/bottom resize” — removed 🚫.
- Claims overlap “flagged banner”/flagged blocks — removed 🚫 (dialog remains).
- Claims “no network calls” — true now (no Google Fonts import; tests enforce it).
- Says “version 0.2.0”, “Schema v2” — app is 0.3.7 / schema v4.
- “Ctrl/Cmd+Z redo” — Ctrl+Z is undo; redo is Ctrl+Y / Shift+Ctrl+Z.
- Project structure omits newer files (`deadlines.ts`, `records.ts`, `reminders.ts`, `backup.ts`, `exportCsv.ts`, `exportExcel.ts`, dashboards, recap).
**Files:** `README.md:6,20,23,25,117,139-145,174`; `types.ts:2` (stale “Schema v2” comment).

### Bug 18 — Custom dropdown accessibility (Low)
`CustomSelect` uses `role="listbox"`/`option` but options are plain buttons; no Arrow/Home/End handling, no type-ahead, no focus transfer into the list, no `aria-activedescendant`. With 25 time options, keyboard users must Tab through the list.
**Files:** `CustomSelect.tsx`.

### Additional minor/dead-code observations
- `screen` “Tips” banner was removed from the UI, but planner blocks still advertise “Press Enter/S/M” via aria-labels (fine).
- `brand` CSS exists with no element; `.resize-handle`, `.conflict-dot`, `.block.conflict` CSS remain after the features were removed.
- `formatCsvDuration`, `blockCategory`, `completedMinutes`, `slotLabels` are exported but unused in production (tests only).
- `ActivityEditor` hidden Start/End dropdowns remain in the DOM (dead controls).
- `src-tauri` `app_version` / `test_notification` commands are unused by the frontend.
- `package.json` version, `tauri.conf.json` version and `APP_VERSION` are aligned at 0.3.7 (tests enforce this).
- Backup `settings.appVersion` may lag (observed “0.3.1”) because the field is persisted, not rewritten on export.

---

## 5. What explicitly does **not** work / does not exist

Collected for quick reference:

1. Weekly study/optional totals across different weekdays — **wrong**.
2. Global reminder lead defaults for editor-created activities — **ignored**.
3. Drag-to-resize activities — **removed**.
4. Conflict highlighting/banner in the grid — **removed** (dialog on write still exists).
5. Undo after JSON restore — **misleading/wrong action**.
6. Restoring v1–v3 backups — **rejected**.
7. Excel export → import round-trip — **mangles data**.
8. Timer bar after switching timetables — **disappears**.
9. Deadline validation on restore — **absent**.
10. Mobile timetable/category management — **unreachable below 1024 px**.
11. Shift-click bulk actions — **none**.
12. Keyboard arrow navigation inside custom dropdowns/menus — **absent**.
13. Confirmation before “Remove all activities” — **absent**.
14. Background/closed-app reminders — **not supported** (documented).
15. Historical week browsing — **not supported** (records pruned at rollover).
16. A “brand” header in the sidebar — **not rendered** (CSS only).

---

## 6. Test and build evidence

**`npm test`**

```
Test Files  10 passed (10)
     Tests  189 passed | 1 skipped (190)
```

Files: `comprehensive`, `deadlines`, `engines`, `fileMenu`, `importExport`, `regression`, `testPlan`, `testPlanFull`, `time`, `totals`.

**`npm run build`** — `tsc && vite build` passes; output includes a 1.2 MB main chunk warning (> 500 kB). No TypeScript errors.

**Coverage gaps relevant to the bugs above**
- No test for `weekTotals` across multiple days (Bug 1).
- No test that Settings reminder defaults flow into new activities (Bug 2).
- No integration test for import-conflict toast ordering (Bug 3).
- No test for restore→undo semantics (Bug 4).
- No round-trip test of `timetableToXlsx` → `analyzeExcel` (Bug 5); `importExport.test.ts` covers CSV only.
- No test that `parseBackup` accepts migrated old schemas (Bug 6).
- No test for timer visibility after timetable switch (Bug 8).
- Several “UI removed” tests check source strings, not rendered behaviour (e.g. resize handles, tip banner); this protects removals but not the remaining UI.

---

## 7. Verification log (highlights of what was actually exercised)

- Created the sample timetable; confirmed 16 activities and 2 deadlines.
- Switched timetables; added “Audit TT“, renamed “Renamed Week”, renamed back, deleted scratch timetables; confirmed the last-timetable guard.
- Opened the editor via Enter; checked all 7 dropdowns/fields; changed category; verified Escape cancels without saving.
- Created “Audit test activity” via the slot picker; saved, reopened, duplicated (merged ×2), undid, deleted with Undo.
- Right-clicked a block: all 9 categories + Edit/Mark complete/Start timer/Duplicate/Swap/Delete; changed category Study→Personal; verified toast/labels.
- Keyboard: `S` switched Study↔Personal; Enter opened the editor; Escape closed it; Ctrl+Z undid a duplicate.
- Day view showed one day + 7 tabs; Week view restored 7 columns; Today button.
- Settings: changed visible range, clock, theme, quick-switch pair (rejected identical pair), reminder leads, quiet hours, test notification (toast), confirmation-popups off (suppressed toast), restore points (applied one), Close.
- Categories: opened manager, saw 9 rows/counts; changed Counting to Neither then Escape (discarded); Add category (row 10); Delete Study prompt with replacement list; Cancel.
- File menu: Excel export (8,106-byte `.xlsx`), CSV export (912-byte file, content inspected), JSON backup (8,262-byte file, structure inspected), Restore (confirm → restore → toast; Undo behaved as Bug 4), Print (window.print called).
- Import: CSV review (2 valid, 1 excluded, warnings), mode stage (3 radios, new-name field), merge success (“Imported 1.”, Guitar lesson added), new-timetable mode (“Imported Week”), conflict merge (dialog + false “Imported 2.” toast, cancel left schedule unchanged), XLSX re-import (31 proposals, 11 valid, Bug 5).
- Today: Now/Next/plan, timeline checkboxes (Reading marked done), Start timer, pause/resume, +15 min (target extended), Finish (“Recorded 0m.”).
- Priorities: added “Audit deadline”, edited (prefill), deleted with Undo; list sorted with relative labels.
- Progress: header, By day, By subject, Activity detail; confirmed totals discrepancy.
- Theme toggle (light ↔ dark), focus mode (class + exit), print wiring.
- Reloaded the app: localStorage persistence confirmed; then cleared the test browser’s `localStorage` to leave a clean first-run state.

---

## 8. Appendix

### Keyboard shortcuts

| Shortcut | Action | Status |
|---|---|---|
| Ctrl/Cmd+Z | Undo | ✅ |
| Ctrl+Y / Shift+Ctrl+Z | Redo | ✅ |
| Ctrl/Cmd+P | Browser/app print | 🟢 (native) |
| F11 | Toggle focus mode | 🟢 |
| Esc | Close menu/modal/editor, cancel swap, exit focus | ✅ |
| Enter | Edit focused block (or confirm move) | ✅ |
| S | Quick-switch focused block | ✅ |
| M | Keyboard move mode | 🟢 |
| Arrow keys | Navigate blocks; move in M-mode | 🟢 |
| Delete / Backspace | Delete focused block | 🟢 |
| Shift+F10 / ContextMenu | Open block menu | 🟢 |

### Data model (schema v4)

- `PersistedState`: `schemaVersion`, `timetables[]`, `activeTimetableId`, `categories[]`, `settings`, `subjects[]`, `weekRecords`, `restorePoints[]`, `activeTimer`, `savedAt`.
- `Timetable`: `id`, `name`, `activities[]`, `deadlines[]`.
- `Activity`: `id`, optional `name`, `categoryId`, optional `subject`, `weekday` (Mon=0), `startTime`/`endTime` (minutes 0–1440), optional `notes`, `optionalWorkOverride`, optional `reminderPreferences`, timestamps.
- `Deadline`: `id`, `title`, `date` (yyyy-mm-dd), optional `subject`/`notes`, timestamps.
- `WeekRecord`: `timetableId`, `weekId` (Monday date), `completed {done, minutes}`, `delivered[]`.
- `TimerState`: `timetableId`, `activityId`, `startedAtEpochMs`, `accumulatedSec`, `running`, `targetSec`.
- `GlobalSettings`: visible range, clock format, theme, switch pair, `showToasts`, quiet hours, reminder defaults, `lastRolloverWeekId`, `appVersion`.
- Storage key: `timeflow.v1.state` (localStorage / Tauri webview).

### Important files

| File | Responsibility |
|---|---|
| `src/App.tsx` | State, commit pipeline, actions, routing, modals, rollover, reminders, timer |
| `src/totals.ts` | Day/week interval unions (contains Bug 1) |
| `src/components/PlannerGrid.tsx` | Grid, gestures, keyboard, block rendering |
| `src/components/ActivityEditor.tsx` | New/Edit form, time picker, reminders |
| `src/components/SettingsPanel.tsx` | All settings controls |
| `src/components/CategoryMenu.tsx` | Context + empty-slot menus |
| `src/components/CategoryManager.tsx` | Category CRUD + delete/replacement |
| `src/components/ImportWizard.tsx` | Import stages |
| `src/importExcel.ts` / `src/exportExcel.ts` | XLSX analysis / writing (Bug 5) |
| `src/exportCsv.ts` | CSV read/write |
| `src/backup.ts` | JSON backup validation (Bugs 6–7) |
| `src/store.ts` | Persistence, defaults, migrations |
| `src/reminders.ts` | Due-reminder engine |
| `src/native.ts` | Tauri/browser file dialogs (Bug 9) |
| `src/components/TodayView.tsx` | Today dashboard + timer UI |
| `src/components/PrioritiesView.tsx` | Deadlines |
| `src/components/ProgressView.tsx` | Progress tables |
| `src/components/RecapModal.tsx` | Weekly recap |
| `src-tauri/` | Tauri shell, capabilities, bundling |
| `.github/workflows/build.yml` | Tests, version bump, native bundles |

---

## 9. Recommended fix order

1. **`weekTotals`** (one-line conceptual fix, affects three prominent surfaces).
2. **Reminder defaults** (make editor initialise from Settings and stop always persisting prefs).
3. **Import conflict toast** (move `notify` after resolution).
4. **Restore** semantics: checkpoint before applying, accept older schemas, validate deadlines.
5. **Excel round-trip**: either fix the analyser or clearly mark XLSX as one-way.
6. **Timer/timetable visibility** and save-cancel false success.
7. Documentation/UI text: Settings schema version, README feature claims, time-label midnight.
8. Accessibility polish for `CustomSelect` and menus (arrow keys).

---

*This audit intentionally did not modify application source code. The only repository changes made by the audit process were the temporary test files under `public/` (now deleted in the working tree; they were accidentally included in commit `8607c59`) and a generated `package-lock.json` from `npm install`.*
