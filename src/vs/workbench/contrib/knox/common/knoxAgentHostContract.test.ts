/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { execFileSync } from 'child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { KNOX_AGENT_MODE_CONTEXT_KEY } from './knoxGuiAgentMode.js';
import { KNOX_GUI_HOST_INBOUND, KNOX_GUI_HOST_OUTBOUND, KNOX_GUI_HOST_OUTBOUND_UNUSED_IN_CHROME } from './knoxGuiProtocol.js';

function repoFile(...parts: string[]): string {
	return readFileSync(join(process.cwd(), ...parts), 'utf8');
}

function coreSources(): string {
	const dir = join(process.cwd(), 'extensions/knox/src/core/core');
	const files: string[] = [];
	const walk = (current: string) => {
		for (const name of readdirSync(current).sort()) {
			const path = join(current, name);
			if (statSync(path).isDirectory()) {
				walk(path);
			} else if (name.endsWith('.ts')) {
				files.push(readFileSync(path, 'utf8'));
			}
		}
	};
	walk(dir);
	return files.join('\n');
}

/** A `widget/<name>.ts` barrel plus every implementation module in `widget/<name>/*.ts`. */
function widgetBarrelSource(name: string): string {
	const dir = `src/vs/workbench/contrib/knox/browser/gui/widget/${name}`;
	return [
		repoFile(`${dir}.ts`),
		...readdirSync(join(process.cwd(), dir)).filter(file => file.endsWith('.ts')).sort().map(file => repoFile(dir, file)),
	].join('\n');
}

/** `widget/composer.ts` is a barrel; its implementation lives in `widget/composer/*.ts`. */
function widgetComposerSource(): string {
	return widgetBarrelSource('composer');
}

/** `widget/checkpoints.ts` is a barrel; its implementation lives in `widget/checkpoints/*.ts`. */
function widgetCheckpointsSource(): string {
	return widgetBarrelSource('checkpoints');
}

/** `widget/memory.ts` is a barrel; its implementation lives in `widget/memory/*.ts`. */
function widgetMemorySource(): string {
	return widgetBarrelSource('memory');
}

/** A git-ignored directory is a local reference checkout, not part of the tree. */
function isGitIgnored(target: string): boolean {
	try {
		execFileSync('git', ['check-ignore', '-q', target], { cwd: process.cwd(), stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
}

suite('Knox agent host contract (KN-350)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('AgentModeManager is one switch with GUI session.mode and knoxAgentModeActive', () => {
		const pkg = JSON.parse(repoFile('extensions/knox/package.json')) as {
			contributes: {
				commands: Array<{ command: string }>;
				keybindings: Array<{ command: string; key: string; mac?: string; when?: string }>;
			};
		};
		const commands = pkg.contributes.commands.map(entry => entry.command);
		assert.ok(commands.includes('knox.toggleAgentMode'));
		const keys = pkg.contributes.keybindings;
		assert.ok(keys.some(entry => entry.command === 'knox.toggleAgentMode' && entry.mac === 'cmd+shift+alt+a'));
		assert.ok(keys.some(entry => entry.when?.includes(KNOX_AGENT_MODE_CONTEXT_KEY) && entry.command === 'knox.undoLastOperation'));
		assert.ok(keys.some(entry => entry.when?.includes(KNOX_AGENT_MODE_CONTEXT_KEY) && entry.command === 'knox.redoLastOperation'));

		const manager = repoFile('extensions/knox/src/host/agent/AgentModeManager.ts');
		const status = repoFile('extensions/knox/src/host/agent/agentModeStatus.ts');
		const messenger = repoFile('extensions/knox/src/host/extension/VsCodeMessenger.ts');
		const activate = repoFile('extensions/knox/src/host/agent/index.ts');
		const inbound = repoFile('src/vs/workbench/contrib/knox/browser/gui/controller/inbound.ts');
		const models = repoFile('src/vs/workbench/contrib/knox/browser/gui/controller/models.ts');
		const protocol = repoFile('src/vs/workbench/contrib/knox/common/knoxGuiProtocol.ts');
		assert.ok(status.includes('AGENT_MODE_CONTEXT_KEY = "knoxAgentModeActive"'));
		assert.ok(manager.includes('onActiveChanged'));
		assert.ok(manager.includes('AGENT_MODE_CONTEXT_KEY'));
		assert.ok(manager.includes('setActive'));
		assert.ok(messenger.includes('onActiveChanged'));
		assert.ok(messenger.includes('agentModeChanged'));
		assert.ok(messenger.includes('"setAgentMode"'));
		assert.ok(activate.includes('AGENT_MODE_CONTEXT_KEY'));
		assert.ok(!activate.includes('onStatusChanged'));
		assert.ok(inbound.includes("case 'agentModeChanged'"));
		assert.ok(!inbound.includes("case 'setAgentMode'"));
		assert.ok(models.includes('postSetAgentMode'));
		assert.ok(models.includes('syncAgentTabWithModel'));
		assert.ok(protocol.includes("'setAgentMode'"));
		assert.ok(protocol.includes("'agentModeChanged'"));
	});
});

suite('Knox agent host contract (KN-351)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('file-byte undo/redo commands, keybindings, and QuickPick stay contributed', () => {
		const pkg = JSON.parse(repoFile('extensions/knox/package.json')) as {
			contributes: {
				commands: Array<{ command: string }>;
				keybindings: Array<{ command: string; key: string; mac?: string; when?: string }>;
			};
		};
		const commands = pkg.contributes.commands.map(entry => entry.command);
		for (const id of [
			'knox.enhancedUndo',
			'knox.enhancedRedo',
			'knox.undoLastOperation',
			'knox.redoLastOperation',
			'knox.showOperationHistory',
			'knox.clearOperationHistory',
		]) {
			assert.ok(commands.includes(id), id);
		}
		const keys = pkg.contributes.keybindings;
		assert.ok(keys.some(entry =>
			entry.command === 'knox.undoLastOperation'
			&& entry.mac === 'cmd+shift+alt+z'
			&& entry.when === 'knoxAgentModeActive && knoxCanUndo'));
		assert.ok(keys.some(entry =>
			entry.command === 'knox.redoLastOperation'
			&& entry.mac === 'cmd+shift+alt+y'
			&& entry.when === 'knoxAgentModeActive && knoxCanRedo'));

		const engine = repoFile('extensions/knox/src/host/agent/operationHistory.ts');
		const history = repoFile('extensions/knox/src/host/agent/CommandHistoryService.ts');
		const manager = repoFile('extensions/knox/src/host/agent/AgentModeManager.ts');
		const mutating = repoFile('extensions/knox/src/host/agent/mutatingToolUndo.ts');
		const snapshots = repoFile('extensions/knox/src/host/agent/fileSnapshots.ts');
		const activate = repoFile('extensions/knox/src/host/agent/index.ts');
		const ide = repoFile('extensions/knox/src/host/VsCodeIde.ts');
		assert.ok(engine.includes('ENHANCED_UNDO_COMMAND = "knox.enhancedUndo"'));
		assert.ok(engine.includes('SHOW_OPERATION_HISTORY_COMMAND = "knox.showOperationHistory"'));
		assert.ok(engine.includes('KNOX_CAN_UNDO_CONTEXT_KEY = "knoxCanUndo"'));
		assert.ok(engine.includes('class OperationHistoryStack'));
		assert.ok(engine.includes('buildOperationHistoryPickItems'));
		assert.ok(engine.includes('operationHistoryInspectPayload'));
		assert.ok(history.includes('ENHANCED_UNDO_COMMAND'));
		assert.ok(history.includes('showQuickPick'));
		assert.ok(history.includes('restoreFileSnapshot'));
		assert.ok(history.includes('recordManualMutation'));
		assert.ok(manager.includes('ENHANCED_UNDO_COMMAND'));
		assert.ok(manager.includes('UNDO_LAST_OPERATION_COMMAND'));
		assert.ok(manager.includes('undoLastOperation'));
		assert.ok(mutating.includes('recordManualMutation'));
		assert.ok(mutating.includes('captureMutatingToolBefore'));
		assert.ok(snapshots.includes('builtin_edit_file'));
		assert.ok(snapshots.includes('builtin_apply_patch'));
		assert.ok(activate.includes('CommandHistoryService.getInstance()'));
		assert.ok(ide.includes('captureMutatingToolBefore'));
		assert.ok(ide.includes('recordMutatingToolAfter'));
	});
});

suite('Knox agent host contract (KN-352)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('DiagnosticChecker / DiagnosticFixManager commands stay contributed', () => {
		const pkg = JSON.parse(repoFile('extensions/knox/package.json')) as {
			contributes: {
				commands: Array<{ command: string }>;
			};
		};
		const commands = pkg.contributes.commands.map(entry => entry.command);
		assert.ok(commands.includes('knox.checkDiagnostics'));
		assert.ok(commands.includes('knox.fixDiagnostics'));

		const engine = repoFile('extensions/knox/src/host/agent/diagnostics.ts');
		const checker = repoFile('extensions/knox/src/host/agent/DiagnosticChecker.ts');
		const fixer = repoFile('extensions/knox/src/host/agent/DiagnosticFixManager.ts');
		const activate = repoFile('extensions/knox/src/host/agent/index.ts');
		const coordinator = repoFile('extensions/knox/src/host/agent/ChatFlowCoordinator.ts');
		const verification = repoFile('extensions/knox/src/host/agent/VerificationService.ts');
		assert.ok(engine.includes('CHECK_DIAGNOSTICS_COMMAND = "knox.checkDiagnostics"'));
		assert.ok(engine.includes('FIX_DIAGNOSTICS_COMMAND = "knox.fixDiagnostics"'));
		assert.ok(engine.includes('LLM_COMPLETE_COMMAND = "knox.llmComplete"'));
		assert.ok(engine.includes('class DiagnosticCache'));
		assert.ok(engine.includes('class FixAttemptTracker'));
		assert.ok(engine.includes('buildFixPrompt'));
		assert.ok(engine.includes('sanitizeLlmFixOutput'));
		assert.ok(engine.includes('MAX_FIX_ATTEMPTS = 3'));
		assert.ok(checker.includes('toDiagnosticIssue'));
		assert.ok(checker.includes('DiagnosticCache'));
		assert.ok(fixer.includes('buildFixPrompt'));
		assert.ok(fixer.includes('sanitizeLlmFixOutput'));
		assert.ok(fixer.includes('FixAttemptTracker'));
		assert.ok(fixer.includes('LLM_COMPLETE_COMMAND'));
		assert.ok(activate.includes('CHECK_DIAGNOSTICS_COMMAND'));
		assert.ok(activate.includes('FIX_DIAGNOSTICS_COMMAND'));
		assert.ok(activate.includes('DiagnosticChecker.getInstance()'));
		assert.ok(activate.includes('DiagnosticFixManager.getInstance()'));
		assert.ok(activate.includes('resolveDiagnosticUri'));
		assert.ok(activate.includes('resolveFixDiagnosticsArgs'));
		assert.ok(coordinator.includes('owned by activateAgentMode (KN-352)'));
		assert.ok(!/this\.diagnosticChecker\.dispose\(\)/.test(coordinator));
		assert.ok(!/this\.diagnosticFixManager\.dispose\(\)/.test(coordinator));
		assert.ok(verification.includes('diagnosticChecker.checkFile'));
		assert.ok(verification.includes('checkAndFixDiagnostics'));
	});
});

