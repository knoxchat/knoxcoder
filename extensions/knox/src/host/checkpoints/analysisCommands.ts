import * as vscode from 'vscode';

import { t } from '../i18n';
import { CheckpointManager } from './CheckpointManager';
import { checkpointIdFromArg } from './commandIds';
import { formatCheckpointAnalysisMarkdown } from './manager/analysis';
import { isListableCheckpoint } from './manager/listQuery';

export async function showCheckpointAnalysis(arg?: unknown): Promise<void> {
    const checkpointManager = CheckpointManager.getInstance();
    if (!checkpointManager.isReady()) {
        vscode.window.showErrorMessage(t('checkpoint.systemNotInit'));
        return;
    }

    let checkpointId = checkpointIdFromArg(arg);
    if (!checkpointId) {
        const history = checkpointManager.getCheckpointHistoryForWorkspace()
            .filter(isListableCheckpoint)
            .sort((a, b) => b.created.getTime() - a.created.getTime());
        if (history.length === 0) {
            vscode.window.showInformationMessage(t('checkpoint.noCheckpoints'));
            return;
        }
        const selected = await vscode.window.showQuickPick(
            history.map((checkpoint) => ({
                label: `$(graph) ${checkpoint.description}`,
                description: checkpoint.created.toLocaleString(),
                detail: checkpoint.id,
                checkpointId: checkpoint.id,
            })),
            { placeHolder: t('checkpoint.analysis.selectCheckpoint') },
        );
        if (!selected) {
            return;
        }
        checkpointId = selected.checkpointId;
    }

    const analysis = await checkpointManager.analyzeCheckpoint(checkpointId);
    if (!analysis) {
        vscode.window.showWarningMessage(t('checkpoint.notFound'));
        return;
    }
    const groups = await checkpointManager.suggestCheckpointGroups();
    const markdown = formatCheckpointAnalysisMarkdown(analysis, groups);
    const document = await vscode.workspace.openTextDocument({
        content: markdown,
        language: 'markdown',
    });
    await vscode.window.showTextDocument(document, { preview: true });
}
