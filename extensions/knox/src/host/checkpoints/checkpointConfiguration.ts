import * as vscode from 'vscode';
import { getCheckpointConfigPath, getKnoxGlobalPath } from 'core/util/paths';
import { t } from '../i18n';
import { CheckpointManager } from './CheckpointManager';
import { AutoCheckpointSystem } from './AutoCheckpointSystem';
import { AUTO_CHECKPOINT_DEFAULTS, defaultCheckpointConfig } from './checkpointSettings';

/**
 * Get checkpoint configuration
 */
export async function getCheckpointConfiguration(): Promise<any> {
    try {
        const defaultConfig = {
            ...defaultCheckpointConfig(),
            autoEnabled: AUTO_CHECKPOINT_DEFAULTS.enabled,
            autoMinIntervalMs: AUTO_CHECKPOINT_DEFAULTS.minIntervalMs,
            autoFileChangeThreshold: AUTO_CHECKPOINT_DEFAULTS.fileChangeThreshold,
            autoShowNotifications: AUTO_CHECKPOINT_DEFAULTS.showNotifications,
        };

        // Try to load from global config file first (~/.knoxcoder/checkpoint-config.json)
        let fileConfig = null;
        try {
            const fs = require('fs').promises;
            const configPath = getCheckpointConfigPath();
            
            if (require('fs').existsSync(configPath)) {
                const configContent = await fs.readFile(configPath, 'utf8');
                fileConfig = JSON.parse(configContent);
                console.log('✅ Loaded checkpoint configuration from', configPath);
            }
        } catch (fileError) {
            console.warn('⚠️ Failed to load configuration from ~/.knoxcoder/checkpoint-config.json:', fileError);
        }

        // Load from VSCode settings
        const config = vscode.workspace.getConfiguration('knox.checkpoints');
        const auto = vscode.workspace.getConfiguration('knox.checkpoints.auto');
        const vscodeConfig: Record<string, any> = {
            maxCheckpoints: config.get('maxCheckpoints'),
            retentionDays: config.get('retentionDays'),
            maxStorageBytes: config.get('maxStorageBytes'),
            maxFilesPerCheckpoint: config.get('maxFilesPerCheckpoint'),
            maxFileSizeBytes: config.get('maxFileSizeBytes'),
            captureBinaryFiles: config.get('captureBinaryFiles'),
            enableCompression: config.get('enableCompression'),
            encryptAtRest: config.get('encryptAtRest'),
            enableAutoCheckpoints: config.get('enableAutoCheckpoints'),
            trackedExtensions: config.get('trackedExtensions'),
            autoCleanup: config.get('autoCleanup'),
            cleanupIntervalHours: config.get('cleanupIntervalHours'),
            autoEnabled: auto.get('enabled', AUTO_CHECKPOINT_DEFAULTS.enabled),
            autoMinIntervalMs: auto.get('minIntervalMs', AUTO_CHECKPOINT_DEFAULTS.minIntervalMs),
            autoFileChangeThreshold: auto.get(
                'fileChangeThreshold',
                AUTO_CHECKPOINT_DEFAULTS.fileChangeThreshold,
            ),
            autoShowNotifications: auto.get(
                'showNotifications',
                AUTO_CHECKPOINT_DEFAULTS.showNotifications,
            ),
        };

        // Remove undefined values from vscodeConfig
        Object.keys(vscodeConfig).forEach((key: string) => {
            if (vscodeConfig[key] === undefined) {
                delete vscodeConfig[key];
            }
        });
        
        // Merge configs: defaults < file config < VSCode settings
        let configData = { ...defaultConfig, ...fileConfig, ...vscodeConfig };
        
        // Apply capture-related settings to the TypeScript manager runtime
        try {
            CheckpointManager.getInstance().applyRuntimeConfig(configData);
        } catch (runtimeError) {
            console.warn('⚠️ Failed to apply runtime configuration:', runtimeError);
        }
        
        return configData;
    } catch (error) {
        console.error('Failed to get checkpoint configuration:', error);
        // Return defaults on error
        return defaultCheckpointConfig();
    }
}

/**
 * Save checkpoint configuration
 */