suite('Knox agent host contract (KN-353)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('DebugIntegrationService helpers + DAP tracker for @debugger stay wired', () => {
		const pkg = JSON.parse(repoFile('extensions/knox/package.json')) as {
			contributes: {
				commands: Array<{ command: string }>;
			};
		};
		const commands = pkg.contributes.commands.map(entry => entry.command);
		assert.ok(commands.includes('knox.analyzeDebugSession'));
		assert.ok(commands.includes('knox.suggestFixForError'));
		assert.ok(commands.includes('knox.addIntelligentBreakpoint'));

		const engine = repoFile('extensions/knox/src/host/agent/debugIntegration.ts');
		const service = repoFile('extensions/knox/src/host/agent/DebugIntegrationService.ts');
		const activate = repoFile('extensions/knox/src/host/agent/index.ts');
		const tracker = repoFile('extensions/knox/src/host/debug/debug.ts');
		const trackerLogic = repoFile('extensions/knox/src/host/debug/debugTrackerLogic.ts');
		const ideUtils = repoFile('extensions/knox/src/host/util/ideUtils.ts');
		const host = repoFile('extensions/knox/src/host/extension/VsCodeExtension.ts');
		const inbound = repoFile('src/vs/workbench/contrib/knox/browser/gui/controller/inbound.ts');
		const protocol = repoFile('src/vs/workbench/contrib/knox/common/knoxGuiProtocol.ts');
		const provider = repoFile('extensions/knox/src/core/context/providers/DebugLocalsProvider.ts');
		const defaults = repoFile('extensions/knox/src/core/context/providers/defaultProviders.ts');
		const builtinDebug = repoFile('extensions/knox/src/core/tools/implementations/debug.ts');
		assert.ok(engine.includes('ANALYZE_DEBUG_SESSION_COMMAND = "knox.analyzeDebugSession"'));
		assert.ok(engine.includes('SUGGEST_FIX_FOR_ERROR_COMMAND = "knox.suggestFixForError"'));
		assert.ok(engine.includes('ADD_INTELLIGENT_BREAKPOINT_COMMAND = "knox.addIntelligentBreakpoint"'));
		assert.ok(engine.includes('parseAnalysisResult'));
		assert.ok(engine.includes('parseBreakpointSuggestions'));
		assert.ok(engine.includes('buildAnalyzeSessionPrompt'));
		assert.ok(engine.includes('Distinct from Agent `builtin_debug`'));
		assert.ok(service.includes('LLM_COMPLETE_COMMAND'));
		assert.ok(service.includes('preferredDebugThreadId'));
		assert.ok(service.includes('KN-353'));
		assert.ok(!service.includes('analyze_debug_session'));
		assert.ok(!service.includes("registerCommand('knox.analyzeDebugSession'"));
		assert.ok(activate.includes('ANALYZE_DEBUG_SESSION_COMMAND'));
		assert.ok(activate.includes('SUGGEST_FIX_FOR_ERROR_COMMAND'));
		assert.ok(activate.includes('ADD_INTELLIGENT_BREAKPOINT_COMMAND'));
		assert.ok(activate.includes('DebugIntegrationService.getInstance()'));
		assert.ok(activate.includes('resolveIntelligentBreakpointPath'));
		assert.ok(trackerLogic.includes('DEBUGGER_CONTEXT_PROVIDER = "debugger"'));
		assert.ok(trackerLogic.includes('filterPausedThreads'));
		assert.ok(trackerLogic.includes('preferredDebugThreadId'));
		assert.ok(tracker.includes('debuggerSubmenuRefreshPayload'));
		assert.ok(tracker.includes('webviewProtocol?.send("refreshSubmenuItems"'));
		assert.ok(!tracker.includes('webviewProtocol?.request("refreshSubmenuItems"'));
		assert.ok(host.includes('registerDebugTracker'));
		assert.ok(host.includes('paused debug threads for @debugger'));
		assert.ok(ideUtils.includes('filterPausedThreads'));
		assert.ok(inbound.includes("case 'refreshSubmenuItems'"));
		assert.ok(protocol.includes("'refreshSubmenuItems'"));
		assert.ok(provider.includes('DEBUGGER_CONTEXT_PROVIDER_TITLE'));
		assert.ok(provider.includes('formatDebuggerContext'));
		assert.ok(defaults.includes('"debugger"'));
		assert.ok(defaults.includes('DebugLocalsProvider'));
		assert.ok(builtinDebug.includes('debugControl') || builtinDebug.includes('builtin_debug'));
	});
});

suite('Knox agent host contract (KN-354)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('Screenshot capture sends addImageAttachment to native chat', () => {
		const pkg = JSON.parse(repoFile('extensions/knox/package.json')) as {
			contributes: {
				commands: Array<{ command: string }>;
			};
		};
		const commands = pkg.contributes.commands.map(entry => entry.command);
		assert.ok(commands.includes('knox.captureScreenshot'));

		const engine = repoFile('extensions/knox/src/host/agent/screenshot.ts');
		const service = repoFile('extensions/knox/src/host/agent/ScreenshotService.ts');
		const activate = repoFile('extensions/knox/src/host/agent/index.ts');
		const host = repoFile('extensions/knox/src/host/extension/VsCodeExtension.ts');
		const inbound = repoFile('src/vs/workbench/contrib/knox/browser/gui/controller/inbound.ts');
		const protocol = repoFile('src/vs/workbench/contrib/knox/common/knoxGuiProtocol.ts');
		const i18nEn = repoFile('extensions/knox/src/host/i18n/locales/en/ui.json');
		const i18nZh = repoFile('extensions/knox/src/host/i18n/locales/zh/ui.json');
		assert.ok(engine.includes('CAPTURE_SCREENSHOT_COMMAND = "knox.captureScreenshot"'));
		assert.ok(engine.includes('SEND_TO_WEBVIEW_COMMAND = "knox.sendToWebview"'));
		assert.ok(engine.includes('ADD_IMAGE_ATTACHMENT_MESSAGE = "addImageAttachment"'));
		assert.ok(engine.includes('addImageAttachmentPayload'));
		assert.ok(engine.includes('screenshotCapturePlan'));
		assert.ok(engine.includes('screencapture'));
		assert.ok(engine.includes('gnome-screenshot'));
		assert.ok(service.includes('KN-354'));
		assert.ok(service.includes('SEND_TO_WEBVIEW_COMMAND'));
		assert.ok(service.includes('captureAndSend'));
		assert.ok(service.includes('screenshotResultFromFile'));
		assert.ok(!/registerCommand/.test(service));
		assert.ok(activate.includes('CAPTURE_SCREENSHOT_COMMAND'));
		assert.ok(activate.includes('ScreenshotService.getInstance()'));
		assert.ok(activate.includes('captureAndSend'));
		assert.ok(host.includes("registerCommand('knox.sendToWebview'"));
		assert.ok(host.includes('KN-354'));
		assert.ok(/case 'addImageAttachment':[\s\S]*?inputFocused: true/.test(inbound));
		assert.ok(protocol.includes("'addImageAttachment'"));
		assert.ok(i18nEn.includes('"screenshot.captured"'));
		assert.ok(i18nZh.includes('"screenshot.captured"'));
	});
});

suite('Knox agent host contract (KN-355)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('RefactoringService LSP rename / extract via llm/complete stays contributed', () => {
		const pkg = JSON.parse(repoFile('extensions/knox/package.json')) as {
			contributes: {
				commands: Array<{ command: string }>;
			};
		};
		const commands = pkg.contributes.commands.map(entry => entry.command);
		for (const id of [
			'knox.renameSymbol',
			'knox.extractMethod',
			'knox.moveFile',
			'knox.extractInterface',
		]) {
			assert.ok(commands.includes(id), id);
		}

		const engine = repoFile('extensions/knox/src/host/agent/refactoring.ts');
		const service = repoFile('extensions/knox/src/host/agent/RefactoringService.ts');
		const activate = repoFile('extensions/knox/src/host/agent/index.ts');
		const host = repoFile('extensions/knox/src/host/extension/VsCodeExtension.ts');
		assert.ok(engine.includes('RENAME_SYMBOL_COMMAND = "knox.renameSymbol"'));
		assert.ok(engine.includes('EXTRACT_METHOD_COMMAND = "knox.extractMethod"'));
		assert.ok(engine.includes('MOVE_FILE_COMMAND = "knox.moveFile"'));
		assert.ok(engine.includes('EXTRACT_INTERFACE_COMMAND = "knox.extractInterface"'));
		assert.ok(engine.includes('buildExtractMethodPrompt'));
		assert.ok(engine.includes('buildExtractInterfacePrompt'));
		assert.ok(engine.includes('LLM_COMPLETE_COMMAND'));
		assert.ok(engine.includes('builtin_plan'));
		assert.ok(service.includes('KN-355'));
		assert.ok(service.includes('LLM_COMPLETE_COMMAND'));
		assert.ok(service.includes('vscode.executeDocumentRenameProvider'));
		assert.ok(service.includes('buildExtractMethodPrompt'));
		assert.ok(service.includes('parseExtractInterfaceResult'));
		assert.ok(!/registerCommand/.test(service));
		assert.ok(activate.includes('RENAME_SYMBOL_COMMAND'));
		assert.ok(activate.includes('EXTRACT_METHOD_COMMAND'));
		assert.ok(activate.includes('MOVE_FILE_COMMAND'));
		assert.ok(activate.includes('EXTRACT_INTERFACE_COMMAND'));
		assert.ok(activate.includes('RefactoringService.getInstance()'));
		assert.ok(activate.includes('resolveRenameArgs'));
		assert.ok(activate.includes('resolveExtractMethodArgs'));
		assert.ok(host.includes("registerCommand('knox.llmComplete'"));
	});
});

