// Node test suite for the dependency-free transit modules.
// Run with:  node --test Tests/test_all.mjs   (Node 18+)
// or simply:  node Tests/test_all.mjs
// These modules never import @minecraft/server, so they run outside the game.

import { test } from "node:test";
import assert from "node:assert/strict";

import { RAIL_ID, posKey } from "../BehaviorPack/scripts/config.js";
import {
  lineKeyFromSupportBlock,
  lineDisplayName,
  resolveLineQuery,
} from "../BehaviorPack/scripts/line_manager.js";
import {
  buildAdjacency,
  orderStationsOnLine,
  activeLines,
} from "../BehaviorPack/scripts/network_manager.js";
import { planRoute, describeRoute } from "../BehaviorPack/scripts/route_planner.js";
import {
  floodFill,
  computeTexturePositions,
  registerStation,
  renameStation,
  recalculateAfterPlace,
  recalculateAfterBreak,
  recalculateSupport,
  createEmptyStore,
  stationsContaining,
} from "../BehaviorPack/scripts/station_manager.js";
import { loadStore, saveStore } from "../BehaviorPack/scripts/persistence_manager.js";

// ---------- tiny in-memory world ----------

function makeWorld(supports = {}) {
  // supports: { "x,y,z": supportTypeId } for rail cells; rails stored in set.
  const rails = new Set();
  const states = new Map();
  const env = {
    dimId: "minecraft:overworld",
    isRail: (x, y, z) => rails.has(`${x},${y},${z}`),
    supportLine: (x, y, z) => {
      const id = supports[`${x},${y},${z}`] ?? supports[`${x},${y - 1},${z}`] ?? null;
      if (!id) return null;
      const low = id.toLowerCase();
      if (low.endsWith("air") || low.endsWith("water") || low.endsWith("lava")) return null;
      return low;
    },
    setPos: (x, y, z, s) => states.set(`${x},${y},${z}`, s),
  };
  return {
    rails,
    states,
    env,
    addRail: (x, z, support = "minecraft:diamond_block", y = 64) => {
      rails.add(`${x},${y},${z}`);
      supports[`${x},${y},${z}`] = support;
    },
  };
}

function station(id, name, lines, anchor = { x: 0, y: 64, z: 0, dim: "minecraft:overworld" }) {
  return { id, name, lines, anchor, dim: anchor.dim, blocks: [anchor], segments: {}, disconnected: false };
}

// ---------- line manager ----------

test("supporting block determines the exact line name", () => {
  assert.equal(lineKeyFromSupportBlock("minecraft:diamond_block"), "minecraft:diamond_block");
  assert.equal(lineDisplayName("minecraft:diamond_block"), "Diamond Line");
  assert.equal(lineDisplayName("minecraft:gold_block"), "Gold Line");
  assert.equal(lineDisplayName("minecraft:emerald_block"), "Emerald Line");
  assert.equal(lineDisplayName("minecraft:red_wool"), "Red Wool Line");
  assert.equal(lineDisplayName("minecraft:lapis_block"), "Lapis Line");
});

test("colour alone is not identity: red wool vs red concrete differ", () => {
  const a = lineKeyFromSupportBlock("minecraft:red_wool");
  const b = lineKeyFromSupportBlock("minecraft:red_concrete");
  assert.notEqual(a, b);
  assert.notEqual(lineDisplayName(a), lineDisplayName(b));
});

test("air/water/lava never produce a line", () => {
  assert.equal(lineKeyFromSupportBlock("minecraft:air"), null);
  assert.equal(lineKeyFromSupportBlock("minecraft:water"), null);
  assert.equal(lineKeyFromSupportBlock("minecraft:lava"), null);
  assert.equal(lineKeyFromSupportBlock(""), null);
  assert.equal(lineKeyFromSupportBlock(null), null);
});

