export type IconStyle = "nerd" | "unicode" | "none";

export type Icons = {
  context: string;
  usage: string;
  reset: string;
  model: string;
  branch: string;
  worktreeBranch: string;
  tokens: string;
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
      branch: "git",
      worktreeBranch: "wt",
      tokens: "",
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
      branch: "⎇",
      worktreeBranch: "◇",
      tokens: "",
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