suite('Knox agent host contract (KN-360)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('KnoxChat OAuth2 PKCE, loopback, SecretStorage, and native oauth messages', () => {
		const controller = repoFile('extensions/knox/src/host/oauth/KnoxOAuthController.ts');
		const persist = repoFile('extensions/knox/src/host/oauth/knoxOAuthPersistence.ts');
		const messenger = repoFile('extensions/knox/src/host/extension/VsCodeMessenger.ts');
		const client = repoFile('extensions/knox/src/core/auth/knoxOAuth/client.ts');
		const pkce = repoFile('extensions/knox/src/core/auth/knoxOAuth/pkce.ts');
		const loopback = repoFile('extensions/knox/src/core/auth/knoxOAuth/loopback.ts');
		const constants = repoFile('extensions/knox/src/core/auth/knoxOAuth/constants.ts');
		const inbound = repoFile('src/vs/workbench/contrib/knox/browser/gui/controller/inbound.ts');
		const models = repoFile('src/vs/workbench/contrib/knox/browser/gui/controller/models.ts');
		const pages = repoFile('src/vs/workbench/contrib/knox/browser/gui/widget/pages.ts');
		const protocol = repoFile('src/vs/workbench/contrib/knox/common/knoxGuiProtocol.ts');
		const overlays = repoFile('src/vs/workbench/contrib/knox/common/knoxGuiOverlays.ts');
		assert.ok(controller.includes('KN-360'));
		assert.ok(controller.includes('vscode.env.openExternal'));
		assert.ok(controller.includes('persistKnoxOAuthSession'));
		assert.ok(controller.includes('restoreKnoxOAuthPersisted'));
		assert.ok(persist.includes('storage.API_KEY_ITEM'));
		assert.ok(persist.includes('storage.REFRESH_TOKEN_ITEM'));
		assert.ok(persist.includes('KNOX_OAUTH_UPDATE_MESSAGE = "knoxchat/oauth/update"'));
		assert.ok(messenger.includes('"knoxchat/oauth/status"'));
		assert.ok(messenger.includes('"knoxchat/oauth/start"'));
		assert.ok(messenger.includes('"knoxchat/oauth/cancel"'));
		assert.ok(messenger.includes('"knoxchat/oauth/signOut"'));
		assert.ok(messenger.includes('void knoxOAuth.startLogin()'));
		assert.ok(client.includes('generateAuthorizationSecrets'));
		assert.ok(client.includes('waitForLoopbackCallback'));
		assert.ok(pkce.includes('S256') || pkce.includes('s256Challenge'));
		assert.ok(loopback.includes('LOOPBACK_PORT'));
		assert.ok(loopback.includes('127.0.0.1'));
		assert.ok(constants.includes('http://127.0.0.1:8733/callback'));
		assert.ok(constants.includes('knoxchat_oauth_api_key'));
		assert.ok(inbound.includes("case 'knoxchat/oauth/update'"));
		assert.ok(models.includes('parseKnoxOAuthStatus'));
		assert.ok(pages.includes('knoxchat/oauth/start'));
		assert.ok(pages.includes('knoxGuiOAuthErrorI18nKey'));
		assert.ok(protocol.includes("'knoxchat/oauth/update'"));
		assert.ok(overlays.includes('oauthErrorDenied'));
	});
});

suite('Knox agent host contract (OpenRouter OAuth)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('OpenRouter PKCE URL, port 8734, SecretStorage, protocol, and GUI start button', () => {
		const controller = repoFile('extensions/knox/src/host/oauth/OpenRouterOAuthController.ts');
		const persist = repoFile('extensions/knox/src/host/oauth/openrouterOAuthPersistence.ts');
		const messenger = repoFile('extensions/knox/src/host/extension/VsCodeMessenger.ts');
		const client = repoFile('extensions/knox/src/core/auth/openrouterOAuth/client.ts');
		const http = repoFile('extensions/knox/src/core/auth/openrouterOAuth/http.ts');
		const constants = repoFile('extensions/knox/src/core/auth/openrouterOAuth/constants.ts');
		const inbound = repoFile('src/vs/workbench/contrib/knox/browser/gui/controller/inbound.ts');
		const models = repoFile('src/vs/workbench/contrib/knox/browser/gui/controller/models.ts');
		const pages = repoFile('src/vs/workbench/contrib/knox/browser/gui/widget/pages.ts');
		const protocol = repoFile('src/vs/workbench/contrib/knox/common/knoxGuiProtocol.ts');
		const overlays = repoFile('src/vs/workbench/contrib/knox/common/knoxGuiOverlays.ts');
		assert.ok(constants.includes('http://127.0.0.1:8734/callback'));
		assert.ok(constants.includes('LOOPBACK_PORT = 8734'));
		assert.ok(constants.includes('openrouter_oauth_api_key'));
		assert.ok(constants.includes('https://openrouter.ai/auth'));
		assert.ok(http.includes('hashOpenRouterApiKey'));
		assert.ok(http.includes('buildAuthorizeUrl'));
		assert.ok(client.includes('waitForLoopbackCallback'));
		assert.ok(client.includes('keyHash'));
		assert.ok(client.includes('logoutOpenRouter'));
		assert.ok(client.includes('deleteKeyEndpoint'));
		assert.ok(constants.includes('deleteKeyEndpoint'));
		assert.ok(constants.includes('/keys/'));
		assert.ok(controller.includes('logoutOpenRouter'));
		assert.ok(persist.includes('OPENROUTER_OAUTH_UPDATE_MESSAGE = "openrouter/oauth/update"'));
		assert.ok(controller.includes('persistOpenRouterOAuthSession'));
		assert.ok(messenger.includes('"openrouter/oauth/status"'));
		assert.ok(messenger.includes('"openrouter/oauth/start"'));
		assert.ok(messenger.includes('"openrouter/oauth/cancel"'));
		assert.ok(messenger.includes('"openrouter/oauth/signOut"'));
		assert.ok(messenger.includes('void openrouterOAuth.startLogin()'));
		assert.ok(inbound.includes("case 'openrouter/oauth/update'"));
		assert.ok(models.includes('parseOpenRouterOAuthStatus'));
		assert.ok(pages.includes('openrouter/oauth/start'));
		assert.ok(pages.includes('signInOpenRouter'));
		assert.ok(pages.includes('knox-gui-openrouter-sign-in'));
		assert.ok(pages.includes('addModelModalProvider'));
		assert.ok(pages.includes('knox-gui-add-model-provider-${id}'));
		assert.ok(pages.includes('manageKey'));
		assert.ok(protocol.includes("'openrouter/oauth/update'"));
		assert.ok(protocol.includes("'openrouter/listModels'"));
		assert.ok(overlays.includes("id: 'openrouter'"));
		assert.ok(overlays.includes('https://openrouter.ai/keys/'));
		assert.ok(overlays.includes('oauthErrorOpenRouterExchange'));
	});
});

suite('Knox agent host contract (KN-361)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('CORS proxy is unused after native GUI and is deleted', () => {
		assert.ok(!existsSync(join(process.cwd(), 'extensions/knox/src/host/activation/proxy.ts')));
		const constants = repoFile('extensions/knox/src/core/llm/constants.ts');
		assert.ok(!constants.includes('PROXY_URL'));
		assert.ok(!constants.includes('65433'));
		const webviewHtml = repoFile('extensions/knox/src/host/webviewHtml.ts');
		assert.ok(!webviewHtml.includes('65433'));
		assert.ok(!webviewHtml.includes('x-knox-url'));
		const activate = repoFile('extensions/knox/src/host/activation/activate.ts');
		assert.ok(!activate.includes('startProxy'));
		const pkg = JSON.parse(repoFile('extensions/knox/package.json')) as {
			dependencies: Record<string, string>;
		};
		assert.ok(!pkg.dependencies.cors);
		assert.ok(!pkg.dependencies.express);
		const messenger = repoFile('src/vs/workbench/contrib/knox/browser/knoxGuiMessenger.ts');
		const service = repoFile('src/vs/workbench/contrib/knox/common/knoxService.ts');
		assert.ok(!messenger.includes('x-knox-url'));
		assert.ok(!messenger.includes('65433'));
		assert.ok(!service.includes('x-knox-url'));
		assert.ok(!service.includes('65433'));
	});
});

suite('Knox agent host contract (KN-362)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('vscode.lm vendor knox and textModelApiTools route to Core tools/call', () => {
		const pkg = JSON.parse(repoFile('extensions/knox/package.json')) as {
			contributes: {
				textModelApiAssistProviders?: Array<{ vendor: string }>;
				textModelApiTools?: Array<{ name: string }>;
			};
		};
		assert.ok(pkg.contributes.textModelApiAssistProviders?.some(provider => provider.vendor === 'knox'));
		const toolNames = (pkg.contributes.textModelApiTools ?? []).map(tool => tool.name);
		assert.ok(toolNames.includes('builtin_read_file'));
		assert.ok(toolNames.includes('builtin_edit_file'));

		const bridge = repoFile('extensions/knox/src/host/lm/knoxLmBridge.ts');
		const tools = repoFile('extensions/knox/src/host/lm/registerLmTools.ts');
		const provider = repoFile('extensions/knox/src/host/lm/knoxAssistProvider.ts');
		const features = repoFile('extensions/knox/src/host/lm/registerLanguageModelFeatures.ts');
		const extHost = repoFile('src/vs/workbench/api/common/extHostLanguageModels.ts');
		assert.ok(bridge.includes('KN-362'));
		assert.ok(bridge.includes('KNOX_LM_VENDOR = "knox"'));
		assert.ok(bridge.includes('KNOX_LM_EXECUTE_TOOL_CALL_COMMAND = "knox.executeToolCall"'));
		assert.ok(bridge.includes('KNOX_LM_TOOLS_CALL_MESSAGE = "tools/call"'));
		assert.ok(bridge.includes('buildToolsCallRequest'));
		assert.ok(tools.includes('KN-362'));
		assert.ok(tools.includes('KNOX_LM_EXECUTE_TOOL_CALL_COMMAND'));
		assert.ok(tools.includes('toolsCallInvocation'));
		assert.ok(provider.includes('KNOX_LM_VENDOR'));
		assert.ok(provider.includes('completionOptionsForLmRequest'));
		assert.ok(provider.includes('lmMessagesToChatMessages'));
		assert.ok(features.includes('KN-362'));
		assert.ok(extHost.includes('serializeAssistOptions'));
		assert.ok(extHost.includes('options?.tools'));
	});
});

