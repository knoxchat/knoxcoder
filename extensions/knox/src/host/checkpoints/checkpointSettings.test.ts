import * as assert from 'node:assert';
import * as vscode from 'vscode';

import { AutoCheckpointSystem } from './AutoCheckpointSystem';
import {
    AUTO_CHECKPOINT_DEFAULTS,
    DEFAULT_ENABLE_AUTO_CHECKPOINTS,
    DEFAULT_MAX_FILES_PER_CHECKPOINT,
    ENGINE_SETTING_KEYS,
    SMART_CHECKPOINT_DEFAULTS,
    defaultCheckpointConfig,
    isAiAutoCheckpointsEnabled,
} from './checkpointSettings';

suite('Checkpoint settings (CP-12)', () => {
    test('GUI/engine defaults match contributed package.json values', () => {
        const defaults = defaultCheckpointConfig();
        const checkpoints = vscode.workspace.getConfiguration('knox.checkpoints');

        assert.strictEqual(defaults.enableAutoCheckpoints, DEFAULT_ENABLE_AUTO_CHECKPOINTS);
        assert.strictEqual(defaults.enableAutoCheckpoints, true);
        assert.strictEqual(
            checkpoints.inspect('enableAutoCheckpoints')?.defaultValue,
            true,
        );
        assert.strictEqual(
            checkpoints.inspect('maxFilesPerCheckpoint')?.defaultValue,
            DEFAULT_MAX_FILES_PER_CHECKPOINT,
        );
        assert.strictEqual(
            checkpoints.inspect('enableCompression')?.defaultValue,
            defaults.enableCompression,
        );
        assert.strictEqual(
            checkpoints.inspect('encryptAtRest')?.defaultValue,
            defaults.encryptAtRest,
        );
        assert.strictEqual(defaults.encryptAtRest, false);
        assert.strictEqual(
            checkpoints.inspect('maxStorageBytes')?.defaultValue,
            defaults.maxStorageBytes,
        );

        for (const key of ENGINE_SETTING_KEYS) {
            assert.notStrictEqual(
                checkpoints.inspect(key)?.defaultValue,
                undefined,
                `${key} must be contributed in package.json`,
            );
        }
    });

    test('auto, smart, and inlineDiff settings are contributed', () => {
        const auto = vscode.workspace.getConfiguration('knox.checkpoints.auto');
        assert.strictEqual(auto.inspect('enabled')?.defaultValue, AUTO_CHECKPOINT_DEFAULTS.enabled);
        assert.strictEqual(
            auto.inspect('minIntervalMs')?.defaultValue,
            AUTO_CHECKPOINT_DEFAULTS.minIntervalMs,
        );
        assert.strictEqual(
            auto.inspect('showNotifications')?.defaultValue,
            AUTO_CHECKPOINT_DEFAULTS.showNotifications,
        );

        const smart = vscode.workspace.getConfiguration('knox.checkpoints.smart');
        assert.strictEqual(smart.inspect('enabled')?.defaultValue, SMART_CHECKPOINT_DEFAULTS.enabled);
        assert.strictEqual(
            smart.inspect('enableMetrics')?.defaultValue,
            SMART_CHECKPOINT_DEFAULTS.enableMetrics,
        );
        assert.strictEqual(SMART_CHECKPOINT_DEFAULTS.enableMetrics, true);

        const inlineDiff = vscode.workspace.getConfiguration('knox.checkpoints.inlineDiff');
        assert.strictEqual(
            inlineDiff.inspect('enabled')?.defaultValue,
            false,
            'inlineDiff is off until the user enables it',
        );
        assert.strictEqual(inlineDiff.inspect('showLineDecorations')?.defaultValue, true);
        assert.strictEqual(inlineDiff.inspect('showGutterIcons')?.defaultValue, true);
        assert.strictEqual(inlineDiff.inspect('showHoverPreviews')?.defaultValue, true);
        assert.strictEqual(inlineDiff.inspect('showCodeLens')?.defaultValue, true);
        assert.strictEqual(inlineDiff.inspect('highlightWordChanges')?.defaultValue, true);
    });

    test('enableAutoCheckpoints defaults to true', () => {
        assert.strictEqual(isAiAutoCheckpointsEnabled(), true);
    });

    test('changing auto minIntervalMs reloads AutoCheckpointSystem without a window reload', async () => {
        const auto = AutoCheckpointSystem.getInstance();
        const section = vscode.workspace.getConfiguration('knox.checkpoints.auto');
        const previous = section.inspect('minIntervalMs')?.globalValue;

        try {
            await section.update('minIntervalMs', 15_000, vscode.ConfigurationTarget.Global);
            auto.reloadConfiguration();
            assert.strictEqual(auto.getConfig().minIntervalMs, 15_000);
        } finally {
            await section.update('minIntervalMs', previous, vscode.ConfigurationTarget.Global);
            auto.reloadConfiguration();
        }
    });

    test('GUI overlay auto defaults match contributed knox.checkpoints.auto values', () => {
        const auto = vscode.workspace.getConfiguration('knox.checkpoints.auto');
        assert.strictEqual(auto.inspect('enabled')?.defaultValue, true);
        assert.strictEqual(auto.inspect('minIntervalMs')?.defaultValue, 60_000);
        assert.strictEqual(auto.inspect('fileChangeThreshold')?.defaultValue, 5);
        assert.strictEqual(auto.inspect('showNotifications')?.defaultValue, false);
    });
});
