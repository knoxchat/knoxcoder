/**
 * CPG-23: the status-bar CP item opens the graph, not the QuickPick list.
 *
 * The extension host bundles the extension separately from this test, so the
 * live status bar and CheckpointManager come from `extension.exports`.
 */

import * as assert from 'node:assert';
import * as vscode from 'vscode';

import { requireKnoxHostExtension } from '../util/knoxHostExtension';
import { CheckpointCommand } from './commandIds';

const GRAPH_TAB_TITLES = new Set(['Checkpoint Graph', '检查点图']);

type CheckpointManagerLike = {
    showCheckpointList: () => Promise<void>;
};

type ActivatedExtension = {
    extension: {
        extensionContext: vscode.ExtensionContext;
        checkpointManager: CheckpointManagerLike;
    };
};

function isStatusBarItem(value: unknown): value is vscode.StatusBarItem {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const item = value as { text?: unknown; show?: unknown; command?: unknown };
    return typeof item.text === 'string' && typeof item.show === 'function' && 'command' in item;
}

function graphTabs(): vscode.Tab[] {
    return vscode.window.tabGroups.all
        .flatMap((group) => group.tabs)
        .filter((tab) => GRAPH_TAB_TITLES.has(tab.label));
}

async function waitForGraphTabs(): Promise<vscode.Tab[]> {
    const deadline = Date.now() + 3_000;
    while (Date.now() < deadline) {
        const tabs = graphTabs();
        if (tabs.length > 0) {
            return tabs;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return graphTabs();
}

suite('Checkpoint graph click path (CPG-23)', () => {
    test('status-bar command is knox.checkpoints.view and does not open the QuickPick list', async () => {
        const extension = requireKnoxHostExtension();
        const api = await extension.activate() as ActivatedExtension;
        assert.ok(api.extension?.checkpointManager, 'test host should expose the extension instance');

        const contributedIcon = extension.packageJSON?.contributes?.icons?.['knox-checkpoint-graph'];
        assert.ok(contributedIcon, 'package.json must contribute knox-checkpoint-graph');
        assert.strictEqual(contributedIcon.default?.fontPath, './media/checkpoint-graph.woff');

        // The CP button moved to the workbench title bar; the status bar must no longer carry it.
        assert.strictEqual(
            api.extension.extensionContext.subscriptions.some((entry) => isStatusBarItem(entry) && entry.text.includes('CP')),
            false,
            'CP status bar item must not be created',
        );
        assert.notStrictEqual(CheckpointCommand.view, CheckpointCommand.list);

        const manager = api.extension.checkpointManager;
        const originalShowCheckpointList = manager.showCheckpointList.bind(manager);
        let listCalls = 0;
        manager.showCheckpointList = async () => {
            listCalls += 1;
            return originalShowCheckpointList();
        };

        let quickPickCalls = 0;
        const errorMessages: string[] = [];
        const originalShowQuickPick = vscode.window.showQuickPick;
        const originalShowErrorMessage = vscode.window.showErrorMessage;
        const originalShowInformationMessage = vscode.window.showInformationMessage;
        (vscode.window as { showQuickPick: typeof vscode.window.showQuickPick }).showQuickPick = (async () => {
            quickPickCalls += 1;
            return undefined;
        }) as typeof vscode.window.showQuickPick;
        (vscode.window as { showErrorMessage: typeof vscode.window.showErrorMessage }).showErrorMessage = (async (
            message: string,
        ) => {
            errorMessages.push(String(message));
            return undefined;
        }) as typeof vscode.window.showErrorMessage;
        (vscode.window as { showInformationMessage: typeof vscode.window.showInformationMessage }).showInformationMessage = (async () => {
            return undefined;
        }) as typeof vscode.window.showInformationMessage;

        try {
            await vscode.commands.executeCommand(CheckpointCommand.view);
            const opened = await waitForGraphTabs();
            const labels = vscode.window.tabGroups.all.flatMap((group) => group.tabs).map((tab) => tab.label);
            assert.ok(
                opened.length > 0,
                `knox.checkpoints.view opens the Checkpoint Graph panel (tabs=${JSON.stringify(labels)}, errors=${JSON.stringify(errorMessages)}, listCalls=${listCalls}, quickPicks=${quickPickCalls})`,
            );
            assert.deepStrictEqual(errorMessages, [], `view failed: ${errorMessages.join('; ')}`);
            assert.strictEqual(listCalls, 0, 'view must not call showCheckpointList');
            assert.strictEqual(quickPickCalls, 0, 'view must not open a QuickPick');

            const openCount = graphTabs().length;
            await vscode.commands.executeCommand(CheckpointCommand.view);
            assert.strictEqual(graphTabs().length, openCount, 'a second click reveals the same panel');
            assert.strictEqual(listCalls, 0);
            assert.strictEqual(quickPickCalls, 0);

            await vscode.commands.executeCommand(CheckpointCommand.list);
            assert.strictEqual(listCalls, 1, 'knox.checkpoints.list still calls showCheckpointList');
        } finally {
            manager.showCheckpointList = originalShowCheckpointList;
            (vscode.window as { showQuickPick: typeof vscode.window.showQuickPick }).showQuickPick = originalShowQuickPick;
            (vscode.window as { showErrorMessage: typeof vscode.window.showErrorMessage }).showErrorMessage = originalShowErrorMessage;
            (vscode.window as { showInformationMessage: typeof vscode.window.showInformationMessage }).showInformationMessage = originalShowInformationMessage;
            const tabs = graphTabs();
            if (tabs.length > 0) {
                await vscode.window.tabGroups.close(tabs);
            }
        }
    });
});