suite('Knox agent host contract (KN-363)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('optional inline completions stay off by default and register only when enabled', () => {
		const pkg = JSON.parse(repoFile('extensions/knox/package.json')) as {
			contributes: {
				configuration?: {
					properties?: Record<string, { default?: unknown; type?: string }>;
				};
			};
		};
		const setting = pkg.contributes.configuration?.properties?.['knoxchat.enableInlineCompletions'];
		assert.ok(setting);
		assert.strictEqual(setting?.type, 'boolean');
		assert.strictEqual(setting?.default, false);

		const engine = repoFile('extensions/knox/src/host/lm/knoxInlineCompletion.ts');
		const provider = repoFile('extensions/knox/src/host/lm/knoxInlineCompletionProvider.ts');
		const features = repoFile('extensions/knox/src/host/lm/registerLanguageModelFeatures.ts');
		assert.ok(engine.includes('KN-363'));
		assert.ok(engine.includes('ENABLE_INLINE_COMPLETIONS_SETTING = "knoxchat.enableInlineCompletions"'));
		assert.ok(engine.includes('ENABLE_INLINE_COMPLETIONS_DEFAULT = false'));
		assert.ok(engine.includes('buildFimPrompt'));
		assert.ok(engine.includes('sanitizeCompletion'));
		assert.ok(engine.includes('shouldProvideInlineCompletion'));
		assert.ok(engine.includes('pickInlineCompletionModel'));
		assert.ok(provider.includes('KN-363'));
		assert.ok(provider.includes('ENABLE_INLINE_COMPLETIONS_SETTING'));
		assert.ok(provider.includes('registerInlineCompletionItemProvider'));
		assert.ok(provider.includes('affectsConfiguration(ENABLE_INLINE_COMPLETIONS_SETTING)'));
		assert.ok(features.includes('KN-363'));
		assert.ok(features.includes('registerKnoxInlineCompletions'));
	});
});

suite('Knox agent host contract (KN-365)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('Remote-SSH ui+workspace, native addons on the remote, no browser field', () => {
		const pkg = JSON.parse(repoFile('extensions/knox/package.json')) as {
			main?: string;
			browser?: string;
			extensionKind?: string[];
		};
		assert.strictEqual(pkg.browser, undefined);
		assert.ok(pkg.main?.includes('extension'));
		assert.deepStrictEqual(pkg.extensionKind, ['ui', 'workspace']);

		const remote = repoFile('extensions/knox/src/host/activation/remoteNativeAddons.ts');
		const install = repoFile('extensions/knox/src/host/activation/installRemoteNativeAddons.ts');
		const activate = repoFile('extensions/knox/src/host/activation/activate.ts');
		const extension = repoFile('extensions/knox/src/host/extension.ts');
		const copyNative = repoFile('extensions/knox/scripts/copy-native.mts');
		const buildExt = repoFile('build/lib/extensions.ts');
		const readme = repoFile('extensions/knox/README.md');
		const i18nEn = repoFile('extensions/knox/src/host/i18n/locales/en/extension.json');
		const i18nZh = repoFile('extensions/knox/src/host/i18n/locales/zh/extension.json');

		assert.ok(remote.includes('KN-365'));
		assert.ok(remote.includes('KNOX_EXTENSION_KIND = ["ui", "workspace"]'));
		assert.ok(remote.includes('sqlite3BindingRelPaths'));
		assert.ok(remote.includes('ripgrepBinaryRelPaths'));
		assert.ok(remote.includes('nodePtyModuleRelPaths'));
		assert.ok(remote.includes('abort-web'));
		assert.ok(install.includes('installRemoteNativeAddons'));
		assert.ok(install.includes('ext.remoteNativeMissing'));
		assert.ok(activate.includes('installRemoteNativeAddons(context)'));
		assert.ok(extension.includes('isKnoxWebHost'));
		assert.ok(extension.includes('ext.desktopOnly'));
		assert.ok(copyNative.includes('KN-365'));
		assert.ok(copyNative.includes('Remote-SSH'));
		assert.ok(buildExt.includes("'knox'"));
		assert.ok(buildExt.includes('desktopOnlyExtensions'));
		assert.ok(readme.includes('extensionKind'));
		assert.ok(readme.includes('browser'));
		assert.ok(i18nEn.includes('ext.desktopOnly'));
		assert.ok(i18nEn.includes('ext.remoteNativeMissing'));
		assert.ok(i18nZh.includes('ext.desktopOnly'));
		assert.ok(i18nZh.includes('ext.remoteNativeMissing'));
	});
});

suite('Knox agent host contract (KN-364)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('public KnoxAPI getAPI(1) matches knox.d.ts Git-style export', () => {
		const dts = repoFile('extensions/knox/src/api/knox.d.ts');
		const impl = repoFile('extensions/knox/src/host/activation/KnoxExtensionImpl.ts');
		const api = repoFile('extensions/knox/src/host/activation/api.ts');
		const helpers = repoFile('extensions/knox/src/host/activation/knoxPublicApi.ts');
		const commands = repoFile('extensions/knox/src/host/commands.ts');
		const activate = repoFile('extensions/knox/src/host/activation/activate.ts');
		const readme = repoFile('extensions/knox/README.md');
		const tsconfig = repoFile('extensions/knox/tsconfig.json');

		assert.ok(dts.includes('getAPI(version: 1): API'));
		assert.ok(dts.includes('openChat(options?: OpenChatOptions)'));
		assert.ok(dts.includes('newSession(): Thenable<void>'));
		assert.ok(dts.includes('toggleAgentMode(): Thenable<void>'));
		assert.ok(dts.includes('executeToolCall(toolCall: ToolCall'));
		assert.ok(dts.includes('handleGuiMessage(message: KnoxGuiMessage)'));
		assert.ok(dts.includes('registerCustomContextProvider(provider: CustomContextProvider)'));
		assert.ok(dts.includes('readonly onDidChangeAgentMode: Event<boolean>'));
		assert.ok(dts.includes('readonly onDidReceiveGuiMessage: Event<KnoxGuiMessage>'));
		assert.ok(dts.includes("extensions.getExtension<KnoxExtension>('vscode.knox')"));

		assert.ok(impl.includes('KN-364'));
		assert.ok(impl.includes('implements KnoxExtension'));
		assert.ok(impl.includes('from "../../api/knox"'));
		assert.ok(impl.includes('assertKnoxApiVersion(version)'));
		// Original activate.ts exports shape stays available beside getAPI(1).
		assert.ok(impl.includes('readonly registerCustomContextProvider ='));
		assert.ok(impl.includes('readonly agentMode = {'));
		assert.ok(impl.includes('isAgentModeActive: ()') && impl.includes('toggleAgentMode: ()') && impl.includes('executeToolCall: ('));
		assert.ok(api.includes('KN-364'));
		assert.ok(api.includes('class KnoxApiImpl implements API'));
		assert.ok(api.includes('wrapCustomContextProvider'));
		assert.ok(api.includes('toCoreToolCall'));
		assert.ok(helpers.includes('KNOX_API_VERSION = 1'));
		assert.ok(helpers.includes('planOpenChat'));
		assert.ok(helpers.includes('wrapCustomContextProvider'));
		assert.ok(commands.includes('planOpenChat(options)'));
		assert.ok(commands.includes('KNOX_SEND_USER_INPUT_MESSAGE'));
		assert.ok(activate.includes('new KnoxExtensionImpl(vscodeExtension)'));
		assert.ok(readme.includes('Copy `src/api/knox.d.ts`'));
		assert.ok(readme.includes("getExtension<KnoxExtension>('vscode.knox')"));
		assert.ok(tsconfig.includes('"src/api/**/*"'));
	});
});

suite('Knox agent host contract (KN-370)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('native GUI consumes setTheme/setColors and host pushes them without a webview', () => {
		const inbound = repoFile('src/vs/workbench/contrib/knox/browser/gui/controller/inbound.ts');
		const theme = repoFile('src/vs/workbench/contrib/knox/common/knoxGuiTheme.ts');
		const protocol = repoFile('src/vs/workbench/contrib/knox/common/knoxGuiProtocol.ts');
		const provider = repoFile('extensions/knox/src/host/KnoxGUIWebviewViewProvider.ts');
		const hostTheme = repoFile('extensions/knox/src/host/util/guiTheme.ts');
		assert.ok(inbound.includes('KN-370'));
		assert.ok(inbound.includes("case 'setTheme'"));
		assert.ok(inbound.includes("case 'setColors'"));
		assert.ok(inbound.includes('applyKnoxGuiSetTheme'));
		assert.ok(inbound.includes('applyKnoxGuiSetColors'));
		assert.ok(!inbound.includes('store.patch({})'));
		assert.ok(theme.includes('constructHljsTheme'));
		assert.ok(theme.includes('HLJS_TO_TEXTMATE'));
		assert.ok(theme.includes('applyKnoxGuiThemeToElement'));
		assert.ok(protocol.includes("'setTheme'"));
		assert.ok(protocol.includes("'setColors'"));
		assert.ok(provider.includes('KN-370'));
		assert.ok(provider.includes('pushGuiTheme'));
		assert.ok(provider.includes('onDidChangeActiveColorTheme'));
		assert.ok(provider.includes('send("setTheme"'));
		assert.ok(provider.includes('send("setColors"'));
		assert.ok(hostTheme.includes('GUI_THEME_CONFIG_KEYS'));
		assert.ok(hostTheme.includes('colorsFromConvertedTheme'));
	});
});

suite('Knox agent host contract (KN-371)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('native GUI tools support is wired to the KN-253 /v1/models cache', () => {
		const capabilities = repoFile('src/vs/workbench/contrib/knox/common/knoxGuiCapabilities.ts');
		const messenger = repoFile('extensions/knox/src/host/extension/VsCodeMessenger.ts');
		const models = repoFile('src/vs/workbench/contrib/knox/browser/gui/controller/models.ts');
		const config = repoFile('src/vs/workbench/contrib/knox/browser/gui/controller/config.ts');
		assert.ok(capabilities.includes('KN-371'));
		assert.ok(capabilities.includes('knoxGuiSeedModelCatalog'));
		assert.ok(!capabilities.includes("['knoxchat', 'openai', 'anthropic']"));
		assert.ok(messenger.includes('getKnoxChatModels'));
		assert.ok(messenger.includes('getOpenRouterModels'));
		assert.ok(models.includes('knoxGuiParseModelCatalog'));
		assert.ok(models.includes('loadOpenRouterModels'));
		assert.ok(config.includes('loadKnoxChatModels'));
	});
});

