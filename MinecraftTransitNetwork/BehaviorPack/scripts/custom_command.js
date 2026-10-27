// Best-effort `/line` custom slash command.
// Loaded via dynamic import() from main.js: if Education Edition 1.26.32 does
// not support this exact custom-command API, the import or registration throws
// and the add-on continues with the !line chat fallback. Nothing else imports
// this file, so a failure here is fully isolated.
//
// API note (Microsoft Learn, custom-commands): the documented registry is
// `init.customCommandRegistry` with signature
//   registerCommand({ name, description, permissionLevel, optionalParameters }, callback)
// Older generations used `init.customCommands` with
//   registerCommand(name, descriptor, overloads, callback).
// This file tries the documented shape first, then the legacy shape, so it
// works regardless of which generation the game exposes.

import {
  system,
  CommandPermissionLevel,
  CustomCommandParamType,
  CustomCommandStatus,
} from "@minecraft/server";
import { lineReport } from "./chat_commands.js";

function pickRegistry(init) {
  if (init && init.customCommandRegistry && typeof init.customCommandRegistry.registerCommand === "function") {
    return init.customCommandRegistry;
  }
  if (init && init.customCommands && typeof init.customCommands.registerCommand === "function") {
    return init.customCommands;
  }
  return null;
}

function deferredReply(origin, text) {
  // Command callbacks run in a "before" context where state-changing calls
  // are restricted, so fan the reply out to a later tick.
  try {
    system.run(() => {
      try {
        if (origin && origin.sourceEntity && typeof origin.sourceEntity.sendMessage === "function") {
          origin.sourceEntity.sendMessage(text);
        }
      } catch (e) {
        console.warn("[MTN] /line reply failed. " + e);
      }
    });
  } catch (e) {
    console.warn("[MTN] /line defer failed. " + e);
  }
}

export function tryRegisterLineCommand(getStore) {
  const startup = system?.beforeEvents?.startup;
  if (!startup) throw new Error("startup event unavailable");
  startup.subscribe((init) => {
    const registry = pickRegistry(init);
    if (!registry) throw new Error("no custom-command registry");
    const callback = (origin, line) => {
      try {
        const text = lineReport(getStore(), typeof line === "string" ? line : "").join("\n");
        deferredReply(origin, text);
      } catch (e) {
        console.warn("[MTN] /line execution failed. " + e);
      }
      return { status: CustomCommandStatus.Success };
    };
    const errors = [];
    try {
      registry.registerCommand(
        {
          name: "mtn:line",
          description: "List the stations on a railway line.",
          permissionLevel: CommandPermissionLevel.Any,
          optionalParameters: [{ type: CustomCommandParamType.String, name: "line" }],
        },
        callback
      );
      console.warn("[MTN] /mtn:line registered (descriptor shape).");
      return;
    } catch (e) {
      errors.push("descriptor-shape: " + e);
    }
    try {
      registry.registerCommand(
        "mtn:line",
        { description: "List the stations on a railway line.", permissionLevel: CommandPermissionLevel.Any },
        [{ parameters: [{ name: "line", type: CustomCommandParamType.String, optional: true }] }],
        callback
      );
      console.warn("[MTN] /mtn:line registered (legacy shape).");
      return;
    } catch (e) {
      errors.push("legacy-shape: " + e);
    }
    throw new Error(errors.join(" | "));
  });
}
