// Route planner: breadth-first search over the station graph.
// Dependency-free. Finds the fewest-edge valid route; ties break
// deterministically by station name (see network_manager.buildAdjacency).

import { buildAdjacency, stationNameById } from "./network_manager.js";

/**
 * Plan a route from fromId to toId.
 * @param stations registered station records
 * @returns { ok, legs, transfers, error }
 *   legs: [{ from, to, line }] with station ids; line = line used for the leg.
 */
export function planRoute(stations, fromId, toId) {
  const list = stations ?? [];
  const from = list.find((s) => s?.id === fromId && !s.disconnected);
  const to = list.find((s) => s?.id === toId && !s.disconnected);
  if (!from) return { ok: false, error: "not_registered", detail: "departure" };
  if (!to) return { ok: false, error: "not_registered", detail: "destination" };
  if (fromId === toId) return { ok: false, error: "same_station" };

  const adj = buildAdjacency(list);
  const prev = new Map(); // id -> { via, line }
  const visited = new Set([fromId]);
  const queue = [fromId];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === toId) break;
    for (const nb of adj.get(current) ?? []) {
      if (visited.has(nb.id)) continue;
      visited.add(nb.id);
      const line = chooseLine(list, current, nb.id, prev, fromId);
      prev.set(nb.id, { via: current, line });
      queue.push(nb.id);
    }
  }

  if (!visited.has(toId)) return { ok: false, error: "no_route" };

  // Reconstruct path, then assign each leg the best line (prefer staying on
  // the previous leg's line to minimise transfers).
  const path = [];
  let cursor = toId;
  while (cursor !== fromId) {
    path.unshift(cursor);
    cursor = prev.get(cursor).via;
  }
  path.unshift(fromId);

  const legs = [];
  let currentLine = null;
  for (let i = 0; i < path.length - 1; i++) {
    const shared = sharedLines(list, path[i], path[i + 1]);
    let line = null;
    if (currentLine && shared.includes(currentLine)) line = currentLine;
    else line = shared.slice().sort()[0] ?? null;
    if (!line) return { ok: false, error: "no_route" };
    currentLine = line;
    legs.push({ from: path[i], to: path[i + 1], line });
  }

  const transfers = [];
  for (let i = 1; i < legs.length; i++) {
    if (legs[i].line !== legs[i - 1].line) transfers.push(legs[i].from);
  }

  return { ok: true, legs, transfers };
}

function sharedLines(stations, aId, bId) {
  const a = stations.find((s) => s?.id === aId);
  const b = stations.find((s) => s?.id === bId);
  if (!a || !b) return [];
  return (a.lines ?? []).filter((l) => (b.lines ?? []).includes(l));
}

// Prefer continuing on the line used to reach `current` (fewer transfers).
function chooseLine(stations, currentId, nextId, prev, fromId) {
  const shared = sharedLines(stations, currentId, nextId).slice().sort();
  if (currentId === fromId || !prev.has(currentId)) return shared[0] ?? null;
  const incoming = prev.get(currentId).line;
  if (incoming && shared.includes(incoming)) return incoming;
  return shared[0] ?? null;
}

/** Render a route as player-readable steps. */
export function describeRoute(stations, route, displayName) {
  const name = displayName ?? ((k) => k);
  const byId = new Map(stations.map((s) => [s.id, s]));
  const dest = byId.get(route.legs[route.legs.length - 1].to);
  const out = [`Destination: ${dest ? dest.name : "unknown"}`, ""];
  let step = 0;
  route.legs.forEach((leg, i) => {
    if (i === 0) out.push(`${++step}. Take the ${name(leg.line)}.`);
    if (i > 0 && leg.line !== route.legs[i - 1].line) {
      const at = byId.get(leg.from);
      out.push(`${++step}. Transfer at ${at ? at.name : leg.from}.`);
      out.push(`${++step}. Continue on the ${name(leg.line)}.`);
    }
  });
  const last = byId.get(route.legs[route.legs.length - 1].to);
  out.push(`${++step}. Arrive at ${last ? last.name : "unknown"}.`);
  out.push("");
  out.push("Fare: 1 emerald");
  return out.join("\n");
}

export { stationNameById };
