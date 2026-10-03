import * as vscode from 'vscode';

import { formatHookLogEntry, getHookLogEntries, onHookLog } from 'core/hooks/auditLog';

export const HOOKS_LOG_COMMAND = 'knoxchat.showHooksLog';

/**
 * K-023: "Knox Hooks" output channel with one line per hook run (event, tool,
 * command, outcome, duration, detail), plus the `Knox: Show Hooks Log` command.
 */
export function registerHooksLog(context: vscode.ExtensionContext): vscode.OutputChannel {
    const channel = vscode.window.createOutputChannel('Knox Hooks');
    for (const entry of getHookLogEntries()) {
        channel.appendLine(formatHookLogEntry(entry));
    }
    context.subscriptions.push(
        channel,
        vscode.commands.registerCommand(HOOKS_LOG_COMMAND, () => channel.show(true)),
        onHookLog((entry) => {
            channel.appendLine(formatHookLogEntry(entry));
            // A denied hook is the one outcome users need to notice right away.
            if (entry.outcome === 'deny') {
                channel.show(true);
            }
        }),
    );
    return channel;
}
