/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/knoxGui.css';
import './media/knoxGuiChat.css';
import './media/knoxGuiComposer.css';
import './media/knoxGuiPanels.css';
import './media/knoxGuiThinking.css';
import './media/knoxGuiPages.css';
import './media/knoxGuiCheckpoints/base.css';
import './media/knoxGuiCheckpoints/tokens.css';
import './media/knoxGuiCheckpoints/ui-button.css';
import './media/knoxGuiCheckpoints/ui-responsive.css';
import './media/knoxGuiCheckpoints/ui-badge.css';
import './media/knoxGuiCheckpoints/ui-checkbox-select.css';
import './media/knoxGuiCheckpoints/ui-input.css';
import './media/knoxGuiCheckpoints/ui-dialog.css';
import './media/knoxGuiCheckpoints/list.css';
import './media/knoxGuiCheckpoints/card.css';
import './media/knoxGuiCheckpoints/timeline-header.css';
import './media/knoxGuiCheckpoints/timeline-list.css';
import './media/knoxGuiCheckpoints/restore.css';
import './media/knoxGuiCheckpoints/compare.css';
import './media/knoxGuiCheckpoints/diff-viewer.css';
import './media/knoxGuiCheckpoints/file-tree.css';
import './media/knoxGuiCheckpoints/diff-pane.css';
import './media/knoxGuiCheckpoints/diff-binary.css';
import './media/knoxGuiCheckpoints/details-dialog.css';
import './media/knoxGuiCheckpoints/details-snapshots.css';
import './media/knoxGuiCheckpoints/details-viewer.css';
import './media/knoxGuiCheckpoints/details-compare.css';
import './media/knoxGuiCheckpoints/details-actions.css';
import './media/knoxGuiMemory.css';
import './media/knoxGuiGraph.css';
import './media/knoxGuiConfig.css';
import './media/knoxGuiCheckpointDetails.css';
import './knoxDiffDecorations.css';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { IKnoxService } from '../common/knoxService.js';
import { KnoxService } from './knoxService.js';
import { IKnoxAgentDiffRanges, IKnoxDiffDecorationService, knoxAgentDiffPayloadIsEmpty, KNOX_WORKBENCH_DIFF_COMMAND } from './knoxDiffDecorations.js';
import { KnoxStatusBarContribution } from './knoxStatusBar.js';
import { KnoxAuxiliaryBarContribution } from './knoxAuxiliaryBar.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { localize } from '../../../../nls.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { EditorExtensions, IEditorFactoryRegistry } from '../../../common/editor.js';
import './knoxGuiActions.js';
import { KnoxCheckpointGraphEditor, KnoxCheckpointGraphEditorInput, KnoxCheckpointGraphEditorInputSerializer, KnoxMemoryEditor, KnoxMemoryEditorInput, KnoxMemoryEditorInputSerializer } from './knoxGuiEditors.js';
import './knoxChatViewPane.js';

registerSingleton(IKnoxService, KnoxService, InstantiationType.Delayed);

registerWorkbenchContribution2(KnoxStatusBarContribution.ID, KnoxStatusBarContribution, WorkbenchPhase.AfterRestored);
registerWorkbenchContribution2(KnoxAuxiliaryBarContribution.ID, KnoxAuxiliaryBarContribution, WorkbenchPhase.AfterRestored);

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(KnoxMemoryEditor, KnoxMemoryEditor.ID, localize('knox.memoryEditor', "Knox Memory")),
	[new SyncDescriptor(KnoxMemoryEditorInput)]
);

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(KnoxCheckpointGraphEditor, KnoxCheckpointGraphEditor.ID, localize('knox.checkpointGraphEditor', "Knox Checkpoint Graph")),
	[new SyncDescriptor(KnoxCheckpointGraphEditorInput)]
);

Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).registerEditorSerializer(KnoxMemoryEditorInput.ID, KnoxMemoryEditorInputSerializer);
Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).registerEditorSerializer(KnoxCheckpointGraphEditorInput.ID, KnoxCheckpointGraphEditorInputSerializer);

CommandsRegistry.registerCommand(KNOX_WORKBENCH_DIFF_COMMAND, (accessor, payload: IKnoxAgentDiffRanges | undefined) => {
	const service = accessor.get(IKnoxDiffDecorationService);
	if (!payload?.uri) {
		service.clear();
		return true;
	}
	if (knoxAgentDiffPayloadIsEmpty(payload)) {
		service.clear(payload.uri);
		return true;
	}
	service.setDecorations(payload);
	return true;
});
