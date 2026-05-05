import { existsSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

type ColorFn = (text: string) => string;
type SelectorComponent = { children?: any[] };
type InteractiveModeWithSelector = {
  editor?: { borderColor?: ColorFn };
  extensionSelector?: SelectorComponent;
  ui?: { requestRender?: () => void };
  showExtensionSelector: (title: string, options: string[], opts?: any) => Promise<string | undefined>;
};

const PATCHED = Symbol.for("pi-cockpit.select-border-color-patched");

function findPiCodingAgentDist(): string | undefined {
  const argvPath = process.argv[1];
  if (!argvPath) return undefined;

  let current: string;
  try {
    current = dirname(realpathSync(argvPath));
  } catch {
    current = dirname(argvPath);
  }

  while (true) {
    if (existsSync(join(current, "index.js")) && existsSync(join(current, "modes/interactive/interactive-mode.js"))) {
      return current;
    }

    const dist = join(current, "dist");
    if (existsSync(join(dist, "index.js")) && existsSync(join(dist, "modes/interactive/interactive-mode.js"))) {
      return dist;
    }

    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function applyBorderColor(selector: SelectorComponent | undefined, borderColor: ColorFn | undefined): void {
  if (!selector?.children?.length || !borderColor) return;

  const borders = selector.children.filter((child) => child && "color" in child);
  for (const border of borders) {
    border.color = borderColor;
    border.invalidate?.();
  }
}

async function patchSelectBorderColor(): Promise<void> {
  const piDist = findPiCodingAgentDist();
  if (!piDist) throw new Error("Could not locate Pi coding agent dist directory");

  // Import the exact file used by the running CLI. Importing the package name from
  // a jiti-loaded extension can create a second module instance, which patches the
  // wrong InteractiveMode prototype and leaves the real selector unchanged.
  const { InteractiveMode } = await import(pathToFileURL(join(piDist, "modes/interactive/interactive-mode.js")).href);
  const proto = InteractiveMode?.prototype as InteractiveModeWithSelector & { [PATCHED]?: boolean };
  if (!proto || proto[PATCHED]) return;

  const original = proto.showExtensionSelector;
  if (typeof original !== "function") return;

  proto.showExtensionSelector = function showExtensionSelectorWithCurrentBorder(
    this: InteractiveModeWithSelector,
    title: string,
    options: string[],
    opts?: any,
  ) {
    const borderColor = this.editor?.borderColor;
    const result = original.call(this, title, options, opts);

    applyBorderColor(this.extensionSelector, borderColor);
    this.ui?.requestRender?.();

    return result;
  };

  proto[PATCHED] = true;
}

export default async function (_pi: ExtensionAPI) {
  await patchSelectBorderColor();
}
