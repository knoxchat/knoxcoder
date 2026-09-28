/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';

function repoFile(...parts: string[]): string {
	return readFileSync(join(process.cwd(), ...parts), 'utf8');
}

suite('Knox editor host contract (KN-340)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('accept/reject all and block commands keep the same ids and keybindings', () => {
		const pkg = JSON.parse(repoFile('extensions/knox/package.json')) as {
			contributes: {
				commands: Array<{ command: string }>;
				keybindings: Array<{ command: string; key: string; mac?: string; when?: string }>;
			};
		};
		const commands = pkg.contributes.commands.map(entry => entry.command);
		for (const id of [
			'knoxchat.acceptDiff',
			'knoxchat.rejectDiff',
			'knoxchat.acceptVerticalDiffBlock',
			'knoxchat.rejectVerticalDiffBlock',
		]) {
			assert.ok(commands.includes(id), id);
		}
		const keys = pkg.contributes.keybindings;
		assert.ok(keys.some(entry => entry.command === 'knoxchat.acceptDiff' && entry.mac === 'shift+cmd+enter' && entry.when === 'knoxchat.diffVisible'));
		assert.ok(keys.some(entry => entry.command === 'knoxchat.rejectDiff' && entry.mac === 'shift+cmd+backspace' && entry.when === 'knoxchat.diffVisible'));
		assert.ok(keys.some(entry => entry.command === 'knoxchat.acceptVerticalDiffBlock' && entry.mac === 'alt+cmd+y'));
		assert.ok(keys.some(entry => entry.command === 'knoxchat.rejectVerticalDiffBlock' && entry.mac === 'alt+cmd+n'));
	});

	test('vertical diffs drive workbench.knox.setAgentDiffDecorations including streaming index', () => {
		const decorations = repoFile('extensions/knox/src/host/diff/vertical/decorations.ts');
		const handler = repoFile('extensions/knox/src/host/diff/vertical/handler.ts');
		const manager = repoFile('extensions/knox/src/host/diff/vertical/manager.ts');
		const contributions = repoFile('src/vs/workbench/contrib/knox/browser/knox.contributions.ts');
		assert.ok(decorations.includes('WORKBENCH_DIFF_COMMAND = "workbench.knox.setAgentDiffDecorations"'));
		assert.ok(decorations.includes('applyIndexDecorations'));
		assert.ok(handler.includes('applyIndexDecorations'));
		assert.ok(handler.includes('isFileVisible(this.fileUri)'));
		assert.ok(handler.includes('findEditorForUri'));
		assert.ok(manager.includes('findEditorForUri'));
		assert.ok(manager.includes('clearWorkbenchAgentDiff'));
		assert.ok(manager.includes('acceptRejectVerticalDiffBlock'));
		assert.ok(contributions.includes('KNOX_WORKBENCH_DIFF_COMMAND'));
		assert.ok(contributions.includes('knoxAgentDiffPayloadIsEmpty'));
	});

	test('host commands map accept/reject to VerticalDiffManager', () => {
		const commands = repoFile('extensions/knox/src/host/commands.ts');
		assert.ok(commands.includes('"knoxchat.acceptDiff"'));
		assert.ok(commands.includes('"knoxchat.rejectDiff"'));
		assert.ok(commands.includes('"knoxchat.acceptVerticalDiffBlock"'));
		assert.ok(commands.includes('"knoxchat.rejectVerticalDiffBlock"'));
		assert.ok(commands.includes('acceptRejectVerticalDiffBlock(true'));
		assert.ok(commands.includes('acceptRejectVerticalDiffBlock(false'));
		assert.ok(commands.includes('processDiff'));
	});
});

