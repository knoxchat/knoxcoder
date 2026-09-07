/**
 * Classify compile / boot oracles from tool output (HL-18).
 * Soul records these so restore + memory see "gcc error signature",
 * not only "ran terminal."
 */

import {
  diagnosticSignature,
  parseBuildOutput,
} from "../../tools/build/parseDiagnostics.js";
import { formatOops, parseOops } from "../../tools/build/parseOops.js";
import { BuiltInToolNames } from "../../tools/builtIn.js";
import type { SoulEventKind } from "./types.js";

export type OracleKind = Extract<
  SoulEventKind,
  "build:fail" | "build:pass" | "qemu:panic" | "bisect:step"
>;

export interface OracleEvent {
  kind: OracleKind;
  signature: string;
  summary: string;
}

const BUILD_TOOLS = new Set<string>([
  BuiltInToolNames.Build,
  BuiltInToolNames.RunTerminalCommand,
  BuiltInToolNames.AwaitShell,
  BuiltInToolNames.PtyRead,
  BuiltInToolNames.Qemu,
]);

export function looksLikeQemuPanic(text: string): boolean {
  return Boolean(parseOops(text));
}

function errorLines(text: string, cap = 8): string[] {
  const parsed = parseBuildOutput(text);
  return parsed.errors.slice(0, cap).map((item) => {
    const loc = item.file
      ? item.line
        ? `${item.file}:${item.line}`
        : item.file
      : item.kind;
    return `${loc}: ${item.message}`;
  });
}

/**
 * Detect a build/QEMU oracle outcome from a tool result body.
 * Returns undefined for unrelated tools (echo, grep, file edits).
 */
export function classifyOracleEvent(
  toolName: string,
  output: string,
): OracleEvent | undefined {
  const text = output ?? "";
  if (toolName === BuiltInToolNames.GitBisect) {
    const firstBad = text.match(/([0-9a-f]{7,40})\s+is the first bad commit/i);
    const remaining = text.match(/(\d+)\s+revisions?\s+left/i);
    return {
      kind: "bisect:step",
      signature: firstBad?.[1] ?? remaining?.[1] ?? "bisect",
      summary: ["bisect:step", text].join("\n").slice(0, 800),
    };
  }

  const oops = parseOops(text);
  if (oops) {
    return {
      kind: "qemu:panic",
      signature: oops.rip ?? oops.title,
      summary: ["qemu:panic", formatOops(oops)].join("\n").slice(0, 800),
    };
  }

  const isBuildTool = BUILD_TOOLS.has(toolName);
  const parsed = parseBuildOutput(text);
  if (toolName === BuiltInToolNames.Build) {
    if (parsed.errors.length > 0) {
      const signature = diagnosticSignature(text);
      return {
        kind: "build:fail",
        signature,
        summary: ["build:fail", `signature=${signature}`, ...errorLines(text)]
          .join("\n")
          .slice(0, 800),
      };
    }
    return {
      kind: "build:pass",
      signature: "ok",
      summary: "build:pass signature=ok",
    };
  }

  if (isBuildTool && parsed.errors.length > 0) {
    const signature = diagnosticSignature(text);
    return {
      kind: "build:fail",
      signature,
      summary: ["build:fail", `signature=${signature}`, ...errorLines(text)]
        .join("\n")
        .slice(0, 800),
    };
  }

  return undefined;
}
