/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { DEFAULT_MENTION_PROVIDER_TITLES, SLASH_BUILTINS } from './knoxGuiInput.js';

function repoFile(...parts: string[]): string {
	return readFileSync(join(process.cwd(), ...parts), 'utf8');
}

suite('Knox context / slash / skills / rules contract (KN-300–307)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('KN-300: default @ providers are file, diff, problems, repo-map, terminal, memory', () => {
		assert.deepStrictEqual([...DEFAULT_MENTION_PROVIDER_TITLES], ['file', 'diff', 'problems', 'repo-map', 'terminal', 'memory']);
		const defaults = repoFile('extensions/knox/src/core/context/providers/defaultProviders.ts');
		assert.ok(defaults.includes('"file"'));
		assert.ok(defaults.includes('"diff"'));
		assert.ok(defaults.includes('"problems"'));
		assert.ok(defaults.includes('"repo-map"'));
		assert.ok(defaults.includes('"terminal"'));
		assert.ok(defaults.includes('"memory"'));
		assert.ok(defaults.includes('new FileFolderContextProvider'));
		assert.ok(defaults.includes('new DiffContextProvider'));
		assert.ok(defaults.includes('new ProblemsContextProvider'));
		assert.ok(defaults.includes('new RepoMapContextProvider'));
		assert.ok(defaults.includes('new TerminalContextProvider'));
		assert.ok(defaults.includes('new ProjectMemoryContextProvider'));
	});

	test('KN-301: core opt-in providers stay in the registry, not defaults', () => {
		const defaults = repoFile('extensions/knox/src/core/context/providers/defaultProviders.ts');
		for (const title of ['currentFile', 'open', 'clipboard', 'commit', 'tree', 'search', 'os', 'url', 'serial']) {
			assert.ok(defaults.includes(`title: "${title}"`) || repoFile(`extensions/knox/src/core/context/providers/${{
				currentFile: 'CurrentFileContextProvider',
				open: 'OpenFilesContextProvider',
				clipboard: 'ClipboardContextProvider',
				commit: 'GitCommitContextProvider',
				tree: 'FileTreeContextProvider',
				search: 'SearchContextProvider',
				os: 'OSContextProvider',
				url: 'URLContextProvider',
				serial: 'SerialContextProvider',
			}[title]}.ts`).includes(`title: "${title}"`), title);
		}
		assert.ok(!defaults.includes('new CurrentFileContextProvider'));
		assert.ok(!defaults.includes('new OpenFilesContextProvider'));
	});

	test('KN-302: integrations are key-gated and never default', () => {
		const defaults = repoFile('extensions/knox/src/core/context/providers/defaultProviders.ts');
		assert.ok(defaults.includes('INTEGRATION_CONTEXT_PROVIDER_TITLES'));
		for (const title of ['google', 'discord', 'greptile', 'postgres', 'database', 'issue', 'http', 'web', 'debugger']) {
			assert.ok(defaults.includes(`"${title}"`), title);
		}
		assert.ok(defaults.includes('requires serperApiKey'));
		assert.ok(defaults.includes('requires discordKey'));
		assert.ok(defaults.includes('requires githubToken'));
		assert.ok(!defaults.includes('new GoogleContextProvider'));
	});

	test('KN-303: auto-context + codebase/cargo/serial cards inject', () => {
		assert.ok(repoFile('extensions/knox/src/core/context/autoContext.ts').includes('export function extractFileReferences'));
		const construct = repoFile('extensions/knox/src/core/llm/constructMessages.ts');
		assert.ok(construct.includes('formatCodebaseCardInject'));
		assert.ok(construct.includes('formatSerialContextInject'));
		assert.ok(repoFile('extensions/knox/src/core/context/codebaseCard.ts').includes('from "./cargoCard"'));
	});

	test('KN-304: ten slash builtins match Core catalog and native SLASH_BUILTINS', () => {
		const catalog = repoFile('extensions/knox/src/core/commands/slash/index.ts');
		const names = SLASH_BUILTINS.map(cmd => cmd.name);
		assert.deepStrictEqual(names, [
			'autonomous', 'issue', 'share', 'cmd', 'http', 'commit', 'review', 'pr', 'changelog', 'skills',
		]);
		for (const file of ['autonomous', 'draftIssue', 'share', 'cmd', 'http', 'commit', 'review', 'pr', 'changelog', 'skills']) {
			assert.ok(catalog.includes(`from "./${file}"`), file);
		}
		assert.ok(repoFile('extensions/knox/src/core/promptFiles/v2/slashCommandFromPromptFile.ts').includes('export'));
	});

	test('KN-305: skills discovery covers ~/.knox, project, Claude, agents, opencode, bundled', () => {
		const index = repoFile('extensions/knox/src/core/skills/index.ts');
		assert.ok(index.includes('~/.knox/skills/'));
		assert.ok(index.includes('`.claude/skills/`'));
		assert.ok(index.includes('`.agents/skills/`'));
		assert.ok(index.includes('`.opencode/skills/`'));
		const manager = repoFile('extensions/knox/src/core/skills/skillManager.ts');
		assert.ok(manager.includes('linux-kernel, qemu, gdb, kbuild, rust') || manager.includes('bundled'));
		const bundled = repoFile('extensions/knox/src/core/skills/skillManager.ts');
		assert.ok(bundled.includes('bundled'));
		for (const name of ['gdb', 'kbuild', 'linux-kernel', 'qemu', 'rust']) {
			assert.ok(existsSync(join(process.cwd(), 'extensions/knox/src/core/skills/bundled', name, 'SKILL.md')), name);
		}
	});

	test('KN-306: rules merge order is global → CLAUDE → AGENTS → .knoxrules → nested', () => {
		const rules = repoFile('extensions/knox/src/core/config/rules.ts');
		assert.ok(rules.includes('~/.knox/rules/*'));
		assert.ok(rules.includes('CLAUDE.md'));
		assert.ok(rules.includes('AGENTS.md'));
		assert.ok(rules.includes('.knoxrules'));
		assert.ok(rules.includes('Knox-specific wins'));
		assert.ok(rules.includes('applyTo'));
		assert.ok(rules.includes('always') && rules.includes('never'));
	});

	test('KN-307: .prompt language, completions, @ mentions, and document links', () => {
		const pkg = repoFile('extensions/knox/package.json');
		assert.ok(pkg.includes('"id": "promptLanguage"'));
		assert.ok(pkg.includes('".prompt"'));
		assert.ok(pkg.includes('prompt-file-language-configuration.json'));
		assert.ok(pkg.includes('prompt.tmLanguage.json'));
		assert.ok(repoFile('extensions/knox/src/host/lang-server/promptFileCompletions.ts').includes('promptLanguage'));
		assert.ok(repoFile('extensions/knox/src/host/lang-server/promptFileAtMentions.ts').includes('export'));
		assert.ok(repoFile('extensions/knox/src/host/lang-server/promptFileDocumentLinks.ts').includes('promptLanguage'));
		assert.ok(repoFile('extensions/knox/src/host/extension/VsCodeExtension.ts').includes('registerAllPromptFilesCompletionProviders'));
	});
});