suite('Knox editor host contract (KN-341)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('vertical, suggestion, and quick-action CodeLens commands keep the same ids', () => {
		const pkg = JSON.parse(repoFile('extensions/knox/package.json')) as {
			contributes: {
				commands: Array<{ command: string }>;
				configuration: { properties: Record<string, { default?: unknown }> };
			};
		};
		const commands = pkg.contributes.commands.map(entry => entry.command);
		for (const id of [
			'knoxchat.acceptVerticalDiffBlock',
			'knoxchat.rejectVerticalDiffBlock',
			'knoxchat.acceptSuggestion',
			'knoxchat.rejectSuggestion',
			'knoxchat.acceptAllSuggestions',
			'knoxchat.rejectAllSuggestions',
		]) {
			assert.ok(commands.includes(id), id);
		}
		assert.strictEqual(pkg.contributes.configuration.properties['knoxchat.enableQuickActions']?.default, false);
	});

	test('host registers CodeLens providers and suggestion/quick-action commands', () => {
		const register = repoFile('extensions/knox/src/host/lang-server/codeLens/registerAllCodeLensProviders.ts');
		const commands = repoFile('extensions/knox/src/host/commands.ts');
		const extension = repoFile('extensions/knox/src/host/extension/VsCodeExtension.ts');
		const suggestions = repoFile('extensions/knox/src/host/suggestions.ts');
		const specs = repoFile('extensions/knox/src/host/lang-server/codeLens/codeLensSpecs.ts');
		assert.ok(register.includes('VerticalPerLineCodeLensProvider'));
		assert.ok(register.includes('SuggestionsCodeLensProvider'));
		assert.ok(register.includes('QuickActionsCodeLensProvider'));
		assert.ok(register.includes('quickActionsEnabledStatus()'));
		assert.ok(register.includes('subscribeToVSCodeQuickActionsSettings'));
		assert.ok(commands.includes('"knoxchat.acceptSuggestion"'));
		assert.ok(commands.includes('"knoxchat.rejectSuggestion"'));
		assert.ok(commands.includes('"knoxchat.acceptAllSuggestions"'));
		assert.ok(commands.includes('"knoxchat.rejectAllSuggestions"'));
		assert.ok(commands.includes('"knoxchat.defaultQuickAction"'));
		assert.ok(commands.includes('"knoxchat.customQuickActionSendToChat"'));
		assert.ok(commands.includes('"knoxchat.customQuickActionStreamInlineEdit"'));
		assert.ok(extension.includes('bindCodeLensRefresh'));
		assert.ok(extension.includes('verticalDiffCodeLens.refresh.bind'));
		assert.ok(suggestions.includes('onDidChangeSuggestions'));
		assert.ok(suggestions.includes('notifySuggestionsChanged()'));
		assert.ok(specs.includes('ENABLE_QUICK_ACTIONS_SETTING = "knoxchat.enableQuickActions"'));
		assert.ok(specs.includes('verticalPerLineCodeLensSpecs'));
		assert.ok(specs.includes('suggestionCodeLensSpecs'));
		assert.ok(specs.includes('quickActionCodeLensSpecs'));
	});

	test('vertical diff handler shifts CodeLens blocks through the shared spec helper', () => {
		const handler = repoFile('extensions/knox/src/host/diff/vertical/handler.ts');
		assert.ok(handler.includes('shiftVerticalDiffCodeLensBlocks'));
		assert.ok(handler.includes('this.refreshCodeLens()'));
	});
});

suite('Knox editor host contract (KN-342)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('applyToFile is a first-class host path: shadow → applyCodeBlock → vertical diffs → updateApplyState', () => {
		const apply = repoFile('extensions/knox/src/host/diff/applyToFile.ts');
		const host = repoFile('extensions/knox/src/host/diff/applyToFileHost.ts');
		const messenger = repoFile('extensions/knox/src/host/extension/VsCodeMessenger.ts');
		const manager = repoFile('extensions/knox/src/host/diff/vertical/manager.ts');
		assert.ok(apply.includes('runApplyToFile'));
		assert.ok(apply.includes('shouldPreviewApply'));
		assert.ok(apply.includes('host.applyCodeBlock'));
		assert.ok(apply.includes('host.streamDiffLines'));
		assert.ok(apply.includes('host.streamEdit'));
		assert.ok(apply.includes('notifyApplyState'));
		assert.ok(apply.includes('streamingApplyState'));
		assert.ok(apply.includes('closedApplyState'));
		assert.ok(host.includes('createVsCodeApplyToFileHost'));
		assert.ok(host.includes('core/edit/lazy/applyCodeBlock'));
		assert.ok(host.includes('previewAndAwaitDecision'));
		assert.ok(host.includes('verticalDiffManager.streamDiffLines'));
		assert.ok(host.includes('verticalDiffManager.streamEdit'));
		assert.ok(host.includes('webviewProtocol.request("updateApplyState"'));
		assert.ok(messenger.includes('runApplyToFile'));
		assert.ok(messenger.includes('createVsCodeApplyToFileHost'));
		assert.ok(messenger.includes('this.onWebview("applyToFile"'));
		assert.ok(manager.includes('webviewProtocol.request("updateApplyState"'));
		assert.ok(manager.includes('streamDiffLines'));
		assert.ok(manager.includes('streamEdit'));
	});

	test('native GUI posts applyToFile and applies updateApplyState', () => {
		const markdown = repoFile('src/vs/workbench/contrib/knox/browser/gui/widget/markdown.ts');
		const inbound = repoFile('src/vs/workbench/contrib/knox/browser/gui/controller/inbound.ts');
		const protocol = repoFile('src/vs/workbench/contrib/knox/common/knoxGuiProtocol.ts');
		assert.ok(markdown.includes("post('applyToFile'"));
		assert.ok(inbound.includes("case 'updateApplyState'"));
		assert.ok(inbound.includes('applyStates'));
		assert.ok(protocol.includes("'applyToFile'"));
		assert.ok(protocol.includes("'updateApplyState'"));
	});
});

