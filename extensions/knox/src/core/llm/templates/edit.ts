import { ChatMessage, PromptTemplate } from "../../index.js";

import { gptEditPrompt } from "./edit/gpt.js";

const simplifiedEditPrompt = `Consider the following code:
\`\`\`{{{language}}}
{{{codeToEdit}}}
\`\`\`
Edit the code to perfectly satisfy the following user request:
{{{userInput}}}
Output nothing except for the code. No code block, no English explanation, no start/end tags.`;

const simplestEditPrompt = `Here is the code before editing:
\`\`\`{{{language}}}
{{{codeToEdit}}}
\`\`\`

Here is the edit requested:
"{{{userInput}}}"

Here is the code after editing:`;

const START_TAG = "<START EDITING HERE>";
const osModelsEditPrompt: PromptTemplate = (history, otherData) => {
  // "No sufix" means either there is no suffix OR
  // it's a clean break at end of function or something
  // (what we're trying to avoid is just the language model trying to complete the closing brackets of a function or something)
  const firstCharOfFirstLine = otherData.suffix?.split("\n")[0]?.[0]?.trim();
  const isSuffix =
    otherData.suffix?.trim() !== "" &&
    // First character of first line is whitespace
    // Otherwise we assume it's a clean break
    !firstCharOfFirstLine;
  const suffixTag = isSuffix ? "<STOP EDITING HERE>" : "";
  const suffixExplanation = isSuffix
    ? ' When you get to "<STOP EDITING HERE>", end your response.'
    : "";

  // If neither prefilling nor /v1/completions are supported, we have to use a chat prompt without putting words in the model's mouth
  if (
    otherData.supportsCompletions !== "true" &&
    otherData.supportsPrefill !== "true"
  ) {
    return gptEditPrompt(history, otherData);
  }

  // Use a different prompt when there's neither prefix nor suffix
  if (otherData.prefix?.trim() === "" && otherData.suffix?.trim() === "") {
    return [
      {
        role: "user",
        content: `\`\`\`${otherData.language}
${otherData.codeToEdit}
${suffixTag}
\`\`\`

Please rewrite the entire code block above in order to satisfy the following request: "${otherData.userInput}". You should rewrite the entire code block without leaving placeholders, even if the code is the same as before.${suffixExplanation}`,
      },
      {
        role: "assistant",
        content: `Sure! Here's the entire rewritten code block:
\`\`\`${otherData.language}
`,
      },
    ];
  }

  return [
    {
      role: "user",
      content: `\`\`\`${otherData.language}
${otherData.prefix}${START_TAG}
${otherData.codeToEdit}
${suffixTag}
\`\`\`

Please rewrite the entire code block above, editing the portion below "${START_TAG}" in order to satisfy the following request: "${otherData.userInput}". You should rewrite the entire code block without leaving placeholders, even if the code is the same as before.${suffixExplanation}
`,
    },
    {
      role: "assistant",
      content: `Sure! Here's the entire code block, including the rewritten portion:
\`\`\`${otherData.language}
${otherData.prefix}${START_TAG}
`,
    },
  ];
};

const claudeEditPrompt: PromptTemplate = (
  history: ChatMessage[],
  otherData: Record<string, string>,
) => [
  {
    role: "user",
    content: `\
\`\`\`${otherData.language}
${otherData.codeToEdit}
\`\`\`

You are an expert programmer. You will rewrite the above code to do the following:

${otherData.userInput}

Output only a code block with the rewritten code:
`,
  },
  {
    role: "assistant",
    content: `Sure! Here is the rewritten code:
\`\`\`${otherData.language}`,
  },
];

export {
  claudeEditPrompt,
  gptEditPrompt,
  osModelsEditPrompt,
  simplestEditPrompt,
  simplifiedEditPrompt,
};
