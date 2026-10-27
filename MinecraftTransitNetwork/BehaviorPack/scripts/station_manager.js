// Station manager: footprints, merging, splits, registration.
// Top-level imports are dependency-free so footprint maths is Node-testable.
// Minecraft API objects (dimension, blocks) are only touched inside functions
// through the injected `env` parameter (duck-typed), never imported here.

import {
  RAIL_ID,
  POS_SINGLE,
  POS_LEFT,
  POS_CENTER,
  POS_RIGHT,
  PLATFORM_STATE,
  HORIZONTAL_OFFSETS,
  posKey,
  comparePos,
} from "./config.js";
import { lineDisplayName } from "./line_manager.js";

const MAX_FOOTPRINT_BLOCKS = 4096;

export function createEmptyStore() {
  return { version: 1, seq: 0, stations: [] };
}

export function normalizeStation(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (typeof raw.id !== "string" || typeof raw.name !== "string") return null;
  if (!raw.anchor || typeof raw.anchor.x !== "number") return null;
  return {
    id: raw.id,
    name: raw.name,
    anchor: { x: raw.anchor.x, y: raw.anchor.y, z: raw.anchor.z, dim: raw.anchor.dim ?? "minecraft:overworld" },
    dim: raw.dim ?? raw.anchor.dim ?? "minecraft:overworld",
    blocks: Array.isArray(raw.blocks) ? raw.blocks.filter((b) => b && typeof b.x === "number") : [],
    segments: raw.segments && typeof raw.segments === "object" ? { ...raw.segments } : {},
    lines: Array.isArray(raw.lines) ? [...new Set(raw.lines.filter((l) => typeof l === "string"))] : [],
    disconnected: raw.disconnected === true,
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : 0,
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : 0,
  };
}

/** Breadth-first flood fill over horizontal face-adjacent rails. */
export function floodFill(isRail, start) {
  if (!isRail(start.x, start.y, start.z)) return [];
  const seen = new Set([posKey(start)]);
  const queue = [{ x: start.x, y: start.y, z: start.z }];
  const out = [];
  while (queue.length > 0) {
    const cur = queue.pop();
    out.push(cur);
    if (out.length >= MAX_FOOTPRINT_BLOCKS) break;
    for (const o of HORIZONTAL_OFFSETS) {
      const n = { x: cur.x + o.x, y: cur.y + o.y, z: cur.z + o.z };
      const k = posKey(n);
      if (seen.has(k)) continue;
      seen.add(k);
      if (isRail(n.x, n.y, n.z)) queue.push(n);
    }
  }
  return out.sort(comparePos);
}

/**
 * Deterministic platform ordering rule (documented, stable across reloads):
 * - If the footprint is at least as wide (x) as it is deep (z), group blocks
 *   into rows by z (rows sorted ascending z), each row sorted ascending x.
 * - Otherwise group into columns by x (sorted ascending x), each column
 *   sorted ascending z.
 * Within each group of N positions: N==1 -> Single; else Left, (N-2)x Centre, Right.
 */
export function computeTexturePositions(blocks) {
  const result = new Map();
  if (!blocks || blocks.length === 0) return result;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const b of blocks) {
    if (b.x < minX) minX = b.x;
    if (b.x > maxX) maxX = b.x;
    if (b.z < minZ) minZ = b.z;
    if (b.z > maxZ) maxZ = b.z;
  }
  const wide = maxX - minX >= maxZ - minZ;
  const groups = new Map();
  for (const b of blocks) {
    const g = wide ? b.z : b.x;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(b);
  }
  const orderedKeys = [...groups.keys()].sort((a, b) => a - b);
  for (const g of orderedKeys) {
    const row = groups.get(g).sort((a, b) => (wide ? a.x - b.x : a.z - b.z));
    if (row.length === 1) {
      result.set(posKey(row[0]), POS_SINGLE);
    } else {
      row.forEach((b, i) => {
        const state = i === 0 ? POS_LEFT : i === row.length - 1 ? POS_RIGHT : POS_CENTER;
        result.set(posKey(b), state);
      });
    }
  }
  return result;
}

export function footprintLineSummary(blocks, supportLineFn) {
  const segments = {};
  const lineSet = new Set();
  for (const b of blocks) {
    let line = null;
    try {
      line = supportLineFn(b.x, b.y, b.z) ?? null;
    } catch {
      line = null;
    }
    segments[posKey(b)] = line;
    if (line) lineSet.add(line);
  }
  return { segments, lines: [...lineSet].sort() };
}

