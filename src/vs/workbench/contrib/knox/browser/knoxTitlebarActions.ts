/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { language as platformLanguage } from '../../../../base/common/platform.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { isDark } from '../../../../platform/theme/common/theme.js';
import { localize, localize2 } from '../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ContextKeyExpr, IContextKey, IContextKeyService, RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { ActiveEditorContext, AuxiliaryBarVisibleContext, IsAuxiliaryWindowContext } from '../../../common/contextkeys.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { IWorkbenchThemeService, ThemeSettingDefaults } from '../../../services/themes/common/workbenchThemeService.js';
import { KNOX_VIEW_ID } from '../../../common/knox.js';
import { knoxGuiResolveLanguage } from '../common/knoxGuiPersist.js';
import { LANGUAGE_KEY } from './gui/controller/helpers.js';
import { knoxGuiNextLanguage } from './gui/widget/languageToggle.js';
import { KnoxChatViewPane } from './knoxChatViewPane.js';
import { KnoxCheckpointGraphEditor, KnoxCheckpointGraphEditorInput, KnoxMemoryEditor, KnoxMemoryEditorInput } from './knoxGuiEditors.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { TitleBarLeadingActionsGroup } from '../../../browser/parts/titlebar/titlebarActions.js';

export const TOGGLE_KNOX_GUI_LANGUAGE_ID = 'workbench.action.knox.toggleGuiLanguage';
export const TOGGLE_KNOX_COLOR_THEME_ID = 'workbench.action.knox.toggleColorTheme';
export const OPEN_KNOX_MEMORY_TITLEBAR_ID = 'workbench.action.knox.titlebar.openMemory';
export const OPEN_KNOX_CHECKPOINT_GRAPH_TITLEBAR_ID = 'workbench.action.knox.titlebar.openCheckpointGraph';

export const KnoxGuiLanguageContext = new RawContextKey<string>('knoxGuiLanguage', 'en', {
	type: 'string',
	description: localize('knoxGuiLanguage', "Knox chat UI language (en or zh)."),
});

const titlebarLanguageIcon = registerIcon('titlebar-language', Codicon.globe, localize('titlebarLanguage', "Toggle Knox chat language"));
const titlebarThemeIcon = registerIcon('titlebar-theme', Codicon.colorMode, localize('titlebarTheme', "Toggle light and dark color theme"));

const titlebarMemoryIcon = registerIcon('titlebar-knox-memory', ThemeIcon.fromId('knox-memory'), localize('titlebarKnoxMemory', "Open Knox Memory"));
const titlebarCheckpointGraphIcon = registerIcon('titlebar-knox-checkpoint-graph', ThemeIcon.fromId('knox-checkpoint-graph'), localize('titlebarKnoxCheckpointGraph', "Open Knox Checkpoint Graph"));

const titlebarToggleWhen = ContextKeyExpr.and(
	IsAuxiliaryWindowContext.negate(),
	ContextKeyExpr.or(
		ContextKeyExpr.equals('config.workbench.layoutControl.type', 'toggles'),
		ContextKeyExpr.equals('config.workbench.layoutControl.type', 'both'),
	),
);

