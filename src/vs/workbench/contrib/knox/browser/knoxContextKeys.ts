/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IContextKey, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import {
	KnoxChatMode,
	KnoxLumpSectionContext,
	KnoxModeContext,
	KnoxNativeGuiContext,
	KnoxPermissionMode,
	KnoxPermissionModeContext,
	KnoxSessionStreamingContext,
	KnoxToolPendingContext,
} from '../common/knoxChat.js';
import { IKnoxChatService } from '../common/knoxChatService.js';

class KnoxContextKeysContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.knoxContextKeys';

	private readonly _nativeGui: IContextKey<boolean>;
	private readonly _streaming: IContextKey<boolean>;
	private readonly _mode: IContextKey<KnoxChatMode>;
	private readonly _toolPending: IContextKey<boolean>;
	private readonly _permissionMode: IContextKey<KnoxPermissionMode>;
	private readonly _lumpSection: IContextKey<string>;

	constructor(
		@IContextKeyService contextKeyService: IContextKeyService,
		@IKnoxChatService private readonly _chatService: IKnoxChatService,
	) {
		super();
		this._nativeGui = KnoxNativeGuiContext.bindTo(contextKeyService);
		this._streaming = KnoxSessionStreamingContext.bindTo(contextKeyService);
		this._mode = KnoxModeContext.bindTo(contextKeyService);
		this._toolPending = KnoxToolPendingContext.bindTo(contextKeyService);
		this._permissionMode = KnoxPermissionModeContext.bindTo(contextKeyService);
		this._lumpSection = KnoxLumpSectionContext.bindTo(contextKeyService);

		this._nativeGui.set(true);
		this._updateFromChat();

		this._register(_chatService.onDidChange(() => this._updateFromChat()));
	}

	private _updateFromChat(): void {
		this._streaming.set(this._chatService.isStreaming);
		this._mode.set(this._chatService.mode);
		this._toolPending.set(this._chatService.toolPending);
		this._permissionMode.set(this._chatService.permissionMode);
		this._lumpSection.set(this._chatService.lumpSection ?? '');
	}
}

registerWorkbenchContribution2(KnoxContextKeysContribution.ID, KnoxContextKeysContribution, WorkbenchPhase.BlockStartup);
