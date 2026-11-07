/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { $ } from '../../../../../base/browser/dom.js';
import { KeyCode } from '../../../../../base/common/keyCodes.js';
import { KeyCodeChord, ResolvedKeybinding } from '../../../../../base/common/keybindings.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { isMacintosh, isWeb, OS } from '../../../../../base/common/platform.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { CommandsRegistry } from '../../../../../platform/commands/common/commands.js';
import { ConfigurationTarget } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IKeybindingService } from '../../../../../platform/keybinding/common/keybinding.js';
import { USLayoutResolvedKeybinding } from '../../../../../platform/keybinding/common/usLayoutResolvedKeybinding.js';
import { MockKeybindingService } from '../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { IWorkspaceContextService, WorkbenchState } from '../../../../../platform/workspace/common/workspace.js';
import { EditorGroupWatermark } from '../../../../browser/parts/editor/editorGroupWatermark.js';
import { TestContextService } from '../../../common/workbenchTestServices.js';
import { workbenchInstantiationService } from '../../workbenchTestServices.js';

suite('EditorGroupWatermark', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	let container: HTMLElement;
	let configurationService: TestConfigurationService;
	let instantiationService: ReturnType<typeof workbenchInstantiationService>;
	let keybindings: Map<string, ResolvedKeybinding>;
	let workbenchState: WorkbenchState;

	function keybinding(keyCode: KeyCode): ResolvedKeybinding {
		return new USLayoutResolvedKeybinding([new KeyCodeChord(!isMacintosh, false, false, isMacintosh, keyCode)], OS);
	}

	function render(): void {
		disposables.add(instantiationService.createInstance(EditorGroupWatermark, container));
	}

	function labels(): string[] {
		return [...container.querySelectorAll('dt')].map(dt => dt.textContent ?? '');
	}

	setup(() => {
		container = document.body.appendChild($('.editor-group-container.empty'));
		disposables.add(toDisposable(() => container.remove()));
		configurationService = new TestConfigurationService({ workbench: { tips: { enabled: true } } });
		disposables.add(configurationService.onDidChangeConfigurationEmitter);
		instantiationService = workbenchInstantiationService({ configurationService: () => configurationService }, disposables);
		keybindings = new Map([
			['workbench.action.showCommands', keybinding(KeyCode.KeyP)],
			['workbench.action.quickOpen', keybinding(KeyCode.KeyP)],
			['workbench.action.debug.start', keybinding(KeyCode.F5)],
			['workbench.action.openRecent', keybinding(KeyCode.KeyR)],
			['workbench.action.files.openFile', keybinding(KeyCode.KeyO)],
			['workbench.action.files.openFolder', keybinding(KeyCode.KeyO)],
			['workbench.action.files.openFileFolder', keybinding(KeyCode.KeyO)],
			['workbench.action.files.newUntitledFile', keybinding(KeyCode.KeyN)],
			['workbench.action.findInFiles', keybinding(KeyCode.KeyF)],
			['workbench.action.terminal.toggleTerminal', keybinding(KeyCode.Backquote)],
		]);
		workbenchState = WorkbenchState.FOLDER;
		instantiationService.stub(IKeybindingService, new class extends MockKeybindingService {
			override lookupKeybinding(id: string) {
				return keybindings.get(id);
			}
		});
		instantiationService.stub(IWorkspaceContextService, new class extends TestContextService {
			override getWorkbenchState() { return workbenchState; }
		});

		for (const id of keybindings.keys()) {
			disposables.add(CommandsRegistry.registerCommand(id, () => { }));
		}
	});

	test('workspace watermark shows commands, go to file, and start debugging', () => {
		render();

		assert.deepStrictEqual(labels(), ['Show All Commands', 'Go to File', 'Start Debugging']);
		assert.strictEqual(container.querySelectorAll('dl').length, 3);
		assert.ok(container.querySelector('.letterpress'));
	});

	test('empty window watermark shows file open shortcuts without chat', () => {
		workbenchState = WorkbenchState.EMPTY;
		render();

		assert.deepStrictEqual(labels(), isMacintosh && !isWeb
			? ['Show All Commands', 'Open Recent', 'Open File or Folder', 'New Untitled Text File']
			: ['Show All Commands', 'Open Recent', 'Open File', 'Open Folder']);
	});

	test('hides shortcuts when tips are disabled', async () => {
		render();
		await configurationService.setUserConfiguration('workbench.tips.enabled', false);
		configurationService.onDidChangeConfigurationEmitter.fire({
			source: ConfigurationTarget.USER,
			affectedKeys: new Set(['workbench.tips.enabled']),
			change: { keys: ['workbench.tips.enabled'], overrides: [] },
			affectsConfiguration: key => key === 'workbench.tips.enabled',
		});

		assert.deepStrictEqual(labels(), []);
	});
});
