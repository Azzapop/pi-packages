import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { architect } from "./personas/architect.ts";
import { qa } from "./personas/qa.ts";
import { reviewer } from "./personas/reviewer.ts";
import { debuggerPersona } from "./personas/debugger.ts";

const PERSONAS = [architect, qa, reviewer, debuggerPersona];

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