suite('Knox editor host contract (KN-343)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('shadow preview settings, Accept/Reject commands, and keybindings stay contributed', () => {
		const pkg = JSON.parse(repoFile('extensions/knox/package.json')) as {
			contributes: {
				commands: Array<{ command: string }>;
				keybindings: Array<{ command: string; key: string; mac?: string; when?: string }>;
				menus: { 'editor/title': Array<{ command: string; when?: string }> };
				configuration: { properties: Record<string, { default?: unknown }> };
			};
		};
		const settings = pkg.contributes.configuration.properties;
		assert.strictEqual(settings['knoxchat.enableShadowPreview']?.default, false);
		assert.strictEqual(settings['knoxchat.shadowPreviewLargeFiles']?.default, false);
		const commands = pkg.contributes.commands.map(entry => entry.command);
		for (const id of [
			'knox.acceptShadowChanges',
			'knox.rejectShadowChanges',
			'knox.applyShadowChanges',
			'knox.showDiffView',
		]) {
			assert.ok(commands.includes(id), id);
		}
		const keys = pkg.contributes.keybindings;
		assert.ok(keys.some(entry => entry.command === 'knox.applyShadowChanges' && entry.mac === 'cmd+shift+alt+s' && entry.when === 'knox.shadowDiffVisible'));
		assert.ok(keys.some(entry => entry.command === 'knox.rejectShadowChanges' && entry.mac === 'cmd+shift+alt+backspace' && entry.when === 'knox.shadowDiffVisible'));
		const title = pkg.contributes.menus['editor/title'];
		assert.ok(title.some(entry => entry.command === 'knox.acceptShadowChanges' && entry.when === 'knox.shadowDiffVisible'));
		assert.ok(title.some(entry => entry.command === 'knox.rejectShadowChanges' && entry.when === 'knox.shadowDiffVisible'));
	});

	test('host opens vscode.diff original|shadow and Accept/Reject skip >4000 lines unless large-files', () => {
		const helpers = repoFile('extensions/knox/src/host/agent/shadowWorkspace.ts');
		const manager = repoFile('extensions/knox/src/host/agent/ShadowWorkspaceManager.ts');
		const host = repoFile('extensions/knox/src/host/diff/applyToFileHost.ts');
		const apply = repoFile('extensions/knox/src/host/diff/applyToFile.ts');
		assert.ok(helpers.includes('SHADOW_PREVIEW_SETTING = "knoxchat.enableShadowPreview"'));
		assert.ok(helpers.includes('SHADOW_PREVIEW_LARGE_FILES_SETTING'));
		assert.ok(helpers.includes('SHADOW_LARGE_FILE_LINE_LIMIT = 4000'));
		assert.ok(helpers.includes('VSCODE_DIFF_COMMAND = "vscode.diff"'));
		assert.ok(helpers.includes('knox.acceptShadowChanges'));
		assert.ok(helpers.includes('knox.rejectShadowChanges'));
		assert.ok(helpers.includes('buildShadowDiffOpen'));
		assert.ok(helpers.includes('shouldPreviewApply'));
		assert.ok(helpers.includes('allowLargeFiles'));
		assert.ok(manager.includes('buildShadowDiffOpen'));
		assert.ok(manager.includes('SHADOW_PREVIEW_COMMANDS.accept'));
		assert.ok(manager.includes('SHADOW_PREVIEW_COMMANDS.reject'));
		assert.ok(manager.includes('diff.command'));
		assert.ok(manager.includes('diff.originalPath'));
		assert.ok(manager.includes('diff.shadowPath'));
		assert.ok(manager.includes('decideShadowAcceptRoute'));
		assert.ok(host.includes('isShadowPreviewEnabled'));
		assert.ok(host.includes('isShadowPreviewLargeFilesEnabled'));
		assert.ok(host.includes('previewAndAwaitDecision'));
		assert.ok(apply.includes('shouldPreviewApply'));
		assert.ok(apply.includes('kind: "shadow-preview"'));
	});
});

