import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import type { PackageStatus } from "./types.ts";

export function statusIcon(status: PackageStatus): string {
  switch (status) {
    case "loaded":
      return "*";
    case "not_loaded":
      return "~";
  }
}

export function statusColor(status: PackageStatus): "success" | "warning" {
  switch (status) {
    case "loaded":
      return "success";
    case "not_loaded":
      return "warning";
  }
}

export function fillLine(line: string, width: number): string {
  const truncated = truncateToWidth(line, width);
  const padding = Math.max(0, width - visibleWidth(truncated));
  return truncated + " ".repeat(padding);
}
