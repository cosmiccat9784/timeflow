// Minimal probe: top-level code is subscription-only (V2 early-execution safe).
import { world, system } from "@minecraft/server";

world.afterEvents.worldLoad.subscribe(() => {
  try {
    world.sendMessage("PROBE: scripts are running. Try /mtn:ping and !ping.");
  } catch (e) {
    console.warn("PROBE failed: " + e);
  }
});

world.beforeEvents.chatSend.subscribe((ev) => {
  try {
    if (typeof ev.message === "string" && ev.message.trim() === "!ping") {
      ev.cancel = true;
      ev.sender.sendMessage("PROBE: pong (!ping)");
    }
  } catch (e) {
    console.warn("PROBE chat failed: " + e);
  }
});

// Slash-command variant (no enum imports on purpose: nothing here may fail
// at load time). Registration failure is caught and logged, never fatal.
// API note: the documented registry is init.customCommandRegistry with a
// descriptor-object signature; older shapes are tried as fallback.
try {
  system.beforeEvents.startup.subscribe((init) => {
    const registry = (init && init.customCommandRegistry && typeof init.customCommandRegistry.registerCommand === "function")
      ? init.customCommandRegistry
      : (init && init.customCommands && typeof init.customCommands.registerCommand === "function")
        ? init.customCommands
        : null;
    const cb = (origin) => {
      system.run(() => {
        try {
          if (origin && origin.sourceEntity && typeof origin.sourceEntity.sendMessage === "function") {
            origin.sourceEntity.sendMessage("PROBE: pong (/mtn:ping)");
          }
        } catch (e) {
          console.warn("PROBE cmd exec failed: " + e);
        }
      });
      return { status: 1 };
    };
    try {
      if (!registry) throw new Error("no custom-command registry");
      try {
        registry.registerCommand({ name: "mtn:ping", description: "Probe: replies pong." }, cb);
      } catch (e1) {
        registry.registerCommand("mtn:ping", { description: "Probe: replies pong." }, [], cb);
      }
      console.warn("PROBE: /mtn:ping registered.");
    } catch (e) {
      console.warn("PROBE: /mtn:ping registration failed: " + e);
    }
  });
} catch (e) {
  console.warn("PROBE: startup hook failed: " + e);
}
