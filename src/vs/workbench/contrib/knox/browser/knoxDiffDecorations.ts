/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { IModelDeltaDecoration, OverviewRulerLane, TrackedRangeStickiness } from '../../../../editor/common/model.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { themeColorFromId } from '../../../../platform/theme/common/themeService.js';
import { diffInsertedLine, diffRemovedLine } from '../../../../platform/theme/common/colors/editorColors.js';

export interface IKnoxDiffLineRange {
	readonly startLineNumber: number;
	readonly endLineNumber: number;
}

export interface IKnoxAgentDiffRanges {
	readonly uri: string;
	readonly red: ReadonlyArray<IKnoxDiffLineRange>;
	readonly green: ReadonlyArray<IKnoxDiffLineRange>;
	/** Streaming cursor (0-based, same as red/green). */
	readonly index?: ReadonlyArray<IKnoxDiffLineRange>;
	/** Unprocessed remainder of the stream range. */
	readonly belowIndex?: ReadonlyArray<IKnoxDiffLineRange>;
}

export const IKnoxDiffDecorationService = createDecorator<IKnoxDiffDecorationService>('knoxDiffDecorationService');

export interface IKnoxDiffDecorationService {
	readonly _serviceBrand: undefined;
	setDecorations(payload: IKnoxAgentDiffRanges): void;
	clear(uri?: string): void;
}

export const KNOX_WORKBENCH_DIFF_COMMAND = 'workbench.knox.setAgentDiffDecorations';

const removedOptions = {
	description: 'knox-agent-diff-removed',
	isWholeLine: true,
	className: 'line-delete',
	stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
	overviewRuler: { color: themeColorFromId(diffRemovedLine), position: OverviewRulerLane.Left },
};

const addedOptions = {
	description: 'knox-agent-diff-added',
	isWholeLine: true,
	className: 'line-insert',
	stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
	overviewRuler: { color: themeColorFromId(diffInsertedLine), position: OverviewRulerLane.Left },
};

const indexOptions = {
	description: 'knox-agent-diff-index',
	isWholeLine: true,
	className: 'knox-agent-diff-index',
	stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
};

const belowIndexOptions = {
	description: 'knox-agent-diff-pending',
	isWholeLine: true,
	className: 'knox-agent-diff-pending',
	stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
};

function toModelRange(range: IKnoxDiffLineRange) {
	return {
		startLineNumber: range.startLineNumber + 1,
		startColumn: 1,
		endLineNumber: range.endLineNumber + 1,
		endColumn: 1,
	};
}

export function knoxAgentDiffPayloadIsEmpty(payload: IKnoxAgentDiffRanges): boolean {
	return !payload.red?.length && !payload.green?.length && !payload.index?.length && !payload.belowIndex?.length;
}

export function knoxAgentDiffToDeltaDecorations(payload: IKnoxAgentDiffRanges): IModelDeltaDecoration[] {
	return [
		...payload.red.map(range => ({ range: toModelRange(range), options: removedOptions })),
		...payload.green.map(range => ({ range: toModelRange(range), options: addedOptions })),
		...(payload.index ?? []).map(range => ({ range: toModelRange(range), options: indexOptions })),
		...(payload.belowIndex ?? []).map(range => ({ range: toModelRange(range), options: belowIndexOptions })),
	];
}

/**
 * KN-173 / KN-340: model-scoped agent diff decorations so split editors all
 * show the same red/green (and streaming index) lines. Extension TextEditor
 * decorations are active-editor only.
 */
export class KnoxDiffDecorationService extends Disposable implements IKnoxDiffDecorationService {
	declare readonly _serviceBrand: undefined;

	private readonly _ids = new Map<string, string[]>();
	private readonly _latest = new Map<string, IKnoxAgentDiffRanges>();

	constructor(
		@IModelService private readonly modelService: IModelService,
		@ICodeEditorService private readonly codeEditorService: ICodeEditorService,
	) {
		super();
		this._register(this.modelService.onModelAdded(model => {
			const payload = this._latest.get(model.uri.toString());
			if (payload) {
				this.setDecorations(payload);
			}
		}));
		this._register(this.codeEditorService.onCodeEditorAdd((editor: ICodeEditor) => {
			const model = editor.getModel();
			if (!model) {
				return;
			}
			const payload = this._latest.get(model.uri.toString());
			if (payload) {
				this.setDecorations(payload);
			}
		}));
	}

	setDecorations(payload: IKnoxAgentDiffRanges): void {
		const key = payload.uri;
		if (knoxAgentDiffPayloadIsEmpty(payload)) {
			this.clear(key);
			return;
		}
		this._latest.set(key, payload);
		const model = this.modelService.getModel(URI.parse(key));
		if (!model) {
			return;
		}
		const previous = this._ids.get(key) ?? [];
		this._ids.set(key, model.deltaDecorations(previous, knoxAgentDiffToDeltaDecorations(payload)));
	}

	clear(uri?: string): void {
		const keys = uri ? [uri] : Array.from(this._ids.keys());
		for (const key of keys) {
			this._latest.delete(key);
			const model = this.modelService.getModel(URI.parse(key));
			const previous = this._ids.get(key) ?? [];
			if (model && previous.length) {
				model.deltaDecorations(previous, []);
			}
			this._ids.delete(key);
		}
	}
}

registerSingleton(IKnoxDiffDecorationService, KnoxDiffDecorationService, InstantiationType.Delayed);