export function anchorOf(blocks) {
  if (!blocks || blocks.length === 0) return null;
  return blocks.slice().sort(comparePos)[0];
}

export function findStationById(store, id) {
  return store.stations.find((s) => s.id === id) ?? null;
}

export function findStationByName(store, name) {
  const q = String(name ?? "").trim().toLowerCase();
  return store.stations.find((s) => s.name.trim().toLowerCase() === q) ?? null;
}

/** Registered, connected stations in a dimension whose footprint contains posKey. */
export function stationsContaining(store, dimId, key) {
  return store.stations.filter(
    (s) =>
      !s.disconnected &&
      s.dim === dimId &&
      Object.prototype.hasOwnProperty.call(s.segments ?? {}, key)
  );
}

export function registerStation(store, dimId, blocks, segments, lines, name) {
  const clean = String(name ?? "").trim();
  if (clean.length === 0) return { ok: false, error: "empty_name" };
  if (clean.length > 32) return { ok: false, error: "name_too_long" };
  if (findStationByName(store, clean)) return { ok: false, error: "duplicate_name" };
  const anchor = anchorOf(blocks);
  if (!anchor) return { ok: false, error: "empty_footprint" };
  store.seq += 1;
  const now = Date.now();
  const station = {
    id: `mtn-${store.seq}`,
    name: clean,
    anchor: { x: anchor.x, y: anchor.y, z: anchor.z, dim: dimId },
    dim: dimId,
    blocks: blocks.map((b) => ({ x: b.x, y: b.y, z: b.z })),
    segments: { ...segments },
    lines: [...lines],
    disconnected: false,
    createdAt: now,
    updatedAt: now,
  };
  store.stations.push(station);
  return { ok: true, station };
}

export function renameStation(store, id, newName) {
  const st = findStationById(store, id);
  if (!st) return { ok: false, error: "unknown_station" };
  const clean = String(newName ?? "").trim();
  if (clean.length === 0) return { ok: false, error: "empty_name" };
  if (clean.length > 32) return { ok: false, error: "name_too_long" };
  const clash = findStationByName(store, clean);
  if (clash && clash.id !== id) return { ok: false, error: "duplicate_name" };
  st.name = clean;
  st.updatedAt = Date.now();
  return { ok: true, station: st };
}

export function removeStation(store, id) {
  const i = store.stations.findIndex((s) => s.id === id);
  if (i < 0) return false;
  store.stations.splice(i, 1);
  return true;
}

function applyFootprint(store, station, dimId, blocks, segments, lines, keepAnchorIfPresent = false) {
  const anchor = anchorOf(blocks);
  station.blocks = blocks.map((b) => ({ x: b.x, y: b.y, z: b.z }));
  station.segments = { ...segments };
  station.lines = [...lines];
  station.disconnected = false;
  if (keepAnchorIfPresent && station.anchor) {
    const aKey = `${station.anchor.x},${station.anchor.y},${station.anchor.z}`;
    if (Object.prototype.hasOwnProperty.call(station.segments, aKey)) {
      station.updatedAt = Date.now();
      return;
    }
  }
  if (anchor) station.anchor = { x: anchor.x, y: anchor.y, z: anchor.z, dim: dimId };
  station.updatedAt = Date.now();
}

/**
 * Recalculate after a Station Rail placement.
 * env: { dimId, isRail(x,y,z), supportLine(x,y,z), setPos(x,y,z,state) }
 */
export function recalculateAfterPlace(store, env, placed) {
  const component = floodFill(env.isRail, placed);
  const positions = computeTexturePositions(component);
  for (const b of component) {
    try {
      env.setPos(b.x, b.y, b.z, positions.get(posKey(b)) ?? POS_SINGLE);
    } catch { /* keep world stable if a single update fails */ }
  }
  const { segments, lines } = footprintLineSummary(component, env.supportLine);
  const keys = new Set(component.map(posKey));
  const matching = store.stations.filter(
    (s) =>
      !s.disconnected &&
      s.dim === env.dimId &&
      Object.keys(s.segments ?? {}).some((k) => keys.has(k))
  );
  if (matching.length === 0) {
    return { component, segments, lines, stationId: null, mergedAway: [] };
  }
  matching.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
  const keeper = matching[0];
  // Merge rule (documented): the oldest registration survives, keeping its
  // anchor when it is still part of the merged footprint.
  applyFootprint(store, keeper, env.dimId, component, segments, lines, true);
  const mergedAway = [];
  for (const other of matching.slice(1)) {
    mergedAway.push(other.name);
    removeStation(store, other.id);
  }
  return { component, segments, lines, stationId: keeper.id, mergedAway };
}

