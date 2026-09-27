/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { workbenchInstantiationService } from '../../../test/browser/workbenchTestServices.js';
import { knoxAgentDiffPayloadIsEmpty, knoxAgentDiffToDeltaDecorations, KnoxDiffDecorationService } from './knoxDiffDecorations.js';

suite('KnoxDiffDecorationService (KN-340)', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('empty payload is occupancy of red, green, and streaming index', () => {
		assert.strictEqual(knoxAgentDiffPayloadIsEmpty({
			uri: 'file:///a.ts',
			red: [],
			green: [],
		}), true);
		assert.strictEqual(knoxAgentDiffPayloadIsEmpty({
			uri: 'file:///a.ts',
			red: [],
			green: [],
			index: [{ startLineNumber: 3, endLineNumber: 3 }],
		}), false);
	});

	test('0-based host lines become 1-based model decorations', () => {
		const decorations = knoxAgentDiffToDeltaDecorations({
			uri: 'file:///a.ts',
			red: [{ startLineNumber: 0, endLineNumber: 1 }],
			green: [{ startLineNumber: 2, endLineNumber: 2 }],
			index: [{ startLineNumber: 4, endLineNumber: 4 }],
		});
		assert.strictEqual(decorations[0].range.startLineNumber, 1);
		assert.strictEqual(decorations[0].range.endLineNumber, 2);
		assert.strictEqual(decorations[0].options.description, 'knox-agent-diff-removed');
		assert.strictEqual(decorations[1].options.description, 'knox-agent-diff-added');
		assert.strictEqual(decorations[1].range.startLineNumber, 3);
		assert.strictEqual(decorations[2].options.description, 'knox-agent-diff-index');
	});

	test('setDecorations is model-scoped so every split of the uri sees the same ranges', () => {
		const instantiationService = disposables.add(workbenchInstantiationService(undefined, disposables));
		const service = disposables.add(instantiationService.createInstance(KnoxDiffDecorationService));
		const modelService = instantiationService.get(IModelService);
		const uri = URI.parse('file:///knox-vertical-diff.ts');
		const model = disposables.add(modelService.createModel('a\nb\nc\nd\n', null, uri));

		service.setDecorations({
			uri: uri.toString(),
			red: [{ startLineNumber: 0, endLineNumber: 0 }],
			green: [{ startLineNumber: 1, endLineNumber: 2 }],
		});

		const descriptions = model.getAllDecorations().map(d => d.options.description);
		assert.ok(descriptions.includes('knox-agent-diff-removed'));
		assert.ok(descriptions.includes('knox-agent-diff-added'));
		const removed = model.getAllDecorations().find(d => d.options.description === 'knox-agent-diff-removed');
		assert.strictEqual(removed?.range.startLineNumber, 1);

		service.clear(uri.toString());
		assert.strictEqual(model.getAllDecorations().filter(d => d.options.description?.startsWith('knox-agent-diff-')).length, 0);
	});

	test('decorations apply when the model is created after the payload', () => {
		const instantiationService = disposables.add(workbenchInstantiationService(undefined, disposables));
		const service = disposables.add(instantiationService.createInstance(KnoxDiffDecorationService));
		const modelService = instantiationService.get(IModelService);
		const uri = URI.parse('file:///knox-vertical-diff-late.ts');

		service.setDecorations({
			uri: uri.toString(),
			red: [],
			green: [{ startLineNumber: 0, endLineNumber: 0 }],
		});

		const model = disposables.add(modelService.createModel('only\n', null, uri));
		assert.ok(model.getAllDecorations().some(d => d.options.description === 'knox-agent-diff-added'));
		service.clear();
	});
});
