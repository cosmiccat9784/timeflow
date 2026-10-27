// Network manager: the transport graph.
// Dependency-free. Stations are nodes; an edge exists between two registered
// stations when they share at least one line (line-connectivity model).
//
// The line-connectivity model is a deliberate, documented assumption: the
// scripting API cannot trace vanilla track between distant stations, so every
// registered station on the same line is treated as reachable via that line.
// Players must still build real track; the planner never invents an edge
// between stations that share no line.

/**
 * Build an adjacency map: stationId -> [{ id, lines }].
 * Neighbours are sorted by station name (case-insensitive) for determinism.
 */
export function buildAdjacency(stations) {
  const byLine = new Map();
  for (const st of stations) {
    if (!st || st.disconnected) continue;
    for (const line of st.lines ?? []) {
      if (!byLine.has(line)) byLine.set(line, []);
      byLine.get(line).push(st);
    }
  }
  const adj = new Map();
  for (const st of stations) {
    if (!st || st.disconnected) continue;
    const neighbours = new Map();
    for (const line of st.lines ?? []) {
      for (const other of byLine.get(line) ?? []) {
        if (other.id === st.id) continue;
        if (!neighbours.has(other.id)) neighbours.set(other.id, { id: other.id, lines: [] });
        if (!neighbours.get(other.id).lines.includes(line)) {
          neighbours.get(other.id).lines.push(line);
        }
      }
    }
    adj.set(
      st.id,
      [...neighbours.values()].sort((a, b) => {
        const na = stationNameById(stations, a.id).toLowerCase();
        const nb = stationNameById(stations, b.id).toLowerCase();
        return na < nb ? -1 : na > nb ? 1 : 0;
      })
    );
  }
  return adj;
}

export function stationNameById(stations, id) {
  const st = stations.find((s) => s?.id === id);
  return st ? st.name : id;
}

/**
 * Order the stations of one line for listings.
 * Deterministic coordinate order (dimension, x, y, z). Interchanges flagged
 * separately by the caller. Physical branch topology cannot be detected
 * through the scripting API, so branches are NOT invented; see docs.
 */
export function orderStationsOnLine(stations, lineKey) {
  return stations
    .filter((s) => s && !s.disconnected && (s.lines ?? []).includes(lineKey))
    .slice()
    .sort((a, b) => {
      const da = a.anchor?.dim ?? "";
      const db = b.anchor?.dim ?? "";
      if (da !== db) return da < db ? -1 : 1;
      if (a.anchor.x !== b.anchor.x) return a.anchor.x - b.anchor.x;
      if (a.anchor.y !== b.anchor.y) return a.anchor.y - b.anchor.y;
      return a.anchor.z - b.anchor.z;
    });
}

/** All active line keys across registered, connected stations. */
export function activeLines(stations) {
  const set = new Set();
  for (const st of stations) {
    if (!st || st.disconnected) continue;
    for (const line of st.lines ?? []) set.add(line);
  }
  return [...set].sort();
}
