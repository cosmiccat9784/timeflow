# Minecraft Transit Network

A railway, station-management and automatic public-transit add-on for
**Minecraft Education Edition 1.26.32**.

Players build station platforms from **Station Rail** (`mtn:station_rail`)
blocks. The block directly underneath each rail decides its line
(diamond blocks → **Diamond Line**, gold → **Gold Line**, …). Adjacent rails
merge into one station automatically, platforms use the supplied
Single / Left / Centre / Right textures, stations are registered under unique
names, routes (including transfers) are planned automatically, and every
journey costs exactly **one emerald**.

## How to play

1. Place a solid block (e.g. diamond block) and put **Station Rail** on top.
2. Extend the platform with horizontally adjacent Station Rail blocks —
   they merge into one station and the textures update by themselves.
3. Stand on the platform and interact with it (or type `!register <name>`)
   to register the station under a unique name.
4. Build more stations the same way.
5. Interact with a station → **Begin a journey** → pick a destination.
   Transfers are automatic. Fare: 1 emerald.
6. Inspect a line any time: `!line diamond` (or `/line diamond` if custom
   commands work in your version — see `Documentation/COMPATIBILITY.md`).

Full command list: type `!help` in chat.

## Repository layout

```text
MinecraftTransitNetwork/
├── README.md                    (this file)
├── INSTALL.md                   (import + first-run guide)
├── BehaviorPack/                (block + scripts, manifests)
│   ├── manifest.json
│   ├── blocks/station_rail.json
│   └── scripts/  main, station/line/network/route/fare/transport,
│                 interface, persistence, chat_commands, custom_command, config
├── ResourcePack/                (supplied Rail_* textures + mappings)
│   ├── manifest.json
│   ├── textures/terrain_texture.json
│   ├── textures/blocks/Rail_*.png
│   └── texts/en_US.lang
├── Tests/test_all.mjs           (Node test suite for the pure modules)
├── Documentation/COMPATIBILITY.md  (what was verified, honest limits)
├── build_mcaddon.ps1            (builds dist/*.mcaddon)
└── dist/                        (built .mcaddon output)
```

## Key design decisions (summary)

- **Line identity = exact supporting block id.** Colour is never enough:
  `minecraft:red_wool` and `minecraft:red_concrete` are different lines.
- **Footprint ≠ identity ≠ connectivity.** A physical platform may serve
  several lines; the station keeps one name/id; reachability comes from the
  line-connectivity graph (stations sharing a line are treated as connected —
  you still build the real track).
- **Travel = staged teleport legs** with transfer narration. Native minecart
  routing is not script-controllable in Education Edition, so it is not
  claimed (see `Documentation/COMPATIBILITY.md`).
- **Fare safety:** validate route → check emerald → deduct once → dispatch.
  Failed dispatch attempts a refund; duplicate presses cannot double-charge.
- **Ordering rules are deterministic** (texture rows, `/line` listings) so
  reloads never shuffle a station.

## Testing

```sh
node --test Tests/test_all.mjs
```

Covers line naming, merging/splits, textures, registration, routing,
transfers, persistence round-trip and fare rules. The in-game checklist from
the brief (§20) is in `Documentation/COMPATIBILITY.md`.
