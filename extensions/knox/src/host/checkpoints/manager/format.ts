export function formatCheckpointAge(createdAt: string): string {
    const created = new Date(createdAt);
    const now = new Date();
    const diffMs = now.getTime() - created.getTime();
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays > 0) {
        return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
    }
    if (diffHours > 0) {
        return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
    }
    if (diffMinutes > 0) {
        return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`;
    }
    return 'Just now';
}

export function formatFileSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    const threshold = 1024;

    if (bytes === 0) {
        return '0 B';
    }

    let size = bytes;
    let unitIndex = 0;

    while (size >= threshold && unitIndex < units.length - 1) {
        size /= threshold;
        unitIndex++;
    }

    if (unitIndex === 0) {
        return `${bytes} ${units[unitIndex]}`;
    }
    return `${size.toFixed(1)} ${units[unitIndex]}`;
}

export function generateAutoDescription(messageId?: string): string {
    const now = new Date();
    const timeStr = now.toLocaleTimeString();
    return messageId ? `Agent response ${messageId} - ${timeStr}` : `Agent response - ${timeStr}`;
}
