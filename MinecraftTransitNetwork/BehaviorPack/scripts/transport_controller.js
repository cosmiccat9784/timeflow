// Transport controller: executes validated route plans.
//
// Travel mechanism (tested-safe for Education Edition): staged teleport legs.
// Each leg teleports the player to the next station's platform, with transfer
// narration in between. Native minecart routing cannot be controlled reliably
// through the Education Edition scripting API, so this add-on does NOT claim
// minecart driving — see Documentation/COMPATIBILITY.md.

import { world, system } from "@minecraft/server";
import { planRoute } from "./route_planner.js";
import { findStationById } from "./station_manager.js";
import { deductFare, hasFare, refundFare } from "./fare_manager.js";
import { lineDisplayName } from "./line_manager.js";

const LEG_DELAY_TICKS = 40;
let journeySeq = 0;
const activeJourneys = new Map(); // playerId -> journey

export function getActiveJourney(playerId) {
  return activeJourneys.get(playerId) ?? null;
}

function platformLocation(station) {
  return { x: station.anchor.x + 0.5, y: station.anchor.y + 1, z: station.anchor.z + 0.5 };
}

function teleportToStation(player, station) {
  const dimension = world.getDimension(station.dim);
  player.teleport(platformLocation(station), { dimension });
}

function abort(player, journey, message, refund) {
  if (activeJourneys.get(player.id) === journey) activeJourneys.delete(player.id);
  if (refund) refundFare(player);
  try { player.sendMessage(message); } catch { /* ignore */ }
}

/**
 * Start a journey. Order of operations (fare safety):
 * 1. validate stations + route, 2. check emerald, 3. deduct, 4. dispatch.
 * Never charges before a valid route is confirmed.
 */
export function startJourney(store, player, fromId, destId) {
  try {
    if (activeJourneys.has(player.id)) {
      player.sendMessage("You already have an active journey. Please wait for it to finish.");
      return { ok: false, error: "already_travelling" };
    }
    const from = findStationById(store, fromId);
    const dest = findStationById(store, destId);
    if (!from || from.disconnected) {
      player.sendMessage("This station is not connected to an operational route.");
      return { ok: false, error: "origin_invalid" };
    }
    if (!dest || dest.disconnected) {
      player.sendMessage("No valid route to that destination.");
      return { ok: false, error: "destination_invalid" };
    }
    const route = planRoute(store.stations, fromId, destId);
    if (!route.ok) {
      player.sendMessage("No valid route to that destination.");
      return { ok: false, error: route.error };
    }
    if (!hasFare(player)) {
      player.sendMessage("You need 1 emerald to travel.");
      return { ok: false, error: "insufficient" };
    }
    journeySeq += 1;
    const txId = `${player.id}:${Date.now()}:${journeySeq}`;
    const charge = deductFare(player, txId);
    if (!charge.ok) {
      player.sendMessage("You need 1 emerald to travel.");
      return { ok: false, error: charge.error };
    }

    const journey = { txId, playerId: player.id, fromId, destId, legs: route.legs, legIndex: 0, done: false };
    activeJourneys.set(player.id, journey);
    player.sendMessage(`§aFare paid: 1 emerald. §rDestination: ${dest.name}`);
    runLeg(store, player, journey);
    return { ok: true, txId };
  } catch (e) {
    console.warn("[MTN] startJourney failed. " + e);
    try { player.sendMessage("The journey could not begin. You were not charged."); } catch { /* ignore */ }
    return { ok: false, error: "internal" };
  }
}

function runLeg(store, player, journey) {
  if (activeJourneys.get(player.id) !== journey || journey.done) return;
  // Revalidate before every leg: the network may have changed mid-journey.
  const current = findStationById(store, journey.legs[journey.legIndex].from);
  const next = findStationById(store, journey.legs[journey.legIndex].to);
  const fresh = planRoute(store.stations, journey.fromId, journey.destId);
  if (!current || current.disconnected || !next || next.disconnected || !fresh.ok) {
    abort(player, journey, "The route has changed. Please select your destination again.", journey.legIndex === 0);
    return;
  }
  journey.legs = fresh.legs; // adopt recalculated route
  const leg = journey.legs[journey.legIndex];
  const nextStation = findStationById(store, leg.to);
  const isLast = journey.legIndex === journey.legs.length - 1;

  system.runTimeout(() => {
    try {
      if (activeJourneys.get(player.id) !== journey || journey.done) return;
      const target = findStationById(store, leg.to);
      if (!target || target.disconnected) {
        abort(player, journey, "The route has changed. Please select your destination again.", journey.legIndex === 0);
        return;
      }
      teleportToStation(player, target);
      if (!isLast) {
        const following = journey.legs[journey.legIndex + 1];
        if (following.line !== leg.line) {
          player.sendMessage(`Transfer at ${target.name}. Continue on the ${lineDisplayName(following.line)}.`);
        } else {
          player.sendMessage(`Passing through ${target.name} on the ${lineDisplayName(leg.line)}.`);
        }
        journey.legIndex += 1;
        runLeg(store, player, journey);
      } else {
        journey.done = true;
        activeJourneys.delete(player.id);
        player.sendMessage(`§aYour destination has been reached: ${nextStation.name}.`);
      }
    } catch (e) {
      console.warn("[MTN] Journey leg failed. " + e);
      // Dispatch failed after payment: attempt refund, never double-charge.
      abort(player, journey, "The transport could not complete this leg. Your fare was refunded.", true);
    }
  }, journey.legIndex === 0 ? 10 : LEG_DELAY_TICKS);
}

export function cancelJourneysFor(playerId) {
  activeJourneys.delete(playerId);
}