suite('Knox agent host contract (S-14)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('native stats page only shows the KnoxChat billing note', () => {
		const inbound = repoFile('src/vs/workbench/contrib/knox/browser/gui/controller/inbound.ts');
		const pages = repoFile('src/vs/workbench/contrib/knox/browser/gui/widget/pages.ts');
		assert.ok(!inbound.includes('stats/getTokensPerDay'));
		assert.ok(!pages.includes('statsDaily'));
		assert.ok(pages.includes('tokenUsageKnoxChatBilling'));
	});
});

suite('Knox agent host contract (KN-373)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('native tool cards cover ToolCallDiv kinds without an xterm dependency', () => {
		const tools = repoFile('src/vs/workbench/contrib/knox/browser/gui/widget/tools.ts');
		const chat = repoFile('src/vs/workbench/contrib/knox/common/knoxGuiChat.ts');
		const helpers = repoFile('src/vs/workbench/contrib/knox/common/knoxGuiTools.ts');
		const controller = repoFile('src/vs/workbench/contrib/knox/browser/gui/controller/tools.ts');
		assert.ok(tools.includes('KN-373') || tools.includes('renderTerminalTool'));
		assert.ok(tools.includes('export function renderTerminalTool'));
		assert.ok(tools.includes('export function renderExactSearchTool'));
		assert.ok(tools.includes('export function renderRepoMapTool'));
		assert.ok(tools.includes('export function renderAskUser'));
		assert.ok(tools.includes('export function renderTaskSubagent'));
		assert.ok(tools.includes('export function renderCreateFileTool'));
		assert.ok(tools.includes('takeTerminalTail'));
		assert.ok(!tools.includes('@xterm'));
		assert.ok(chat.includes("n === 'exact_search'"));
		assert.ok(!chat.includes("n === 'glob' || n === 'search_web'"));
		assert.ok(helpers.includes('parseAskUserQuestionsForGui'));
		assert.ok(helpers.includes('repoMapFileAnsiColor'));
		assert.ok(helpers.includes('displayBuildCommand'));
		assert.ok(controller.includes('parsedArgs: parsed'));
		assert.ok(controller.includes('answers'));
	});
});

suite('Knox agent host contract (KN-374)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('native composer wires @ mentions, slash builtins, image drop, history, and code-to-edit chips', () => {
		const input = repoFile('src/vs/workbench/contrib/knox/common/knoxGuiInput.ts');
		const composer = repoFile('src/vs/workbench/contrib/knox/browser/gui/controller/composer.ts');
		const stream = repoFile('src/vs/workbench/contrib/knox/browser/gui/controller/stream.ts');
		const config = repoFile('src/vs/workbench/contrib/knox/browser/gui/controller/config.ts');
		const widget = widgetComposerSource();
		const panels = repoFile('src/vs/workbench/contrib/knox/browser/gui/widget/panels.ts');
		const defaults = repoFile('extensions/knox/src/core/context/providers/defaultProviders.ts');
		const slash = repoFile('extensions/knox/src/core/commands/slash/index.ts');
		assert.ok(input.includes('KN-300'));
		assert.ok(input.includes('KN-304'));
		assert.ok(input.includes("DEFAULT_MENTION_PROVIDER_TITLES = ['file', 'diff', 'problems', 'repo-map', 'terminal', 'memory']"));
		assert.ok(input.includes('mergeContextProvidersWithDefaults'));
		assert.ok(input.includes('mergeSlashCommandsWithBuiltins'));
		assert.ok(input.includes('resolveComposerSlashCommand'));
		assert.ok(composer.includes('KN-374'));
		assert.ok(composer.includes('mergeContextProvidersWithDefaults'));
		assert.ok(composer.includes('mergeSlashCommandsWithBuiltins'));
		assert.ok(stream.includes('resolveComposerSlashCommand'));
		assert.ok(stream.includes('legacySlashCommandData: legacySlash'));
		assert.ok(stream.includes('expandPromptSlashCommand'));
		assert.ok(config.includes('mergeSlashCommandsWithBuiltins(slashCommands)'));
		assert.ok(config.includes('mergeContextProvidersWithDefaults(contextProviders)'));
		assert.ok(widget.includes('KN-374'));
		assert.ok(widget.includes('isDroppedImageFile'));
		assert.ok(widget.includes('stepInputHistory'));
		assert.ok(widget.includes('knox-gui-mention-chip'));
		assert.ok(widget.includes('knox-gui-slash-chip'));
		assert.ok(widget.includes('knox-gui-code-to-edit'));
		assert.ok(widget.includes('knox-gui-drop-overlay'));
		assert.ok(panels.includes('knox-gui-code-to-edit-chip'));
		assert.ok(defaults.includes('"file"'));
		assert.ok(defaults.includes('"memory"'));
		assert.ok(slash.includes('from "./autonomous"'));
		assert.ok(slash.includes('from "./skills"'));
	});
});

suite('Knox agent host contract (KN-375)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('native checkpoint overlay wires restore preview, Pierre word diffs, analysis, dashboard, and branches to KN-320–330', () => {
		const protocol = repoFile('src/vs/workbench/contrib/knox/common/knoxGuiProtocol.ts');
		const helpers = repoFile('src/vs/workbench/contrib/knox/common/knoxGuiCheckpoints.ts');
		const controller = repoFile('src/vs/workbench/contrib/knox/browser/gui/controller/checkpoints.ts');
		const widget = widgetCheckpointsSource();
		const graph = repoFile('src/vs/workbench/contrib/knox/browser/gui/widget/checkpointGraph.ts');
		const hostMessenger = repoFile('extensions/knox/src/host/extension/VsCodeMessenger.ts');
		const hostManager = repoFile('extensions/knox/src/host/checkpoints/manager/CheckpointManager.ts');
		assert.ok(helpers.includes('CHECKPOINT_DASHBOARD_HISTORY_DAYS = 30'));
		assert.ok(helpers.includes('hunkWordAltRanges'));
		assert.ok(helpers.includes('parseRestorePreview'));
		assert.ok(helpers.includes('parsePerformanceDashboard'));
		assert.ok(helpers.includes('parseCheckpointAnalysis'));
		assert.ok(helpers.includes('parseSuggestedCheckpointGroups'));
		assert.ok(protocol.includes("'previewRestore'"));
		assert.ok(protocol.includes("'computeCheckpointDiff'"));
		assert.ok(protocol.includes("'getPerformanceDashboard'"));
		assert.ok(protocol.includes("'analyzeCheckpoint'"));
		assert.ok(protocol.includes("'suggestCheckpointGroups'"));
		assert.ok(protocol.includes("'createCheckpointBranch'"));
		assert.ok(protocol.includes("'switchCheckpointBranch'"));
		assert.ok(controller.includes('KN-375'));
		assert.ok(controller.includes('historyDays: CHECKPOINT_DASHBOARD_HISTORY_DAYS'));
		assert.ok(controller.includes("request('previewRestore'"));
		assert.ok(controller.includes("request('analyzeCheckpoint'"));
		assert.ok(controller.includes("request('suggestCheckpointGroups'"));
		assert.ok(controller.includes("request<Record<string, unknown>>('createCheckpointBranch'"));
		assert.ok(controller.includes("request('switchCheckpointBranch'"));
		assert.ok(widget.includes('KN-375'));
		assert.ok(widget.includes('pierre-diff-container'));
		assert.ok(widget.includes('knox-gui-diff-word-alt'));
		assert.ok(widget.includes('knox-gui-checkpoint-dashboard'));
		assert.ok(widget.includes('knox-gui-checkpoint-analysis'));
		assert.ok(graph.includes('createCheckpointBranch'));
		assert.ok(graph.includes('switchCheckpointBranch'));
		assert.ok(graph.includes('mergeCheckpointBranches'));
		assert.ok(hostMessenger.includes('"previewRestore"'));
		assert.ok(hostMessenger.includes('"getPerformanceDashboard"'));
		assert.ok(hostMessenger.includes('"analyzeCheckpoint"'));
		assert.ok(hostMessenger.includes('"suggestCheckpointGroups"'));
		assert.ok(hostMessenger.includes('"createCheckpointBranch"'));
		assert.ok(hostManager.includes('previewRestore'));
		assert.ok(hostManager.includes('getPerformanceDashboard'));
		assert.ok(hostManager.includes('analyzeCheckpoint'));
	});
});

