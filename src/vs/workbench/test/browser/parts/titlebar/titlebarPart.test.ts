/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { CodeWindow, mainWindow } from '../../../../../base/browser/window.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { isIMenuItem, MenuId, MenuRegistry } from '../../../../../platform/actions/common/actions.js';
import { IContextMenuService } from '../../../../../platform/contextview/browser/contextView.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { TestColorTheme, TestThemeService } from '../../../../../platform/theme/test/common/testThemeService.js';
import { ToggleSidebarVisibilityAction } from '../../../../browser/actions/layoutActions.js';
import { ToggleAuxiliaryBarAction } from '../../../../browser/parts/auxiliarybar/auxiliaryBarActions.js';
import { TogglePanelAction } from '../../../../browser/parts/panel/panelActions.js';
import { TOGGLE_KNOX_COLOR_THEME_ID, TOGGLE_KNOX_GUI_LANGUAGE_ID } from '../../../../contrib/knox/browser/knoxTitlebarActions.js';
import { BrowserTitlebarPart } from '../../../../browser/parts/titlebar/titlebarPart.js';
import { TITLE_BAR_SHOWS_MANAGE_ACTION } from '../../../../browser/parts/titlebar/titlebarActions.js';
import { WindowTitle } from '../../../../browser/parts/titlebar/windowTitle.js';
import { MODERN_UI_INACTIVE_SHELL_BACKGROUND, MODERN_UI_SHELL_BACKGROUND, TITLE_BAR_ACTIVE_BACKGROUND, TITLE_BAR_INACTIVE_BACKGROUND } from '../../../../common/theme.js';
import { IEditorGroupsContainer } from '../../../../services/editor/common/editorGroupsService.js';
import { IHostService } from '../../../../services/host/browser/host.js';
import { IWorkbenchLayoutService, Parts } from '../../../../services/layout/browser/layoutService.js';
import { TestContextMenuService, TestHostService, TestLayoutService, workbenchInstantiationService } from '../../workbenchTestServices.js';
import '../../../../contrib/modernUI/browser/media/titlebar.css';

