import {
  filterLeadingAndTrailingNewLineInsertion,
  filterLeadingNewline,
  removeTrailingWhitespace,
  stopAtLines,
} from "../../diff/streamTransforms/lineStream.js";
import { streamDiff } from "../../diff/streamDiff.js";
import { LineStream, streamLines } from "../../diff/util.js";
import { DiffLine, ILLM } from "../../index.js";
import { t } from "../../i18n/index.js";

import { lazyApplyPromptForModel, UNCHANGED_CODE } from "./prompts.js";
import {
  BUFFER_LINES_BELOW,
  getReplacementByMatching,
  getReplacementWithLlm,
} from "./replace.js";

export async function* streamLazyApply(
  oldCode: string,
  filename: string,
  newCode: string,
  llm: ILLM,
  fastLlm: ILLM,
): AsyncGenerator<DiffLine> {
  const promptFactory = lazyApplyPromptForModel(llm.model, llm.providerName);
  if (!promptFactory) {
    throw new Error(t("modelDoesNotSupportLazy", { model: llm.model }));
  }

  const promptMessages = promptFactory(oldCode, filename, newCode);
  const lazyCompletion = llm.streamChat(
    promptMessages,
    new AbortController().signal,
  );

  // Prefer exact context matching; fall back to a small LLM fill-in.
  async function* replacementFunction(
    oldCode: string,
    linesBefore: string[],
    linesAfter: string[],
  ): AsyncGenerator<string> {
    const matched = getReplacementByMatching(oldCode, linesBefore, linesAfter);
    if (matched !== undefined) {
      if (matched.length === 0) {
        return;
      }
      for (const line of matched.split("\n")) {
        yield line;
      }
      return;
    }

    for await (const line of getReplacementWithLlm(
      oldCode,
      linesBefore,
      linesAfter,
      fastLlm,
    )) {
      yield line;
    }
  }

  let lazyCompletionLines = streamLines(lazyCompletion, true);
  lazyCompletionLines = stopAtLines(lazyCompletionLines, () => {}, ["```"]);
  lazyCompletionLines = filterLeadingNewline(lazyCompletionLines);
  lazyCompletionLines = removeTrailingWhitespace(lazyCompletionLines);

  const lines = streamFillUnchangedCode(
    lazyCompletionLines,
    oldCode,
    replacementFunction,
  );

  const oldLines = oldCode.split(/\r?\n/);
  let diffLines = streamDiff(oldLines, lines);
  diffLines = filterLeadingAndTrailingNewLineInsertion(diffLines);
  for await (const diffLine of diffLines) {
    yield diffLine;
  }
}

async function* streamFillUnchangedCode(
  lines: LineStream,
  oldCode: string,
  replacementFunction: (
    oldCode: string,
    linesBefore: string[],
    linesAfter: string[],
  ) => AsyncGenerator<string>,
): LineStream {
  const newLines: string[] = [];
  let buffer: string[] = [];
  let waitingForBuffer = false;

  for await (const line of lines) {
    if (waitingForBuffer) {
      buffer.push(line);

      if (buffer.length >= BUFFER_LINES_BELOW) {
        const replacementLines = replacementFunction(oldCode, newLines, buffer);
        for await (const replacementLine of replacementLines) {
          yield replacementLine;
          newLines.push(replacementLine);
        }

        for (const bufferedLine of buffer) {
          yield bufferedLine;
          newLines.push(bufferedLine);
        }

        waitingForBuffer = false;
        buffer = [];
      }
      continue;
    }

    if (line.includes(UNCHANGED_CODE)) {
      // Buffer BUFFER_LINES_BELOW lines of context below the marker.
      // When newLines is empty (marker at top of file), replacementFunction
      // treats the gap as starting at offset 0 in oldCode.
      waitingForBuffer = true;
    } else {
      yield line;
      newLines.push(line);
    }
  }

  if (waitingForBuffer) {
    const replacementLines = replacementFunction(oldCode, newLines, buffer);
    for await (const replacementLine of replacementLines) {
      yield replacementLine;
      newLines.push(replacementLine);
    }
    for (const bufferedLine of buffer) {
      yield bufferedLine;
      newLines.push(bufferedLine);
    }
  }
}
