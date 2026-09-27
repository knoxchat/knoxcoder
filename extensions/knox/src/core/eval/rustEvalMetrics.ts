/**
 * Scripted rust eval counters (RL-56). Live pass@1 is out of scope.
 */

import { TEST_TAMPER_MARKER } from "../tools/rustEditGuard";
import { BuiltInToolNames } from "../tools/builtIn";

export interface RustEvalMetrics {
  editsToGreen: number | null;
  clippyWarnings: number;
  cloneDelta: number;
  unwrapDelta: number;
  testTamper: number;
  miriClean: boolean | null;
}

const EDIT_TOOLS = new Set<string>([
  BuiltInToolNames.EditFile,
  BuiltInToolNames.WriteFile,
  BuiltInToolNames.ApplyPatch,
]);

function editPayload(args: Record<string, unknown>): string {
  return [args.new_string, args.contents, args.patch, args.diff]
    .filter((part): part is string => typeof part === "string")
    .join("\n");
}

function outputHasCleanCargoCheck(step: {
  args: Record<string, unknown>;
  output: string;
}): boolean {
  const command = String(step.args.command ?? "");
  return (
    (/cargo check/.test(command) || /cargo check/.test(step.output)) &&
    /Exit:\s*0/.test(step.output)
  );
}

export function summarizeRustEval(result: {
  toolTrace: Array<{
    name: string;
    args: Record<string, unknown>;
    output: string;
  }>;
}): RustEvalMetrics {
  let edits = 0;
  let clippyWarnings = 0;
  let cloneDelta = 0;
  let unwrapDelta = 0;
  let testTamper = 0;
  let miriClean: boolean | null = null;
  let editsToGreen: number | null = null;

  for (const step of result.toolTrace) {
    if (EDIT_TOOLS.has(step.name)) {
      edits += 1;
      const blob = editPayload(step.args);
      cloneDelta += (blob.match(/\.clone\s*\(/g) ?? []).length;
      unwrapDelta += (blob.match(/\.unwrap\s*\(/g) ?? []).length;
      if (step.output.includes(TEST_TAMPER_MARKER)) {
        testTamper += 1;
      }
    }
    clippyWarnings += (step.output.match(/\bclippy::[\w]+/g) ?? []).length;
    if (editsToGreen === null && outputHasCleanCargoCheck(step)) {
      editsToGreen = edits;
    }
    if (/\bmiri\b/i.test(JSON.stringify(step.args)) || /\bmiri\b/i.test(step.output)) {
      miriClean =
        /Exit:\s*0/.test(step.output) &&
        !/\bUB\b|undefined behavior/i.test(step.output);
    }
  }

  return {
    editsToGreen,
    clippyWarnings,
    cloneDelta,
    unwrapDelta,
    testTamper,
    miriClean,
  };
}
