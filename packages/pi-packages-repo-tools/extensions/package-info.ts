import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

// This is a test
export default function (pi: ExtensionAPI) {
  pi.registerCommand("pi-packages-info", {
    description: "Show information about the local pi package repo",
    handler: async (_args, ctx) => {
      ctx.ui.notify(
        "pi-packages repo tools are loaded: repository maintenance commands and skills are available.",
        "info",
      );
    },
  });
}
