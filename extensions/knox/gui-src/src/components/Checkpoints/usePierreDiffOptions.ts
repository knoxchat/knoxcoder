import { useMemo } from "react";
import {
  DEFAULT_THEMES,
  type FileDiffOptions,
  type FileOptions,
} from "@pierre/diffs";
import { useCheckpointThemeType } from "./checkpointUi";

/** Shiki themes for checkpoint diff/file viewers */
const CHECKPOINT_THEMES = {
  ...DEFAULT_THEMES,
  dark: "one-dark-pro",
} as const;

export function usePierreDiffOptions(
  diffStyle: "split" | "unified" = "split",
  overflow: "scroll" | "wrap" = "scroll",
): FileDiffOptions<undefined, undefined> {
  const themeType = useCheckpointThemeType();

  return useMemo(
    () => ({
      theme: CHECKPOINT_THEMES,
      themeType,
      diffStyle,
      diffIndicators: "bars",
      hunkSeparators: "line-info",
      lineDiffType: "word-alt",
      overflow,
      preferredHighlighter: "shiki-js",
    }),
    [themeType, diffStyle, overflow],
  );
}

export function usePierreFileOptions(
  overflow: "scroll" | "wrap" = "scroll",
): FileOptions<undefined, undefined> {
  const themeType = useCheckpointThemeType();

  return useMemo(
    () => ({
      theme: CHECKPOINT_THEMES,
      themeType,
      overflow,
      preferredHighlighter: "shiki-js",
    }),
    [themeType, overflow],
  );
}
