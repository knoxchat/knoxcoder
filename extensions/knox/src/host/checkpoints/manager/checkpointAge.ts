export function formatCheckpointAge(created: Date, now = Date.now()): string {
    const ms = Math.max(0, now - created.getTime());
    if (ms < 45_000) {
        return `${Math.max(1, Math.round(ms / 1000))}s`;
    }
    if (ms < 90 * 60_000) {
        return `${Math.max(1, Math.round(ms / 60_000))}m`;
    }
    if (ms < 36 * 3_600_000) {
        return `${Math.max(1, Math.round(ms / 3_600_000))}h`;
    }
    return `${Math.max(1, Math.round(ms / 86_400_000))}d`;
}

export function latestCheckpointCreated(
    checkpoints: Array<{ created: Date }>,
): Date | undefined {
    let latest: Date | undefined;
    for (const checkpoint of checkpoints) {
        if (!latest || checkpoint.created.getTime() > latest.getTime()) {
            latest = checkpoint.created;
        }
    }
    return latest;
}
