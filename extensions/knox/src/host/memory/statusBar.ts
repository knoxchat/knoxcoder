import * as vscode from 'vscode';

import { t } from '../i18n';
import { onGuiLanguageChanged } from '../i18n/guiLanguage';

export const MEMORY_VIEW_COMMAND = 'knoxchat.viewMemory';
/** One step left of the CP item (priority 50). */
const MEMORY_STATUS_BAR_PRIORITY = 51;

export function registerMemoryStatusBar(context: vscode.ExtensionContext): vscode.StatusBarItem {
    const item = vscode.window.createStatusBarItem(
        'knox.memory',
        vscode.StatusBarAlignment.Right,
        MEMORY_STATUS_BAR_PRIORITY,
    );
    item.name = t('memory.view.title');
    // Same glyph as the Memory tab (media/memory.svg).
    item.text = '$(knox-memory) Memory';
    item.tooltip = t('memory.statusBar.tooltip');
    item.command = MEMORY_VIEW_COMMAND;
    item.show();
    context.subscriptions.push(
        item,
        onGuiLanguageChanged(() => {
            item.name = t('memory.view.title');
            item.tooltip = t('memory.statusBar.tooltip');
        }),
    );
    return item;
}
