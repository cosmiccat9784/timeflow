// Line manager: maps the exact supporting-block identifier to a line identity.
// Dependency-free (no @minecraft/server import) so it runs in Node tests.
//
// Rule: the FULL namespaced block id is the canonical line key, e.g.
//   "minecraft:diamond_block" -> key "minecraft:diamond_block", name "Diamond Line"
// Colour alone is never sufficient: "minecraft:red_wool" and
// "minecraft:red_concrete" stay separate lines.

import { NON_LINE_BLOCKS } from "./config.js";

function titleCaseWords(s) {
  return s
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Canonical line key for a supporting block id, or null when unassignable. */
export function lineKeyFromSupportBlock(typeId) {
  if (typeof typeId !== "string" || typeId.length === 0) return null;
  const id = typeId.toLowerCase();
  if (NON_LINE_BLOCKS.has(id)) return null;
  if (!id.includes(":")) return null; // require a namespaced id
  return id;
}

/** Human-readable line name with the block-naming rule from the brief:
 *   "minecraft:diamond_block" -> "Diamond Line"
 *   "minecraft:gold_block"     -> "Gold Line"
 *   "minecraft:red_wool"       -> "Red Wool Line"
 * A trailing "Block" word is dropped (Diamond Block means Diamond Line), but
 * all other words are preserved, and the full namespaced key stays canonical
 * so similarly coloured blocks never collide. */
export function lineDisplayName(lineKey) {
  if (typeof lineKey !== "string") return "Unknown Line";
  const parts = lineKey.split(":");
  const path = parts.length > 1 ? parts.slice(1).join(":") : parts[0];
  const noBlock = path.replace(/_block$/, "");
  const words = titleCaseWords(noBlock.replace(/:/g, " "));
  return `${words} Line`;
}

/**
 * Resolve a free-text query (e.g. `/line diamond`, `!line Diamond Line`,
 * `!line minecraft:diamond_block`) to a canonical line key, given the set of
 * known line keys. Matching is case-insensitive and accepts the block path
 * ("diamond_block"), the display words ("diamond"), or the full key.
 * Returns the key, or null when nothing matches.
 */
export function resolveLineQuery(query, knownKeys) {
  if (!query || !Array.isArray(knownKeys)) return null;
  let q = String(query).trim().toLowerCase();
  if (q.length === 0) return null;
  q = q.replace(/\s+line$/, "").trim();
  for (const key of knownKeys) {
    if (key.toLowerCase() === q) return key;
  }
  const matches = knownKeys.filter((key) => {
    const lower = key.toLowerCase();
    const path = lower.includes(":") ? lower.split(":").slice(1).join(":") : lower;
    const words = path.replace(/_/g, " ");
    return path === q || words === q || path.startsWith(q) || words.startsWith(q);
  });
  if (matches.length === 1) return matches[0];
  // Prefer an exact word match when several prefix-match.
  const exact = matches.find((key) => {
    const lower = key.toLowerCase();
    const path = lower.includes(":") ? lower.split(":").slice(1).join(":") : lower;
    return path === q || path.replace(/_/g, " ") === q;
  });
  return exact ?? null;
}