suite('Knox editor host contract (KN-344)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('knox.batch.* commands stay contributed and registered', () => {
		const pkg = JSON.parse(repoFile('extensions/knox/package.json')) as {
			contributes: {
				commands: Array<{ command: string }>;
				menus: { commandPalette: Array<{ command: string }> };
			};
		};
		const commands = pkg.contributes.commands.map(entry => entry.command);
		for (const id of [
			'knox.batch.show',
			'knox.batch.acceptAll',
			'knox.batch.rejectAll',
			'knox.batch.acceptSelected',
			'knox.batch.rejectSelected',
		]) {
			assert.ok(commands.includes(id), id);
		}
		assert.ok(pkg.contributes.menus.commandPalette.some(entry => entry.command === 'knox.batch.show'));
		const hostCommands = repoFile('extensions/knox/src/host/commands.ts');
		assert.ok(hostCommands.includes('BATCH_DIFF_COMMANDS.show'));
		assert.ok(hostCommands.includes('BATCH_DIFF_COMMANDS.acceptAll'));
		assert.ok(hostCommands.includes('BatchDiffView.createOrShow'));
		assert.ok(hostCommands.includes('batch.applyAll("accept")'));
		assert.ok(hostCommands.includes('batch.applySelected("reject"'));
	});

	test('leftover tree view is gone; createOrShow opens native /batch-diff', () => {
		const view = repoFile('extensions/knox/src/host/diff/batchDiff/BatchDiffView.ts');
		const engine = repoFile('extensions/knox/src/host/diff/batchDiff/batchDiff.ts');
		const extension = repoFile('extensions/knox/src/host/extension/VsCodeExtension.ts');
		const messenger = repoFile('extensions/knox/src/host/extension/VsCodeMessenger.ts');
		assert.ok(engine.includes('BATCH_DIFF_ROUTE = "/batch-diff"'));
		assert.ok(engine.includes('knox.batch.show'));
		assert.ok(engine.includes('batch/getPendingFiles'));
		assert.ok(view.includes('BATCH_DIFF_NAVIGATE_COMMAND'));
		assert.ok(view.includes('BATCH_DIFF_ROUTE'));
		assert.ok(view.includes('createOrShow'));
		assert.ok(!view.includes('createTreeView'));
		assert.ok(!view.includes('knox.batchDiffView'));
		assert.ok(extension.includes('BatchDiffManager.getInstance()'));
		assert.ok(extension.includes('setVerticalDiffManager'));
		assert.ok(messenger.includes('BATCH_DIFF_PROTOCOL.getPendingFiles'));
		assert.ok(messenger.includes('applyKind("acceptAll")'));
		assert.ok(messenger.includes('applyKind("rejectSelected"'));
	});

	test('native GUI /batch-diff loads pending files and posts batch/*', () => {
		const inbound = repoFile('src/vs/workbench/contrib/knox/browser/gui/controller/inbound.ts');
		const panels = repoFile('src/vs/workbench/contrib/knox/browser/gui/controller/panels.ts');
		const pages = repoFile('src/vs/workbench/contrib/knox/browser/gui/widget/pages.ts');
		const composer = repoFile('src/vs/workbench/contrib/knox/browser/gui/widget/composer.ts');
		const protocol = repoFile('src/vs/workbench/contrib/knox/common/knoxGuiProtocol.ts');
		assert.ok(inbound.includes("path === '/batch-diff'"));
		assert.ok(inbound.includes('loadPendingFiles'));
		assert.ok(panels.includes("'batch/getPendingFiles'"));
		assert.ok(panels.includes('`batch/${kind}`'));
		assert.ok(pages.includes("data-testid', 'knox-gui-batch-diff'"));
		assert.ok(pages.includes('applyBatchDiff'));
		assert.ok(pages.includes('item.filepath === file.filepath ? { ...item, selected: !item.selected }'));
		assert.ok(composer.includes("navigate('/batch-diff')"));
		assert.ok(composer.includes('knoxGuiShowsBatchDiffEntry'));
		assert.ok(protocol.includes("'batch/getPendingFiles'"));
		assert.ok(protocol.includes("'batch/acceptAll'"));
		assert.ok(protocol.includes("'batch/rejectSelected'"));
		assert.ok(protocol.includes("BatchDiff = 'batch-diff'"));
	});
});

