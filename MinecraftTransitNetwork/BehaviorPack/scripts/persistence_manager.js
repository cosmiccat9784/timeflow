// Persistence manager: save/load the network through world dynamic properties.
// Dynamic-property strings are length-limited, so the JSON payload is stored
// in fixed-size chunks. World-specific; takes `world` as a parameter.

import { createEmptyStore, normalizeStation } from "./station_manager.js";

const COUNT_KEY = "mtn:store:chunks";
const CHUNK_KEY = "mtn:store:chunk:";
const CHUNK_SIZE = 8000;
const MAX_CHUNKS = 30; // ~240 KB cap; beyond this the save is refused, never truncated silently.

export function loadStore(world) {
  const store = createEmptyStore();
  try {
    const count = world.getDynamicProperty(COUNT_KEY);
    if (typeof count !== "number" || count <= 0) return store;
    let json = "";
    for (let i = 0; i < Math.min(count, MAX_CHUNKS); i++) {
      const part = world.getDynamicProperty(CHUNK_KEY + i);
      if (typeof part !== "string") break;
      json += part;
    }
    if (!json) return store;
    const raw = JSON.parse(json);
    if (!raw || !Array.isArray(raw.stations)) return store;
    store.seq = typeof raw.seq === "number" ? raw.seq : 0;
    const seenIds = new Set();
    const seenNames = new Set();
    for (const r of raw.stations) {
      const st = normalizeStation(r);
      if (!st) continue;
      if (seenIds.has(st.id)) continue;
      const lname = st.name.trim().toLowerCase();
      if (seenNames.has(lname)) continue; // keep first; drop stale duplicates
      seenIds.add(st.id);
      seenNames.add(lname);
      store.stations.push(st);
    }
    if (store.stations.length > 0) {
      const maxSeq = Math.max(0, ...store.stations.map((s) => {
        const m = /^mtn-(\d+)$/.exec(s.id);
        return m ? Number(m[1]) : 0;
      }));
      store.seq = Math.max(store.seq, maxSeq);
    }
  } catch (e) {
    console.warn("[MTN] Saved network data unreadable; starting empty. " + e);
  }
  return store;
}

/** Returns { ok } — refuses (ok:false) rather than silently truncating. */
export function saveStore(world, store) {
  try {
    const json = JSON.stringify({ version: 1, seq: store.seq, stations: store.stations });
    const chunks = [];
    for (let i = 0; i < json.length; i += CHUNK_SIZE) chunks.push(json.slice(i, i + CHUNK_SIZE));
    if (chunks.length > MAX_CHUNKS) {
      console.warn("[MTN] Network data exceeds save cap; NOT saved to avoid corruption.");
      return { ok: false, error: "too_large" };
    }
    const prev = world.getDynamicProperty(COUNT_KEY);
    const prevCount = typeof prev === "number" ? prev : 0;
    world.setDynamicProperty(COUNT_KEY, chunks.length);
    chunks.forEach((c, i) => world.setDynamicProperty(CHUNK_KEY + i, c));
    for (let i = chunks.length; i < prevCount; i++) {
      try { world.setDynamicProperty(CHUNK_KEY + i, undefined); } catch { /* ignore */ }
    }
    return { ok: true };
  } catch (e) {
    console.warn("[MTN] Failed to save network data. " + e);
    return { ok: false, error: "save_failed" };
  }
}
