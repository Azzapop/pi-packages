export type IconStyle = "nerd" | "unicode" | "none";

export type Icons = {
  context: string;
  /**
   * Subscription-usage icon. Rendered by the cockpit footer only when a
   * provider emits session/weekly quota data via the `usage:update` event
   * (e.g. pi-usage-bars). Pay-per-token providers like amazon-bedrock,
   * openai, and google-vertex never populate this segment.
   */
  usage: string;
  reset: string;
  model: string;
  branch: string;
  worktreeBranch: string;
  tokens: string;
  /**
   * Cache-read indicator. Rendered by the cockpit footer in the totals
   * segment when the session has non-zero cache-read tokens (prompt
   * caching hits). Hidden otherwise.
   */
  cache: string;
  loading: string;
  diverged: string;
  ahead: string;
  behind: string;
  staged: string;
  unstaged: string;
  untracked: string;
  stashed: string;
  separator: string;
};

export function normalizeIconStyle(value: unknown): IconStyle {
  if (value === "unicode" || value === "none" || value === "nerd") return value;
  return "nerd";
}

export function getIcons(style: IconStyle): Icons {
  if (style === "none") {
    return {
      context: "ctx",
      usage: "usg",
      reset: "reset",
      model: "model",
      branch: "",
      worktreeBranch: "wt",
      tokens: "",
      cache: "cache",
      loading: "...",
      diverged: "D",
      ahead: "+",
      behind: "-",
      staged: "S",
      unstaged: "M",
      untracked: "?",
      stashed: "$",
      separator: "|",
    };
  }

  if (style === "unicode") {
    return {
      context: "◔",
      usage: "◷",
      reset: "↻",
      model: "◇",
      branch: "",
      worktreeBranch: "◇",
      tokens: "",
      cache: "⚡",
      loading: "◌",
      diverged: "Ð",
      ahead: "▲",
      behind: "▼",
      staged: "●",
      unstaged: "●",
      untracked: "●",
      stashed: "š",
      separator: "|",
    };
  }

  return {
    context: "󰍛",
    usage: "󰔟",
    reset: "󰑓",
    model: "󰚩",
    branch: "",
    worktreeBranch: "󰜌",
    tokens: "",
    cache: "",
    loading: "⠋",
    diverged: "Ð",
    ahead: "▲",
    behind: "▼",
    staged: "●",
    unstaged: "●",
    untracked: "●",
    stashed: "š",
    separator: "|",
  };
}
