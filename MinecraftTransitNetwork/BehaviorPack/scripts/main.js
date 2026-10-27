// Entry point: wires blocks, events, UI, fares and transport together.
// Every handler is guarded so one bad event can never kill the whole system.
//
// Design notes:
// - Station Rail placement/removal drives flood-fill recalculation locally
//   around the affected footprint (never whole-world scans).
// - The add-on's own setPermutation() texture updates do not fire
//   playerPlaceBlock, so no update loops occur.
// - server-ui is loaded with dynamic import(): if Education Edition 1.26.32
//   lacks it, the add-on keeps running on chat commands (!help).

import { world, system } from "@minecraft/server";
import { RAIL_ID, PLATFORM_STATE, posKey } from "./config.js";
import { lineKeyFromSupportBlock, lineDisplayName } from "./line_manager.js";
import {
  createEmptyStore,
  floodFill,
  footprintLineSummary,
  computeTexturePositions,
  findStationById,
  registerStation,
  renameStation,
  recalculateAfterPlace,
  recalculateAfterBreak,
  recalculateSupport,
  stationLineNames,
} from "./station_manager.js";
import { loadStore, saveStore } from "./persistence_manager.js";
import * as transport from "./transport_controller.js";
import { registerChatCommands } from "./chat_commands.js";

let store = createEmptyStore(); // safe empty shell; replaced once the world is loaded
let ui = null; // set when interface_manager loads
let saveDirty = false;
let worldReady = false;

function markDirty() {
  saveDirty = true;
}

function save() {
  saveStore(world, store);
  saveDirty = false;
}

function blockTypeAt(dimension, x, y, z) {
  try {
    const b = dimension.getBlock({ x, y, z });
    return b ? b.typeId : null;
  } catch {
    return null; // unloaded / out of bounds: treat as unknown, never guess
  }
}

function makeEnv(dimension, dimId) {
  return {
    dimId,
    isRail: (x, y, z) => blockTypeAt(dimension, x, y, z) === RAIL_ID,
    supportLine: (x, y, z) => {
      const below = blockTypeAt(dimension, x, y - 1, z);
      if (!below) return null;
      return lineKeyFromSupportBlock(below);
    },
    setPos: (x, y, z, state) => {
      const b = dimension.getBlock({ x, y, z });
      if (!b || b.typeId !== RAIL_ID) return;
      b.setPermutation(b.permutation.withState(PLATFORM_STATE, state));
    },
  };
}

/** Revalidate one station against the live world; adopts/migrates/disconnects. */
function validateStationLive(station) {
  try {
    const dimension = world.getDimension(station.dim);
    const env = makeEnv(dimension, station.dim);
    const a = station.anchor;
    if (blockTypeAt(dimension, a.x, a.y, a.z) === RAIL_ID) {
      const comp = floodFill(env.isRail, { x: a.x, y: a.y, z: a.z });
      const { segments, lines } = footprintLineSummary(comp, env.supportLine);
      const positions = computeTexturePositions(comp);
      for (const b of comp) env.setPos(b.x, b.y, b.z, positions.get(posKey(b)) ?? 0);
      station.blocks = comp.map((b) => ({ x: b.x, y: b.y, z: b.z }));
      station.segments = segments;
      station.lines = lines;
      station.disconnected = false;
      station.updatedAt = Date.now();
      return true;
    }
    for (const b of station.blocks ?? []) {
      if (blockTypeAt(dimension, b.x, b.y, b.z) === RAIL_ID) {
        const comp = floodFill(env.isRail, b);
        const { segments, lines } = footprintLineSummary(comp, env.supportLine);
        station.blocks = comp.map((c) => ({ x: c.x, y: c.y, z: c.z }));
        station.segments = segments;
        station.lines = lines;
        station.disconnected = false;
        const anchor = comp.slice().sort((p, q) => (p.x - q.x) || (p.y - q.y) || (p.z - q.z))[0];
        station.anchor = { x: anchor.x, y: anchor.y, z: anchor.z, dim: station.dim };
        station.updatedAt = Date.now();
        markDirty();
        return true;
      }
    }
    if (!station.disconnected) {
      station.disconnected = true;
      station.updatedAt = Date.now();
      markDirty();
    }
    return false;
  } catch (e) {
    console.warn("[MTN] Station validation failed. " + e);
    return !station.disconnected;
  }
}

