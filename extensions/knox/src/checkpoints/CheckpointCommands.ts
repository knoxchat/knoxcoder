/**
 * VSCode commands for checkpoint system configuration and management
 */

import * as vscode from 'vscode';
import { getGlobalKnoxIgnorePath } from 'core/util/paths';
import { t } from '../i18n';
import { CheckpointManager } from './CheckpointManager';
import { CheckpointCommand, registerCanonicalCommand } from './commandIds';
import { 
    ALL_PRESETS, 
    detectProjectType, 
    createKnoxIgnoreFile
} from './IgnorePatternPresets';
import type { IgnorePreset } from './IgnorePatternPresets';

const path = require('path');
const fs = require('fs').promises;

/**
 * Register all checkpoint-related commands
 */
export function registerCheckpointCommands(context: vscode.ExtensionContext): void {
    const checkpointManager = CheckpointManager.getInstance();
    
    registerCanonicalCommand(context, CheckpointCommand.showConfiguration, async () => {
        await showConfigurationPanel(checkpointManager);
    });

    registerCanonicalCommand(context, CheckpointCommand.createKnoxIgnore, async () => {
        await createKnoxIgnoreCommand();
    });

    registerCanonicalCommand(context, CheckpointCommand.configureScanDepth, async () => {
        await configureScanDepthCommand(checkpointManager);
    });

    registerCanonicalCommand(context, CheckpointCommand.configureMaxFileSize, async () => {
        await configureMaxFileSizeCommand(checkpointManager);
    });

    registerCanonicalCommand(context, CheckpointCommand.showScanMetrics, async () => {
        await showPerformanceMetrics(checkpointManager);
    });

    registerCanonicalCommand(context, CheckpointCommand.resetConfiguration, async () => {
        await resetConfigurationCommand(checkpointManager);
    });
}

/**
 * Show checkpoint configuration panel
 */
async function showConfigurationPanel(manager: CheckpointManager): Promise<void> {
    const config = manager.getConfiguration();
    const metrics = manager.getPerformanceMetrics();
    const storagePath = manager.getCurrentStoragePath();
    
    const items = [
        {
            label: t('checkpoint.config.scanDepth'),
            detail: config.maxScanDepth === 0
                ? t('checkpoint.config.scanDepthUnlimitedDetail')
                : t('checkpoint.config.scanDepthDetail', { depth: config.maxScanDepth }),
            action: 'configureScanDepth'
        },
        {
            label: t('checkpoint.config.maxFileSize'),
            detail: t('checkpoint.config.maxFileSizeDetail', { size: formatBytes(config.maxFileSize) }),
            action: 'configureMaxFileSize'
        },
        {
            label: t('checkpoint.config.perfMetrics'),
            detail: t('checkpoint.config.perfMetricsDetail', { scans: metrics.totalScans, duration: metrics.averageScanDuration.toFixed(0) }),
            action: 'showMetrics'
        },
        {
            label: t('checkpoint.config.storageLocation'),
            detail: storagePath,
            action: 'openStorage'
        },
        {
            label: t('checkpoint.config.createKnoxIgnore'),
            detail: t('checkpoint.config.createKnoxIgnoreDetail'),
            action: 'createKnoxIgnore'
        },
        {
            label: t('checkpoint.config.resetDefaults'),
            detail: t('checkpoint.config.resetDefaultsDetail'),
            action: 'resetConfiguration'
        }
    ];
    
    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: t('checkpoint.config.title')
    });
    
    if (selected) {
        switch (selected.action) {
            case 'configureScanDepth':
                await configureScanDepthCommand(manager);
                break;
            case 'configureMaxFileSize':
                await configureMaxFileSizeCommand(manager);
                break;
            case 'showMetrics':
                await showPerformanceMetrics(manager);
                break;
            case 'openStorage':
                await openStorageLocation(storagePath);
                break;
            case 'createKnoxIgnore':
                await createKnoxIgnoreCommand();
                break;
            case 'resetConfiguration':
                await resetConfigurationCommand(manager);
                break;
        }
    }
}

