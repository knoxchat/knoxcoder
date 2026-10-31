import * as vscode from 'vscode';

import {
    formatJevLogEntry,
    getActiveJevRuntime,
    getJevActivityState,
    getJevLogEntries,
    onJevActivity,
    onJevConfig,
    onJevLog,
} from 'core/jev';

import { t } from '../i18n';
import { onGuiLanguageChanged } from '../i18n/guiLanguage';

// The Memory and Checkpoint Graph buttons now live in the workbench title bar
// (src/vs/workbench/contrib/knox/browser/knoxTitlebarActions.ts).

export const JEV_LOG_COMMAND = 'knoxchat.showJevLog';
const JEV_STATUS_BAR_PRIORITY = 52;

/**
 * Status bar indicator for Jev calls (K-007): a spinner while a call is in
 * flight, a warning when the circuit breaker is open, and an output channel
 * with one line per call. Hidden while Jev itself is off (GUI Settings,
 * YAML `jev.enabled`, or `knoxchat.jev.enabled`) even if the vscode setting
 * still defaults on — the GUI toggle writes shared config, not that setting.
 */
export function registerJevStatusBar(context: vscode.ExtensionContext): vscode.StatusBarItem {
    const channel = vscode.window.createOutputChannel('Knox Jev');
    const item = vscode.window.createStatusBarItem(
        'knox.jev',
        vscode.StatusBarAlignment.Right,
        JEV_STATUS_BAR_PRIORITY,
    );
    item.name = 'Knox Jev';
    item.command = JEV_LOG_COMMAND;

    const visible = () =>
        vscode.workspace.getConfiguration('knoxchat').get<boolean>('jev.showStatusBar', true) !== false &&
        getActiveJevRuntime().enabled;

    const render = (state = getJevActivityState()) => {
        if (!visible()) {
            item.hide();
            return;
        }
        const paused = state.breakerOpenUntil > Date.now();
        item.text = state.inFlight > 0 ? '$(sync~spin) Jev' : paused ? '$(warning) Jev' : '$(pulse) Jev';
        item.tooltip = paused ? t('jev.statusBar.paused') : t('jev.statusBar.tooltip');
        item.show();
    };

    for (const entry of getJevLogEntries()) {
        channel.appendLine(formatJevLogEntry(entry));
    }
    render();
    context.subscriptions.push(
        item,
        channel,
        vscode.commands.registerCommand(JEV_LOG_COMMAND, () => channel.show(true)),
        { dispose: onJevLog((entry) => channel.appendLine(formatJevLogEntry(entry))) },
        { dispose: onJevActivity((state) => render(state)) },
        { dispose: onJevConfig(() => render()) },
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration('knoxchat.jev')) {
                render();
            }
        }),
        onGuiLanguageChanged(() => render()),
    );
    return item;
}
