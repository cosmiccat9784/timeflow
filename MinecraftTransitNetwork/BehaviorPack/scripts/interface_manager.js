// Interface manager: station forms (requires @minecraft/server-ui).
// This file is loaded via dynamic import() from main.js, so worlds where the
// UI module is unavailable keep running on the chat fallback (!line etc.).
// Every form call is additionally guarded: failures fall back to chat text.

import { ActionFormData, MessageFormData, ModalFormData } from "@minecraft/server-ui";
import { findStationById } from "./station_manager.js";
import { planRoute, describeRoute } from "./route_planner.js";
import { activeLines, orderStationsOnLine } from "./network_manager.js";
import { lineDisplayName } from "./line_manager.js";
import { stationLineNames } from "./station_manager.js";

const formCooldown = new Map(); // playerId -> timestamp ms

function cooledDown(player) {
  const now = Date.now();
  const last = formCooldown.get(player.id) ?? 0;
  if (now - last < 2000) return false; // duplicate-press protection
  formCooldown.set(player.id, now);
  return true;
}

function chatFallback(player, lines) {
  try { player.sendMessage(lines.join("\n")); } catch { /* ignore */ }
}

export function createInterface(deps) {
  const { getStore, transport } = deps;

  async function showForm(player, form, fallbackLines) {
    try {
      const res = await form.show(player);
      return res;
    } catch {
      chatFallback(player, fallbackLines);
      return null;
    }
  }

  function stationSummary(store, station) {
    const lines = stationLineNames(station);
    return [
      `§l${station.name}§r`,
      `Status: ${station.disconnected ? "§cDisconnected" : "§aRegistered"}`,
      `Lines: ${lines.length > 0 ? lines.join(", ") : "none detected"}`,
      `Platform blocks: ${station.blocks.length}`,
    ].join("\n");
  }

  async function openStation(player, stationId) {
    const store = getStore();
    const station = findStationById(store, stationId);
    if (!station) {
      chatFallback(player, ["This station is not registered."]);
      return;
    }
    if (!cooledDown(player)) return;
    const form = new ActionFormData()
      .title(station.name)
      .body(stationSummary(store, station))
      .button("Begin a journey")
      .button("Rename station")
      .button("Network information");
    const res = await showForm(player, form, [stationSummary(store, station), "Use !go <destination> to travel."]);
    if (!res || res.canceled) return;
    if (res.selection === 0) await openDestinations(player, station.id);
    else if (res.selection === 1) await openRename(player, station.id);
    else if (res.selection === 2) await openNetwork(player);
  }

  async function openUnregistered(player, infoLines) {
    if (!cooledDown(player)) return;
    const form = new ActionFormData()
      .title("Unregistered station")
      .body(infoLines.join("\n"))
      .button("Register this station")
      .button("Network information");
    const res = await showForm(player, form, [...infoLines, "Use !register <name> to register."]);
    if (!res || res.canceled) return;
    if (res.selection === 0) {
      const form2 = new ModalFormData().title("Register station").textField("Station name (unique):", "Central");
      const r2 = await showForm(player, form2, ["Use: !register <name>"]);
      if (!r2 || r2.canceled) return;
      deps.registerAt(player, String(r2.formValues?.[0] ?? ""));
    } else if (res.selection === 1) await openNetwork(player);
  }

  async function openRename(player, stationId) {
    const store = getStore();
    const station = findStationById(store, stationId);
    if (!station) return;
    const form = new ModalFormData().title(`Rename ${station.name}`).textField("New unique name:", station.name);
    const res = await showForm(player, form, [`Use: !rename ${station.name} <new name>`]);
    if (!res || res.canceled) return;
    deps.renameStationBy(player, stationId, String(res.formValues?.[0] ?? ""));
  }

  async function openDestinations(player, fromId) {
    const store = getStore();
    const from = findStationById(store, fromId);
    if (!from) return;
    const others = store.stations
      .filter((s) => s.id !== fromId && !s.disconnected)
      .slice()
      .sort((a, b) => (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1));
    if (others.length === 0) {
      chatFallback(player, ["No destination is available."]);
      return;
    }
    const form = new ActionFormData().title(`Travel from ${from.name}`).body("Choose your final destination. Transfers are automatic. Fare: 1 emerald.");
    const reachability = others.map((s) => planRoute(store.stations, fromId, s.id).ok);
    others.forEach((s, i) => {
      const tag = reachability[i] ? "" : " [no route]";
      form.button(`${s.name}${tag}`);
    });
    const res = await showForm(player, form, [
      "Destinations:",
      ...others.map((s, i) => `- ${s.name}${reachability[i] ? "" : " (no route)"}`),
      "Use: !go <destination>",
    ]);
    if (!res || res.canceled) return;
    const dest = others[res.selection];
    if (!dest) return;
    if (!reachability[res.selection]) {
      chatFallback(player, [`No valid route to ${dest.name}.`]);
      return;
    }
    const route = planRoute(store.stations, fromId, dest.id);
    if (route.ok) {
      chatFallback(player, [describeRoute(store.stations, route, lineDisplayName)]);
    }
    transport.startJourney(store, player, fromId, dest.id);
    deps.save();
  }

  async function openNetwork(player) {
    const store = getStore();
    const lines = activeLines(store.stations);
    let body;
    if (lines.length === 0) {
      body = "No active lines yet. Build Station Rail over solid blocks to create lines.";
    } else {
      body = lines
        .map((l) => {
          const sts = orderStationsOnLine(store.stations, l);
          const names = sts.map((s) => `${s.name}${s.lines.length > 1 ? " §e(interchange)§r" : ""}`);
          return `§l${lineDisplayName(l)}§r (${sts.length} station${sts.length === 1 ? "" : "s"})\n${names.map((n, i) => `${i + 1}. ${n}`).join("\n")}`;
        })
        .join("\n\n");
    }
    const form = new MessageFormData().title("Transit network").body(body).button1("Close").button2("Close");
    await showForm(player, form, [body]);
  }

  return { openStation, openUnregistered, openDestinations, openNetwork };
}