suite('TitlebarPart colors', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	class TestTitlebarPart extends BrowserTitlebarPart {
		protected override createContentArea(parent: HTMLElement): HTMLElement {
			this.element = parent;
			return parent;
		}
	}

	test('resolves shell and title colors from the target window focus', () => {
		let focused = false;
		const targetWindow = new class extends mock<CodeWindow>() {
			override vscodeWindowId = mainWindow.vscodeWindowId;
			override document = new class extends mock<Document>() {
				override hasFocus(): boolean { return focused; }
			}();
		}();
		const activeWindowEmitter = store.add(new Emitter<number>());
		const hostService = new class extends TestHostService {
			override readonly onDidChangeActiveWindow = activeWindowEmitter.event;
		}();
		const themeService = new TestThemeService(new TestColorTheme({
			[TITLE_BAR_ACTIVE_BACKGROUND]: '#112233',
			[TITLE_BAR_INACTIVE_BACKGROUND]: '#223344',
			[MODERN_UI_SHELL_BACKGROUND]: '#334455',
			[MODERN_UI_INACTIVE_SHELL_BACKGROUND]: '#445566',
		}));
		const root = document.createElement('div');
		const instantiationService = workbenchInstantiationService(undefined, store);
		instantiationService.stub(IHostService, hostService);
		instantiationService.stub(IThemeService, themeService);
		instantiationService.stub(IContextMenuService, new TestContextMenuService());
		instantiationService.stub(IWorkbenchLayoutService, new class extends TestLayoutService {
			override getContainer(): HTMLElement { return root; }
		}());
		instantiationService.stubInstance(WindowTitle, { dispose() { } });
		const groups = new class extends mock<IEditorGroupsContainer>() {
			override onDidChangeEditorPartOptions = Event.None;
		}();
		const part = store.add(instantiationService.createInstance(TestTitlebarPart, Parts.TITLEBAR_PART, targetWindow, groups));
		const container = document.createElement('div');
		part.create(container);
		const colors = () => ({
			title: container.style.backgroundColor,
			shell: root.style.getPropertyValue('--modern-ui-shell-background'),
		});
		const initiallyInactive = colors();
		focused = true;
		activeWindowEmitter.fire(targetWindow.vscodeWindowId);
		const active = colors();
		focused = false;
		activeWindowEmitter.fire(targetWindow.vscodeWindowId + 1);
		hostService.setFocus(false);
		hostService.setFocus(true);
		const anotherWindowActive = colors();

		themeService.setTheme(new TestColorTheme({
			[TITLE_BAR_ACTIVE_BACKGROUND]: '#112233',
			[MODERN_UI_SHELL_BACKGROUND]: '#334455',
		}));
		const missingInactiveColors = colors();

		assert.deepStrictEqual({ initiallyInactive, active, anotherWindowActive, missingInactiveColors }, {
			initiallyInactive: { title: 'rgb(34, 51, 68)', shell: '#445566' },
			active: { title: 'rgb(17, 34, 51)', shell: '#334455' },
			anotherWindowActive: { title: 'rgb(34, 51, 68)', shell: '#445566' },
			missingInactiveColors: { title: 'rgb(17, 34, 51)', shell: '#334455' },
		});
	});

	test('uses title bar foreground colors for action toolbar icons', () => {
		const workbench = document.createElement('div');
		workbench.className = 'monaco-workbench';
		workbench.style.color = '#abcdef';
		workbench.style.setProperty('--vscode-titleBar-activeForeground', '#112233');
		workbench.style.setProperty('--vscode-titleBar-inactiveForeground', '#445566');

		const titlebar = document.createElement('div');
		titlebar.className = 'part titlebar';
		const titlebarContainer = document.createElement('div');
		titlebarContainer.className = 'titlebar-container';
		const titlebarRight = document.createElement('div');
		titlebarRight.className = 'titlebar-right';
		const actionToolbar = document.createElement('div');
		actionToolbar.className = 'action-toolbar-container';
		const icon = document.createElement('span');
		icon.className = 'codicon';
		actionToolbar.appendChild(icon);
		titlebarRight.appendChild(actionToolbar);
		titlebarContainer.appendChild(titlebarRight);
		titlebar.appendChild(titlebarContainer);
		workbench.appendChild(titlebar);
		document.body.appendChild(workbench);

		try {
			const active = mainWindow.getComputedStyle(icon).color;
			titlebar.classList.add('inactive');
			const inactive = mainWindow.getComputedStyle(icon).color;

			assert.deepStrictEqual({ active, inactive }, {
				active: 'rgb(17, 34, 51)',
				inactive: 'rgb(68, 85, 102)',
			});
		} finally {
			workbench.remove();
		}
	});

	test('uses Knox primary color for checked title bar layout buttons', () => {
		const workbench = document.createElement('div');
		workbench.className = 'monaco-workbench';
		const titlebar = document.createElement('div');
		titlebar.className = 'part titlebar';
		const titlebarContainer = document.createElement('div');
		titlebarContainer.className = 'titlebar-container';
		const titlebarLeft = document.createElement('div');
		titlebarLeft.className = 'titlebar-left';
		const leftToolbar = document.createElement('div');
		leftToolbar.className = 'left-action-toolbar-container';
		const actionBar = document.createElement('div');
		actionBar.className = 'monaco-action-bar';
		const actionItem = document.createElement('div');
		actionItem.className = 'action-item';
		const icon = document.createElement('span');
		icon.className = 'action-label codicon checked';
		actionItem.appendChild(icon);
		actionBar.appendChild(actionItem);
		leftToolbar.appendChild(actionBar);
		titlebarLeft.appendChild(leftToolbar);
		titlebarContainer.appendChild(titlebarLeft);
		titlebar.appendChild(titlebarContainer);
		workbench.appendChild(titlebar);
		document.body.appendChild(workbench);

		try {
			const style = mainWindow.getComputedStyle(icon);
			assert.deepStrictEqual({
				color: style.color,
				background: style.backgroundColor,
				boxShadow: style.boxShadow,
			}, {
				color: 'rgb(21, 153, 148)',
				background: 'rgba(0, 0, 0, 0)',
				boxShadow: 'none',
			});
		} finally {
			workbench.remove();
		}
	});

	test('keeps title bar chrome on the traffic-light centerline', () => {
		const workbench = document.createElement('div');
		workbench.className = 'monaco-workbench mac modern-ui';
		const titlebar = document.createElement('div');
		titlebar.className = 'part titlebar';
		titlebar.style.height = '35px';
		const titlebarContainer = document.createElement('div');
		titlebarContainer.className = 'titlebar-container';
		titlebarContainer.style.height = '35px';
		const titlebarLeft = document.createElement('div');
		titlebarLeft.className = 'titlebar-left';
		const titlebarCenter = document.createElement('div');
		titlebarCenter.className = 'titlebar-center';
		const titlebarRight = document.createElement('div');
		titlebarRight.className = 'titlebar-right';
		const leftToolbar = document.createElement('div');
		leftToolbar.className = 'left-action-toolbar-container';
		const actionBar = document.createElement('div');
		actionBar.className = 'monaco-action-bar';
		const actionItem = document.createElement('div');
		actionItem.className = 'action-item';
		const icon = document.createElement('span');
		icon.className = 'action-label codicon';
		actionItem.appendChild(icon);
		actionBar.appendChild(actionItem);
		leftToolbar.appendChild(actionBar);
		titlebarLeft.appendChild(leftToolbar);
		titlebarContainer.append(titlebarLeft, titlebarCenter, titlebarRight);
		titlebar.appendChild(titlebarContainer);
		workbench.appendChild(titlebar);
		document.body.appendChild(workbench);

		try {
			const sections = [titlebarLeft, titlebarCenter, titlebarRight].map(section => {
				const style = mainWindow.getComputedStyle(section);
				return {
					paddingTop: style.paddingTop,
					paddingBottom: style.paddingBottom,
					alignItems: style.alignItems,
				};
			});
			const item = mainWindow.getComputedStyle(actionItem);
			assert.deepStrictEqual({
				sections,
				actionItem: {
					display: item.display,
					alignItems: item.alignItems,
				},
			}, {
				sections: [
					{ paddingTop: '0px', paddingBottom: '0px', alignItems: 'center' },
					{ paddingTop: '0px', paddingBottom: '0px', alignItems: 'center' },
					{ paddingTop: '0px', paddingBottom: '0px', alignItems: 'center' },
				],
				actionItem: {
					display: 'flex',
					alignItems: 'center',
				},
			});
		} finally {
			workbench.remove();
		}
	});
});