suite('Knox agent host contract (KN-376)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('native Memory panel wires 5 tabs to KN-310–317 brain/* handlers', () => {
		const helpers = repoFile('src/vs/workbench/contrib/knox/common/knoxGuiMemory.ts');
		const controller = repoFile('src/vs/workbench/contrib/knox/browser/gui/controller/memory.ts');
		const widget = widgetMemorySource();
		const overlays = repoFile('src/vs/workbench/contrib/knox/common/knoxGuiOverlays.ts');
		const protocol = repoFile('src/vs/workbench/contrib/knox/common/knoxGuiProtocol.ts');
		const core = coreSources();
		const store = repoFile('extensions/knox/src/core/context/memory/brain/store/state.ts');
		const hierarchy = repoFile('extensions/knox/src/core/context/memory/brain/MemoryHierarchy.ts');
		const sanitizer = repoFile('extensions/knox/src/core/context/memory/brain/InputSanitizer.ts');
		assert.ok(overlays.includes("MEMORY_TAB_IDS = ['overview', 'memories', 'sessions', 'graph', 'settings']"));
		assert.ok(helpers.includes('MEMORY_RETRIEVAL_THRESHOLD = 0.6'));
		assert.ok(helpers.includes('MEMORY_RETRIEVAL_TOP_K = 20'));
		assert.ok(helpers.includes('MEMORY_PANEL_TAB_BRAIN_MESSAGES'));
		assert.ok(helpers.includes('parseMemoryDashboard'));
		assert.ok(helpers.includes('parseExploreResult'));
		assert.ok(protocol.includes("'brain/dashboard'"));
		assert.ok(protocol.includes("'brain/searchMemories'"));
		assert.ok(protocol.includes("'brain/listSessions'"));
		assert.ok(protocol.includes("'brain/exploreGraph'"));
		assert.ok(protocol.includes("'brain/heal'"));
		assert.ok(controller.includes('KN-376'));
		assert.ok(controller.includes("request<Record<string, unknown>>('brain/dashboard'"));
		assert.ok(controller.includes("request<Record<string, unknown>>('brain/searchMemories'"));
		assert.ok(controller.includes("request<Record<string, unknown>>('brain/listSessions'"));
		assert.ok(controller.includes("request<Record<string, unknown>>('brain/exploreGraph'"));
		assert.ok(controller.includes("request<Record<string, unknown>>('brain/getConfig'"));
		assert.ok(controller.includes("'brain/export'"));
		assert.ok(controller.includes("'brain/import'"));
		assert.ok(controller.includes("'brain/heal'"));
		assert.ok(widget.includes('KN-376'));
		assert.ok(widget.includes('knox-gui-memory-tab-'));
		assert.ok(widget.includes('knox-gui-memory-overview'));
		assert.ok(widget.includes('knox-gui-memory-browser'));
		assert.ok(widget.includes('knox-gui-memory-sessions'));
		assert.ok(widget.includes('knox-gui-memory-graph'));
		assert.ok(widget.includes('knox-gui-memory-settings'));
		assert.ok(widget.includes('runMemoryMaintenance'));
		assert.ok(widget.includes('exportMemory'));
		assert.ok(core.includes('on("brain/dashboard"'));
		assert.ok(core.includes('on("brain/searchMemories"'));
		assert.ok(core.includes('on("brain/listSessions"'));
		assert.ok(core.includes('on("brain/exploreGraph"'));
		assert.ok(core.includes('on("brain/heal"'));
		assert.ok(store.includes('retrieval_threshold: 0.6'));
		assert.ok(store.includes('retrieval_top_k: 20'));
		assert.ok(hierarchy.includes('"M1"'));
		assert.ok(hierarchy.includes('"M5"'));
		assert.ok(sanitizer.includes('credential_leak'));
		assert.ok(repoFile('extensions/knox/src/host/checkpoints/notifyRestore.ts').includes('rewindMemory'));
	});
});

suite('Knox agent host contract (KN-377)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('native find-in-chat, session tabs, fatal banner, and composer accept/reject-all stay wired', () => {
		const actions = repoFile('src/vs/workbench/contrib/knox/browser/knoxGuiActions.ts');
		const pane = repoFile('src/vs/workbench/contrib/knox/browser/knoxChatViewPane.ts');
		const chrome = repoFile('src/vs/workbench/contrib/knox/browser/gui/widget/chrome.ts');
		const composer = widgetComposerSource();
		const stream = repoFile('src/vs/workbench/contrib/knox/browser/gui/controller/stream.ts');
		const sessions = repoFile('src/vs/workbench/contrib/knox/browser/gui/controller/sessions.ts');
		const widget = repoFile('src/vs/workbench/contrib/knox/browser/gui/knoxGuiWidget.ts');
		const helpers = repoFile('src/vs/workbench/contrib/knox/common/knoxGuiChrome.ts');
		assert.ok(actions.includes("id: 'workbench.action.knox.findInChat'"));
		assert.ok(actions.includes('KeyMod.CtrlCmd | KeyCode.KeyF'));
		assert.ok(!actions.includes('KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyF'));
		assert.ok(pane.includes('focusFind'));
		assert.ok(chrome.includes('KN-377'));
		assert.ok(chrome.includes('knox-gui-find'));
		assert.ok(chrome.includes('knox-gui-tabs'));
		assert.ok(chrome.includes('knox-gui-fatal'));
		assert.ok(chrome.includes("role', 'tablist'"));
		assert.ok(composer.includes('KN-377'));
		assert.ok(composer.includes('knox-gui-accept-reject-all'));
		assert.ok(composer.includes('acceptAllApplies'));
		assert.ok(composer.includes('rejectAllApplies'));
		assert.ok(stream.includes('KN-377'));
		assert.ok(stream.includes("post('acceptDiff'"));
		assert.ok(stream.includes('exitEditMode'));
		assert.ok(sessions.includes('KN-377'));
		assert.ok(sessions.includes('activateTab'));
		assert.ok(sessions.includes('closeTab'));
		assert.ok(widget.includes('knoxGuiShowsFatalBanner'));
		assert.ok(widget.includes('knoxGuiShowsSessionTabs'));
		assert.ok(helpers.includes('knoxGuiShowsSessionTabs'));
		assert.ok(helpers.includes('knoxGuiShowsFatalBanner'));
		assert.ok(helpers.includes('knoxGuiShowsComposerAcceptReject'));
		assert.ok(helpers.includes("'acceptRejectAll'"));
	});
});

suite('Knox agent host contract (KN-378)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('unused chrome leftovers are dropped; Core/host handlers stay for non-chrome callers', () => {
		const protocol = repoFile('src/vs/workbench/contrib/knox/common/knoxGuiProtocol.ts');
		const chrome = [
			repoFile('src/vs/workbench/contrib/knox/browser/gui/controller/config.ts'),
			repoFile('src/vs/workbench/contrib/knox/browser/gui/controller/inbound.ts'),
			repoFile('src/vs/workbench/contrib/knox/browser/gui/controller/stream.ts'),
			repoFile('src/vs/workbench/contrib/knox/browser/gui/controller/sessions.ts'),
			repoFile('src/vs/workbench/contrib/knox/browser/gui/controller/composer.ts'),
			repoFile('src/vs/workbench/contrib/knox/browser/gui/widget/chrome.ts'),
			widgetComposerSource(),
			repoFile('src/vs/workbench/contrib/knox/browser/gui/widget/overlays.ts'),
			repoFile('src/vs/workbench/contrib/knox/browser/gui/widget/pages.ts'),
			repoFile('src/vs/workbench/contrib/knox/common/knoxGuiMemory.ts'),
		].join('\n');
		const core = coreSources();
		const messenger = repoFile('extensions/knox/src/host/extension/VsCodeMessenger.ts');
		assert.ok(protocol.includes('KN-378'));
		assert.deepStrictEqual([...KNOX_GUI_HOST_OUTBOUND_UNUSED_IN_CHROME], []);
		for (const dropped of ['config/reload', 'overwriteFile', 'memory/create', 'memory/search', 'memory/delete', 'memory/list', 'memory/cleanup', 'brain/forgetMemories', 'brain/stats'] as const) {
			assert.ok(!(KNOX_GUI_HOST_OUTBOUND as readonly string[]).includes(dropped), dropped);
			assert.ok(!chrome.includes(`'${dropped}'`) && !chrome.includes(`"${dropped}"`), dropped);
		}
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('config/getSerializedProfileInfo'));
		assert.ok(KNOX_GUI_HOST_INBOUND.includes('configUpdate'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('applyToFile'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('restoreCheckpoint'));
		assert.ok(KNOX_GUI_HOST_OUTBOUND.includes('brain/searchMemories'));
		assert.ok(core.includes('on("config/reload"'));
		assert.ok(core.includes('on("memory/create"'));
		assert.ok(core.includes('on("memory/search"'));
		assert.ok(core.includes('on("memory/delete"'));
		assert.ok(core.includes('on("memory/list"'));
		assert.ok(core.includes('on("memory/cleanup"'));
		assert.ok(core.includes('on("brain/searchMemories"'));
		assert.ok(core.includes('on("brain/deleteMemory"'));
		assert.ok(messenger.includes('"overwriteFile"'));
		assert.ok(messenger.includes('"applyToFile"'));
		assert.ok(chrome.includes("config/getSerializedProfileInfo"));
		assert.ok(chrome.includes('configUpdate') || chrome.includes("'configUpdate'"));
		assert.ok(chrome.includes('brain/searchMemories'));
	});

	test('KP-059 every outbound catalog name has a browser/gui caller', () => {
		const guiDir = join(process.cwd(), 'src/vs/workbench/contrib/knox/browser/gui');
		const files: string[] = [];
		const walk = (dir: string) => {
			for (const name of readdirSync(dir)) {
				const path = join(dir, name);
				if (statSync(path).isDirectory()) {
					walk(path);
				} else if (name.endsWith('.ts')) {
					files.push(path);
				}
			}
		};
		walk(guiDir);
		const source = files.map(path => readFileSync(path, 'utf8')).join('\n');
		const templated = new Set([...source.matchAll(/`([a-zA-Z0-9]+)\/\$\{/g)].map(match => `${match[1]}/`));
		const unused = [...KNOX_GUI_HOST_OUTBOUND].filter(name => {
			if (source.includes(`'${name}'`) || source.includes(`"${name}"`)) {
				return false;
			}
			return ![...templated].some(prefix => name.startsWith(prefix));
		});
		assert.deepStrictEqual(unused, []);
	});

	test('KP-041 Vite localhost is gone; KP-043 typo command is not contributed', () => {
		assert.ok(!repoFile('extensions/knox/src/host/webviewHtml.ts').includes('localhost:5173'));
		const pkg = JSON.parse(repoFile('extensions/knox/package.json')) as {
			contributes?: { commands?: Array<{ command?: string }>; views?: { knoxchat?: Array<{ id?: string }> }; keybindings?: Array<{ command?: string }> };
		};
		assert.ok(!(pkg.contributes?.commands ?? []).some(entry => entry.command === 'knox.chatoLastOperation'));
		assert.ok(!(pkg.contributes?.keybindings ?? []).some(entry => entry.command === 'knoxchat.quickEditHistoryUp' || entry.command === 'knoxchat.quickEditHistoryDown'));
		assert.ok((pkg.contributes?.views?.knoxchat ?? []).some(entry => entry.id === 'knoxchat.knoxGUIView'));
		const viewsPoint = repoFile('src/vs/workbench/api/browser/viewsExtensionPoint.ts');
		assert.ok(viewsPoint.includes('KnoxChatViewPane'));
		assert.ok(viewsPoint.includes('KNOX_VIEW_ID'));
	});
});

suite('Knox agent host contract (KN-380)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('eval harness (golden / systems / rust / honesty) lives on the new tree and stays scripted', () => {
		const evalDir = 'extensions/knox/src/core/eval';
		const harness = repoFile(evalDir, 'harness.ts');
		const honesty = repoFile(evalDir, 'honestyGate.test.ts');
		const readme = repoFile(evalDir, 'README.md');
		const pkg = repoFile('extensions/knox/package.json');
		const corePkg = repoFile('extensions/knox/src/core/package.json');
		const vitest = repoFile('extensions/knox/src/core/vitest.config.ts');
		assert.ok(existsSync(join(process.cwd(), evalDir, 'goldenTasks.test.ts')));
		assert.ok(existsSync(join(process.cwd(), evalDir, 'systemsTasks.test.ts')));
		assert.ok(existsSync(join(process.cwd(), evalDir, 'rustTasks.test.ts')));
		assert.ok(existsSync(join(process.cwd(), evalDir, 'honestyGate.test.ts')));
		assert.ok(existsSync(join(process.cwd(), evalDir, 'fixtures/mini-c/Makefile')));
		assert.ok(existsSync(join(process.cwd(), evalDir, 'fixtures/mini-rust/Cargo.toml')));
		assert.ok(harness.includes('KN-380'));
		assert.ok(harness.includes('createScriptedLlm'));
		assert.ok(harness.includes('eval-scripted'));
		assert.ok(harness.includes('export async function runAgentEval'));
		assert.ok(!harness.includes('api.knoxstudio.ai'));
		assert.ok(honesty.includes('createScriptedLlm'));
		assert.ok(honesty.includes('extensions/knox/src/host/agent/README.md'));
		assert.ok(!honesty.includes('extensions/vscode/src/agent/README.md'));
		assert.ok(readme.includes('npm run test:eval'));
		assert.ok(readme.includes('extensions/knox'));
		assert.ok(!readme.includes('cd core\n'));
		assert.ok(pkg.includes('"test:eval"'));
		assert.ok(corePkg.includes('file:../pkg'));
		assert.ok(vitest.includes('eval/**/*.test.ts'));
		assert.ok(vitest.includes('knoxdev-package/config-yaml'));
		assert.ok(repoFile('.github/pull_request_template.md').includes('callTool'));
		assert.ok(repoFile('.github/pull_request_template.md').includes('SmartToolRouter'));
	});
});

