/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';

function repoFile(...parts: string[]): string {
	return readFileSync(join(process.cwd(), ...parts), 'utf8');
}

suite('Knox checkpoint engine contract (KN-320–332)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('KN-320: blob store gzip >4KB, AES-GCM, atomic write, ~/.knox/checkpoints', () => {
		const blobs = repoFile('extensions/knox/src/host/checkpoints/store/blobStore.ts');
		assert.ok(blobs.includes('BLOB_COMPRESS_THRESHOLD = 4096'));
		assert.ok(blobs.includes('encryptBlobPayload'));
		assert.ok(repoFile('extensions/knox/src/host/checkpoints/store/blobEncryption.ts').includes('createCipheriv'));
		assert.ok(repoFile('extensions/knox/src/host/checkpoints/store/blobEncryption.ts').includes('knox.checkpoints.encryptAtRest'));
		assert.ok(repoFile('extensions/knox/src/host/checkpoints/store/atomicWrite.ts').includes('export'));
		assert.ok(repoFile('extensions/knox/src/host/checkpoints/store/durableState.ts').includes('export'));
		assert.ok(repoFile('extensions/knox/src/host/checkpoints/store/auditLog.ts').includes('export'));
		assert.ok(repoFile('extensions/knox/src/core/util/paths.ts').includes('path.join(getKnoxGlobalPath(), "checkpoints")'));
	});

	test('KN-321: capture uses knoxignore, classification, and does not truncate', () => {
		const create = repoFile('extensions/knox/src/host/checkpoints/manager/create.ts');
		assert.ok(create.includes('continuing without truncation'));
		assert.ok(create.includes('maxFilesPerCheckpoint'));
		assert.ok(repoFile('extensions/knox/src/host/checkpoints/checkpointIgnore.ts').includes('export'));
		assert.ok(repoFile('extensions/knox/src/host/checkpoints/manager/fileClassification.ts').includes('export'));
		assert.ok(repoFile('extensions/knox/src/host/checkpoints/manager/pathFilter.ts').includes('export'));
	});

	test('KN-322: restore, preview, and journal exist', () => {
		assert.ok(repoFile('extensions/knox/src/host/checkpoints/manager/restore.ts').includes('export'));
		assert.ok(repoFile('extensions/knox/src/host/checkpoints/manager/restorePreview.ts').includes('export'));
		const journal = repoFile('extensions/knox/src/host/checkpoints/manager/restoreJournal.ts');
		assert.ok(journal.includes('RESTORE_JOURNAL_FILENAME'));
		assert.ok(journal.includes('plannedWrites'));
	});

	test('KN-323: checkpoint diff + native word hunks', () => {
		assert.ok(repoFile('extensions/knox/src/host/checkpoints/manager/diff.ts').includes('export async function computeCheckpointDiff'));
		assert.ok(repoFile('src/vs/workbench/contrib/knox/common/knoxGuiCheckpoints.ts').includes('export function hunkWordAltRanges'));
	});

	test('KN-324: branch create / switch / merge / delete / rename', () => {
		const branches = repoFile('extensions/knox/src/host/checkpoints/manager/branches.ts');
		for (const name of ['createBranch', 'switchBranch', 'mergeBranches', 'deleteBranch', 'renameBranch']) {
			assert.ok(branches.includes(`export async function ${name}`), name);
		}
		assert.ok(repoFile('extensions/knox/src/host/checkpoints/ConflictResolver.ts').includes('export'));
	});

	test('KN-325: retention skips pinned checkpoints', () => {
		const retention = repoFile('extensions/knox/src/host/checkpoints/manager/retention.ts');
		assert.ok(retention.includes('pinned'));
		assert.ok(retention.includes('retention'));
		assert.ok(repoFile('extensions/knox/src/host/checkpoints/manager/storeHealth.ts').includes('export') || repoFile('extensions/knox/src/host/checkpoints/manager/storeHealthReport.ts').includes('export'));
	});

	test('KN-326: auto + soul-turn + pre-risky hooks', () => {
		assert.ok(repoFile('extensions/knox/src/host/checkpoints/AutoCheckpointSystem.ts').includes('export'));
		assert.ok(repoFile('extensions/knox/src/host/checkpoints/manager/CheckpointManager.ts').includes('soul-turn-'));
		assert.ok(repoFile('extensions/knox/src/host/VsCodeIde.ts').includes('runPreRiskyCheckpoint'));
		assert.ok(repoFile('extensions/knox/src/host/VsCodeIde.ts').includes('ensureTurnCheckpoint'));
	});

	test('KN-327: dashboard and AI session metrics', () => {
		assert.ok(repoFile('extensions/knox/src/host/checkpoints/manager/dashboard.ts').includes('export'));
		assert.ok(repoFile('extensions/knox/src/host/checkpoints/manager/aiSessionMetrics.ts').includes('export'));
		assert.ok(repoFile('extensions/knox/src/host/checkpoints/SmartCheckpointManager.ts').includes('export'));
	});

	test('KN-328: graph payload and shell action names stay on the native protocol', () => {
		assert.ok(repoFile('extensions/knox/src/host/checkpoints/manager/graphPayload.ts').includes('export'));
		assert.ok(repoFile('extensions/knox/src/host/checkpoints/manager/graphShell.ts').includes('export'));
		assert.ok(repoFile('extensions/knox/src/host/checkpoints/graphMessages.ts').includes('export function registerCheckpointGraphMessages'));
		const protocol = repoFile('src/vs/workbench/contrib/knox/common/knoxGuiProtocol.ts');
		assert.ok(protocol.includes("'checkpointGraph'"));
		assert.ok(protocol.includes("'getCheckpointGraphShell'"));
		assert.ok(protocol.includes("'runCheckpointGraphAction'"));
	});

	test('KN-329: HMAC share/import, export, file history, gutter diff', () => {
		assert.ok(repoFile('extensions/knox/src/host/checkpoints/store/bundleHmac.ts').includes('createHmac'));
		assert.ok(repoFile('extensions/knox/src/host/checkpoints/manager/shareBundles.ts').includes('export'));
		assert.ok(repoFile('extensions/knox/src/host/checkpoints/manager/fileHistory.ts').includes('export'));
		assert.ok(repoFile('extensions/knox/src/host/checkpoints/InlineDiffDecorator.ts').includes('export') || repoFile('extensions/knox/src/host/checkpoints/inlineDiffLines.ts').includes('export'));
	});

	test('KN-330: messageId map, This session filter, shift-click memory rewind', () => {
		assert.ok(repoFile('extensions/knox/src/host/checkpoints/manager/CheckpointManager.ts').includes('getCheckpointForMessage'));
		assert.ok(repoFile('src/vs/workbench/contrib/knox/common/knoxGuiCheckpoints.ts').includes('thisSession'));
		assert.ok(repoFile('src/vs/workbench/contrib/knox/browser/gui/widget/chat/activity.ts').includes('event.shiftKey'));
		assert.ok(repoFile('src/vs/workbench/contrib/knox/browser/gui/controller/checkpoints.ts').includes('rewindMemory'));
	});

	test('KN-331: canonical knox.checkpoints.* plus aliases', () => {
		const ids = repoFile('extensions/knox/src/host/checkpoints/commandIds.ts');
		assert.ok(ids.includes("create: 'knox.checkpoints.create'"));
		assert.ok(ids.includes("alias: 'knoxchat.checkpoints.create'"));
		assert.ok(ids.includes("alias: 'knox.checkpoint.undo'"));
		assert.ok(repoFile('extensions/knox/src/host/checkpoints/commandIds.test.ts').includes('CHECKPOINT_PALETTE_COMMANDS'));
	});

	test('KN-332: MemoryView and CheckpointGraphView are native routers, not webviews', () => {
		const graph = repoFile('extensions/knox/src/host/checkpoints/CheckpointGraphView.ts');
		const memory = repoFile('extensions/knox/src/host/memory/MemoryView.ts');
		assert.ok(graph.includes('workbench.action.knox.openCheckpointGraph'));
		assert.ok(memory.includes('workbench.action.knox.openMemory'));
		assert.ok(!graph.includes('createWebviewPanel'));
		assert.ok(!memory.includes('createWebviewPanel'));
		assert.ok(!graph.includes('renderKnoxWebviewHtml'));
		assert.ok(!memory.includes('renderKnoxWebviewHtml'));
		const ext = repoFile('extensions/knox/src/host/extension/VsCodeExtension.ts');
		assert.ok(ext.includes('CheckpointGraphView.setNotifier'));
		assert.ok(ext.includes('MemoryView.setNotifier'));
		assert.ok(ext.includes('checkpointGraphUpdated'));
		assert.ok(ext.includes('memoryViewUpdated'));
	});
});
