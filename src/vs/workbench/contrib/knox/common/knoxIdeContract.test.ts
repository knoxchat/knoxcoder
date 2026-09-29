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

function parseQuotedConst(src: string, constName: string): string[] {
	const start = src.indexOf(`export const ${constName}`);
	assert.ok(start >= 0, `${constName} missing`);
	const slice = src.slice(start);
	const end = slice.indexOf('] as const');
	assert.ok(end > 0, `${constName} terminator missing`);
	return [...slice.slice(0, end).matchAll(/"([A-Za-z][A-Za-z0-9]*)"/g)].map(m => m[1]);
}

function parseIdeInterfaceMethods(src: string): { name: string; optional: boolean }[] {
	const start = src.indexOf('export interface IDE {');
	assert.ok(start >= 0, 'IDE interface missing from index.d.ts');
	const rest = src.slice(start);
	const end = rest.indexOf('\n}\n\n// Slash Commands');
	assert.ok(end > 0, 'IDE interface terminator not found');
	const body = rest.slice(0, end);
	const found: { name: string; optional: boolean }[] = [];
	const re = /^\s+([A-Za-z][A-Za-z0-9]*)(\?)?\(/gm;
	let match: RegExpExecArray | null;
	while ((match = re.exec(body))) {
		found.push({ name: match[1], optional: match[2] === '?' });
	}
	return found;
}

function hostDeclares(hostSrc: string, name: string): boolean {
	return new RegExp(`^[ \\t]+(?:public\\s+)?(?:async\\s+)?${name}\\s*[:(=]`, 'm').test(hostSrc);
}

suite('Knox IDE façade contract (KN-210–222)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const catalogSrc = repoFile('extensions/knox/src/core/ide.ts');
	const indexDts = repoFile('extensions/knox/src/core/index.d.ts');
	const hostSrc = repoFile('extensions/knox/src/host/VsCodeIde.ts');
	const required = parseQuotedConst(catalogSrc, 'IDE_REQUIRED_METHODS');
	const optional = parseQuotedConst(catalogSrc, 'IDE_OPTIONAL_METHODS');
	const all = [...required, ...optional];
	const interfaceMethods = parseIdeInterfaceMethods(indexDts);

	test('KN-210: ide.ts catalog matches IDE in index.d.ts', () => {
		assert.deepStrictEqual(interfaceMethods.map(m => m.name).sort(), [...all].sort());
		assert.deepStrictEqual(interfaceMethods.filter(m => m.optional).map(m => m.name).sort(), [...optional].sort());
		assert.deepStrictEqual(interfaceMethods.filter(m => !m.optional).map(m => m.name).sort(), [...required].sort());
	});

	test('KN-210: VsCodeIde implements every required and optional IDE method', () => {
		const missing = all.filter(name => !hostDeclares(hostSrc, name));
		assert.deepStrictEqual(missing, [], `missing on VsCodeIde: ${missing.join(', ')}`);
	});

	test('KN-211: glob / read_file / view_subdirectory walk extras.ide + walkIgnore', () => {
		const glob = repoFile('extensions/knox/src/core/tools/implementations/glob.ts');
		const readFile = repoFile('extensions/knox/src/core/tools/implementations/readFile.ts');
		const view = repoFile('extensions/knox/src/core/tools/implementations/viewSubdirectory.ts');
		const ignore = repoFile('extensions/knox/src/core/util/walkIgnore.ts');
		assert.ok(glob.includes('extras.ide.getWorkspaceDirs()'));
		assert.ok(glob.includes('extras.ide.listDir'));
		assert.ok(glob.includes('loadWalkIgnore(extras.ide'));
		assert.ok(readFile.includes('extras.ide.fileExists'));
		assert.ok(readFile.includes('extras.ide.readFile'));
		assert.ok(readFile.includes('extras.ide.readRangeInFile'));
		assert.ok(view.includes('extras.ide.listDir'));
		assert.ok(view.includes('loadWalkIgnore(extras.ide'));
		assert.ok(ignore.includes('.knoxignore'));
		assert.ok(ignore.includes('.gitignore'));
	});

	test('KN-212: secrets go through SecretStorage on VsCodeIde', () => {
		assert.ok(hostSrc.includes('this.secretStorage.get'));
		assert.ok(hostSrc.includes('this.secretStorage.store'));
		const stub = repoFile('extensions/knox/src/host/stubs/SecretStorage.ts');
		assert.ok(stub.includes('context.secrets'));
		assert.ok(stub.includes('async store('));
		assert.ok(stub.includes('async get('));
		assert.ok(stub.includes('async encrypt('));
		assert.ok(stub.includes('async decrypt('));
	});

	test('KN-213: git status/diff prefer vscode.git model, shell only as fallback', () => {
		const git = repoFile('extensions/knox/src/core/tools/implementations/git.ts');
		const utils = repoFile('extensions/knox/src/host/util/ideUtils.ts');
		assert.ok(git.includes('extras.ide.getGitStatusPorcelain'));
		assert.ok(git.includes('extras.ide.getGitDiffCached'));
		assert.ok(git.includes('runGit(extras'));
		assert.ok(utils.includes('vscode.git'));
		assert.ok(utils.includes('formatGitStatusPorcelain'));
	});

	test('KN-214: exact search and host search use bundled ripgrep', () => {
		const search = repoFile('extensions/knox/src/core/tools/implementations/exactSearch.ts');
		assert.ok(search.includes('extras.ide.getSearchResults'));
		assert.ok(hostSrc.includes('searchWorkspaceWithRipgrep'));
		assert.ok(hostSrc.includes('resolveRipgrepBinary'));
	});

	test('KN-215: terminal contents feed @terminal, debugTerminal, and TerminalMonitor', () => {
		assert.ok(hostSrc.includes('this.ideUtils.getTerminalContents'));
		const terminal = repoFile('extensions/knox/src/core/context/providers/TerminalContextProvider.ts');
		assert.ok(terminal.includes('extras.ide.getTerminalContents()'));
		assert.ok(repoFile('extensions/knox/src/host/commands.ts').includes('knoxchat.debugTerminal'));
		assert.ok(repoFile('extensions/knox/src/host/agent/index.ts').includes('TerminalMonitor.getInstance()'));
	});

	test('KN-216: @problems reads façade diagnostics', () => {
		assert.ok(hostSrc.includes('async getProblems'));
		assert.ok(hostSrc.includes('vscode.languages.getDiagnostics'));
		assert.ok(repoFile('extensions/knox/src/core/context/providers/ProblemsContextProvider.ts').includes('ide.getProblems()'));
	});

	test('KN-217: LSP surface used by builtin_lsp is on VsCodeIde', () => {
		for (const name of [
			'gotoDefinition',
			'findReferences',
			'getHover',
			'getDocumentSymbols',
			'getWorkspaceSymbols',
			'gotoImplementation',
			'prepareCallHierarchy',
			'getIncomingCalls',
			'getOutgoingCalls',
		]) {
			assert.ok(hostDeclares(hostSrc, name), name);
		}
		assert.ok(repoFile('extensions/knox/src/core/tools/implementations/lsp.ts').includes('extras.ide'));
	});

	test('KN-218: debugControl is optional and catalog-gated', () => {
		const catalog = repoFile('extensions/knox/src/core/tools/catalog.ts');
		assert.ok(hostDeclares(hostSrc, 'debugControl'));
		assert.ok(catalog.includes('shouldIncludeDebugTool'));
		assert.ok(catalog.includes('opts.systems || opts.debugSessionActive'));
		assert.ok(catalog.includes('debugControl?.({ op: "status" })'));
	});

	test('KN-219: native PTY injects optionally and degrades', () => {
		const pty = repoFile('extensions/knox/src/host/util/installNativePty.ts');
		assert.ok(pty.includes('setNativePtySpawner'));
		assert.ok(pty.includes('Native PTY unavailable'));
		assert.ok(repoFile('extensions/knox/src/host/activation/activate.ts').includes('installHostNativePty'));
	});

	test('KN-220: mutating-tool snapshot hooks are on the façade', () => {
		assert.ok(hostDeclares(hostSrc, 'captureMutatingToolBefore'));
		assert.ok(hostDeclares(hostSrc, 'recordMutatingToolAfter'));
		const hooks = repoFile('extensions/knox/src/core/tools/mutatingToolHooks.ts');
		assert.ok(hooks.includes('ide.captureMutatingToolBefore'));
		assert.ok(hooks.includes('ide.recordMutatingToolAfter'));
	});

	test('KN-221: post-edit verification + compile oracle live on the façade', () => {
		assert.ok(hostDeclares(hostSrc, 'runPostEditVerification'));
		const verify = repoFile('extensions/knox/src/core/tools/postEditVerification.ts');
		assert.ok(verify.includes('isLspWeakLanguagePath'));
		assert.ok(verify.includes('isRustLanguagePath'));
		const command = repoFile('extensions/knox/src/core/tools/build/verifyCommand.ts');
		assert.ok(command.includes('detectWorkspaceKind'));
		assert.ok(command.includes('CARGO_CHECK_COMMAND'));
		assert.ok(command.includes('{ file: "Makefile", command: "make" }'));
	});

	test('KN-222: checkpoint CRUD hooks are on the façade', () => {
		for (const name of [
			'listWorkspaceCheckpoints',
			'createWorkspaceCheckpoint',
			'restoreWorkspaceCheckpoint',
			'previewWorkspaceCheckpointRestore',
			'diffWorkspaceCheckpoint',
			'pinWorkspaceCheckpoint',
			'ensureTurnCheckpoint',
		]) {
			assert.ok(hostDeclares(hostSrc, name), name);
		}
		assert.ok(repoFile('extensions/knox/src/core/tools/implementations/workspaceCheckpoint.ts').includes('extras.ide'));
	});
});
