import { useContext, useMemo } from "react";
import { VscThemeContext } from "../../context/VscTheme";
import "./checkpointTheme.css";

/** Shared Lucide sizing so checkpoint chrome stays visually even. */
export const CP_ICON = "size-4 shrink-0";
export const CP_ICON_META = "size-3 shrink-0";
export const CP_ICON_EMPTY = "size-8 shrink-0 text-muted-foreground";

/** Compact, horizontally scrollable shadcn TabsList for the sidebar overlay. */
export const compactTabsListClass =
  "flex h-8 w-full items-center justify-start gap-0.5 overflow-x-auto rounded-md bg-muted p-0.5";

export const compactTabsTriggerClass =
  "h-7 shrink-0 gap-1.5 px-2 text-xs";

/** Compact sidebar height for shadcn ChartContainer (overrides default aspect-video). */
export const CP_CHART_CLASS = "aspect-auto h-[168px] w-full";

/** One Dark Pro branch rail colors (dark). Light variant is remapped in the GUI. */
export const ODP_BRANCH_DARK = [
  "#61afef",
  "#98c379",
  "#e5c07b",
  "#e06c75",
  "#c678dd",
  "#56b6c2",
  "#d19a66",
  "#abb2bf",
] as const;

export const ODP_BRANCH_LIGHT = [
  "#4078f2",
  "#50a14f",
  "#c18401",
  "#e45649",
  "#a626a4",
  "#0184bc",
  "#986801",
  "#383a42",
] as const;

const LEGACY_BRANCH_COLORS = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
  "#f97316",
];

export type CheckpointThemeType = "dark" | "light";

export function detectEditorThemeType(): CheckpointThemeType {
  if (typeof document === "undefined") {
    return "dark";
  }

  const kind = document.documentElement.getAttribute("data-vscode-theme-kind") ?? "";
  if (kind.includes("light")) {
    return "light";
  }
  if (document.body.classList.contains("vscode-light")) {
    return "light";
  }

  const bg = getComputedStyle(document.body)
    .getPropertyValue("--vscode-editor-background")
    .trim();

  if (bg.startsWith("#") && bg.length >= 7) {
    const hex = bg.slice(1);
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) {
      return (r + g + b) / 3 >= 128 ? "light" : "dark";
    }
  }

  return "dark";
}

export function useCheckpointThemeType(): CheckpointThemeType {
  const { theme } = useContext(VscThemeContext);
  return useMemo(() => detectEditorThemeType(), [theme]);
}

export function remapBranchColor(color: string | undefined, theme: CheckpointThemeType): string {
  const palette = theme === "light" ? ODP_BRANCH_LIGHT : ODP_BRANCH_DARK;
  if (!color) {
    return palette[0];
  }
  const odpIndex = (ODP_BRANCH_DARK as readonly string[]).indexOf(color);
  if (odpIndex >= 0) {
    return palette[odpIndex];
  }
  const legacyIndex = LEGACY_BRANCH_COLORS.indexOf(color);
  if (legacyIndex >= 0) {
    return palette[legacyIndex];
  }
  return color;
}

export const ODP_TYPE_CLASS = {
  manual: "odp-type-manual",
  auto: "odp-type-auto",
  ai: "odp-type-ai",
  merge: "odp-type-merge",
  "branch-point": "odp-type-branch",
} as const;
