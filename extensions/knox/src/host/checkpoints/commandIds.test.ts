import * as assert from 'node:assert';
import * as vscode from 'vscode';

import { requireKnoxHostExtension } from '../util/knoxHostExtension';
import {
    CHECKPOINT_COMMAND_ALIASES,
    CHECKPOINT_PALETTE_COMMANDS,
    CHECKPOINT_TREE_COMMANDS,
    CHECKPOINT_TREE_VIEW_ID,
    CheckpointCommand,
    aliasesFor,
} from './commandIds';

type ContributedCommand = {
    command: string;
    title: string;
    category?: string;
};

function contributedCheckpointCommands(): ContributedCommand[] {
    const extension = requireKnoxHostExtension();
    const commands = (extension.packageJSON?.contributes?.commands ?? []) as ContributedCommand[];
    return commands.filter((entry) =>
        entry.command.startsWith('knox.checkpoints.')
        || entry.command.startsWith('knox.checkpoint.')
        || entry.command.startsWith('knoxchat.checkpoints.'),
    );
}

suite('Checkpoint command surface (CP-16)', () => {
    test('palette contributes exactly the canonical Knox Checkpoints commands', () => {
        const contributed = contributedCheckpointCommands();
        const paletteIds = contributed
            .map((entry) => entry.command)
            .filter((id) => (CHECKPOINT_PALETTE_COMMANDS as readonly string[]).includes(id))
            .sort();
        assert.deepStrictEqual(paletteIds, [...CHECKPOINT_PALETTE_COMMANDS].sort());

        const treeIds = contributed
            .map((entry) => entry.command)
            .filter((id) => (CHECKPOINT_TREE_COMMANDS as readonly string[]).includes(id))
            .sort();
        assert.deepStrictEqual(treeIds, [], 'Explorer tree commands must not be contributed');

        for (const entry of contributed) {
            assert.strictEqual(
                entry.category,
                'Knox Checkpoints',
                `${entry.command} must use the Knox Checkpoints category`,
            );
        }
    });

    test('former Explorer tree commands are not contributed', () => {
        const contributed = new Set(contributedCheckpointCommands().map((entry) => entry.command));
        for (const id of CHECKPOINT_TREE_COMMANDS) {
            assert.strictEqual(contributed.has(id), false, `${id} must not be contributed`);
        }

        const extension = requireKnoxHostExtension();
        const menus = (extension.packageJSON?.contributes?.menus?.commandPalette ?? []) as Array<{
            command: string;
            when?: string;
        }>;
        for (const id of CHECKPOINT_TREE_COMMANDS) {
            assert.strictEqual(
                menus.some((item) => item.command === id),
                false,
                `${id} must not appear in commandPalette menus`,
            );
        }
    });

    test('Explorer does not contribute the checkpoints tree view', () => {
        const extension = requireKnoxHostExtension();
        const explorer = (extension.packageJSON?.contributes?.views?.explorer ?? []) as Array<{ id: string }>;
        assert.ok(
            !explorer.some((view) => view.id === CHECKPOINT_TREE_VIEW_ID),
            'knox.checkpoints.view must not be contributed to Explorer',
        );
    });

    test('file history is contributed to Explorer and editor context menus', () => {
        const extension = requireKnoxHostExtension();
        const menus = extension.packageJSON?.contributes?.menus as {
            'explorer/context'?: Array<{ command: string }>;
            'editor/context'?: Array<{ command: string }>;
        };
        assert.ok(
            (menus['explorer/context'] ?? []).some((entry) => entry.command === CheckpointCommand.fileHistory),
            'knox.checkpoints.fileHistory must appear on Explorer file context menus',
        );
        assert.ok(
            (menus['editor/context'] ?? []).some((entry) => entry.command === CheckpointCommand.fileHistory),
            'knox.checkpoints.fileHistory must appear on editor context menus',
        );
    });

    test('legacy IDs are aliases, not a second palette entry', () => {
        const contributed = new Set(contributedCheckpointCommands().map((entry) => entry.command));
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
        const extension = requireKnoxHostExtension();
        const keybindings = (extension.packageJSON?.contributes?.keybindings ?? []) as Array<{
            command: string;
            key?: string;
            mac?: string;
        }>;
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
        const contributed = contributedCheckpointCommands();
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

    test('core commands and their aliases are registered', async () => {
        const extension = requireKnoxHostExtension();
        await extension.activate();

        const registered = new Set(await vscode.commands.getCommands(true));
        const alwaysRegistered = [
            CheckpointCommand.create,
            CheckpointCommand.view,
            CheckpointCommand.list,
            CheckpointCommand.restore,
            CheckpointCommand.fileHistory,
            CheckpointCommand.stats,
            CheckpointCommand.export,
            CheckpointCommand.share,
            CheckpointCommand.import,
            CheckpointCommand.cleanup,
            CheckpointCommand.undo,
            CheckpointCommand.redo,
            CheckpointCommand.toggleAuto,
            CheckpointCommand.showConfiguration,
        ];

        for (const id of alwaysRegistered) {
            assert.ok(registered.has(id), `${id} should be registered`);
            for (const alias of aliasesFor(id)) {
                assert.ok(registered.has(alias), `${alias} should be registered as an alias of ${id}`);
            }
        }

        assert.ok(registered.has(CheckpointCommand.init));
        assert.strictEqual(
            aliasesFor(CheckpointCommand.init).length,
            0,
            'init is canonical-only and is not a palette command',
        );
    });
});
