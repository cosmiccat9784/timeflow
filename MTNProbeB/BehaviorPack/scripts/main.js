// ProbeB: answers ONE question — does this client run @minecraft/server 1.x?
// Every API touch is guarded; startup works whether the game offers
// worldLoad, worldInitialize, or neither (timeout backstop).
import { world, system } from "@minecraft/server";

function announce() {
  try {
    world.sendMessage("PROBE-B: scripts running (server 1.x). Try !pingb.");
  } catch (e) {}
}

let ready = false;
function boot() {
  if (ready) return;
  ready = true;
  announce();
}

try {
  if (world.afterEvents && world.afterEvents.worldLoad) {
    world.afterEvents.worldLoad.subscribe(boot);
  } else {
    throw new Error("no worldLoad");
  }
} catch (e) {
  try {
    if (world.beforeEvents && world.beforeEvents.worldInitialize) {
      world.beforeEvents.worldInitialize.subscribe(boot);
    } else {
      throw new Error("no worldInitialize");
    }
  } catch (e2) {
    try {
      system.run(boot);
    } catch (e3) {}
  }
}

try {
  system.runTimeout(boot, 200);
} catch (e) {}

try {
  world.beforeEvents.chatSend.subscribe((ev) => {
    try {
      if (typeof ev.message === "string" && ev.message.trim() === "!pingb") {
        ev.cancel = true;
        ev.sender.sendMessage("PROBE-B: pong");
      }
    } catch (e) {}
  });
} catch (e) {}
