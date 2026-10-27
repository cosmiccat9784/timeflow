// Chat fallback commands. Always available, even when scripted forms or
// custom slash commands are unsupported:
//   !help | !stations | !line <name> | !register <name> | !rename <old> <new>
//   | !go <destination> | !here
// Messages using these prefixes are consumed (not broadcast).

import { world } from "@minecraft/server";
import { activeLines, orderStationsOnLine } from "./network_manager.js";
import { planRoute, describeRoute } from "./route_planner.js";
import { findStationByName, findStationById } from "./station_manager.js";
import { lineDisplayName, resolveLineQuery } from "./line_manager.js";
import { stationLineNames } from "./station_manager.js";

export function lineReport(store, query) {
  const lines = activeLines(store.stations);
  if (lines.length === 0) return ["No active lines yet."];
  const key = resolveLineQuery(query ?? "", lines);
  if (!key) {
    return [
      `Unknown line: "${query}".`,
      "Active lines: " + lines.map(lineDisplayName).join(", "),
    ];
  }
  const sts = orderStationsOnLine(store.stations, key);
  const out = [`${lineDisplayName(key)}`, `${sts.length} station${sts.length === 1 ? "" : "s"}`, ""];
  sts.forEach((s, i) => {
    out.push(`${i + 1}. ${s.name}${s.lines.length > 1 ? " (interchange)" : ""}`);
  });
  return out;
}

export function registerChatCommands(deps) {
  const { getStore, save, locateStationAt, registerAt, renameStationBy, transport } = deps;
  const uiLoaded = typeof deps.uiLoaded === "function" ? deps.uiLoaded : () => false;

  world.beforeEvents.chatSend.subscribe((ev) => {
    let text;
    try { text = ev.message; } catch { return; }
    if (typeof text !== "string") return;
    const trimmed = text.trim();
    if (!trimmed.startsWith("!")) return;
    const [cmd, ...rest] = trimmed.slice(1).split(/\s+/);
    const arg = rest.join(" ").trim();
    const player = ev.sender;
    const store = getStore();

    const reply = (lines) => {
      try { player.sendMessage((Array.isArray(lines) ? lines : [lines]).join("\n")); } catch { /* ignore */ }
    };

    try {
      switch ((cmd ?? "").toLowerCase()) {
        case "help":
          ev.cancel = true;
          reply([
            "Transit commands:",
            "!stations — list stations",
            "!line <name> — stations on a line (e.g. !line diamond)",
            "!register <name> — register the station you stand on",
            "!rename <old> <new> — rename a station",
            "!go <destination> — travel (1 emerald)",
            "!here — station info for where you stand",
            "!diag — add-on self-test (send me its output)",
          ]);
          break;
        case "diag": {
          ev.cancel = true;
          const list = store.stations.filter((s) => !s.disconnected);
          reply([
            "MTN self-test:",
            `scripts: running (chat ok)`,
            `forms UI: ${uiLoaded() ? "loaded" : "UNAVAILABLE (chat fallback active)"}`,
            `registered stations: ${list.length}`,
            "block check: place Station Rail — if it looks wrong, the RESOURCE pack is missing/inactive.",
          ]);
          break;
        }
        case "stations": {
          ev.cancel = true;
          const list = store.stations.filter((s) => !s.disconnected);
          reply(list.length === 0 ? ["No registered stations yet."] : ["Stations:", ...list.map((s) => `- ${s.name} (${stationLineNames(s).join(", ") || "no line"})`)]);
          break;
        }
        case "line":
          ev.cancel = true;
          reply(lineReport(store, arg));
          break;
        case "here": {
          ev.cancel = true;
          const found = locateStationAt(player);
          if (!found) reply(["You are not standing on a registered station. Stand on a Station Rail platform and use !register <name>."]);
          else reply([[`You are at ${found.name}.`, `Lines: ${stationLineNames(found).join(", ") || "none"}`].join("\n")]);
          break;
        }
        case "register":
          ev.cancel = true;
          if (!arg) reply(["Usage: !register <name>"]);
          else registerAt(player, arg);
          break;
        case "rename": {
          ev.cancel = true;
          const parts = arg.split(/\s+/).filter(Boolean);
          if (parts.length < 2) { reply(["Usage: !rename <old> <new>"]); break; }
          const oldName = parts[0];
          const newName = parts.slice(1).join(" ");
          const st = findStationByName(store, oldName);
          if (!st) { reply([`Unknown station: "${oldName}".`]); break; }
          renameStationBy(player, st.id, newName);
          break;
        }
        case "go": {
          ev.cancel = true;
          if (!arg) { reply(["Usage: !go <destination>"]); break; }
          const from = locateStationAt(player);
          if (!from) { reply(["Stand on a station platform to begin a journey."]); break; }
          const dest = findStationByName(store, arg);
          if (!dest || dest.disconnected) { reply([`No valid route to "${arg}".`]); break; }
          const route = planRoute(store.stations, from.id, dest.id);
          if (!route.ok) { reply(["No valid route to that destination."]); break; }
          reply([describeRoute(store.stations, route, lineDisplayName)]);
          transport.startJourney(store, player, from.id, dest.id);
          save();
          break;
        }
        default:
          break; // not ours; let chat through
      }
    } catch (e) {
      console.warn("[MTN] Chat command failed. " + e);
    }
  });
}