suite('Knox editor host contract (KN-345)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('inline tip setting, hide command, and host wiring stay contributed', () => {
		const pkg = JSON.parse(repoFile('extensions/knox/package.json')) as {
			contributes: {
				configuration: { properties: Record<string, { default?: unknown }> };
			};
		};
		assert.strictEqual(pkg.contributes.configuration.properties['knoxchat.showInlineTip']?.default, true);
		assert.strictEqual(pkg.contributes.configuration.properties['knoxchat.disableQuickFix']?.default, false);

		const engine = repoFile('extensions/knox/src/host/activation/inlineTip.ts');
		const manager = repoFile('extensions/knox/src/host/activation/InlineTipManager.ts');
		const activate = repoFile('extensions/knox/src/host/activation/activate.ts');
		const commands = repoFile('extensions/knox/src/host/commands.ts');
		assert.ok(engine.includes('SHOW_INLINE_TIP_SETTING = "knoxchat.showInlineTip"'));
		assert.ok(engine.includes('HIDE_INLINE_TIP_COMMAND = "knoxchat.hideInlineTip"'));
		assert.ok(engine.includes('shouldRenderInlineTip'));
		assert.ok(engine.includes('calculateInlineTipPosition'));
		assert.ok(manager.includes('shouldRenderInlineTip'));
		assert.ok(manager.includes('calculateInlineTipPosition'));
		assert.ok(manager.includes('emptyFileTipText'));
		assert.ok(manager.includes('HIDE_INLINE_TIP_COMMAND'));
		assert.ok(activate.includes('setupInlineTips'));
		assert.ok(commands.includes('HIDE_INLINE_TIP_COMMAND'));
		assert.ok(commands.includes('SHOW_INLINE_TIP_SETTING'));
	});

	test('Ask Knox quick-fix posts highlightedCode with shouldRun and native chat submits', () => {
		const quickFix = repoFile('extensions/knox/src/host/lang-server/quickFix.ts');
		const codeActions = repoFile('extensions/knox/src/host/lang-server/codeActions.ts');
		const commands = repoFile('extensions/knox/src/host/commands.ts');
		const activate = repoFile('extensions/knox/src/host/activation/activate.ts');
		const inbound = repoFile('src/vs/workbench/contrib/knox/browser/gui/controller/inbound.ts');
		const composer = repoFile('src/vs/workbench/contrib/knox/browser/gui/controller/composer.ts');
		const protocol = repoFile('src/vs/workbench/contrib/knox/common/knoxGuiProtocol.ts');
		assert.ok(quickFix.includes('QUICK_FIX_COMMAND = "knoxchat.quickFix"'));
		assert.ok(quickFix.includes('QUICK_FIX_TITLE = "Ask Knox"'));
		assert.ok(quickFix.includes('HIGHLIGHTED_CODE_MESSAGE = "highlightedCode"'));
		assert.ok(quickFix.includes('shouldRun: true'));
		assert.ok(quickFix.includes('buildQuickFixChatRequest'));
		assert.ok(codeActions.includes('askKnoxQuickFixSpec'));
		assert.ok(codeActions.includes('quickFixSurroundingRange'));
		assert.ok(codeActions.includes('isQuickFixProviderEnabled'));
		assert.ok(commands.includes('QUICK_FIX_COMMAND'));
		assert.ok(commands.includes('buildQuickFixChatRequest'));
		assert.ok(commands.includes('HIGHLIGHTED_CODE_MESSAGE'));
		assert.ok(commands.includes('FOCUS_KNOX_GUI_COMMAND'));
		assert.ok(commands.includes('commands.errorExplain'));
		assert.ok(activate.includes('registerQuickFixProvider'));
		assert.ok(inbound.includes("case 'highlightedCode'"));
		assert.ok(inbound.includes('applyHighlightedCode'));
		assert.ok(composer.includes('rec.shouldRun'));
		assert.ok(composer.includes('controller.submit(undefined, { noContext: true })'));
		assert.ok(protocol.includes("'highlightedCode'"));
	});
});

