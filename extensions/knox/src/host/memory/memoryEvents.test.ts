import * as assert from 'node:assert';

import { isMemoryWriteMessage } from './memoryEvents';

suite('memory panel refresh triggers', () => {
    test('memory writes refresh the panel', () => {
        assert.strictEqual(isMemoryWriteMessage('brain/store'), true);
        assert.strictEqual(isMemoryWriteMessage('brain/deleteMemories'), true);
        assert.strictEqual(isMemoryWriteMessage('memory/postTurn'), true);
    });

    test('reads do not refresh the panel', () => {
        assert.strictEqual(isMemoryWriteMessage('brain/dashboard'), false);
        assert.strictEqual(isMemoryWriteMessage('brain/searchMemories'), false);
        assert.strictEqual(isMemoryWriteMessage('memory/buildContext'), false);
    });

    test('tools/call counts only for builtin memory tools', () => {
        const call = (name: unknown) => ({ toolCall: { function: { name } } });
        assert.strictEqual(isMemoryWriteMessage('tools/call', call('builtin_memory')), true);
        assert.strictEqual(isMemoryWriteMessage('tools/call', call('builtin_memory_manage')), true);
        assert.strictEqual(isMemoryWriteMessage('tools/call', call('builtin_read_file')), false);
        assert.strictEqual(isMemoryWriteMessage('tools/call', undefined), false);
    });
});