// Memory and Checkpoint Graph: leading group of the right title bar toolbar, i.e. directly left of Customize Layout.
registerAction2(class KnoxTitlebarOpenMemoryAction extends Action2 {
	constructor() {
		super({
			id: OPEN_KNOX_MEMORY_TITLEBAR_ID,
			title: localize2('knox.titlebar.openMemory', 'Knox Memory'),
			tooltip: localize('knox.titlebar.openMemoryTooltip', "Knox memory — click to open Memory"),
			icon: titlebarMemoryIcon,
			toggled: {
				condition: ActiveEditorContext.isEqualTo(KnoxMemoryEditor.ID),
				icon: titlebarMemoryIcon,
			},
			menu: {
				id: MenuId.TitleBar,
				group: TitleBarLeadingActionsGroup,
				order: 1,
				when: IsAuxiliaryWindowContext.negate(),
			},
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		await accessor.get(IEditorService).openEditor(new KnoxMemoryEditorInput(), { pinned: true });
	}
});

registerAction2(class KnoxTitlebarOpenCheckpointGraphAction extends Action2 {
	constructor() {
		super({
			id: OPEN_KNOX_CHECKPOINT_GRAPH_TITLEBAR_ID,
			title: localize2('knox.titlebar.openCheckpointGraph', 'Knox Checkpoint Graph'),
			tooltip: localize('knox.titlebar.openCheckpointGraphTooltip', "Knox checkpoint graph — click to open"),
			icon: titlebarCheckpointGraphIcon,
			toggled: {
				condition: ActiveEditorContext.isEqualTo(KnoxCheckpointGraphEditor.ID),
				icon: titlebarCheckpointGraphIcon,
			},
			menu: {
				id: MenuId.TitleBar,
				group: TitleBarLeadingActionsGroup,
				order: 2,
				when: IsAuxiliaryWindowContext.negate(),
			},
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		await accessor.get(IEditorService).openEditor(new KnoxCheckpointGraphEditorInput(), { pinned: true });
	}
});

registerAction2(class ToggleKnoxGuiLanguageAction extends Action2 {
	constructor() {
		super({
			id: TOGGLE_KNOX_GUI_LANGUAGE_ID,
			title: localize2('knox.toggleGuiLanguage', 'Toggle Chat Language'),
			f1: true,
			icon: titlebarLanguageIcon,
			toggled: {
				condition: KnoxGuiLanguageContext.isEqualTo('zh'),
				icon: titlebarLanguageIcon,
				title: localize('knox.languageChinese', "Chinese"),
			},
			menu: {
				id: MenuId.TitleBarLeft,
				group: 'navigation',
				order: 1,
				when: ContextKeyExpr.and(titlebarToggleWhen, AuxiliaryBarVisibleContext),
			},
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const storageService = accessor.get(IStorageService);
		const viewsService = accessor.get(IViewsService);
		const current = knoxGuiResolveLanguage(storageService.get(LANGUAGE_KEY, StorageScope.PROFILE), platformLanguage);
		const next = knoxGuiNextLanguage(current);
		const pane = viewsService.getViewWithId<KnoxChatViewPane>(KNOX_VIEW_ID);
		const controller = pane?.getController();
		if (controller) {
			await controller.setLanguage(next);
			return;
		}
		storageService.store(LANGUAGE_KEY, next, StorageScope.PROFILE, StorageTarget.USER);
	}
});

registerAction2(class ToggleKnoxColorThemeAction extends Action2 {
	constructor() {
		super({
			id: TOGGLE_KNOX_COLOR_THEME_ID,
			title: localize2('knox.toggleColorTheme', 'Toggle Light/Dark Theme'),
			f1: true,
			icon: titlebarThemeIcon,
			toggled: {
				condition: ContextKeyExpr.equals('config.workbench.colorTheme', ThemeSettingDefaults.COLOR_THEME_DARK),
				icon: titlebarThemeIcon,
				title: localize('knox.themeDark', "Dark"),
			},
			menu: {
				id: MenuId.TitleBarLeft,
				group: 'navigation',
				order: 2,
				when: titlebarToggleWhen,
			},
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const themeService = accessor.get(IWorkbenchThemeService);
		const nextSettingsId = isDark(themeService.getColorTheme().type)
			? ThemeSettingDefaults.COLOR_THEME_LIGHT
			: ThemeSettingDefaults.COLOR_THEME_DARK;
		const theme = (await themeService.getColorThemes()).find(candidate => candidate.settingsId === nextSettingsId);
		if (theme) {
			await themeService.setColorTheme(theme.id, 'auto');
		}
	}
});

class KnoxTitlebarChromeContribution extends Disposable {
	static readonly ID = 'workbench.contrib.knoxTitlebarChrome';

	private readonly languageContext: IContextKey<string>;

	constructor(
		@IStorageService storageService: IStorageService,
		@IContextKeyService contextKeyService: IContextKeyService,
	) {
		super();
		this.languageContext = KnoxGuiLanguageContext.bindTo(contextKeyService);
		const sync = () => {
			this.languageContext.set(knoxGuiResolveLanguage(storageService.get(LANGUAGE_KEY, StorageScope.PROFILE), platformLanguage));
		};
		sync();
		this._register(storageService.onDidChangeValue(StorageScope.PROFILE, LANGUAGE_KEY, this._store)(sync));
	}
}

registerWorkbenchContribution2(KnoxTitlebarChromeContribution.ID, KnoxTitlebarChromeContribution, WorkbenchPhase.AfterRestored);
