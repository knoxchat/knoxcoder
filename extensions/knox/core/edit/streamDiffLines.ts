import { ChatMessage, DiffLine, ILLM, Prediction } from "../";
import {
  filterCodeBlockLines,
  filterEnglishLinesAtEnd,
  filterEnglishLinesAtStart,
  filterLeadingAndTrailingNewLineInsertion,
  removeTrailingWhitespace,
  skipLines,
  stopAtLines,
} from "../diff/streamTransforms/lineStream";
import { streamDiff } from "../diff/streamDiff";
import { streamLines } from "../diff/util";
import { gptEditPrompt } from "../llm/templates/edit";


function constructPrompt(
  prefix: string,
  highlighted: string,
  suffix: string,
  llm: ILLM,
  userInput: string,
  language: string | undefined,
): string | ChatMessage[] {
  const template = llm.promptTemplates?.edit ?? gptEditPrompt;
  return llm.renderPromptTemplate(template, [], {
    userInput,
    prefix,
    codeToEdit: highlighted,
    suffix,
    language: language ?? "",
  });
}

export async function* addIndentation(
  diffLineGenerator: AsyncGenerator<DiffLine>,
  indentation: string,
): AsyncGenerator<DiffLine> {
  for await (const diffLine of diffLineGenerator) {
    yield {
      ...diffLine,
      line: indentation + diffLine.line,
    };
  }
}

function modelIsInept(model: string): boolean {
  const lower = model.toLowerCase();
  // Capable chat/coding families (including KnoxChat org/model IDs)
  const capable = [
    "gpt",
    "claude",
    "gemini",
    "deepseek",
    "qwen",
    "grok",
    "o1",
    "o3",
    "o4",
    "sonnet",
    "opus",
    "haiku",
    "fable",
    "mistral",
    "codestral",
    "devstral",
    "knox",
    "kimi",
    "glm",
    "minimax",
    "nemotron",
  ];
  return !capable.some((part) => lower.includes(part));
}

export async function* streamDiffLines(
  prefix: string,
  highlighted: string,
  suffix: string,
  llm: ILLM,
  input: string,
  language: string | undefined,
  onlyOneInsertion: boolean,
  overridePrompt: ChatMessage[] | undefined,
): AsyncGenerator<DiffLine> {
  // Strip common indentation for the LLM, then add back after generation
  let oldLines =
    highlighted.length > 0
      ? highlighted.split("\n")
      : // When highlighted is empty, we need to combine last line of prefix and first line of suffix to determine the line being edited
        [(prefix + suffix).split("\n")[prefix.split("\n").length - 1]];

  // But if that line is empty, we can assume we are insertion-only
  if (oldLines.length === 1 && oldLines[0].trim() === "") {
    oldLines = [];
  }

  const prompt =
    overridePrompt ??
    constructPrompt(prefix, highlighted, suffix, llm, input, language);
  const inept = modelIsInept(llm.model);

  const prediction: Prediction = {
    type: "content",
    content: highlighted,
  };

  const completion =
    typeof prompt === "string"
      ? llm.streamComplete(prompt, new AbortController().signal, {
          raw: true,
          prediction,
        })
      : llm.streamChat(prompt, new AbortController().signal, {
          prediction,
        });

  let lines = streamLines(completion);

  lines = filterEnglishLinesAtStart(lines);
  lines = filterCodeBlockLines(lines);
  lines = stopAtLines(lines, () => {});
  lines = skipLines(lines);
  lines = removeTrailingWhitespace(lines);
  if (inept) {
    lines = filterEnglishLinesAtEnd(lines);
  }

  let diffLines = streamDiff(oldLines, lines);
  diffLines = filterLeadingAndTrailingNewLineInsertion(diffLines);
  if (highlighted.length === 0) {
    const line = prefix.split("\n").slice(-1)[0];
    const indentation = line.slice(0, line.length - line.trimStart().length);
    diffLines = addIndentation(diffLines, indentation);
  }

  let seenGreen = false;
  for await (const diffLine of diffLines) {
    yield diffLine;
    if (diffLine.type === "new") {
      seenGreen = true;
    } else if (onlyOneInsertion && seenGreen && diffLine.type === "same") {
      break;
    }
  }
}
