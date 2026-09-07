export function hasVisibleCodeContent(content: string): boolean {
  return content.trim().length > 0;
}

export function initialCodeBlockExpanded(
  codeBlockContent: string,
  expanded?: boolean,
): boolean {
  if (typeof expanded === "boolean") {
    return expanded;
  }
  return hasVisibleCodeContent(codeBlockContent);
}

export function shouldAutoExpandGeneratingCodeBlock(
  isGenerating: boolean,
  codeBlockContent: string,
  expanded?: boolean,
): boolean {
  if (expanded === false) {
    return false;
  }
  return isGenerating && hasVisibleCodeContent(codeBlockContent);
}
