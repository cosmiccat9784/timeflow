// Shared constants for the Minecraft Transit Network add-on.
// This module is dependency-free so it can be unit-tested with plain Node.

export const RAIL_ID = "mtn:station_rail";

export const FARE_ITEM = "minecraft:emerald";
export const FARE_COST = 1;

// Block-state values for platform texture positions.
// 0 = Single, 1 = Left, 2 = Centre, 3 = Right.
export const POS_SINGLE = 0;
export const POS_LEFT = 1;
export const POS_CENTER = 2;
export const POS_RIGHT = 3;
export const PLATFORM_STATE = "mtn:platform_pos";

// Supporting blocks that can never identify a line (no solid identity to read).
export const NON_LINE_BLOCKS = new Set([
  "minecraft:air",
  "minecraft:cave_air",
  "minecraft:void_air",
  "minecraft:water",
  "minecraft:flowing_water",
  "minecraft:lava",
  "minecraft:flowing_lava",
]);

// Horizontal (face-adjacent) neighbour offsets. Diagonal, above and below
// must NEVER merge station footprints.
export const HORIZONTAL_OFFSETS = [
  { x: 1, y: 0, z: 0 },
  { x: -1, y: 0, z: 0 },
  { x: 0, y: 0, z: 1 },
  { x: 0, y: 0, z: -1 },
];

export function posKey(p) {
  return `${p.x},${p.y},${p.z}`;
}

export function parsePosKey(key) {
  const [x, y, z] = key.split(",").map(Number);
  return { x, y, z };
}

export function comparePos(a, b) {
  if (a.x !== b.x) return a.x - b.x;
  if (a.y !== b.y) return a.y - b.y;
  return a.z - b.z;
}