suite('Workbench - Titlebar layout toggles', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	function commandIds(menuId: MenuId): string[] {
		return MenuRegistry.getMenuItems(menuId).filter(isIMenuItem).map(item => item.command.id);
	}

	test('places the file-tree toggle on the left and keeps other layout toggles on the right', () => {
		const left = commandIds(MenuId.TitleBarLeft);
		const right = commandIds(MenuId.LayoutControlMenu);

		assert.deepStrictEqual({
			leftHasFileTree: left.includes(ToggleSidebarVisibilityAction.ID),
			leftHasLanguage: left.includes(TOGGLE_KNOX_GUI_LANGUAGE_ID),
			leftHasTheme: left.includes(TOGGLE_KNOX_COLOR_THEME_ID),
			rightHasFileTree: right.includes(ToggleSidebarVisibilityAction.ID),
			rightHasPanel: right.includes(TogglePanelAction.ID),
			rightHasSecondarySideBar: right.includes(ToggleAuxiliaryBarAction.ID),
			rightHasCustomizeLayout: right.includes('workbench.action.customizeLayout'),
		}, {
			leftHasFileTree: true,
			leftHasLanguage: true,
			leftHasTheme: true,
			rightHasFileTree: false,
			rightHasPanel: true,
			rightHasSecondarySideBar: true,
			rightHasCustomizeLayout: true,
		});
	});

	test('shows the language toggle only while the secondary side bar is visible', () => {
		const language = MenuRegistry.getMenuItems(MenuId.TitleBarLeft).filter(isIMenuItem)
			.find(item => item.command.id === TOGGLE_KNOX_GUI_LANGUAGE_ID);
		assert.ok(language?.when?.keys().includes('auxiliaryBarVisible'));
	});

	test('hides the Manage gear from the title bar', () => {
		assert.strictEqual(TITLE_BAR_SHOWS_MANAGE_ACTION, false);
	});
});

suite('Workbench - Titlebar Part', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const updateTitleBarToolBarOverflow = Reflect.get(BrowserTitlebarPart.prototype, 'updateTitleBarToolBarOverflow') as (this: BrowserTitlebarPart) => void;

	test('hides optional toolbar groups in priority order', () => {
		let rootClientWidth = 130;
		const centerAdjacentToolBar = mainWindow.document.createElement('div');
		const updateToolBar = mainWindow.document.createElement('div');
		const root = createMeasuredElement(
			() => rootClientWidth,
			() => 100 + visibleWidth(centerAdjacentToolBar, 30) + visibleWidth(updateToolBar, 30)
		);
		const titlebarPart = Object.create(BrowserTitlebarPart.prototype) as BrowserTitlebarPart;
		Reflect.set(titlebarPart, 'rootContainer', root);
		Reflect.set(titlebarPart, 'centerAdjacentToolBarElement', centerAdjacentToolBar);
		Reflect.set(titlebarPart, 'updateToolBarElement', updateToolBar);

		updateTitleBarToolBarOverflow.call(titlebarPart);
		const centerHiddenFirst = [centerAdjacentToolBar, updateToolBar].map(element => element.classList.contains('overflowing'));

		rootClientWidth = 100;
		updateTitleBarToolBarOverflow.call(titlebarPart);
		const bothHidden = [centerAdjacentToolBar, updateToolBar].map(element => element.classList.contains('overflowing'));

		rootClientWidth = 160;
		updateTitleBarToolBarOverflow.call(titlebarPart);
		const bothVisible = [centerAdjacentToolBar, updateToolBar].map(element => element.classList.contains('overflowing'));

		assert.deepStrictEqual({ centerHiddenFirst, bothHidden, bothVisible }, {
			centerHiddenFirst: [true, false],
			bothHidden: [true, true],
			bothVisible: [false, false],
		});
	});
});

function createMeasuredElement(clientWidth: () => number, scrollWidth: () => number): HTMLElement {
	const element = mainWindow.document.createElement('div');
	Object.defineProperties(element, {
		clientWidth: { get: clientWidth },
		scrollWidth: { get: scrollWidth },
	});
	return element;
}

function visibleWidth(element: HTMLElement, width: number): number {
	return element.classList.contains('overflowing') || element.classList.contains('has-no-actions') ? 0 : width;
}
