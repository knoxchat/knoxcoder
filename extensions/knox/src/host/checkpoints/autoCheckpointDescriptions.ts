// Description text for auto-checkpoints (split out of AutoCheckpointSystem; no logic change).

/**
 * Generate description for auto-checkpoint, including the affected file
 * names so checkpoints are recognizable in the list without opening details
 */
export function generateAutoDescription(reason: string, changedFiles: string[]): string {
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const changeCount = changedFiles.length;
    const fileSummary = summarizeFiles(changedFiles);
    
    switch (reason) {
        case 'file-changes':
            return changeCount === 1
                ? `Auto: ${fileSummary} changed at ${timeStr}`
                : `Auto: ${changeCount} files changed (${fileSummary}) at ${timeStr}`;
        case 'time-interval':
            return fileSummary
                ? `Auto: Periodic checkpoint (${fileSummary}) at ${timeStr}`
                : `Auto: Periodic checkpoint at ${timeStr}`;
        case 'ai-operation':
            return `Auto: After AI operation at ${timeStr}`;
        case 'pre-risky':
            return `Auto: Safety checkpoint at ${timeStr}`;
        default:
            return `Auto: Checkpoint at ${timeStr}`;
    }
}

/**
 * Produce a short human-readable summary of changed files (up to 2 names)
 */
function summarizeFiles(changedFiles: string[]): string {
    if (changedFiles.length === 0) {
        return '';
    }
    
    const names = changedFiles
        .slice(0, 2)
        .map(f => f.split(/[\\/]/).pop() || f);
    
    const extra = changedFiles.length - names.length;
    return extra > 0 ? `${names.join(', ')} +${extra} more` : names.join(', ');
}