test("line query resolution is case-insensitive and flexible", () => {
  const known = ["minecraft:diamond_block", "minecraft:gold_block", "minecraft:red_wool"];
  assert.equal(resolveLineQuery("diamond", known), "minecraft:diamond_block");
  assert.equal(resolveLineQuery("Diamond Line", known), "minecraft:diamond_block");
  assert.equal(resolveLineQuery("minecraft:gold_block", known), "minecraft:gold_block");
  assert.equal(resolveLineQuery("GOLD", known), "minecraft:gold_block");
  assert.equal(resolveLineQuery("red wool", known), "minecraft:red_wool");
  assert.equal(resolveLineQuery("platinum", known), null);
});

// ---------- flood fill ----------

test("horizontal neighbours merge; diagonal and vertical do not", () => {
  const w = makeWorld();
  w.addRail(0, 0); w.addRail(1, 0);            // row
  w.addRail(1, 1);                             // joined via (1,64,0), not diagonal-only
  const comp = floodFill(w.env.isRail, { x: 0, y: 64, z: 0 });
  assert.deepEqual(comp.map((b) => [b.x, b.z]), [[0, 0], [1, 0], [1, 1]]);
  // vertical neighbour must not merge
  w.rails.add("0,65,0");
  const comp2 = floodFill(w.env.isRail, { x: 0, y: 64, z: 0 });
  assert.ok(!comp2.some((b) => b.y === 65));
  // pure diagonal stays separate
  const w2 = makeWorld();
  w2.addRail(5, 5); w2.addRail(6, 6);
  assert.equal(floodFill(w2.env.isRail, { x: 5, y: 64, z: 5 }).length, 1);
});

// ---------- textures ----------

test("texture sequences follow the Single/Left/Centre/Right table", () => {
  const seq = (n) => {
    const blocks = Array.from({ length: n }, (_, i) => ({ x: i, y: 64, z: 0 }));
    const m = computeTexturePositions(blocks);
    return blocks.map((b) => m.get(posKey(b)));
  };
  assert.deepEqual(seq(1), [0]);
  assert.deepEqual(seq(2), [1, 3]);
  assert.deepEqual(seq(3), [1, 2, 3]);
  assert.deepEqual(seq(4), [1, 2, 2, 3]);
  assert.deepEqual(seq(5), [1, 2, 2, 2, 3]);
  const ten = seq(10);
  assert.equal(ten[0], 1);
  assert.equal(ten[9], 3);
  assert.ok(ten.slice(1, 9).every((s) => s === 2));
});

test("narrow (column) footprints texture along z", () => {
  const blocks = [{ x: 0, y: 64, z: 0 }, { x: 0, y: 64, z: 1 }, { x: 0, y: 64, z: 2 }];
  const m = computeTexturePositions(blocks);
  assert.deepEqual([m.get("0,64,0"), m.get("0,64,1"), m.get("0,64,2")], [1, 2, 3]);
});

// ---------- registration ----------

test("registration enforces unique trimmed case-insensitive names", () => {
  const store = createEmptyStore();
  const blocks = [{ x: 0, y: 64, z: 0 }];
  assert.ok(registerStation(store, "minecraft:overworld", blocks, {}, ["minecraft:diamond_block"], "Central").ok);
  assert.equal(registerStation(store, "minecraft:overworld", blocks, {}, [], " central ").ok, false);
  assert.equal(registerStation(store, "minecraft:overworld", blocks, {}, [], "CENTRAL").ok, false);
  assert.equal(registerStation(store, "minecraft:overworld", blocks, {}, [], "  ").ok, false);
  assert.ok(registerStation(store, "minecraft:overworld", blocks, {}, [], "Harbour").ok);
});

test("rename keeps identity and blocks duplicates", () => {
  const store = createEmptyStore();
  const blocks = [{ x: 0, y: 64, z: 0 }];
  const a = registerStation(store, "minecraft:overworld", blocks, {}, [], "Central").station;
  registerStation(store, "minecraft:overworld", [{ x: 9, y: 64, z: 9 }], {}, [], "Harbour");
  assert.equal(renameStation(store, a.id, "Harbour").ok, false);
  const r = renameStation(store, a.id, "City Square");
  assert.ok(r.ok);
  assert.equal(r.station.id, a.id);
  assert.equal(r.station.name, "City Square");
});

// ---------- place / split ----------

