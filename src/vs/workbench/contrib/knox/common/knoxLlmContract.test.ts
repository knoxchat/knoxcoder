/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';

function repoFile(...parts: string[]): string {
	return readFileSync(join(process.cwd(), ...parts), 'utf8');
}

suite('Knox LLM stack contract (KN-250–256)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('KN-250: BaseLLM + streamChat / complete + chars÷4 estimate', () => {
		const index = repoFile('extensions/knox/src/core/llm/index.ts');
		assert.ok(index.includes('export abstract class BaseLLM'));
		assert.ok(index.includes('compileChatMessages'));
		const tokens = repoFile('extensions/knox/src/core/llm/countTokens.ts');
		assert.ok(tokens.includes('chars ÷ 4') || tokens.includes('CHARS_PER_CONTEXT_UNIT = 4'));
		assert.ok(repoFile('extensions/knox/src/core/llm/streamChat.ts').includes('export'));
	});

	test('KN-251: OpenAI Chat Completions provider', () => {
		const openai = repoFile('extensions/knox/src/core/llm/llms/OpenAI.ts');
		assert.ok(openai.includes('class OpenAI'));
		assert.ok(openai.includes('tool_calls') || openai.includes('parallel_tool_calls'));
	});

	test('KN-252: Anthropic Messages API with tool_use and thinking', () => {
		const anthropic = repoFile('extensions/knox/src/core/llm/llms/Anthropic.ts');
		assert.ok(anthropic.includes('tool_use'));
		assert.ok(anthropic.includes('thinking'));
	});

	test('KN-253: KnoxChat provider hits api.knoxstudio.ai and caches /v1/models', () => {
		assert.ok(repoFile('extensions/knox/src/core/llm/llms/KnoxChat.ts').includes('https://api.knoxstudio.ai/v1/'));
		assert.ok(repoFile('extensions/knox/src/core/llm/knoxChatModels.ts').includes('https://api.knoxstudio.ai/v1/models'));
		assert.ok(repoFile('extensions/knox/src/host/extension/VsCodeMessenger.ts').includes('getKnoxChatModels'));
	});

	test('KN-371: native GUI tools support reads the KN-253 /v1/models cache', () => {
		const capabilities = repoFile('src/vs/workbench/contrib/knox/common/knoxGuiCapabilities.ts');
		const messenger = repoFile('extensions/knox/src/host/extension/VsCodeMessenger.ts');
		const models = repoFile('src/vs/workbench/contrib/knox/browser/gui/controller/models.ts');
		assert.ok(capabilities.includes('knoxGuiSeedModelCatalog'));
		assert.ok(capabilities.includes('knoxGuiParseModelCatalog'));
		assert.ok(capabilities.includes('modelSupportsToolsFromSupportedParameters') || capabilities.includes('knoxGuiModelSupportsToolsFromSupportedParameters'));
		assert.ok(!capabilities.includes("['knoxchat', 'openai', 'anthropic']"));
		assert.ok(messenger.includes('getKnoxChatModels'));
		assert.ok(messenger.includes('KN-371'));
		assert.ok(!messenger.includes('fetch(KNOX_CHAT_MODELS_URL)'));
		assert.ok(capabilities.includes('knoxGuiModelToolsSupportKnown'));
		assert.ok(capabilities.includes('knoxGuiResolveToolsSupported'));
		assert.ok(models.includes('knoxGuiSeedModelCatalog'));
		assert.ok(models.includes('patchSelectedModelCapabilities'));
	});

	test('KN-254: CustomLLM + Mock + Test providers exist', () => {
		assert.ok(repoFile('extensions/knox/src/core/llm/llms/CustomLLM.ts').includes('class CustomLLM'));
		assert.ok(repoFile('extensions/knox/src/core/llm/llms/Mock.ts').includes('class Mock'));
		assert.ok(repoFile('extensions/knox/src/core/llm/llms/Test.ts').includes('class Test'));
	});

	test('KN-255: constructMessages, compileChatMessages, text tool-call hydration', () => {
		assert.ok(repoFile('extensions/knox/src/core/llm/constructMessages.ts').includes('export function constructMessages'));
		assert.ok(repoFile('extensions/knox/src/core/llm/countTokens.ts').includes('function compileChatMessages'));
		const parse = repoFile('extensions/knox/src/core/llm/parseTextToolCalls.ts');
		assert.ok(parse.includes('export function extractTextToolCalls'));
		assert.ok(parse.includes('export function hydrateAssistantTextToolCalls'));
		assert.ok(parse.includes('HERMES_FN_RE'));
		assert.ok(parse.includes('DSML_BAR_RE'));
		assert.ok(parse.includes('XML_TAG_RE'));
	});

	test('KN-256: role-based model routing + reasoning-effort prefs', () => {
		const roles = repoFile('extensions/knox/src/core/config/selectedModels.ts');
		for (const role of ['chat', 'edit', 'apply', 'summarize', 'viewRead', 'realTimeSearch']) {
			assert.ok(roles.includes(`"${role}"`), role);
		}
		assert.ok(repoFile('extensions/knox/src/core/llm/reasoningEffortConfig.ts').includes('reasoning'));
	});
});
