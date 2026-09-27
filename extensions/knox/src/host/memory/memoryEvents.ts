const MEMORY_WRITE_MESSAGES = new Set<string>([
    'brain/dispatch',
    'brain/trackSession',
    'brain/recordMessage',
    'brain/recordSoulEvent',
    'brain/autoStore',
    'brain/store',
    'brain/updateConfig',
    'brain/optimize',
    'brain/heal',
    'brain/import',
    'brain/deleteMemory',
    'brain/deleteMemories',
    'brain/pinMemory',
    'brain/unpinMemory',
    'brain/mismatchMemory',
    'brain/pinMemories',
    'brain/unpinMemories',
    'brain/consolidate',
    'brain/summarizeSession',
    'brain/llmExtractEntities',
    'brain/llmSummarizeSession',
    'brain/llmPostActionMemory',
    'brain/createCheckpoint',
    'brain/rollbackCheckpoint',
    'brain/deleteCheckpoint',
    'brain/runPipeline',
    'brain/runAutonomousLoop',
    'memory/postTurn',
    'memory/autoStore',
]);

const MEMORY_TOOL_PREFIX = 'builtin_memory';

/**
 * Whether a webview → host message can change what the Memory panel shows.
 * `tools/call` counts only for the builtin memory tools.
 */
export function isMemoryWriteMessage(messageType: string, data?: unknown): boolean {
    if (MEMORY_WRITE_MESSAGES.has(messageType)) {
        return true;
    }
    if (messageType !== 'tools/call') {
        return false;
    }
    const name = (data as { toolCall?: { function?: { name?: unknown } } } | undefined)
        ?.toolCall?.function?.name;
    return typeof name === 'string' && name.startsWith(MEMORY_TOOL_PREFIX);
}