/**
 * Recalculate after a Station Rail removal at `broken`.
 * env: same as recalculateAfterPlace.
 * Returns per-station outcomes for messaging/persistence.
 */
export function recalculateAfterBreak(store, env, broken) {
  const outcomes = [];
  // Find components adjacent to the break (the break cell itself is now air).
  const neighbourRoots = [];
  for (const o of HORIZONTAL_OFFSETS) {
    const n = { x: broken.x + o.x, y: broken.y + o.y, z: broken.z + o.z };
    try {
      if (env.isRail(n.x, n.y, n.z)) neighbourRoots.push(n);
    } catch { /* ignore */ }
  }
  const seen = new Set();
  const components = [];
  for (const root of neighbourRoots) {
    const k = posKey(root);
    if (seen.has(k)) continue;
    const comp = floodFill(env.isRail, root);
    for (const b of comp) seen.add(posKey(b));
    if (comp.length > 0) components.push(comp);
  }
  for (const comp of components) {
    const positions = computeTexturePositions(comp);
    for (const b of comp) {
      try {
        env.setPos(b.x, b.y, b.z, positions.get(posKey(b)) ?? POS_SINGLE);
      } catch { /* ignore */ }
    }
  }

  const brokenKey = posKey(broken);
  const affected = store.stations.filter(
    (s) =>
      !s.disconnected &&
      s.dim === env.dimId &&
      Object.prototype.hasOwnProperty.call(s.segments ?? {}, brokenKey)
  );
  for (const st of affected) {
    const anchorKey = posKey(st.anchor);
    let anchorComp = null;
    try {
      if (env.isRail(st.anchor.x, st.anchor.y, st.anchor.z)) {
        anchorComp = components.find((c) => c.some((b) => posKey(b) === anchorKey)) ?? null;
      }
    } catch { anchorComp = null; }
    if (anchorComp) {
      const { segments, lines } = footprintLineSummary(anchorComp, env.supportLine);
      applyFootprint(store, st, env.dimId, anchorComp, segments, lines);
      outcomes.push({ stationId: st.id, result: components.length > 1 ? "split" : "shrunk" });
    } else if (components.length > 0) {
      // Anchor destroyed: migrate identity to the largest remnant (documented rule).
      const largest = components.slice().sort((a, b) => b.length - a.length)[0];
      const { segments, lines } = footprintLineSummary(largest, env.supportLine);
      applyFootprint(store, st, env.dimId, largest, segments, lines);
      outcomes.push({ stationId: st.id, result: "anchor_migrated" });
    } else {
      st.blocks = [];
      st.segments = {};
      st.lines = [];
      st.disconnected = true;
      st.updatedAt = Date.now();
      outcomes.push({ stationId: st.id, result: "disconnected" });
    }
  }
  return { components, outcomes };
}

/**
 * Recalculate line associations for the rail component at `at`
 * (used when a supporting block changes). Textures are refreshed too.
 */
export function recalculateSupport(store, env, at) {
  let isRailNow = false;
  try {
    isRailNow = env.isRail(at.x, at.y, at.z);
  } catch { isRailNow = false; }
  if (!isRailNow) return { stationId: null, lines: [] };
  const component = floodFill(env.isRail, at);
  const positions = computeTexturePositions(component);
  for (const b of component) {
    try {
      env.setPos(b.x, b.y, b.z, positions.get(posKey(b)) ?? POS_SINGLE);
    } catch { /* ignore */ }
  }
  const { segments, lines } = footprintLineSummary(component, env.supportLine);
  const keys = new Set(component.map(posKey));
  const match = store.stations.find(
    (s) =>
      !s.disconnected &&
      s.dim === env.dimId &&
      Object.keys(s.segments ?? {}).some((k) => keys.has(k))
  );
  if (!match) return { stationId: null, lines };
  applyFootprint(store, match, env.dimId, component, segments, lines);
  return { stationId: match.id, lines };
}

export function stationLineNames(station) {
  return (station.lines ?? []).map(lineDisplayName);
}

// Re-export for tests that import from one place.
export { RAIL_ID, PLATFORM_STATE };
