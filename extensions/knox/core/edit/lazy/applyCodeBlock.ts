import { DiffLine, ILLM } from "../..";
import { generateLines } from "../../diff/util";
import { t } from "../../i18n/index.js";
import { supportedLanguages } from "../../util/treeSitter";
import { getUriFileExtension } from "../../util/uri";

import { deterministicApplyLazyEdit } from "./deterministic";
import { streamLazyApply } from "./streamLazyApply";
import { isUnifiedDiffFormat, applyUnifiedDiff } from "./unifiedDiffApply";

function canUseInstantApply(filename: string) {
  const fileExtension = getUriFileExtension(filename);
  return supportedLanguages[fileExtension] !== undefined;
}

export async function applyCodeBlock(
  oldFile: string,
  newFile: string,
  filename: string,
  llm: ILLM,
  fastLlm: ILLM,
): Promise<[boolean, AsyncGenerator<DiffLine>]> {
  // AST / deterministic path — returns undefined when confidence is low
  if (canUseInstantApply(filename)) {
    const diffLines = await deterministicApplyLazyEdit(
      oldFile,
      newFile,
      filename,
    );

    if (diffLines !== undefined) {
      return [true, generateLines(diffLines)];
    }
  }

  // Unified diff code blocks
  if (isUnifiedDiffFormat(newFile)) {
    try {
      const diffLines = applyUnifiedDiff(oldFile, newFile);
      return [true, generateLines(diffLines)];
    } catch (e) {
      console.error(t("failedToApplyUnifiedDiff"), e);
    }
  }

  return [false, streamLazyApply(oldFile, filename, newFile, llm, fastLlm)];
}