suite('Knox editor host contract (KN-346)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('Cmd/Ctrl+I commands and Esc keybinding stay contributed', () => {
		const pkg = JSON.parse(repoFile('extensions/knox/package.json')) as {
			contributes: {
				commands: Array<{ command: string }>;
				keybindings: Array<{ command: string; key: string; mac?: string; when?: string }>;
			};
		};
		const commands = pkg.contributes.commands.map(entry => entry.command);
		assert.ok(commands.includes('knoxchat.focusEdit'));
		assert.ok(commands.includes('knoxchat.exitEditMode'));
		const keys = pkg.contributes.keybindings;
		assert.ok(keys.some(entry => entry.command === 'knoxchat.focusEdit' && entry.mac === 'cmd+i' && entry.key === 'ctrl+i'));
		assert.ok(keys.some(entry => entry.command === 'knoxchat.focusEditWithoutClear' && entry.mac === 'cmd+shift+i' && entry.key === 'ctrl+shift+i'));
		assert.ok(keys.some(entry => entry.command === 'knoxchat.exitEditMode' && entry.key === 'escape' && entry.when === 'knoxchat.inEditMode && editorFocus'));
	});

	test('host posts focusEdit / addCodeToEdit and native composer is the product path', () => {
		const engine = repoFile('extensions/knox/src/host/quickEdit/editMode.ts');
		const commands = repoFile('extensions/knox/src/host/commands.ts');
		const decorations = repoFile('extensions/knox/src/host/quickEdit/EditDecorationManager.ts');
		const messenger = repoFile('extensions/knox/src/host/extension/VsCodeMessenger.ts');
		const inbound = repoFile('src/vs/workbench/contrib/knox/browser/gui/controller/inbound.ts');
		const stream = repoFile('src/vs/workbench/contrib/knox/browser/gui/controller/stream.ts');
		const sessions = repoFile('src/vs/workbench/contrib/knox/browser/gui/controller/sessions.ts');
		const chrome = repoFile('src/vs/workbench/contrib/knox/browser/gui/widget/chrome.ts');
		const protocol = repoFile('src/vs/workbench/contrib/knox/common/knoxGuiProtocol.ts');
		assert.ok(engine.includes('FOCUS_EDIT_COMMAND = "knoxchat.focusEdit"'));
		assert.ok(engine.includes('ADD_CODE_TO_EDIT_MESSAGE = "addCodeToEdit"'));
		assert.ok(engine.includes('buildWholeLineEditRange'));
		assert.ok(commands.includes('FOCUS_EDIT_MESSAGE'));
		assert.ok(commands.includes('ADD_CODE_TO_EDIT_MESSAGE'));
		assert.ok(commands.includes('shouldSkipAddCodeToEdit'));
		assert.ok(decorations.includes('IN_EDIT_MODE_CONTEXT'));
		assert.ok(messenger.includes('edit/sendPrompt'));
		assert.ok(messenger.includes('edit/exit'));
		assert.ok(inbound.includes("case 'focusEdit'"));
		assert.ok(inbound.includes('enterEditMode({ clearSession: true })'));
		assert.ok(inbound.includes("case 'addCodeToEdit'"));
		assert.ok(inbound.includes("case 'exitEditMode'"));
		assert.ok(stream.includes("post('edit/sendPrompt'"));
		assert.ok(stream.includes('shouldSendEditPrompt'));
		assert.ok(sessions.includes('enterEditMode'));
		assert.ok(sessions.includes("post('edit/exit'"));
		assert.ok(chrome.includes("state.mode === 'edit'"));
		assert.ok(chrome.includes('exitEditMode()'));
		assert.ok(protocol.includes("'focusEdit'"));
		assert.ok(protocol.includes("'addCodeToEdit'"));
		assert.ok(protocol.includes("'edit/sendPrompt'"));
	});
});