/**
 * Create .knoxignore file with preset
 */
async function createKnoxIgnoreCommand(): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const workspacePath = workspaceFolder?.uri.fsPath;
    const knoxignorePath = getGlobalKnoxIgnorePath();

    // Check if global .knoxignore already exists
    try {
        await fs.access(knoxignorePath);
        const overwrite = await vscode.window.showWarningMessage(
            t('checkpoint.config.knoxignoreOverwrite'),
            t('checkpoint.yes'), t('checkpoint.no')
        );
        if (overwrite !== t('checkpoint.yes')) {
            return;
        }
    } catch {
        // File doesn't exist, continue
    }

    // Detect project type from workspace when available
    const detectedPreset = workspacePath
        ? await detectProjectType(workspacePath)
        : undefined;
    
    // Let user choose preset
    const presetItems = ALL_PRESETS.map(preset => ({
        label: preset.name,
        description: preset.description,
        detail: detectedPreset?.name === preset.name ? '$(check) Detected' : undefined,
        preset
    }));
    
    const selected = await vscode.window.showQuickPick(presetItems, {
        placeHolder: t('checkpoint.config.selectPreset')
    });
    
    if (selected) {
        try {
            const createdPath = await createKnoxIgnoreFile(workspacePath, selected.preset);
            vscode.window.showInformationMessage(
                t('checkpoint.config.createdKnoxIgnore', { preset: selected.preset.name })
            );
            
            // Open the file
            const doc = await vscode.workspace.openTextDocument(createdPath);
            await vscode.window.showTextDocument(doc);
        } catch (error) {
            vscode.window.showErrorMessage(
                t('checkpoint.config.failedCreateKnoxIgnore', { error: error instanceof Error ? error.message : String(error) })
            );
        }
    }
}

/**
 * Configure scan depth limit
 */
async function configureScanDepthCommand(manager: CheckpointManager): Promise<void> {
    const current = manager.getConfiguration().maxScanDepth;
    
    const input = await vscode.window.showInputBox({
        prompt: t('checkpoint.config.enterScanDepth'),
        value: current.toString(),
        validateInput: (value) => {
            const num = parseInt(value, 10);
            if (isNaN(num) || num < 0 || num > 50) {
                return t('checkpoint.config.scanDepthValidation');
            }
            return undefined;
        }
    });
    
    if (input) {
        const depth = parseInt(input);
        try {
            manager.setMaxScanDepth(depth);
            vscode.window.showInformationMessage(
                depth === 0
                    ? t('checkpoint.config.updatedScanDepthUnlimited')
                    : t('checkpoint.config.updatedScanDepth', { depth }),
            );
        } catch (error) {
            vscode.window.showErrorMessage(
                t('checkpoint.config.failedUpdateScanDepth', { error: error instanceof Error ? error.message : String(error) })
            );
        }
    }
}

/**
 * Configure maximum file size
 */
