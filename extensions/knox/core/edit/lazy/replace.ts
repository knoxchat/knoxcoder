import { ILLM } from "../..";
import {
  filterLeadingNewline,
  stopAtLines,
} from "../../diff/streamTransforms/lineStream";
import { streamLines } from "../../diff/util";
import { dedent } from "../../util";

export const BUFFER_LINES_BELOW = 3;

const MATCH_LINES_ABOVE = 1;

/**
 * Fast path: locate the unchanged gap in `oldCode` using surrounding context.
 * Handles UNCHANGED CODE at the very top (`linesBefore` empty) or bottom
 * (`linesAfter` empty). Returns `undefined` when context does not uniquely match.
 */
export function getReplacementByMatching(
  oldCode: string,
  linesBefore: string[],
  linesAfter: string[],
): string | undefined {
  const oldLines = oldCode.split("\n");
  const linesToMatchAbove = MATCH_LINES_ABOVE;
  const linesToMatchBelow = Math.min(BUFFER_LINES_BELOW, linesAfter.length);

  const atFileStart = linesBefore.length === 0;
  const atFileEnd = linesAfter.length === 0;

  if (atFileStart && atFileEnd) {
    return oldCode;
  }

  let startIndex: number;
  if (atFileStart) {
    // Virtual "match" just before the first line so slice start is 0.
    startIndex = -linesToMatchAbove;
  } else {
    const beforeContext = linesBefore.slice(-linesToMatchAbove).join("\n");
    const matchesContext = (index: number) =>
      oldLines.slice(index, index + linesToMatchAbove).join("\n") ===
      beforeContext;

    if (atFileEnd) {
      // Trailing UNCHANGED: prefer the last context match so the gap is the tail.
      startIndex = -1;
      for (
        let index = oldLines.length - linesToMatchAbove;
        index >= 0;
        index--
      ) {
        if (matchesContext(index)) {
          startIndex = index;
          break;
        }
      }
    } else {
      startIndex = oldLines.findIndex((_, index) => matchesContext(index));
    }
    if (startIndex === -1) {
      return undefined;
    }
  }

  let endIndex: number;
  if (atFileEnd) {
    endIndex = oldLines.length;
  } else {
    if (linesToMatchBelow === 0) {
      return undefined;
    }
    const afterContext = linesAfter.slice(0, linesToMatchBelow).join("\n");
    const minIndex = atFileStart ? 0 : startIndex + linesToMatchAbove;
    endIndex = oldLines.findIndex((_, index) => {
      if (index < minIndex) {
        return false;
      }
      if (index + linesToMatchBelow > oldLines.length) {
        return false;
      }
      const chunk = oldLines.slice(index, index + linesToMatchBelow).join("\n");
      return chunk === afterContext;
    });
    if (endIndex === -1) {
      return undefined;
    }
  }

  return oldLines.slice(startIndex + linesToMatchAbove, endIndex).join("\n");
}

const REPLACE_HERE = "// REPLACE HERE //";
export async function* getReplacementWithLlm(
  oldCode: string,
  linesBefore: string[],
  linesAfter: string[],
  llm: ILLM,
): AsyncGenerator<string> {
  const userPrompt = dedent`
    ORIGINAL CODE:
    \`\`\`
    ${oldCode}
    \`\`\`

    UPDATED CODE:
    \`\`\`
    ${linesBefore.join("\n")}
    ${REPLACE_HERE}
    ${linesAfter.join("\n")}
    \`\`\`

    Above is an original version of a file, followed by a newer version that is in the process of being written. The new version contains a section which is exactly the same as in the original code, and has been marked with "${REPLACE_HERE}". Your task is to give the exact snippet of code from the original code that should replace "${REPLACE_HERE}" in the new version.

    Your output should be a single code block. We will paste the contents of that code block directly into the new version, so make sure that it has correct indentation.
  `;

  const assistantPrompt = dedent`
    Here is the snippet of code that will replace "${REPLACE_HERE}" in the new version:
    \`\`\`
  `;

  const completion = await llm.streamChat(
    [
      { role: "user", content: userPrompt },
      { role: "assistant", content: assistantPrompt },
    ],
    new AbortController().signal,
  );

  let lines = streamLines(completion);
  lines = filterLeadingNewline(lines);
  lines = stopAtLines(lines, () => {}, ["```"]);

  for await (const line of lines) {
    yield line;
  }
}