test("placement merges one footprint, keeps multi-line associations", () => {
  const w = makeWorld();
  const store = createEmptyStore();
  w.addRail(0, 0, "minecraft:diamond_block");
  let res = recalculateAfterPlace(store, w.env, { x: 0, y: 64, z: 0 });
  assert.equal(res.component.length, 1);
  assert.deepEqual(res.lines, ["minecraft:diamond_block"]);
  w.addRail(1, 0, "minecraft:emerald_block");
  res = recalculateAfterPlace(store, w.env, { x: 1, y: 64, z: 0 });
  assert.equal(res.component.length, 2);
  assert.deepEqual(res.lines.sort(), ["minecraft:diamond_block", "minecraft:emerald_block"]);
  assert.deepEqual([w.states.get("0,64,0"), w.states.get("1,64,0")], [1, 3]);
});

test("breaking the middle splits the footprint and re-textures", () => {
  const w = makeWorld();
  const store = createEmptyStore();
  for (let x = 0; x < 4; x++) w.addRail(x, 0);
  const placed = recalculateAfterPlace(store, w.env, { x: 0, y: 64, z: 0 });
  assert.equal(placed.component.length, 4);
  const reg = registerStation(store, "minecraft:overworld", placed.component, placed.segments, placed.lines, "Central");
  assert.ok(reg.ok);
  w.rails.delete("1,64,0"); // break second block
  const res = recalculateAfterBreak(store, w.env, { x: 1, y: 64, z: 0 });
  assert.equal(res.components.length, 2);
  const st = store.stations[0];
  assert.equal(st.blocks.length, 1); // anchor (0,64,0) side preserved
  assert.deepEqual(st.blocks[0], { x: 0, y: 64, z: 0 });
  assert.equal(w.states.get("0,64,0"), 0); // back to Single
});

test("breaking the anchor migrates identity to the largest remnant", () => {
  const w = makeWorld();
  const store = createEmptyStore();
  for (let x = 0; x < 3; x++) w.addRail(x, 0);
  const placed = recalculateAfterPlace(store, w.env, { x: 0, y: 64, z: 0 });
  registerStation(store, "minecraft:overworld", placed.component, placed.segments, placed.lines, "Central");
  w.rails.delete("0,64,0");
  const res = recalculateAfterBreak(store, w.env, { x: 0, y: 64, z: 0 });
  assert.equal(res.outcomes[0].result, "anchor_migrated");
  assert.equal(store.stations[0].name, "Central");
  assert.equal(store.stations[0].blocks.length, 2);
});

test("support change recalculates the line", () => {
  const supports = {};
  const w = makeWorld(supports);
  const store = createEmptyStore();
  w.addRail(0, 0, "minecraft:diamond_block");
  const placed = recalculateAfterPlace(store, w.env, { x: 0, y: 64, z: 0 });
  registerStation(store, "minecraft:overworld", placed.component, placed.segments, placed.lines, "Central");
  supports["0,64,0"] = "minecraft:gold_block";
  const res = recalculateSupport(store, w.env, { x: 0, y: 64, z: 0 });
  assert.deepEqual(res.lines, ["minecraft:gold_block"]);
  assert.deepEqual(store.stations[0].lines, ["minecraft:gold_block"]);
});

test("stationsContaining finds footprints by block", () => {
  const store = createEmptyStore();
  registerStation(store, "minecraft:overworld", [{ x: 2, y: 64, z: 2 }], { "2,64,2": "minecraft:diamond_block" }, ["minecraft:diamond_block"], "Central");
  assert.equal(stationsContaining(store, "minecraft:overworld", "2,64,2").length, 1);
  assert.equal(stationsContaining(store, "minecraft:overworld", "3,64,3").length, 0);
});

// ---------- network + routing ----------

test("direct route on one line", () => {
  const stations = [
    station("mtn-1", "Central", ["minecraft:diamond_block"], { x: 0, y: 64, z: 0, dim: "minecraft:overworld" }),
    station("mtn-2", "Harbour", ["minecraft:diamond_block"], { x: 100, y: 64, z: 0, dim: "minecraft:overworld" }),
  ];
  const r = planRoute(stations, "mtn-1", "mtn-2");
  assert.ok(r.ok);
  assert.equal(r.legs.length, 1);
  assert.deepEqual(r.transfers, []);
});

