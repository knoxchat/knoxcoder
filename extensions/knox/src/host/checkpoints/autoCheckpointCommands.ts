import * as vscode from 'vscode';
import { t } from '../i18n';
import { AutoCheckpointSystem } from './AutoCheckpointSystem';
import { CheckpointCommand, registerCanonicalCommand } from './commandIds';

/**
 * Register auto-checkpoint commands
 */
export function registerAutoCheckpointCommands(context: vscode.ExtensionContext): void {
    const autoCheckpoint = AutoCheckpointSystem.getInstance();
    
    // Initialize
    autoCheckpoint.initialize(context);
    
    registerCanonicalCommand(context, CheckpointCommand.undo, async () => {
        await autoCheckpoint.undo();
    });

    registerCanonicalCommand(context, CheckpointCommand.redo, async () => {
        await autoCheckpoint.redo();
    });

    registerCanonicalCommand(context, CheckpointCommand.createBranch, async () => {
        const name = await vscode.window.showInputBox({
            prompt: t('checkpoint.auto.enterBranchName'),
            placeHolder: t('checkpoint.auto.branchPlaceholder'),
        });
        if (!name?.trim()) {
            return;
        }
        await autoCheckpoint.createBranch(name.trim());
    });
    registerCanonicalCommand(context, CheckpointCommand.switchBranch, async () => {
        const branches = await autoCheckpoint.getBranches();
        if (branches.length === 0) {
            vscode.window.showInformationMessage(t('checkpoint.auto.noBranches'));
            return;
        }
        const current = autoCheckpoint.getCurrentBranch();
        const selected = await vscode.window.showQuickPick(
            branches.map((branch) => ({
                label: `${branch.id === current?.id ? '$(arrow-right) ' : ''}${branch.name}`,
                description: branch.id === current?.id ? '(current)' : branch.headCheckpointId.substring(0, 8),
                branchId: branch.id,
            })),
            { placeHolder: t('checkpoint.auto.selectBranch') },
        );
        if (selected) {
            await autoCheckpoint.switchBranch(selected.branchId, { offerRestore: true });
        }
    });
    registerCanonicalCommand(context, CheckpointCommand.mergeBranch, async () => {
        const branches = await autoCheckpoint.getBranches();
        const current = autoCheckpoint.getCurrentBranch();
        const sources = branches.filter((branch) => branch.id !== current?.id);
        if (!current) {
            vscode.window.showErrorMessage(t('checkpoint.auto.noCurrentBranchToMerge'));
            return;
        }
        if (sources.length === 0) {
            vscode.window.showInformationMessage(t('checkpoint.auto.noBranches'));
            return;
        }
        const selected = await vscode.window.showQuickPick(
            sources.map((branch) => ({
                label: branch.name,
                description: branch.headCheckpointId.substring(0, 8),
                branchId: branch.id,
            })),
            { placeHolder: t('checkpoint.auto.selectMergeSource') },
        );
        if (selected) {
            await autoCheckpoint.mergeBranch(selected.branchId);
        }
    });
    registerCanonicalCommand(context, CheckpointCommand.deleteBranch, async () => {
        const branches = await autoCheckpoint.getBranches();
        const current = autoCheckpoint.getCurrentBranch();
        const deletable = branches.filter((branch) => branch.id !== current?.id);
        if (deletable.length === 0) {
            vscode.window.showInformationMessage(t('checkpoint.auto.noBranches'));
            return;
        }
        const selected = await vscode.window.showQuickPick(
            deletable.map((branch) => ({
                label: branch.name,
                description: branch.headCheckpointId.substring(0, 8),
                branchId: branch.id,
            })),
            { placeHolder: t('checkpoint.auto.selectDeleteBranch') },
        );
        if (selected) {
            await autoCheckpoint.deleteBranch(selected.branchId);
        }
    });

    registerCanonicalCommand(context, CheckpointCommand.toggleAuto, () => {
        const config = autoCheckpoint.getConfig();
        autoCheckpoint.setEnabled(!config.enabled);

        vscode.window.showInformationMessage(
            t('checkpoint.auto.toggled', { status: config.enabled ? 'disabled' : 'enabled' })
        );
    });

    registerCanonicalCommand(context, CheckpointCommand.showUndoHistory, async () => {
        const state = autoCheckpoint.getUndoRedoStack();
        const items = [];
        for (let i = 0; i < state.stack.length; i++) {
            const checkpointId = state.stack[i];
            const isCurrent = i === state.currentIndex;

            items.push({
                label: `${isCurrent ? '$(arrow-right) ' : ''}${checkpointId.substring(0, 8)}`,
                description: isCurrent ? '(current)' : '',
                index: i,
            });
        }

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: t('checkpoint.auto.selectCheckpoint'),
        });

        if (selected) {
            await autoCheckpoint.jumpToCheckpoint(selected.index);
        }
    });
    
    // Save state on deactivation
    context.subscriptions.push({
        dispose: async () => {
            await autoCheckpoint.saveUndoRedoState(context);
            autoCheckpoint.dispose();
        }
    });
}
