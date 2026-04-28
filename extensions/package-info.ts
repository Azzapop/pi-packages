import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("pi-packages-info", {
    description: "Show information about the local pi package repo",
    handler: async (_args, ctx) => {
      ctx.ui.notify(
        "pi-packages is loaded: extensions, skills, prompts, and themes are available.",
        "info",
      );
    },
  });
}
