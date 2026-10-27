// Fare manager: exactly one emerald per successfully initiated journey.
// Transfers never charge again. Only the travelling player's inventory is touched.

import { ItemStack } from "@minecraft/server";
import { FARE_ITEM, FARE_COST } from "./config.js";

export function countEmeralds(player) {
  try {
    const inv = player.getComponent("inventory");
    const container = inv?.container;
    if (!container) return 0;
    let total = 0;
    for (let i = 0; i < container.size; i++) {
      const item = container.getItem(i);
      if (item && item.typeId === FARE_ITEM) total += item.amount;
    }
    return total;
  } catch {
    return 0;
  }
}

export function hasFare(player) {
  return countEmeralds(player) >= FARE_COST;
}

/**
 * Deduct exactly FARE_COST emeralds from THIS player.
 * Returns { ok:true, txId } or { ok:false, error:"insufficient"|"no_inventory" }.
 * Nothing is deducted unless the full fare can be taken.
 */
export function deductFare(player, txId) {
  try {
    const inv = player.getComponent("inventory");
    const container = inv?.container;
    if (!container) return { ok: false, error: "no_inventory" };
    if (countEmeralds(player) < FARE_COST) return { ok: false, error: "insufficient" };
    let remaining = FARE_COST;
    for (let i = 0; i < container.size && remaining > 0; i++) {
      const item = container.getItem(i);
      if (!item || item.typeId !== FARE_ITEM) continue;
      const take = Math.min(item.amount, remaining);
      remaining -= take;
      if (item.amount - take <= 0) container.setItem(i, undefined);
      else {
        item.amount -= take;
        container.setItem(i, item);
      }
    }
    return remaining === 0 ? { ok: true, txId } : { ok: false, error: "deduct_failed" };
  } catch (e) {
    console.warn("[MTN] Fare deduction failed. " + e);
    return { ok: false, error: "deduct_failed" };
  }
}

/** Best-effort refund of one fare (failed dispatch recovery). */
export function refundFare(player) {
  try {
    const inv = player.getComponent("inventory");
    const container = inv?.container;
    if (!container) return { ok: false, error: "no_inventory" };
    container.addItem(new ItemStack(FARE_ITEM, FARE_COST));
    return { ok: true };
  } catch (e) {
    console.warn("[MTN] Fare refund failed. " + e);
    return { ok: false, error: "refund_failed" };
  }
}
