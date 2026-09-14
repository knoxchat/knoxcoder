/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	KNOX_CHAT_FALLBACK_MODELS,
	KNOX_CHAT_MS_MODEL_ID,
	KNOX_CHAT_PROVIDER,
	KNOX_PROVIDERS,
	knoxAddModelRoles,
	knoxBuildAddModelPayload,
	knoxBuildKnoxChatAddModelPayload,
	knoxCatalogModelId,
	knoxCategorizeListedModel,
	knoxConnectDisabled,
	knoxDisplayModalities,
	knoxFilterCatalogBySearch,
	knoxFormatContextBadge,
	knoxFormatModelPricingPerMillion,
	knoxFormatTokenCount,
	knoxGroupModelPackages,
	knoxListedModelToPackage,
	knoxMergeKnoxChatCatalog,
	knoxModelRoleToExperimentalRole,
	knoxParseListedChatModels,
	knoxProviderRequiredMissing,
} from '../../common/knoxAddModel.js';
import {
	knoxBatchDiffFileName,
	knoxParseBatchDiffFiles,
	knoxSelectAllBatchDiffFiles,
	knoxSelectedBatchDiffUris,
	knoxToggleBatchDiffFile,
} from '../../common/knoxBatchDiff.js';

suite('knox add model (T9.3–T9.4)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('categorizes KnoxChat catalog models by developer, tokenizer, and id', () => {
		assert.strictEqual(knoxCategorizeListedModel({ id: 'openai/gpt-4o', name: 'GPT' }), 'OpenAI');
		assert.strictEqual(knoxCategorizeListedModel({ id: 'claude-sonnet', developer: 'anthropic' }), 'Anthropic');
		assert.strictEqual(knoxCategorizeListedModel({ id: 'z-ai/glm-5.3-flash', name: 'Z.ai: GLM 5.3 Flash', developer: 'z-ai' }), 'ChatGLM');
		assert.strictEqual(knoxCategorizeListedModel({ id: 'vendor/glm-4', name: 'GLM 4' }), 'ChatGLM');
		assert.strictEqual(knoxCategorizeListedModel({ id: 'meta/llama-3', architecture: { tokenizer: 'llama' } }), 'Meta');
		assert.strictEqual(knoxCategorizeListedModel({ id: 'knox/knox-ms', name: 'Knox MS' }), 'KnoxChat');
	});

	test('parses interactive /v1/models entries into catalog cards and KnoxChat payloads', () => {
		const listed = knoxParseListedChatModels({
			data: [{
				id: 'anthropic/claude-fable-5.1',
				name: 'Anthropic: Claude Fable 5.1',
				developer: 'anthropic',
				context_length: 1_000_000,
				supported_parameters: ['tools', 'reasoning'],
				architecture: { input_modalities: ['text', 'image', 'file'], output_modalities: ['text'] },
				top_provider: { context_length: 1_000_000, max_completion_tokens: 128000 },
				pricing: { prompt: '10', completion: '50' },
				pricing_in_display_units: true,
			}],
		});
		assert.strictEqual(listed[0].id, 'anthropic/claude-fable-5.1');
		const pkg = knoxListedModelToPackage(listed[0]);
		assert.strictEqual(pkg.category, 'Anthropic');
		assert.strictEqual(pkg.params.model, 'anthropic/claude-fable-5.1');
		assert.strictEqual(pkg.params.provider, KNOX_CHAT_PROVIDER);
		assert.strictEqual(pkg.supportsTools, true);
		assert.strictEqual(pkg.supportsReasoning, true);
		assert.deepStrictEqual(knoxDisplayModalities(pkg.modalities), ['image', 'file']);
		assert.strictEqual(knoxFormatContextBadge(pkg.params.contextLength), '1.0m');
		assert.strictEqual(knoxFormatTokenCount(pkg.maxTokens ?? 0), '128k');
		assert.deepStrictEqual(knoxFormatModelPricingPerMillion(pkg.pricing!), {
			badge: '$10/50',
			title: '$10 / $50 per 1M tokens',
		});

		const payload = knoxBuildKnoxChatAddModelPayload(pkg, 'knox-key', { modelRole: 'chat', bulkAdd: true });
		assert.strictEqual(payload.provider, KNOX_CHAT_PROVIDER);
		assert.strictEqual(payload.title, pkg.title);
		assert.strictEqual(payload.name, pkg.title);
		assert.strictEqual(payload.apiKey, 'knox-key');
		assert.deepStrictEqual(payload.roles, ['chat', 'edit', 'apply']);
		assert.strictEqual(knoxModelRoleToExperimentalRole('chat'), 'chat');
		assert.strictEqual(knoxModelRoleToExperimentalRole('edit'), 'inlineEdit');
		assert.strictEqual(knoxModelRoleToExperimentalRole('apply'), 'applyCodeBlock');
	});

	test('Connect stays disabled without a KnoxChat API key and merges the Knox MS fallback', () => {
		assert.strictEqual(knoxConnectDisabled(''), true);
		assert.strictEqual(knoxConnectDisabled('  '), true);
		assert.strictEqual(knoxConnectDisabled('knox-key'), false);
		assert.deepStrictEqual(knoxAddModelRoles({ modelRole: 'edit' }), ['edit']);
		assert.strictEqual(knoxAddModelRoles()?.length, undefined);

		const merged = knoxMergeKnoxChatCatalog([]);
		assert.strictEqual(merged.some(model => knoxCatalogModelId(model) === KNOX_CHAT_MS_MODEL_ID), true);
		const withMs = knoxMergeKnoxChatCatalog([{ id: KNOX_CHAT_MS_MODEL_ID, name: 'Knox MS' }]);
		assert.strictEqual(withMs.filter(model => knoxCatalogModelId(model) === KNOX_CHAT_MS_MODEL_ID).length, 1);

		const filtered = knoxFilterCatalogBySearch(KNOX_CHAT_FALLBACK_MODELS, 'knox-ms');
		assert.strictEqual(filtered.length, 1);
		assert.deepStrictEqual(knoxFilterCatalogBySearch(KNOX_CHAT_FALLBACK_MODELS, 'nope'), []);

		const grouped = knoxGroupModelPackages([
			{ title: 'Z', description: '', category: 'Other', params: { title: 'Z', model: 'z', contextLength: 1 } },
			{ title: 'A', description: '', category: 'Anthropic', params: { title: 'A', model: 'a', contextLength: 1 } },
		]);
		assert.deepStrictEqual(grouped.map(group => group.title), ['Anthropic', 'Other']);

		const knoxchat = KNOX_PROVIDERS.knoxchat;
		assert.strictEqual(knoxchat.provider, KNOX_CHAT_PROVIDER);
		assert.deepStrictEqual(Object.keys(KNOX_PROVIDERS), [KNOX_CHAT_PROVIDER]);
		assert.strictEqual(knoxProviderRequiredMissing(knoxchat, {}), true);
		assert.strictEqual(knoxProviderRequiredMissing(knoxchat, { apiKey: 'knox-key' }), false);
		const built = knoxBuildAddModelPayload(KNOX_CHAT_FALLBACK_MODELS[0], knoxchat, { apiKey: 'knox-key' });
		assert.strictEqual(built.provider, KNOX_CHAT_PROVIDER);
		assert.strictEqual(built.apiKey, 'knox-key');
		assert.strictEqual(knoxFormatContextBadge(Number.POSITIVE_INFINITY), '∞');
		assert.strictEqual(knoxFormatTokenCount(4200), '4.2k');
	});
});

suite('knox batch diff (T9.5)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('parses pending files and toggles selection', () => {
		const files = knoxParseBatchDiffFiles({
			files: [
				{ filepath: '/tmp/a.ts', numDiffs: 2 },
				{ filepath: '/tmp/b.ts', numDiffs: 1, selected: false },
			],
		});
		assert.strictEqual(files[0].selected, true);
		assert.strictEqual(files[1].selected, false);
		const toggled = knoxToggleBatchDiffFile(files, '/tmp/b.ts');
		assert.deepStrictEqual(knoxSelectedBatchDiffUris(toggled), ['/tmp/a.ts', '/tmp/b.ts']);
		assert.deepStrictEqual(knoxSelectedBatchDiffUris(knoxSelectAllBatchDiffFiles(files, false)), []);
		assert.deepStrictEqual(knoxBatchDiffFileName('/tmp/src/app.ts'), { name: 'app.ts', dir: '/tmp/src' });
	});
});