export async function saveCheckpointConfiguration(config: any): Promise<boolean> {
    try {
        // 1. Save to global config file (~/.knoxcoder/checkpoint-config.json)
        try {
            const fs = require('fs').promises;
            const configPath = getCheckpointConfigPath();
            const knoxDir = getKnoxGlobalPath();
            
            // Ensure the directory exists
            await fs.mkdir(knoxDir, { recursive: true });
            
            // Write the config file with pretty formatting
            const configContent = JSON.stringify(config, null, 2);
            await fs.writeFile(configPath, configContent, 'utf8');
            console.log('✅ Checkpoint configuration saved to', configPath);
        } catch (fileError) {
            console.error('❌ Failed to save configuration to ~/.knoxcoder/checkpoint-config.json:', fileError);
            // Don't fail the entire operation, continue with VSCode settings
        }

        // 2. Save to VSCode settings (for backward compatibility and IDE integration)
        const workspaceConfig = vscode.workspace.getConfiguration('knox.checkpoints');
        const autoConfig = vscode.workspace.getConfiguration('knox.checkpoints.auto');
        
        await Promise.all([
            workspaceConfig.update('maxCheckpoints', config.maxCheckpoints, vscode.ConfigurationTarget.Global),
            workspaceConfig.update('retentionDays', config.retentionDays, vscode.ConfigurationTarget.Global),
            workspaceConfig.update('maxStorageBytes', config.maxStorageBytes, vscode.ConfigurationTarget.Global),
            workspaceConfig.update('maxFilesPerCheckpoint', config.maxFilesPerCheckpoint, vscode.ConfigurationTarget.Global),
            workspaceConfig.update('maxFileSizeBytes', config.maxFileSizeBytes, vscode.ConfigurationTarget.Global),
            workspaceConfig.update('captureBinaryFiles', config.captureBinaryFiles, vscode.ConfigurationTarget.Global),
            workspaceConfig.update('enableCompression', config.enableCompression, vscode.ConfigurationTarget.Global),
            workspaceConfig.update('encryptAtRest', config.encryptAtRest, vscode.ConfigurationTarget.Global),
            workspaceConfig.update('enableAutoCheckpoints', config.enableAutoCheckpoints, vscode.ConfigurationTarget.Global),
            workspaceConfig.update('trackedExtensions', config.trackedExtensions, vscode.ConfigurationTarget.Global),
            workspaceConfig.update('autoCleanup', config.autoCleanup, vscode.ConfigurationTarget.Global),
            workspaceConfig.update('cleanupIntervalHours', config.cleanupIntervalHours, vscode.ConfigurationTarget.Global),
            autoConfig.update(
                'enabled',
                typeof config.autoEnabled === 'boolean'
                    ? config.autoEnabled
                    : AUTO_CHECKPOINT_DEFAULTS.enabled,
                vscode.ConfigurationTarget.Global,
            ),
            autoConfig.update(
                'minIntervalMs',
                typeof config.autoMinIntervalMs === 'number'
                    ? config.autoMinIntervalMs
                    : AUTO_CHECKPOINT_DEFAULTS.minIntervalMs,
                vscode.ConfigurationTarget.Global,
            ),
            autoConfig.update(
                'fileChangeThreshold',
                typeof config.autoFileChangeThreshold === 'number'
                    ? config.autoFileChangeThreshold
                    : AUTO_CHECKPOINT_DEFAULTS.fileChangeThreshold,
                vscode.ConfigurationTarget.Global,
            ),
            autoConfig.update(
                'showNotifications',
                typeof config.autoShowNotifications === 'boolean'
                    ? config.autoShowNotifications
                    : AUTO_CHECKPOINT_DEFAULTS.showNotifications,
                vscode.ConfigurationTarget.Global,
            ),
        ]);
        
        // 3. Apply capture-related settings to the TypeScript manager immediately
        try {
            CheckpointManager.getInstance().applyRuntimeConfig(config);
            void CheckpointManager.getInstance().enforceRetentionPolicies();
            AutoCheckpointSystem.getInstance().reloadConfiguration();
            console.log('✅ Checkpoint configuration saved to global config file and VS Code settings');
        } catch (runtimeError) {
            console.warn('⚠️ Failed to apply runtime configuration:', runtimeError);
        }
        
        return true;
    } catch (error) {
        console.error('Failed to save checkpoint configuration:', error);
        return false;
    }
}
