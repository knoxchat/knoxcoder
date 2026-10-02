/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { EditorInputCapabilities, IEditorSerializer, IUntypedEditorInput } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { KnoxGuiRoute } from '../common/knoxGuiProtocol.js';
import { KnoxGuiController } from './knoxGuiController.js';
import { KnoxGuiMessenger } from './knoxGuiMessenger.js';
import { KnoxGuiStore } from './knoxGuiStore.js';
import { KnoxGuiWidget } from './gui/knoxGuiWidget.js';

// Contributed by the Knox extension (`contributes.icons`).
const memoryIcon = ThemeIcon.fromId('knox-memory');
const checkpointIcon = ThemeIcon.fromId('knox-checkpoint-graph');

abstract class KnoxGuiEditorInputBase extends EditorInput {
	override get capabilities(): EditorInputCapabilities {
		return super.capabilities | EditorInputCapabilities.Singleton | EditorInputCapabilities.Readonly;
	}

	constructor(
		private readonly _typeId: string,
		private readonly _name: string,
		private readonly _resource: URI,
		private readonly _icon: ThemeIcon,
	) {
		super();
	}

	get typeId(): string {
		return this._typeId;
	}

	get resource(): URI {
		return this._resource;
	}

	override getName(): string {
		return this._name;
	}

	override getIcon(): ThemeIcon {
		return this._icon;
	}

	override matches(other: EditorInput | IUntypedEditorInput): boolean {
		return other instanceof KnoxGuiEditorInputBase && other.typeId === this.typeId;
	}
}

export class KnoxMemoryEditorInput extends KnoxGuiEditorInputBase {
	static readonly ID = 'workbench.input.knoxMemory';

	constructor() {
		super(KnoxMemoryEditorInput.ID, localize('knox.memory', "Memory"), URI.from({ scheme: 'knox', path: '/memory' }), memoryIcon);
	}
}

export class KnoxCheckpointGraphEditorInput extends KnoxGuiEditorInputBase {
	static readonly ID = 'workbench.input.knoxCheckpointGraph';

	constructor() {
		super(KnoxCheckpointGraphEditorInput.ID, localize('knox.checkpointGraph', "Checkpoint Graph"), URI.from({ scheme: 'knox', path: '/checkpoint-graph' }), checkpointIcon);
	}
}

abstract class KnoxGuiEditorPane extends EditorPane {
	private widget: KnoxGuiWidget | undefined;

	constructor(
		id: string,
		group: IEditorGroup,
		private readonly route: KnoxGuiRoute,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		super(id, group, telemetryService, themeService, storageService);
	}

	protected createEditor(parent: HTMLElement): void {
		if (this.widget) {
			return;
		}
		parent.classList.add('monaco-knox-gui-editor');
		parent.style.height = '100%';
		const store = this._register(this.instantiationService.createInstance(KnoxGuiStore));
		store.lockView(this.route);
		const messenger = this._register(this.instantiationService.createInstance(KnoxGuiMessenger));
		const controller = this._register(this.instantiationService.createInstance(KnoxGuiController, store, messenger));
		this.widget = this._register(this.instantiationService.createInstance(KnoxGuiWidget, parent, controller));
	}

	override layout(dimension: { height: number; width: number }): void {
		this.widget?.layout(dimension.height, dimension.width);
	}
}

export class KnoxMemoryEditor extends KnoxGuiEditorPane {
	static readonly ID = 'workbench.editor.knoxMemory';

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super(KnoxMemoryEditor.ID, group, KnoxGuiRoute.Memory, telemetryService, themeService, storageService, instantiationService);
	}
}

export class KnoxMemoryEditorInputSerializer implements IEditorSerializer {
	canSerialize(): boolean {
		return true;
	}

	serialize(): string {
		return '{}';
	}

	deserialize(): KnoxMemoryEditorInput {
		return new KnoxMemoryEditorInput();
	}
}

export class KnoxCheckpointGraphEditorInputSerializer implements IEditorSerializer {
	canSerialize(): boolean {
		return true;
	}

	serialize(): string {
		return '{}';
	}

	deserialize(): KnoxCheckpointGraphEditorInput {
		return new KnoxCheckpointGraphEditorInput();
	}
}

export class KnoxCheckpointGraphEditor extends KnoxGuiEditorPane {
	static readonly ID = 'workbench.editor.knoxCheckpointGraph';

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super(KnoxCheckpointGraphEditor.ID, group, KnoxGuiRoute.CheckpointGraph, telemetryService, themeService, storageService, instantiationService);
	}
}
