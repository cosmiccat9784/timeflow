# Compatibility & Honest Limitations

Target: **Minecraft Education Edition 1.26.32**.
Test version record: behaviour verified by unit tests + static packaging
checks in this repo (see `Tests/`); **in-game verification on 1.26.32 is
still required before release** — run every Phase-1 check below on the
actual device and tick the boxes.

## 1. Phase-1 prototype checklist (must be ticked in-game)

- [ ] Behaviour + resource packs import with no Content Log errors.
- [ ] `mtn:station_rail` appears in Creative → Construction as Station Rail.
- [ ] Rail can be placed and broken; drops behave sanely.
- [ ] Supporting block is read correctly (interact shows the right line).
- [ ] Supplied textures render (Single/Left/Centre/Right switch on merge).
- [ ] A scripted form opens on interact, OR chat fallback works (`!help`).
- [ ] Emerald check + 1-emerald deduction works.
- [ ] Stations survive close/reopen (`!stations` still lists them).
- [ ] `!line diamond` lists Diamond Line stations in coordinate order.
- [ ] A paid journey moves the player through each leg to the destination.

If any box fails, follow the fallback column — do not ship the feature as
“working”.

## 2. Known limitations (by design, documented — not bugs)

| # | Limitation | Fallback / behaviour |
|---|---|---|
| 1 | **Custom slash commands** (`/line diamond`) may be unsupported in Education Edition. | Registration is attempted in an isolated module; any failure is caught. `!line <name>` gives identical output. |
| 2 | **Native minecart driving is not script-controllable.** Spawning a minecart does not give route control, arrival detection or collision safety. | Travel uses staged, validated **teleport legs** with transfer narration. No minecart behaviour is advertised. |
| 3 | **Track between stations cannot be traced** by the scripting API. | Line-connectivity model: registered stations sharing a line count as connected. Players still build real track; the planner never invents edges between stations sharing no line. |
| 4 | **Branch/loop topology is not auto-detected** (would need track tracing). | `/line` + network listings use deterministic coordinate order with interchange flags; branches are not invented as fake linear orders — the listing states its ordering rule. |
| 5 | **Support-block changes** are caught for player place/break directly under a rail. Piston- or explosion-moved supports may need a re-place to refresh. | Interact revalidates; `recalculateSupport` refreshes on demand. |
| 6 | **Scripted forms** depend on `@minecraft/server-ui`. | Dynamically imported; failure leaves chat commands fully working. |
| 7 | **Dynamic-property save cap** (~240 KB across 30 chunks). | `saveStore` refuses and warns instead of truncating; the in-memory network keeps running. |
| 8 | **Cross-dimension station graphs** assume loaded dimensions for teleport; validation touches only involved stations (no world scans). | Journeys revalidate every leg and stop safely with a message if the network changed. |

## 3. Deterministic rules (stable across reloads)

- **Texture rows:** if footprint width (x) ≥ depth (z), group by z rows
  (ascending), each row ascending x; else group by x columns (ascending),
  each column ascending z. N=1 → Single; N≥2 → Left, (N−2)×Centre, Right.
- **Anchors:** smallest (x, y, z) of the footprint, kept stable unless the
  anchor block itself is destroyed (then the largest remnant is adopted and
  the event is reported).
- **Merges:** oldest registration survives; retired names are reported.
- **Splits:** the component holding the anchor keeps the identity; other
  components become unregistered structures.
- **Routing:** BFS fewest-edge; ties broken by station name; legs prefer
  staying on the current line to minimise transfers.
- **`/line` order:** dimension, x, y, z of station anchors.

## 4. In-game test plan mapping (§20 of the brief)

All pure-logic cases (naming, merging, splits, textures, registration,
routing, persistence round-trip) are automated in `Tests/test_all.mjs`.
The following need a live world: placement feel, texture rendering, form UI,
emerald deduction animation, teleport legs, multiplayer isolation
(two players, simultaneous `!go`), and reload recovery. Record results in
the checklist above with the exact game version.

## 5. Fixed issues (v1.0.4)

- **Wrong custom-command registry/signature (v1.0.4).** The code used
  `init.customCommands.registerCommand(name, descriptor, overloads, cb)`.
  The documented API is `init.customCommandRegistry.registerCommand(
  { name, description, permissionLevel, optionalParameters }, callback)`,
  and callbacks run in a "before" context (replies deferred via
  `system.run`). Registration now feature-detects the registry and tries
  the documented shape first, legacy shape second. Symptom fixed:
  "unknown command" for `/mtn:ping` and `/mtn:line`.
- **Texture short names now namespaced (v1.0.4).** Current samples use
  `"texture": "namespace:name"` in `material_instances`, so block JSONs now
  reference `mtn:station_rail_*` / `mtn:probe_tex`. Both bare and
  namespaced keys remain in `terrain_texture.json` as fallback.
- **Scripts ran world API calls during early execution (Scripting V2,**
  fixed v1.0.1, see §4).

- **Scripts ran world API calls during early execution (Scripting V2).**
  `main.js` used to read dynamic properties at module top level, which V2
  forbids before `worldLoad` — the whole script module died silently and no
  chat command, form or journey worked. Store loading, chat registration and
  UI init are now deferred into `world.afterEvents.worldLoad`. All top-level
  code is subscription-only.
- **Custom-command startup subscription could miss its window** when made
  from inside `system.run()`. It now subscribes at top level; failure stays
  isolated and `!line` covers the feature.
- **Invalid `minecraft:map_color` value** (string instead of RGB array) in
  the first build could break block parsing. Removed; block JSON is now
  minimal (material instances + states + permutations) on format `1.21.0`.
- **Re-imports of the same version may not refresh.** Both packs are now
  **1.0.1** (same UUIDs). Always delete the old packs from Storage before
  importing a new build, and test in a **fresh world**.