function stationAtPlayerFeet(player) {
  try {
    const dimension = player.dimension;
    const loc = player.location;
    const cx = Math.floor(loc.x), cy = Math.floor(loc.y), cz = Math.floor(loc.z);
    const candidates = [
      { x: cx, y: cy, z: cz },
      { x: cx, y: cy - 1, z: cz },
    ];
    const env = makeEnv(dimension, dimension.id);
    for (const c of candidates) {
      if (blockTypeAt(dimension, c.x, c.y, c.z) === RAIL_ID) {
        const component = floodFill(env.isRail, c);
        const { segments, lines } = footprintLineSummary(component, env.supportLine);
        const match = store.stations.find(
          (s) =>
            !s.disconnected &&
            s.dim === dimension.id &&
            component.some((b) => Object.prototype.hasOwnProperty.call(s.segments ?? {}, posKey(b)))
        ) ?? null;
        return { dimension, component, segments, lines, match };
      }
    }
    return null;
  } catch (e) {
    console.warn("[MTN] Footprint lookup failed. " + e);
    return null;
  }
}

function locateStationAt(player) {
  const found = stationAtPlayerFeet(player);
  if (!found || !found.match) return null;
  validateStationLive(found.match);
  markDirty();
  return found.match.disconnected ? null : found.match;
}

function registerAt(player, name) {
  try {
    const found = stationAtPlayerFeet(player);
    if (!found) {
      player.sendMessage("Stand on a Station Rail platform to register it.");
      return;
    }
    if (found.match) {
      player.sendMessage(`This platform is already part of "${found.match.name}".`);
      return;
    }
    const res = registerStation(store, found.dimension.id, found.component, found.segments, found.lines, name);
    if (!res.ok) {
      if (res.error === "duplicate_name") player.sendMessage("Station name already exists.");
      else if (res.error === "empty_name") player.sendMessage("Give the station a name first.");
      else if (res.error === "name_too_long") player.sendMessage("That name is too long (max 32 characters).");
      else player.sendMessage("The station could not be registered.");
      return;
    }
    save();
    player.sendMessage("Station registered successfully.");
    const lines = stationLineNames(res.station);
    player.sendMessage(lines.length > 0 ? `Line detected: ${lines.join(", ")}.` : "The supporting block is not recognised by the line system.");
  } catch (e) {
    console.warn("[MTN] Registration failed. " + e);
  }
}

function renameStationBy(player, id, newName) {
  try {
    const res = renameStation(store, id, newName);
    if (!res.ok) {
      if (res.error === "duplicate_name") player.sendMessage("Station name already exists.");
      else player.sendMessage("The station could not be renamed.");
      return;
    }
    save();
    player.sendMessage(`Station renamed to ${res.station.name}.`);
  } catch (e) {
    console.warn("[MTN] Rename failed. " + e);
  }
}

// ---- Event wiring ----

world.afterEvents.playerPlaceBlock.subscribe((ev) => {
  try {
    const { block, player, dimension } = ev;
    if (!block) return;
    const dimId = dimension.id;
    const env = makeEnv(dimension, dimId);
    const p = { x: block.location.x, y: block.location.y, z: block.location.z };
    if (block.typeId === RAIL_ID) {
      const res = recalculateAfterPlace(store, env, p);
      markDirty();
      if (res.mergedAway.length > 0) {
        try { player.sendMessage(`Stations merged. Kept registration; retired: ${res.mergedAway.join(", ")}.`); } catch { /* ignore */ }
      }
      const unassigned = Object.values(res.segments).filter((l) => !l).length;
      if (unassigned > 0) {
        try { player.sendMessage("The supporting block is not recognised by the line system."); } catch { /* ignore */ }
      }
    } else {
      // Any other block placed directly under a rail changes line identity.
      const above = { x: p.x, y: p.y + 1, z: p.z };
      if (blockTypeAt(dimension, above.x, above.y, above.z) === RAIL_ID) {
        recalculateSupport(store, env, above);
        markDirty();
      }
    }
  } catch (e) {
    console.warn("[MTN] playerPlaceBlock handler failed. " + e);
  }
});

