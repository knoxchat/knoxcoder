/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'mocha';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
	CHECKPOINT_COMMAND_ALIASES,
	CHECKPOINT_PALETTE_COMMANDS,
	CHECKPOINT_TREE_COMMANDS,
	CHECKPOINT_TREE_VIEW_ID,
	CheckpointCommand,
	aliasesFor,
} from '../checkpoints/commandIds';
import { knoxExtensionRoot } from './paths';

type ContributedCommand = {
	command: string;
	title: string;
	category?: string;
};

type PackageJson = {
	name: string;
	publisher: string;
	contributes?: {
		commands?: ContributedCommand[];
		menus?: {
			commandPalette?: Array<{ command: string; when?: string }>;
			'explorer/context'?: Array<{ command: string }>;
			'editor/context'?: Array<{ command: string }>;
		};
		viewsContainers?: {
			activitybar?: Array<{ id: string }>;
			secondarySidebar?: Array<{ id: string }>;
		};
		views?: {
			knoxchat?: Array<{ id: string }>;
			explorer?: Array<{ id: string }>;
		};
		keybindings?: Array<{ command: string; key?: string; mac?: string }>;
	};
};

function loadPackage(): PackageJson {
	return JSON.parse(
		fs.readFileSync(path.join(knoxExtensionRoot(), 'package.json'), 'utf8'),
	) as PackageJson;
}

function contributedCheckpointCommands(pkg: PackageJson): ContributedCommand[] {
	const commands = pkg.contributes?.commands ?? [];
	return commands.filter((entry) =>
		entry.command.startsWith('knox.checkpoints.')
		|| entry.command.startsWith('knox.checkpoint.')
		|| entry.command.startsWith('knoxchat.checkpoints.'),
	);
}

suite('Checkpoint command surface (CP-16)', () => {
	const pkg = loadPackage();

	test('bundled identity is vscode.knox', () => {
		assert.strictEqual(pkg.publisher, 'vscode');
		assert.strictEqual(pkg.name, 'knox');
	});

	test('chat view is pinned to the Secondary Side Bar', () => {
		assert.ok(
			pkg.contributes?.viewsContainers?.secondarySidebar?.some((container) => container.id === 'knoxchat'),
			'knoxchat view container must be contributed to secondarySidebar',
		);
		assert.strictEqual(pkg.contributes?.viewsContainers?.activitybar, undefined);
		assert.ok(
			pkg.contributes?.views?.knoxchat?.some((view) => view.id === 'knoxchat.knoxGUIView'),
			'knoxchat.knoxGUIView must stay in the knoxchat container',
		);
	});

	test('palette contributes exactly the canonical Knox Checkpoints commands', () => {
		const contributed = contributedCheckpointCommands(pkg);
		const paletteIds = contributed
			.map((entry) => entry.command)
			.filter((id) => (CHECKPOINT_PALETTE_COMMANDS as readonly string[]).includes(id))
			.sort();
		assert.deepStrictEqual(paletteIds, [...CHECKPOINT_PALETTE_COMMANDS].sort());

		const treeIds = contributed
			.map((entry) => entry.command)
			.filter((id) => (CHECKPOINT_TREE_COMMANDS as readonly string[]).includes(id))
			.sort();
		assert.deepStrictEqual(treeIds, [...CHECKPOINT_TREE_COMMANDS].sort());

		for (const entry of contributed) {
			assert.strictEqual(
				entry.category,
				'Knox Checkpoints',
				`${entry.command} must use the Knox Checkpoints category`,
			);
		}
	});

	test('tree commands are hidden from the Command Palette', () => {
		const menus = pkg.contributes?.menus?.commandPalette ?? [];
		for (const id of CHECKPOINT_TREE_COMMANDS) {
			const entry = menus.find((item) => item.command === id);
			assert.ok(entry, `${id} should be listed in commandPalette menus`);
			assert.strictEqual(entry?.when, 'false', `${id} must not appear in the Command Palette`);
		}
	});

	test('Explorer contributes the checkpoints tree view', () => {
		const explorer = pkg.contributes?.views?.explorer ?? [];
		assert.ok(
			explorer.some((view) => view.id === CHECKPOINT_TREE_VIEW_ID),
			'knox.checkpoints.view must be contributed to Explorer',
		);
	});

	test('file history is contributed to Explorer and editor context menus', () => {
		const menus = pkg.contributes?.menus;
		assert.ok(
			(menus?.['explorer/context'] ?? []).some((entry) => entry.command === CheckpointCommand.fileHistory),
			'knox.checkpoints.fileHistory must appear on Explorer file context menus',
		);
		assert.ok(
			(menus?.['editor/context'] ?? []).some((entry) => entry.command === CheckpointCommand.fileHistory),
			'knox.checkpoints.fileHistory must appear on editor context menus',
		);
	});

	test('legacy IDs are aliases, not a second palette entry', () => {
		const contributed = new Set(contributedCheckpointCommands(pkg).map((entry) => entry.command));
		const aliasIds = CHECKPOINT_COMMAND_ALIASES.map((entry) => entry.alias);

		for (const alias of aliasIds) {
			assert.strictEqual(
				contributed.has(alias),
				false,
				`${alias} must not appear in the Command Palette`,
			);
		}

		assert.strictEqual(contributed.has(CheckpointCommand.init), false);
		assert.strictEqual(contributed.has(CheckpointCommand.healthMetrics), false);
	});

	test('checkpoint keybindings are contributed for create, undo, redo, list, and file history', () => {
		const keybindings = pkg.contributes?.keybindings ?? [];
		const byCommand = new Map(keybindings.map((entry) => [entry.command, entry]));
		const expected = [
			CheckpointCommand.create,
			CheckpointCommand.undo,
			CheckpointCommand.redo,
			CheckpointCommand.list,
			CheckpointCommand.fileHistory,
		];
		for (const id of expected) {
			const binding = byCommand.get(id);
			assert.ok(binding, `${id} must have a contributed keybinding`);
			assert.ok(binding?.key, `${id} must define a Windows/Linux key`);
			assert.ok(binding?.mac, `${id} must define a macOS key`);
		}
	});

	test('no two palette commands share a title', () => {
		const contributed = contributedCheckpointCommands(pkg);
		const titles = contributed.map((entry) => entry.title);
		assert.strictEqual(titles.length, new Set(titles).size);
	});

	test('every alias forwards to knox.checkpoints.*', () => {
		for (const { alias, canonical } of CHECKPOINT_COMMAND_ALIASES) {
			assert.ok(
				canonical.startsWith('knox.checkpoints.'),
				`${alias} must alias a knox.checkpoints.* command, got ${canonical}`,
			);
			assert.notStrictEqual(alias, canonical);
			assert.ok(aliasesFor(canonical).includes(alias));
		}
	});

	test('New Conversation stays knoxchat.newSession', () => {
		const commands = pkg.contributes?.commands ?? [];
		assert.ok(
			commands.some((entry) => entry.command === 'knoxchat.newSession' && /new conversation/i.test(entry.title)),
			'knoxchat.newSession must remain the New Conversation command',
		);
	});
});