async function configureMaxFileSizeCommand(manager: CheckpointManager): Promise<void> {
    const current = manager.getConfiguration().maxFileSize;
    
    const presets = [
        { label: '512 KB', value: 512 * 1024 },
        { label: '1 MB (Default)', value: 1024 * 1024, detail: current === 1024 * 1024 ? '$(check) Current' : undefined },
        { label: '2 MB', value: 2 * 1024 * 1024 },
        { label: '5 MB', value: 5 * 1024 * 1024 },
        { label: '10 MB', value: 10 * 1024 * 1024 },
        { label: 'Custom...', value: -1 }
    ];
    
    const selected = await vscode.window.showQuickPick(presets, {
        placeHolder: t('checkpoint.config.selectMaxFileSize', { size: formatBytes(current) })
    });
    
    if (selected) {
        let sizeInBytes = selected.value;
        
        if (sizeInBytes === -1) {
            // Custom size
            const input = await vscode.window.showInputBox({
                prompt: t('checkpoint.config.enterFileSizeMB'),
                value: (current / (1024 * 1024)).toString(),
                validateInput: (value) => {
                    const num = parseFloat(value);
                    if (isNaN(num) || num < 0.001 || num > 100) {
                        return t('checkpoint.config.fileSizeValidation');
                    }
                    return undefined;
                }
            });
            
            if (!input) {
                return;
            }
            
            sizeInBytes = Math.floor(parseFloat(input) * 1024 * 1024);
        }
        
        try {
            manager.setMaxFileSize(sizeInBytes);
            vscode.window.showInformationMessage(
                t('checkpoint.config.updatedMaxFileSize', { size: formatBytes(sizeInBytes) })
            );
        } catch (error) {
            vscode.window.showErrorMessage(
                t('checkpoint.config.failedUpdateMaxFileSize', { error: error instanceof Error ? error.message : String(error) })
            );
        }
    }
}

/**
 * Show performance metrics
 */
async function showPerformanceMetrics(manager: CheckpointManager): Promise<void> {
    const metrics = manager.getPerformanceMetrics();
    
    const message = [
        '📊 Checkpoint Performance Metrics',
        '',
        `Total Scans: ${metrics.totalScans}`,
        `Files Scanned: ${metrics.filesScanned}`,
        `Last Scan: ${metrics.lastScanDuration}ms`,
        `Average Scan: ${metrics.averageScanDuration.toFixed(2)}ms`,
        `Last Scan Time: ${new Date(metrics.lastScanTimestamp).toLocaleString()}`,
        '',
        `Efficiency: ${metrics.totalScans > 0 ? (metrics.filesScanned / metrics.totalScans).toFixed(1) : 0} files/scan`
    ].join('\n');
    
    const action = await vscode.window.showInformationMessage(
        message,
        { modal: true },
        t('checkpoint.config.copyToClipboard'),
        t('checkpoint.config.close')
    );
    
    if (action === t('checkpoint.config.copyToClipboard')) {
        await vscode.env.clipboard.writeText(message);
        vscode.window.showInformationMessage(t('checkpoint.config.metricsCopied'));
    }
}

/**
 * Open storage location in file explorer
 */
async function openStorageLocation(storagePath: string): Promise<void> {
    const uri = vscode.Uri.file(storagePath);
    try {
        await vscode.commands.executeCommand('revealFileInOS', uri);
    } catch (error) {
        // Fallback: try to open in VSCode
        try {
            await vscode.commands.executeCommand('vscode.openFolder', uri, true);
        } catch {
            vscode.window.showErrorMessage(t('checkpoint.config.failedOpenStorage'));
        }
    }
}

/**
 * Reset configuration to defaults
 */
async function resetConfigurationCommand(manager: CheckpointManager): Promise<void> {
    const confirm = await vscode.window.showWarningMessage(
        t('checkpoint.config.resetConfirm'),
        { modal: true },
        t('checkpoint.config.reset'),
        t('checkpoint.cancel')
    );
    
    if (confirm === t('checkpoint.config.reset')) {
        try {
            manager.setMaxScanDepth(0);
            manager.setMaxFileSize(1024 * 1024); // 1MB
            vscode.window.showInformationMessage(t('checkpoint.config.resetSuccess'));
        } catch (error) {
            vscode.window.showErrorMessage(
                t('checkpoint.config.failedReset', { error: error instanceof Error ? error.message : String(error) })
            );
        }
    }
}

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    const threshold = 1024;
    
    if (bytes === 0) {
        return '0 B';
    }
    
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= threshold && unitIndex < units.length - 1) {
        size /= threshold;
        unitIndex++;
    }
    
    if (unitIndex === 0) {
        return `${bytes} ${units[unitIndex]}`;
    } else {
        return `${size.toFixed(1)} ${units[unitIndex]}`;
    }
}