world.beforeEvents.playerBreakBlock.subscribe((ev) => {
  try {
    const { block, dimension } = ev;
    if (!block) return;
    const wasRail = block.typeId === RAIL_ID;
    const dimId = dimension.id;
    const p = { x: block.location.x, y: block.location.y, z: block.location.z };
    system.run(() => {
      try {
        const dim = world.getDimension(dimId);
        const env = makeEnv(dim, dimId);
        if (wasRail) {
          const res = recalculateAfterBreak(store, env, p);
          for (const o of res.outcomes) {
            const st = findStationById(store, o.stationId);
            if (o.result === "disconnected" && st) {
              try {
                const payload = JSON.stringify({ rawtext: [{ text: `Station ${st.name} lost its platform and is disconnected.` }] });
                dim.runCommand(`tellraw @a ${payload}`);
              } catch { /* ignore */ }
            }
          }
          markDirty();
        } else {
          const above = { x: p.x, y: p.y + 1, z: p.z };
          if (blockTypeAt(dim, above.x, above.y, above.z) === RAIL_ID) {
            recalculateSupport(store, env, above);
            markDirty();
          }
        }
      } catch (e) {
        console.warn("[MTN] Break follow-up failed. " + e);
      }
    });
  } catch (e) {
    console.warn("[MTN] playerBreakBlock handler failed. " + e);
  }
});

world.afterEvents.playerInteractWithBlock.subscribe(async (ev) => {
  try {
    const { block, player } = ev;
    if (!block || block.typeId !== RAIL_ID) return;
    const dimension = player.dimension;
    const env = makeEnv(dimension, dimension.id);
    const at = { x: block.location.x, y: block.location.y, z: block.location.z };
    const component = floodFill(env.isRail, at);
    const { lines } = footprintLineSummary(component, env.supportLine);
    const match = store.stations.find(
      (s) =>
        !s.disconnected &&
        s.dim === dimension.id &&
        component.some((b) => Object.prototype.hasOwnProperty.call(s.segments ?? {}, posKey(b)))
    ) ?? null;
    if (match) {
      validateStationLive(match);
      markDirty();
      if (ui) await ui.openStation(player, match.id);
      else player.sendMessage(`Station ${match.name}. Lines: ${stationLineNames(match).join(", ") || "none"}. Use !go <destination> to travel.`);
    } else {
      const info = [
        "This platform is not registered yet.",
        `Platform blocks: ${component.length}`,
        lines.length > 0 ? `Lines: ${lines.map(lineDisplayName).join(", ")}` : "The supporting block is not recognised by the line system.",
      ];
      if (ui) await ui.openUnregistered(player, info);
      else player.sendMessage(info.join("\n") + "\nUse !register <name> to register.");
    }
  } catch (e) {
    console.warn("[MTN] Interact handler failed. " + e);
  }
});

world.afterEvents.playerLeave.subscribe((ev) => {
  try { transport.cancelJourneysFor(ev.playerId); } catch { /* ignore */ }
});

// Periodic cheap save flush (event handlers only mark dirty; no world scans here).
system.runInterval(() => {
  try {
    if (saveDirty) save();
  } catch (e) {
    console.warn("[MTN] Autosave failed. " + e);
  }
}, 100);

// Best-effort custom slash command (/line <name>), isolated in its own module
// so any Education Edition API difference cannot break the core system.
// Chat fallback (!line) always works regardless.
// NOTE: the startup subscription must run at top level (early execution);
// subscribing from inside system.run() would miss the event entirely.
import("./custom_command.js")
  .then((mod) => {
    try { mod.tryRegisterLineCommand(() => store); } catch (e) {
      console.warn("[MTN] Custom command unavailable; use !line instead. " + e);
    }
  })
  .catch((e) => {
    console.warn("[MTN] Custom command unavailable; use !line instead. " + e);
  });

// ---- Startup ----
// World state (dynamic properties) may only be touched AFTER worldLoad.
// Everything above is subscription-only, which early execution allows.
console.warn("[MTN] Minecraft Transit Network script module evaluating.");

world.afterEvents.worldLoad.subscribe(() => {
  try {
    store = loadStore(world);
    worldReady = true;
    console.warn("[MTN] Minecraft Transit Network loaded. Stations: " + store.stations.length);
  } catch (e) {
    console.warn("[MTN] World-load init failed; running with empty network. " + e);
    store = createEmptyStore();
    worldReady = true;
  }

  registerChatCommands({
    getStore: () => store,
    save,
    locateStationAt,
    registerAt,
    renameStationBy,
    transport,
    uiLoaded: () => ui !== null,
  });

  system.run(() => {
    import("./interface_manager.js")
      .then((mod) => {
        ui = mod.createInterface({ getStore: () => store, save, transport, registerAt, renameStationBy });
        console.warn("[MTN] Station interface ready.");
      })
      .catch((e) => {
        console.warn("[MTN] Scripted forms unavailable; chat commands (!help) remain active. " + e);
      });
  });
});
