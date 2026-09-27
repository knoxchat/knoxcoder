export interface InlineLineDiff {
    lineNumber: number;
    type: 'added' | 'removed' | 'modified';
    originalContent?: string;
    currentContent: string;
    wordChanges?: Array<{ start: number; end: number; type: 'added' | 'removed' }>;
}

export function computeInlineWordChanges(
    oldLine: string,
    newLine: string,
    diffWords: (oldText: string, newText: string) => Array<{ added?: boolean; removed?: boolean; value: string }>,
): Array<{ start: number; end: number; type: 'added' | 'removed' }> {
    const wordDiff = diffWords(oldLine, newLine);
    const changes: Array<{ start: number; end: number; type: 'added' | 'removed' }> = [];
    let position = 0;
    for (const part of wordDiff) {
        if (part.added && typeof part.value === 'string') {
            changes.push({
                start: position,
                end: position + part.value.length,
                type: 'added',
            });
        }
        if (!part.removed && typeof part.value === 'string') {
            position += part.value.length;
        }
    }
    return changes;
}

/**
 * Line-level checkpoint vs editor diff. `lineNumber` is 0-based in the current document
 * for added/modified lines; removed lines keep the surrounding current-document index.
 */
export function computeInlineLineDiffs(
    originalText: string,
    currentText: string,
    diffLines: (oldText: string, newText: string) => Array<{
        added?: boolean;
        removed?: boolean;
        value: string;
    }>,
    diffWords: (oldText: string, newText: string) => Array<{ added?: boolean; removed?: boolean; value: string }>,
): InlineLineDiff[] {
    if (typeof originalText !== 'string' || typeof currentText !== 'string') {
        return [];
    }

    const changes = diffLines(originalText, currentText);
    const lineDiffs: InlineLineDiff[] = [];
    let lineNumber = 0;

    for (let i = 0; i < changes.length; i++) {
        const change = changes[i];
        const value = typeof change.value === 'string' ? change.value : '';
        const lines = value.split('\n');
        if (lines[lines.length - 1] === '') {
            lines.pop();
        }

        for (const line of lines) {
            if (change.added) {
                lineDiffs.push({
                    lineNumber,
                    type: 'added',
                    currentContent: line,
                });
            } else if (change.removed) {
                const nextChange = changes[i + 1];
                if (nextChange?.added) {
                    const nextValue = typeof nextChange.value === 'string' ? nextChange.value : '';
                    const nextLines = nextValue.split('\n').filter((entry) => entry !== '');
                    if (nextLines.length > 0) {
                        lineDiffs.push({
                            lineNumber,
                            type: 'modified',
                            originalContent: line,
                            currentContent: nextLines[0],
                            wordChanges: computeInlineWordChanges(line, nextLines[0], diffWords),
                        });
                    }
                } else {
                    lineDiffs.push({
                        lineNumber,
                        type: 'removed',
                        originalContent: line,
                        currentContent: '',
                    });
                }
            }

            if (!change.removed) {
                lineNumber++;
            }
        }
    }

    return lineDiffs;
}