suite('Knox agent host contract (KN-381)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('host + core i18n use separate instances, sync language, and keep native GUI keys in parity', () => {
		const coreI18n = repoFile('extensions/knox/src/core/i18n/index.ts');
		const hostI18n = repoFile('extensions/knox/src/host/i18n/index.ts');
		const parityTest = repoFile('extensions/knox/src/core/i18n/localeParity.test.ts');
		const guiI18n = repoFile('src/vs/workbench/contrib/knox/browser/gui/knoxGuiI18n.ts');
		const guiParity = repoFile('src/vs/workbench/contrib/knox/browser/knoxGuiParity.test.ts');
		assert.ok(coreI18n.includes('KN-381'));
		assert.ok(coreI18n.includes('createInstance()'));
		assert.ok(hostI18n.includes('KN-381'));
		assert.ok(hostI18n.includes('createInstance()'));
		assert.ok(hostI18n.includes('switchCoreLanguage'));
		assert.ok(hostI18n.includes('from "core/i18n"'));
		assert.ok(parityTest.includes('host/i18n/locales/en'));
		assert.ok(parityTest.includes('host/agent'));
		assert.ok(parityTest.includes('host/checkpoints'));
		assert.ok(!parityTest.includes('extensions/vscode/src/i18n'));
		assert.ok(!parityTest.includes('gui/src/locales'));
		assert.ok(parityTest.includes('browser/gui/i18n'));
		assert.ok(parityTest.includes('compareGuiLocaleModules'));
		assert.ok(existsSync(join(process.cwd(), 'src/vs/workbench/contrib/knox/browser/gui/i18n/en/common.ts')));
		assert.ok(existsSync(join(process.cwd(), 'src/vs/workbench/contrib/knox/browser/gui/i18n/zh/tools.ts')));
		assert.ok(existsSync(join(process.cwd(), 'extensions/knox/src/core/i18n/locales/en/core.json')));
		assert.ok(existsSync(join(process.cwd(), 'extensions/knox/src/core/i18n/locales/zh/core.json')));
		assert.ok(existsSync(join(process.cwd(), 'extensions/knox/src/host/i18n/locales/en/extension.json')));
		assert.ok(existsSync(join(process.cwd(), 'extensions/knox/src/host/i18n/locales/zh/extension.json')));
		assert.ok(existsSync(join(process.cwd(), 'extensions/knox/package.nls.json')));
		assert.ok(existsSync(join(process.cwd(), 'extensions/knox/package.nls.zh-cn.json')));
		assert.ok(guiI18n.includes('knoxGuiLocaleKeys'));
		assert.ok(guiParity.includes('KN-381'));
		assert.ok(guiParity.includes('knoxGuiLocaleKeys'));
	});
});

suite('Knox agent host contract (KN-382)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('knoxchat.* and knox.checkpoints.* setting ids stay in extensions/knox/package.json', () => {
		const catalog = repoFile('extensions/knox/src/core/config/settingIds.ts');
		const identity = repoFile('extensions/knox/src/core/config/extensionName.ts');
		const vitest = repoFile('extensions/knox/src/core/config/settingIds.test.ts');
		const hostParity = repoFile('extensions/knox/src/host/nativeParity/settingsIdsParity.test.ts');
		assert.ok(catalog.includes('KN-382'));
		assert.ok(catalog.includes('KNOX_CHAT_SETTING_IDS'));
		assert.ok(catalog.includes('KNOX_CHECKPOINT_SETTING_IDS'));
		assert.ok(catalog.includes('KNOX_SYNC_KEYBINDING_COMMANDS'));
		assert.ok(identity.includes('knoxchat'));
		assert.ok(vitest.includes('KN-382'));
		assert.ok(hostParity.includes('KN-382'));

		const pkg = JSON.parse(repoFile('extensions/knox/package.json')) as {
			contributes?: {
				configuration?: { properties?: Record<string, unknown> };
				keybindings?: Array<{ command?: string }>;
			};
		};
		const contributed = Object.keys(pkg.contributes?.configuration?.properties ?? {})
			.filter(id => id.startsWith('knoxchat.') || id.startsWith('knox.checkpoints.'))
			.sort();
		const settingBlock = catalog.slice(
			catalog.indexOf('export const KNOX_CHAT_SETTING_IDS'),
			catalog.indexOf('export const KNOX_SETTING_IDS'),
		);
		const frozen = [...settingBlock.matchAll(/"(knoxchat\.[^"]+|knox\.checkpoints\.[^"]+)"/g)]
			.map(match => match[1])
			.sort();
		assert.deepStrictEqual(contributed, frozen);
		assert.strictEqual(contributed.length, 61);
		assert.ok(contributed.includes('knoxchat.jev.enabled'));
		assert.ok(contributed.includes('knoxchat.memoryBrain.maxBytes'));
		assert.ok(contributed.includes('knox.checkpoints.enableAutoCheckpoints'));

		const keyCommands = [...new Set(
			(pkg.contributes?.keybindings ?? [])
				.map(entry => entry.command)
				.filter((id): id is string => Boolean(id && (id.startsWith('knoxchat.') || id.startsWith('knox.checkpoints.')))),
		)].sort();
		for (const id of ['knoxchat.focusKnoxInput', 'knoxchat.acceptDiff', 'knoxchat.focusEdit', 'knox.checkpoints.create']) {
			assert.ok(keyCommands.includes(id), id);
		}

	});
});

suite('Knox agent host contract (KN-383)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('sqlite3 and node-pty rebuild for Electron 43.3.0 ABI 148, with KNOX_SKIP_ELECTRON_REBUILD', () => {
		const policy = repoFile('extensions/knox/scripts/electronRebuild.mts');
		const policyTest = repoFile('extensions/knox/src/host/activation/electronRebuild.test.ts');
		const copyNative = repoFile('extensions/knox/scripts/copy-native.mts');
		const readme = repoFile('extensions/knox/README.md');
		const gulp = repoFile('build/gulpfile.extensions.ts');
		const knoxPkg = JSON.parse(repoFile('extensions/knox/package.json')) as {
			dependencies?: { '@electron/rebuild'?: string; sqlite3?: string };
			optionalDependencies?: { 'node-pty'?: string };
			scripts?: { 'compile-native'?: string };
		};
		const rootPkg = JSON.parse(repoFile('package.json')) as {
			devDependencies?: { electron?: string };
		};

		assert.ok(policy.includes('KN-383'));
		assert.ok(policy.includes("KNOX_ELECTRON_VERSION = '43.3.0'"));
		assert.ok(policy.includes('KNOX_ELECTRON_ABI = 148'));
		assert.ok(policy.includes('KNOX_SKIP_ELECTRON_REBUILD'));
		assert.ok(policy.includes('KNOX_FORCE_ELECTRON_REBUILD'));
		assert.ok(policy.includes("'sqlite3'"));
		assert.ok(policy.includes("'node-pty'"));
		assert.ok(policy.includes('forceABI'));
		assert.ok(policyTest.includes('KN-383'));
		assert.ok(policyTest.includes('KNOX_SKIP_ELECTRON_REBUILD=1'));
		assert.ok(policyTest.includes('../../../scripts/electronRebuild.mts'));
		assert.ok(copyNative.includes('KN-383'));
		assert.ok(copyNative.includes('shouldSkipKnoxElectronRebuild'));
		assert.ok(copyNative.includes('knoxElectronRebuildOptions'));
		assert.ok(copyNative.includes("from './electronRebuild.mts'"));
		assert.ok(readme.includes('KNOX_SKIP_ELECTRON_REBUILD=1'));
		assert.ok(readme.includes('ABI **148**'));
		assert.ok(readme.includes('43.3.0'));
		assert.ok(gulp.includes("compile-extension-knox-native"));
		assert.ok(gulp.includes('scripts/copy-native.mts'));
		assert.ok(knoxPkg.dependencies?.['@electron/rebuild']);
		assert.ok(knoxPkg.dependencies?.sqlite3);
		assert.ok(knoxPkg.optionalDependencies?.['node-pty']);
		assert.ok(knoxPkg.scripts?.['compile-native']?.includes('compile-extension-knox-native'));
		assert.strictEqual(rootPkg.devDependencies?.electron, '43.3.0');
	});
});

