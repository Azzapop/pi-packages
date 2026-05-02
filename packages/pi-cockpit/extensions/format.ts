import type { ThemeColor } from "@mariozechner/pi-coding-agent";

export function sanitizeOneLine(text: string): string {
  return text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
}

export function formatTokens(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return "0";
  if (count < 1000) return Math.round(count).toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
  return `${Math.round(count / 1000000)}M`;
}

export function formatCost(cost: number): string {
  if (!Number.isFinite(cost) || cost <= 0) return "$0.00";
  if (cost < 10) return `$${cost.toFixed(2)}`;
  return `$${Math.round(cost)}`;
}

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function colorForPercent(value: number): ThemeColor {
  if (value >= 90) return "error";
  if (value >= 70) return "warning";
  return "success";
}

export function percentBar(percent: number, width = 5): string {
  const value = clampPercent(percent);
  const filled = Math.round((value / 100) * width);
  return "▰".repeat(filled) + "▱".repeat(Math.max(0, width - filled));
}

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export function thinkingColor(level: ThinkingLevel | string | undefined): ThemeColor {
  switch (level) {
    case "off":
      return "thinkingOff";
    case "minimal":
      return "thinkingMinimal";
    case "low":
      return "thinkingLow";
    case "medium":
      return "thinkingMedium";
    case "high":
      return "thinkingHigh";
    case "xhigh":
      return "thinkingXhigh";
    default:
      return "muted";
  }
}

export function providerLabel(provider: string | undefined): string {
  switch (provider) {
    case "anthropic":
      return "Claude";
    case "openai-codex":
      return "Codex";
    case "zai":
      return "Z.AI";
    case "google-gemini-cli":
      return "Gemini";
    case "google-antigravity":
      return "Antigravity";
    default:
      return provider || "usage";
  }
}

function titleCaseWords(value: string): string {
  return value
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((word) => {
      if (/^\d/.test(word)) return word;
      if (["gpt", "api", "zai", "ai"].includes(word.toLowerCase())) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

export function formatModelName(model: { provider?: string; id?: string; name?: string } | undefined): string {
  if (!model) return "unknown";

  const provider = model.provider;
  const raw = model.name || model.id || "unknown";
  const id = raw.toLowerCase();

  if (provider === "anthropic" || id.includes("claude")) {
    const family = id.includes("opus")
      ? "Opus"
      : id.includes("haiku")
        ? "Haiku"
        : id.includes("sonnet")
          ? "Sonnet"
          : "Claude";

    const version = id.match(/(?:^|[-\s])(\d+(?:[.-]\d+)?)(?:[-\s]|$)/)?.[1]?.replace("-", ".");
    return family === "Claude"
      ? version
        ? `Claude ${version}`
        : "Claude"
      : version
        ? `Claude ${family} ${version}`
        : `Claude ${family}`;
  }

  if (provider === "openai" || provider === "openai-codex" || id.startsWith("gpt")) {
    return raw
      .replace(/-20\d{2}-\d{2}-\d{2}.*/, "")
      .replace(/-/g, " ")
      .replace(/\bgpt\b/i, "GPT")
      .replace(/\bo(\d)/i, "o$1")
      .replace(/\s+/g, " ")
      .trim();
  }

  if (provider?.includes("google") || id.includes("gemini")) {
    return titleCaseWords(raw.replace(/-\d{3,}.*$/, ""));
  }

  return titleCaseWords(
    raw
      .replace(/^claude-/, "")
      .replace(/^gpt-/, "GPT ")
      .replace(/-20\d{6}$/, "")
      .replace(/-\d{4}-\d{2}-\d{2}$/, ""),
  );
}

export function summarizePrompt(prompt: string): string {
  const cleaned = sanitizeOneLine(prompt)
    .toLowerCase()
    .replace(/^please\s+/i, "")
    .replace(/^(can you|could you|would you|will you|lets|let's)\s+/i, "")
    .replace(/[`'"""'']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  if (!cleaned) return "";

  const stopwords = new Set([
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "by",
    "can",
    "do",
    "for",
    "from",
    "have",
    "help",
    "how",
    "i",
    "in",
    "into",
    "is",
    "it",
    "make",
    "me",
    "my",
    "of",
    "on",
    "or",
    "our",
    "the",
    "this",
    "to",
    "using",
    "want",
    "we",
    "with",
  ]);

  const meaningful = cleaned
    .split(/\s+/)
    .filter((word) => word.length > 1 && !stopwords.has(word));
  const fallback = cleaned.split(/\s+/).filter(Boolean);
  const words = (meaningful.length >= 3 ? meaningful : fallback).slice(0, 10);

  return words.join("-");
}