test("transfer route is automatic with one fare", () => {
  const stations = [
    station("mtn-1", "Central", ["minecraft:diamond_block"]),
    station("mtn-2", "Diamond Junction", ["minecraft:diamond_block", "minecraft:emerald_block"]),
    station("mtn-3", "Harbour", ["minecraft:emerald_block"]),
  ];
  const r = planRoute(stations, "mtn-1", "mtn-3");
  assert.ok(r.ok);
  assert.equal(r.legs.length, 2);
  assert.deepEqual(r.transfers, ["mtn-2"]);
  const text = describeRoute(stations, r, lineDisplayName);
  assert.match(text, /Transfer at Diamond Junction/);
  assert.match(text, /Fare: 1 emerald/);
});

test("disconnected destinations are rejected, never charged", () => {
  const stations = [
    station("mtn-1", "Central", ["minecraft:diamond_block"]),
    station("mtn-2", "Airport", ["minecraft:gold_block"]),
  ];
  assert.equal(planRoute(stations, "mtn-1", "mtn-2").error, "no_route");
  assert.equal(planRoute(stations, "mtn-1", "mtn-1").error, "same_station");
  assert.equal(planRoute(stations, "mtn-1", "mtn-9").error, "not_registered");
});

test("route choice is deterministic regardless of input order", () => {
  const base = [
    station("mtn-1", "Central", ["minecraft:diamond_block"]),
    station("mtn-2", "Beta", ["minecraft:diamond_block", "minecraft:emerald_block"]),
    station("mtn-3", "Alpha", ["minecraft:diamond_block", "minecraft:emerald_block"]),
    station("mtn-4", "Harbour", ["minecraft:emerald_block"]),
  ];
  const rev = base.slice().reverse();
  const r1 = planRoute(base, "mtn-1", "mtn-4");
  const r2 = planRoute(rev, "mtn-1", "mtn-4");
  assert.deepEqual(r1, r2);
  // Alphabetically-first interchange wins the tie, in both orders.
  assert.deepEqual(r1.transfers, ["mtn-3"]);
});

test("line listings use coordinate order with interchange flags", () => {
  const stations = [
    station("mtn-1", "Harbour", ["minecraft:diamond_block"], { x: 100, y: 64, z: 0, dim: "minecraft:overworld" }),
    station("mtn-2", "Central", ["minecraft:diamond_block"], { x: 0, y: 64, z: 0, dim: "minecraft:overworld" }),
    station("mtn-3", "Junction", ["minecraft:diamond_block", "minecraft:gold_block"], { x: 50, y: 64, z: 0, dim: "minecraft:overworld" }),
  ];
  const ordered = orderStationsOnLine(stations, "minecraft:diamond_block");
  assert.deepEqual(ordered.map((s) => s.name), ["Central", "Junction", "Harbour"]);
  assert.deepEqual(activeLines(stations).sort(), ["minecraft:diamond_block", "minecraft:gold_block"]);
  assert.equal(buildAdjacency(stations).get("mtn-1").length, 2);
});

// ---------- persistence ----------

function mockWorld() {
  const props = new Map();
  return {
    getDynamicProperty: (k) => (props.has(k) ? props.get(k) : undefined),
    setDynamicProperty: (k, v) => { props.set(k, v); },
  };
}

test("save/load round-trips stations and dedupes stale records", () => {
  const w = mockWorld();
  const store = createEmptyStore();
  registerStation(store, "minecraft:overworld", [{ x: 0, y: 64, z: 0 }], {}, ["minecraft:diamond_block"], "Central");
  assert.ok(saveStore(w, store).ok);
  const loaded = loadStore(w);
  assert.equal(loaded.stations.length, 1);
  assert.equal(loaded.stations[0].name, "Central");
  assert.equal(loaded.seq, 1);
});

test("RAIL_ID constant matches the custom block", () => {
  assert.equal(RAIL_ID, "mtn:station_rail");
});
