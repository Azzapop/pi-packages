import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

function formatPercent(usage: { percent?: number }): string {
  const p = usage.percent == null ? undefined : Number(usage.percent);
  return p == null ? "--%" : `${Math.round(p)}%`;
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("compact", {
    description: "Compact context via LLM summarization. Optionally pass instructions to guide the summary.",
    handler: async (args, ctx) => {
      const usage = ctx.getContextUsage?.();
      const usageText = usage ? ` (context: ${formatPercent(usage)})` : "";
      ctx.ui.notify(`Starting compaction${usageText}…`, "info");

      ctx.compact({
        customInstructions: args.trim() || undefined,
        onComplete: () => {
          const newUsage = ctx.getContextUsage?.();
          const newText = newUsage ? ` Context now at ${formatPercent(newUsage)}.` : "";
          ctx.ui.notify(`Compaction complete.${newText}`, "info");
        },
        onError: (err: unknown) => {
          ctx.ui.notify(`Compaction failed: ${err}`, "error");
        },
      });
    },
  });

  pi.registerCommand("clear", {
    description: "Clear all context by appending a compaction that discards prior entries.",
    handler: async (_args, ctx) => {
      const entries = ctx.sessionManager.getEntries();
      if (!entries.length) {
        ctx.ui.notify("Nothing to clear — session is empty.", "info");
        return;
      }

      const usage = ctx.getContextUsage?.();
      const usageText = usage ? ` (context: ${formatPercent(usage)})` : "";
      const confirmed = await ctx.ui.confirm(`Clear all context?${usageText} This cannot be undone.`);
      if (!confirmed) {
        ctx.ui.notify("Clear cancelled.", "info");
        return;
      }

      const lastEntry = entries[entries.length - 1];
      const tokensBefore = usage?.tokensUsed ?? 0;

      ctx.sessionManager.appendCompaction({
        summary: "Context cleared by user.",
        firstKeptId: lastEntry.id,
        tokensBefore,
        fromHook: false,
      });

      ctx.ui.notify("Context cleared.", "info");
    },
  });
}