suite('Knox agent host contract (KN-384)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('nativeExtensions includes knox; gulp compile-extension:knox + compile-extension-knox-native only; no marketplace builtin', () => {
		const packaging = repoFile('extensions/knox/scripts/packaging.mts');
		const packagingTest = repoFile('extensions/knox/src/host/activation/packaging.test.ts');
		const gulp = repoFile('build/gulpfile.extensions.ts');
		const buildExt = repoFile('build/lib/extensions.ts');
		const ignore = repoFile('extensions/knox/.vscodeignore');
		const readme = repoFile('extensions/knox/README.md');
		const identity = repoFile('extensions/knox/src/core/protocol/knoxCoderIdentity.test.ts');
		const knoxPkg = JSON.parse(repoFile('extensions/knox/package.json')) as {
			scripts?: { compile?: string; 'compile-native'?: string };
		};
		const product = JSON.parse(repoFile('product.json')) as {
			builtInExtensions?: Array<{ name?: string }>;
			webBuiltInExtensions?: Array<{ name?: string }>;
		};

		assert.ok(packaging.includes('KN-384'));
		assert.ok(packaging.includes("KNOX_NATIVE_EXTENSION_NAME = 'knox'"));
		assert.ok(packaging.includes("KNOX_GULP_COMPILE_JS_TASK = 'compile-extension:knox'"));
		assert.ok(packaging.includes("KNOX_GULP_COMPILE_NATIVE_TASK = 'compile-extension-knox-native'"));
		assert.ok(packaging.includes('assertNoKnoxMarketplaceBuiltins'));
		assert.ok(packaging.includes('vscodeIgnoreAllowsPackagedNatives'));
		assert.ok(packagingTest.includes('KN-384'));
		assert.ok(packagingTest.includes('../../../scripts/packaging.mts'));

		assert.ok(gulp.includes("task.define('compile-extension:knox'"));
		assert.ok(gulp.includes("task.define('compile-extension-knox-native'"));
		assert.ok(gulp.includes('KN-384'));
		assert.ok(!gulp.includes("task.define('compile-extension-knox-gui'"));
		assert.ok(!gulp.includes(`task.define('${['copy', 'gui'].join('-')}'`));
		assert.ok(!gulp.includes("'extensions/knox/tsconfig.json'"));

		assert.ok(buildExt.includes('export const nativeExtensions'));
		assert.ok(buildExt.includes("'knox'"));
		assert.ok(buildExt.includes('assertNoKnoxMarketplaceBuiltin'));
		assert.ok(buildExt.includes('skipGenericTypecheck'));
		assert.ok(buildExt.includes("extensionName === 'knox'"));
		assert.ok(buildExt.includes('desktopOnlyExtensions'));

		assert.ok(ignore.includes('/node_modules/**'));
		assert.ok(ignore.includes('KN-384'));
		assert.ok(!/^node_modules\/\*\*$/m.test(ignore));

		assert.ok(knoxPkg.scripts?.compile?.includes('compile-extension:knox'));
		assert.ok(knoxPkg.scripts?.['compile-native']?.includes('compile-extension-knox-native'));

		assert.ok(!(product.builtInExtensions ?? []).some(ext =>
			(ext.name ?? '').toLowerCase().includes('knox') || (ext.name ?? '').toLowerCase().includes('knoxchat')));
		assert.ok(!(product.webBuiltInExtensions ?? []).some(ext =>
			(ext.name ?? '').toLowerCase().includes('knox') || (ext.name ?? '').toLowerCase().includes('knoxchat')));

		assert.ok(readme.includes('nativeExtensions'));
		assert.ok(readme.includes('compile-extension:knox'));
		assert.ok(readme.includes('compile-extension-knox-native'));
		assert.ok(readme.includes('builtInExtensions'));
		assert.ok(identity.includes('KN-384'));
	});
});

suite('Knox agent host contract (KN-390)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('inventory gate scans leftover path markers and allowlists only history files', () => {
		const gate = repoFile('extensions/knox/scripts/inventory-gate.mts');
		const inventory = repoFile('src/vs/workbench/contrib/knox/browser/knoxNativeInventory.test.ts');
		const esbuild = repoFile('extensions/knox/esbuild.mts');
		const packaging = repoFile('extensions/knox/scripts/packaging.mts');
		assert.ok(gate.includes('KN-390'));
		assert.ok(gate.includes('assertNoLegacyKnoxPathMentions'));
		assert.ok(gate.includes('assertKnoxNativeInventory'));
		assert.ok(gate.includes('knox-native.md'));
		assert.ok(gate.includes('CHANGELOG.md'));
		assert.ok(gate.includes("['knox', 'core'].join('/')"));
		assert.ok(gate.includes("['copy', 'gui'].join('-')"));
		assert.ok(inventory.includes('KN-390'));
		assert.ok(inventory.includes('KN-391'));
		assert.ok(inventory.includes('knox-native.md'));
		assert.ok(esbuild.includes('assertKnoxNativeInventory'));
		assert.ok(packaging.includes("['copy', 'gui'].join('-')"));
	});
});

suite('Knox agent host contract (KN-391)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('gulp and npm dirs point at extensions/knox, not leftover ./knox', () => {
		const packaging = repoFile('extensions/knox/scripts/packaging.mts');
		const gate = repoFile('extensions/knox/scripts/inventory-gate.mts');
		const packagingTest = repoFile('extensions/knox/src/host/activation/packaging.test.ts');
		const dirs = repoFile('build/npm/dirs.ts');
		const gulp = repoFile('build/gulpfile.extensions.ts');
		const readme = repoFile('extensions/knox/README.md');

		assert.ok(packaging.includes('KN-391'));
		assert.ok(packaging.includes("KNOX_FORK_NPM_DIR = 'extensions/knox'"));
		assert.ok(packaging.includes('assertNoLeftoverKnoxBuildPointers'));
		assert.ok(packaging.includes('npmDirEntriesPointAtLeftoverKnox'));
		assert.ok(packaging.includes('gulpJoinsLeftoverKnoxRoot'));
		assert.ok(gate.includes('KN-391'));
		assert.ok(gate.includes('assertNoLeftoverKnoxGulpNpmPointers'));
		assert.ok(gate.includes('assertNoLeftoverKnoxBuildPointers'));
		assert.ok(packagingTest.includes('KN-391'));
		assert.ok(packagingTest.includes('../../../scripts/packaging.mts'));

		assert.ok(dirs.includes('KN-391'));
		assert.ok(dirs.includes("'extensions/knox'"));
		assert.ok(!/^\s*'knox'\s*,?\s*$/m.test(dirs));
		assert.ok(!dirs.includes("path.join(root, 'knox'"));

		assert.ok(gulp.includes('KN-391'));
		assert.ok(gulp.includes("path.join(root, 'extensions', 'knox'"));
		assert.ok(!/path\.join\(\s*root\s*,\s*(['"])knox\1/.test(gulp));
		assert.ok(!gulp.includes("task.define('compile-extension-knox-gui'"));
		assert.ok(!gulp.includes("task.define('compile-extension-knox-core'"));

		assert.ok(readme.includes('KN-391'));
		assert.ok(readme.includes('extensions/knox'));
		assert.ok(readme.includes('build/npm/dirs.ts'));
	});
});

suite('Knox agent host contract (KN-392)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('inventory gate fails if leftover product directory still exists', () => {
		const gate = repoFile('extensions/knox/scripts/inventory-gate.mts');
		const inventory = repoFile('src/vs/workbench/contrib/knox/browser/knoxNativeInventory.test.ts');
		const packagingTest = repoFile('extensions/knox/src/host/activation/packaging.test.ts');
		const leftover = join(process.cwd(), 'knox');

		assert.ok(gate.includes('KN-392'));
		assert.ok(gate.includes('assertNoLeftoverKnoxDirectory'));
		assert.ok(gate.includes('leftoverProductDirectoryExists'));
		assert.ok(gate.includes('assertKnoxNativeInventory'));
		assert.ok(inventory.includes('KN-392'));
		assert.ok(packagingTest.includes('KN-392'));
		assert.ok(gate.includes('isGitIgnored'));
		assert.ok(!existsSync(leftover) || isGitIgnored(leftover), 'KN-392: leftover product directory at repo root must be deleted');
	});
});

suite('Knox native parity follow-ups (NP)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('NP-26 getDebugLocals warns when there is no active debug session', () => {
		const ideUtils = repoFile('extensions/knox/src/host/util/ideUtils.ts');
		const start = ideUtils.indexOf('async getDebugLocals(');
		assert.ok(start > 0);
		const body = ideUtils.slice(start, start + 600);
		assert.ok(body.includes('showWarningMessage'));
		assert.ok(body.includes('No active debug session found'));
	});

	test('NP-28 the host merges the turn inject into the leading system message, else prepends one', () => {
		const source = repoFile('extensions/knox/src/host/extension/nativeAgentRequest.ts');
		assert.ok(source.includes('export function mergeInjectIntoMessages'));
		assert.ok(source.includes('first?.role === "system"'));
		assert.ok(source.includes('return [{ role: "system", content: injected }, ...messages];'));
	});

	test('NP-29 the ported openai-adapters package tests run under their own vitest config', () => {
		assert.ok(existsSync(join(process.cwd(), 'extensions/knox/src/pkg/openai-adapters/apis/Anthropic.test.ts')));
		assert.ok(repoFile('extensions/knox/src/pkg/vitest.config.ts').includes('**/*.test.ts'));
		assert.ok(repoFile('extensions/knox/package.json').includes('"test:pkg"'));
	});

	test('NP-30 extra editors cannot fan out llm/streamChat tokens', () => {
		const extHost = repoFile('src/vs/workbench/api/common/extHostKnoxExtensionService.ts');
		const protocol = repoFile('extensions/knox/src/host/webviewProtocol.ts');
		const dispatch = repoFile('extensions/knox/src/core/protocol/dispatchHandlers.ts');
		const messenger = repoFile('src/vs/workbench/contrib/knox/browser/knoxGuiMessenger.ts');
		const inbound = repoFile('src/vs/workbench/contrib/knox/browser/gui/controller/inbound.ts');
		const service = repoFile('src/vs/workbench/contrib/knox/browser/knoxService.ts');
		assert.ok(extHost.includes('_knoxApiPromise'));
		assert.ok(extHost.includes('_guiListenersAttached'));
		assert.ok(extHost.includes('_attachKnoxApiListeners'));
		assert.ok(protocol.includes('dispatchProtocolHandlers'));
		assert.ok(dispatch.includes('Streaming `llm/streamChat` through every'));
		assert.ok(messenger.includes('isKnoxGuiResponseEnvelope'));
		assert.ok(messenger.includes('if (finished)'));
		assert.ok(inbound.includes('isKnoxGuiResponseEnvelope(data)'));
		assert.ok(service.includes('ignoring the extra host'));
		assert.ok(!service.includes('BugIndicatingError'));
	});
});
