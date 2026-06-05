import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { piAuthor } from "./personas/pi-author.ts";

const PERSONAS = [piAuthor];

export default function (pi: ExtensionAPI) {
  function registerAll() {
    // pi-cockpit's persona registry overwrites by id, so re-registration
    // is idempotent. We register on both events so this works regardless
    // of extension load order and survives /reload of either side.
    for (const persona of PERSONAS) {
      pi.events.emit("cockpit:persona:register", persona);
    }
  }

  pi.on("session_start", () => registerAll());
  pi.events.on("cockpit:ready", () => registerAll());
}
