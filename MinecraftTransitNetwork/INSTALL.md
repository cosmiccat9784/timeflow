# Installation & First Run

Target: **Minecraft Education Edition 1.26.32**.

## 1. Build the package

In PowerShell, from the `MinecraftTransitNetwork/` folder:

```powershell
.\build_mcaddon.ps1
```

This produces `dist/MinecraftTransitNetwork.mcaddon` (a zip containing the
behaviour pack and resource pack with valid manifests and linked UUIDs).

No build tools are required — only the texture PNGs already in
`ResourcePack/textures/blocks/`.

## 2. Import

1. Double-click (or open with Minecraft Education) the `.mcaddon` file, **or**
   use *Settings → Storage → Import* inside the game.
2. Confirm both packs import without errors:
   - *MTN Logic v1.0.3 (Behavior)* — the brains (stations, routing, fares)
   - *MTN Textures v1.0.3 (Resource)* — the pictures (rail textures)

## 3. Activate in a world

1. Create a new world (Creative + **Activate Cheats** recommended so
   scripted forms, teleport legs and chat commands all work).
2. Under *Resource Packs* and *Behavior Packs → My Packs*, activate both
   Transit Network packs. The behaviour pack lists the resource pack as a
   dependency, so the game should pair them automatically.
3. Make sure **Beta APIs / Scripting** (Scripting capabilities) are enabled
   if your version exposes the toggle.
4. Open the world. In chat you should be able to type `!help` and get the
   transit command list. If `!help` answers, the behaviour pack is running.

## 4. First station (smoke test)

1. Give yourself the block: it appears in the Creative inventory under
   **Construction** as **Station Rail**. (If it is missing, the custom block
   did not register — see troubleshooting.)
2. Place a **diamond block**, put **Station Rail** on top → chat should say
   nothing yet (unregistered), but interacting with the rail shows
   *Lines: Diamond Line*.
3. Place a second rail next to it → textures become Left/Right.
4. Stand on the platform, type `!register Central` → expect
   `Station registered successfully.` + `Line detected: Diamond Line.`
5. Type `!here` → expect your station info. Type `!line diamond` →
   expect the Diamond Line listing with Central as station 1.

## 5. Granting test items

```text
!help
```

Emeralds for fares come from normal gameplay/Creative inventory.

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `!help` silent | Behaviour pack not active, scripting disabled, or world needs re-open. Check Content Log for `[MTN]` lines. |
| Station Rail missing from inventory | Custom block failed to register; check Content Log errors on `mtn:station_rail`. Verify resource + behaviour packs are both active. |
| Forms never open, chat works | Scripted UI unavailable in this build — by design the chat fallback (`!register`, `!go`, …) covers everything. See `Documentation/COMPATIBILITY.md`. |
| `/line diamond` unknown command | Custom slash commands unsupported here — use `!line diamond`. Same output. |
| Line shows “not recognised” | The block below is air/fluid or unreadable; put the rail on a solid block. |
| Journey refunds immediately | Route revalidation failed (station broken/disconnected). Rebuild and re-register. |
