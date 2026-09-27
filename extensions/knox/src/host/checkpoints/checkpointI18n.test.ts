import * as assert from 'node:assert';

import enCheckpoints from '../i18n/locales/en/checkpoints.json';
import zhCheckpoints from '../i18n/locales/zh/checkpoints.json';

suite('Checkpoint i18n (CP-33)', () => {
    test('vscode checkpoint errors exist in en and zh', () => {
        const required = [
            'checkpoint.encrypt.missingKey',
            'checkpoint.encrypt.decryptFailed',
            'checkpoint.error.sandbox',
            'checkpoint.error.quotaExceeded',
            'checkpoint.error.reconstruct',
            'checkpoint.restoreProgress.title',
            'checkpoint.restoreProgress.cancelled',
            'checkpoint.corrupt',
            'checkpoint.diff.showingDiff',
            'checkpoint.monitor.healthyAgeTooltip',
            'checkpoint.graph.title',
            'checkpoint.graph.cannotDeleteActive',
            'checkpoint.graph.cannotDeleteMain',
            'checkpoint.graph.mergeFailed',
            'checkpoint.graph.integrationUnavailable',
            'checkpoint.graph.bundleFilter',
            'checkpoint.graph.allFilesFilter',
        ];
        for (const key of required) {
            assert.strictEqual(typeof (enCheckpoints as Record<string, string>)[key], 'string', `en missing ${key}`);
            assert.strictEqual(typeof (zhCheckpoints as Record<string, string>)[key], 'string', `zh missing ${key}`);
        }
    });
});
