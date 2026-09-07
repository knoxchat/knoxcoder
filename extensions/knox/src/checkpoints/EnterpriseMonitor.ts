import * as vscode from 'vscode';

import { t } from '../i18n';

import { CheckpointManager } from './CheckpointManager';
import { CheckpointCommand, registerCanonicalCommand } from './commandIds';
import { CheckpointConflictResolver } from './ConflictResolver';
import { CheckpointSessionManager } from './SessionManager';
import {
    storeHealthIsAutoFixable,
    storeHealthSeverity,
    gcOrphansSucceeded,
    repairAllSucceeded,
    type StoreHealthReport,
} from './manager/storeHealth';
import { formatCheckpointAge, latestCheckpointCreated } from './manager/checkpointAge';


/**
 * Health status levels
 */
export enum HealthStatus {
    HEALTHY = 'healthy',
    WARNING = 'warning',
    CRITICAL = 'critical',
    FAILED = 'failed'
}

/**
 * System metrics
 */
export interface SystemMetrics {
    checkpointCount: number;
    totalStorageUsed: number;
    averageCheckpointSize: number;
    sessionCount: number;
    conflictCount: number;
    errorCount: number;
    performanceMetrics: {
        averageCreationTime: number;
        averageRestoreTime: number;
        successRate: number;
    };
    lastHealthCheck: Date;
    healthStatus: HealthStatus;
}

/**
 * Health check result
 */
export interface HealthCheckResult {
    status: HealthStatus;
    message: string;
    details: string[];
    recommendations: string[];
    metrics: SystemMetrics;
}

/**
 * Recovery action
 */
export interface RecoveryAction {
    id: string;
    name: string;
    description: string;
    severity: 'low' | 'medium' | 'high';
    automatic: boolean;
    action: () => Promise<boolean>;
}

/**
 * Health monitoring and recovery helpers for the TypeScript checkpoint system.
 */
export class CheckpointEnterpriseMonitor {
    /**
     * Get the more severe health status
     */
    private getMoreSevereStatus(current: HealthStatus, candidate: HealthStatus): HealthStatus {
        const severityOrder = {
            [HealthStatus.HEALTHY]: 0,
            [HealthStatus.WARNING]: 1,
            [HealthStatus.CRITICAL]: 2,
            [HealthStatus.FAILED]: 3
        };
        
        return severityOrder[candidate] > severityOrder[current] ? candidate : current;
    }
    private static instance: CheckpointEnterpriseMonitor | undefined;
    private healthCheckInterval: NodeJS.Timeout | undefined;
    private statusBarAgeInterval: NodeJS.Timeout | undefined;
    private statusBarItem: vscode.StatusBarItem | undefined;
    private errorLog: Array<{ timestamp: Date; error: string; context: any }> = [];
    private performanceLog: Array<{ timestamp: Date; operation: string; duration: number; success: boolean }> = [];
    private static readonly MAX_ERROR_LOG = 1000;
    private static readonly MAX_PERF_LOG = 1000;
    private lastHealthCheck: HealthCheckResult | undefined;
    private recoveryActions: Map<string, RecoveryAction> = new Map();

    private constructor() {
        this.registerRecoveryActions();
    }

    static getInstance(): CheckpointEnterpriseMonitor {
        if (!CheckpointEnterpriseMonitor.instance) {
            CheckpointEnterpriseMonitor.instance = new CheckpointEnterpriseMonitor();
        }
        return CheckpointEnterpriseMonitor.instance;
    }

    /**
     * Initialize monitoring system
     */
    async initialize(context: vscode.ExtensionContext): Promise<void> {
        console.log('🔍 Initializing checkpoint monitoring...');
        
        this.registerRecoveryActions();
        
        // Create status bar item
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50);
        this.statusBarItem.command = CheckpointCommand.list;
        this.updateStatusBar(HealthStatus.HEALTHY);
        this.statusBarItem.show();
        context.subscriptions.push(this.statusBarItem);
        context.subscriptions.push(
            CheckpointManager.getInstance().onCheckpointCreated(() => {
                void this.performHealthCheck({ allowAutoRecovery: false });
            }),
        );
        
        // Start health monitoring
        this.startHealthMonitoring();
        this.registerCommands(context);
        
        console.log('✅ Checkpoint monitoring initialized');
    }

    /**
     * Register recovery actions
     */
    private registerRecoveryActions(): void {
        this.recoveryActions.set('recover_journal', {
            id: 'recover_journal',
            name: t('checkpoint.monitor.recoverJournal'),
            description: t('checkpoint.monitor.recoverJournalDesc'),
            severity: 'high',
            automatic: true,
            action: async () => {
                const mgr = CheckpointManager.getInstance();
                const before = await mgr.inspectStoreHealth();
                if (!before.incompleteJournal) {
                    return true;
                }
                const result = await mgr.repairStoreHealth({
                    journal: true,
                    index: false,
                    gc: false,
                });
                return result.journalRecovered;
            },
        });

        this.recoveryActions.set('rebuild_index', {
            id: 'rebuild_index',
            name: t('checkpoint.monitor.rebuildIndex'),
            description: t('checkpoint.monitor.rebuildIndexDesc'),
            severity: 'high',
            automatic: true,
            action: async () => CheckpointManager.getInstance().rebuildHistoryFromManifests(),
        });

        this.recoveryActions.set('gc_orphans', {
            id: 'gc_orphans',
            name: t('checkpoint.monitor.gcOrphans'),
            description: t('checkpoint.monitor.gcOrphansDesc'),
            severity: 'medium',
            automatic: true,
            action: async () => {
                const manager = CheckpointManager.getInstance();
                const before = await manager.inspectStoreHealth();
                const result = await manager.repairStoreHealth({
                    journal: false,
                    index: false,
                    gc: true,
                });
                const after = await manager.inspectStoreHealth();
                return gcOrphansSucceeded(before, result, after);
            },
        });

        this.recoveryActions.set('repair_all', {
            id: 'repair_all',
            name: t('checkpoint.monitor.repairAll'),
            description: t('checkpoint.monitor.repairAllDesc'),
            severity: 'high',
            automatic: false,
            action: async () => {
                const manager = CheckpointManager.getInstance();
                await manager.repairStoreHealth();
                const after = await manager.inspectStoreHealth();
                return repairAllSucceeded(after);
            },
        });

        this.recoveryActions.set('session_recovery', {
            id: 'session_recovery',
            name: t('checkpoint.monitor.sessionRecovery'),
            description: t('checkpoint.monitor.sessionRecoveryDesc'),
            severity: 'medium',
            automatic: false,
            action: async () => {
                CheckpointSessionManager.getInstance().cleanupStaleSessions();
                return true;
            },
        });

        this.recoveryActions.set('conflict_reset', {
            id: 'conflict_reset',
            name: t('checkpoint.monitor.conflictReset'),
            description: t('checkpoint.monitor.conflictResetDesc'),
            severity: 'low',
            automatic: false,
            action: async () => {
                CheckpointConflictResolver.getInstance().cleanupHistory();
                return true;
            },
        });
    }

    /**
     * Start continuous health monitoring
     */
    private startHealthMonitoring(): void {
        // Run health check every 5 minutes
        this.healthCheckInterval = setInterval(async () => {
            await this.performHealthCheck();
        }, 5 * 60 * 1000);
        this.healthCheckInterval.unref?.();

        this.statusBarAgeInterval = setInterval(() => {
            if (this.lastHealthCheck) {
                this.updateStatusBar(this.lastHealthCheck.status, this.lastHealthCheck.details);
            }
        }, 60 * 1000);
        this.statusBarAgeInterval.unref?.();

        // Run initial health check
        setTimeout(() => this.performHealthCheck(), 1000);
    }

    /**
     * Perform comprehensive health check
     */
    async performHealthCheck(options?: { allowAutoRecovery?: boolean }): Promise<HealthCheckResult> {
        const checkpointManager = CheckpointManager.getInstance();
        const sessionManager = CheckpointSessionManager.getInstance();
        const conflictResolver = CheckpointConflictResolver.getInstance();
        const allowAutoRecovery = options?.allowAutoRecovery !== false;

        const details: string[] = [];
        const recommendations: string[] = [];
        let status = HealthStatus.HEALTHY;
        let storeReport: StoreHealthReport | undefined;

        try {
            if (!checkpointManager.isReady()) {
                status = HealthStatus.CRITICAL;
                details.push('Checkpoint manager is not ready');
                recommendations.push('Restart checkpoint system');
            } else {
                try {
                    storeReport = await checkpointManager.inspectStoreHealth();
                    this.applyStoreHealth(storeReport, details, recommendations);
                    const storeStatus = storeHealthSeverity(storeReport);
                    if (storeStatus === 'critical') {
                        status = this.getMoreSevereStatus(status, HealthStatus.CRITICAL);
                    } else if (storeStatus === 'warning') {
                        status = this.getMoreSevereStatus(status, HealthStatus.WARNING);
                    }
                } catch (error) {
                    status = this.getMoreSevereStatus(status, HealthStatus.WARNING);
                    details.push(`Store health scan failed: ${error instanceof Error ? error.message : String(error)}`);
                    recommendations.push('Run checkpoint recovery');
                }
            }

            // Get metrics
            const sessionStats = sessionManager.getSessionStats();
            const conflictStats = conflictResolver.getConflictStats();
            
            // Check for excessive conflicts
            if (conflictStats.recentConflicts.length > 10) {
                status = this.getMoreSevereStatus(status, HealthStatus.WARNING);
                details.push(`High conflict rate: ${conflictStats.recentConflicts.length} conflicts in last hour`);
                recommendations.push('Review concurrent operation patterns');
            }

            // Check for old sessions
            const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
            if (sessionStats.oldestSession && sessionStats.oldestSession < oneHourAgo) {
                details.push(`Old sessions detected (oldest: ${sessionStats.oldestSession})`);
                recommendations.push('Consider session cleanup');
            }

            // Check error rate
            const recentErrors = this.errorLog.filter(e => e.timestamp > oneHourAgo);
            if (recentErrors.length > 5) {
                status = this.getMoreSevereStatus(status, HealthStatus.WARNING);
                details.push(`High error rate: ${recentErrors.length} errors in last hour`);
                recommendations.push('Investigate error patterns');
            }

            // Calculate performance metrics
            const recentPerf = this.performanceLog.filter(p => p.timestamp > oneHourAgo);
            const successRate = recentPerf.length > 0 
                ? recentPerf.filter(p => p.success).length / recentPerf.length 
                : 1.0;

            if (successRate < 0.9) {
                status = this.getMoreSevereStatus(status, HealthStatus.WARNING);
                details.push(`Low success rate: ${(successRate * 100).toFixed(1)}%`);
                recommendations.push('Investigate operation failures');
            }

            // Calculate storage metrics from real data when available
            let totalStorageUsed = 0;
            let averageCheckpointSize = 0;
            let averageRestoreTime = 0;
            try {
                const storageData = await CheckpointManager.getInstance().getStorageUsage();
                if (storageData) {
                    totalStorageUsed = storageData.totalBytes ?? 0;
                }
                const stats = await CheckpointManager.getInstance().getCheckpointStatistics();
                if (stats.totalCheckpoints > 0 && totalStorageUsed > 0) {
                    averageCheckpointSize = Math.round(totalStorageUsed / stats.totalCheckpoints);
                }
            } catch { /* fallback to 0 */ }

            const restoreOps = recentPerf.filter(p => p.operation === 'restore');
            if (restoreOps.length > 0) {
                averageRestoreTime = restoreOps.reduce((sum, p) => sum + p.duration, 0) / restoreOps.length;
            } else {
                try {
                    const dashboard = await checkpointManager.getPerformanceDashboard(1);
                    if (dashboard.summary.totalRestorations > 0) {
                        averageRestoreTime = dashboard.summary.avgRestorationTimeMs;
                    }
                } catch { /* in-memory restore times remain 0 */ }
            }

            const metrics: SystemMetrics = {
                checkpointCount: checkpointManager.getCheckpointHistoryForWorkspace().length,
                totalStorageUsed,
                averageCheckpointSize,
                sessionCount: sessionStats.totalSessions,
                conflictCount: conflictStats.totalConflicts,
                errorCount: this.errorLog.length,
                performanceMetrics: {
                    averageCreationTime: recentPerf.length > 0 
                        ? recentPerf.reduce((sum, p) => sum + p.duration, 0) / recentPerf.length 
                        : 0,
                    averageRestoreTime,
                    successRate
                },
                lastHealthCheck: new Date(),
                healthStatus: status
            };

            const result: HealthCheckResult = {
                status,
                message: this.getStatusMessage(status, details),
                details,
                recommendations,
                metrics
            };

            this.lastHealthCheck = result;
            this.updateStatusBar(status, details);

            if (
                allowAutoRecovery
                && checkpointManager.isReady()
                && storeReport
                && storeHealthIsAutoFixable(storeReport)
                && (status === HealthStatus.CRITICAL || status === HealthStatus.WARNING)
            ) {
                await this.executeAutoRecovery(storeReport);
                return this.performHealthCheck({ allowAutoRecovery: false });
            }

            return result;

        } catch (error) {
            console.error('Health check failed:', error);
            return {
                status: HealthStatus.FAILED,
                message: `Health check failed: ${error}`,
                details: ['Health check system error'],
                recommendations: ['Restart monitoring system'],
                metrics: {
                    checkpointCount: 0,
                    totalStorageUsed: 0,
                    averageCheckpointSize: 0,
                    sessionCount: 0,
                    conflictCount: 0,
                    errorCount: 0,
                    performanceMetrics: { averageCreationTime: 0, averageRestoreTime: 0, successRate: 0 },
                    lastHealthCheck: new Date(),
                    healthStatus: HealthStatus.FAILED
                }
            };
        }
    }

    private applyStoreHealth(
        report: StoreHealthReport,
        details: string[],
        recommendations: string[],
    ): void {
        if (report.incompleteJournal) {
            details.push(
                t('checkpoint.monitor.incompleteJournal', {
                    id: report.journalCheckpointId ?? 'unknown',
                }),
            );
            recommendations.push(t('checkpoint.monitor.runJournalRecovery'));
        }
        if (report.corruptManifests.length > 0) {
            details.push(
                t('checkpoint.monitor.corruptManifests', { count: report.corruptManifests.length }),
            );
            recommendations.push(t('checkpoint.monitor.runIndexRebuild'));
        }
        if (report.manifestsWithoutBlobs.length > 0) {
            details.push(
                t('checkpoint.monitor.manifestsWithoutBlobs', {
                    count: report.manifestsWithoutBlobs.length,
                }),
            );
        }
        if (report.missingBlobs.length > 0) {
            details.push(
                t('checkpoint.monitor.missingBlobs', { count: report.missingBlobs.length }),
            );
        }
        if (report.orphanBlobCount > 0) {
            details.push(
                t('checkpoint.monitor.orphanBlobs', { count: report.orphanBlobCount }),
            );
            recommendations.push(t('checkpoint.monitor.runGcOrphans'));
        }
        if (report.indexNeedsRebuild) {
            details.push(t('checkpoint.monitor.indexNeedsRebuild'));
            recommendations.push(t('checkpoint.monitor.runIndexRebuild'));
        }
    }

    /**
     * Execute automatic recovery actions
     */
    private async executeAutoRecovery(report: StoreHealthReport): Promise<void> {
        const wanted: string[] = [];
        if (report.incompleteJournal) {
            wanted.push('recover_journal');
        }
        if (report.indexNeedsRebuild || report.corruptManifests.length > 0) {
            wanted.push('rebuild_index');
        }
        if (report.orphanBlobCount > 0 && report.corruptManifests.length === 0) {
            wanted.push('gc_orphans');
        }

        for (const id of wanted) {
            const action = this.recoveryActions.get(id);
            if (!action) {
                continue;
            }
            try {
                await action.action();
            } catch (error) {
                console.error(`Recovery action error: ${action.name}`, error);
            }
        }
    }

    /**
     * Get status message for health level
     */
    private getStatusMessage(status: HealthStatus, details: string[]): string {
        switch (status) {
            case HealthStatus.HEALTHY:
                return 'Checkpoint system is operating normally';
            case HealthStatus.WARNING:
                return `Checkpoint system has warnings: ${details.slice(0, 2).join(', ')}`;
            case HealthStatus.CRITICAL:
                return `Checkpoint system has critical issues: ${details.slice(0, 2).join(', ')}`;
            case HealthStatus.FAILED:
                return `Checkpoint system has failed: ${details.slice(0, 1).join(', ')}`;
            default:
                return 'Unknown health status';
        }
    }

    /**
     * Update the status bar indicator based on health status
     */
    private updateStatusBar(status: HealthStatus, details: string[] = []): void {
        if (!this.statusBarItem) { return; }
        const latestCreated = latestCheckpointCreated(
            CheckpointManager.getInstance().getCheckpointHistoryForWorkspace(),
        );
        const age = latestCreated ? formatCheckpointAge(latestCreated) : undefined;
        const summary = details.length > 0 ? details.slice(0, 3).join('\n') : undefined;
        const ageSuffix = age ? ` ${age}` : '';
        switch (status) {
            case HealthStatus.HEALTHY:
                this.statusBarItem.text = `$(check) CP${ageSuffix}`;
                this.statusBarItem.backgroundColor = undefined;
                this.statusBarItem.tooltip = age
                    ? t('checkpoint.monitor.healthyAgeTooltip', { age })
                    : t('checkpoint.monitor.healthyTooltip');
                break;
            case HealthStatus.WARNING:
                this.statusBarItem.text = `$(warning) CP${ageSuffix}`;
                this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
                this.statusBarItem.tooltip = summary
                    ?? t('checkpoint.monitor.warningTooltip');
                break;
            case HealthStatus.CRITICAL:
            case HealthStatus.FAILED:
                this.statusBarItem.text = `$(error) CP${ageSuffix}`;
                this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
                this.statusBarItem.tooltip = summary
                    ?? t('checkpoint.monitor.criticalTooltip');
                break;
        }
    }

    /**
     * Log an error for monitoring
     */
    logError(error: string, context: any = {}): void {
        this.errorLog.push({
            timestamp: new Date(),
            error,
            context
        });

        if (this.errorLog.length > CheckpointEnterpriseMonitor.MAX_ERROR_LOG) {
            this.errorLog = this.errorLog.slice(-CheckpointEnterpriseMonitor.MAX_ERROR_LOG);
        }

        console.error(`📊 Checkpoint error logged: ${error}`, context);
    }

    /**
     * Log performance metric
     */
    logPerformance(operation: string, duration: number, success: boolean): void {
        this.performanceLog.push({
            timestamp: new Date(),
            operation,
            duration,
            success
        });

        if (this.performanceLog.length > CheckpointEnterpriseMonitor.MAX_PERF_LOG) {
            this.performanceLog = this.performanceLog.slice(-CheckpointEnterpriseMonitor.MAX_PERF_LOG);
        }
    }

    /**
     * Register monitoring commands
     */
    private registerCommands(context: vscode.ExtensionContext): void {
        registerCanonicalCommand(context, CheckpointCommand.health, async () => {
            const result = await this.performHealthCheck();

            const message = `Health: ${result.status.toUpperCase()}\n${result.message}`;

            if (result.status === HealthStatus.HEALTHY) {
                vscode.window.showInformationMessage(message);
            } else if (result.status === HealthStatus.WARNING) {
                vscode.window.showWarningMessage(message);
            } else {
                vscode.window.showErrorMessage(message);
            }
        });

        registerCanonicalCommand(context, CheckpointCommand.healthMetrics, async () => {
            if (!this.lastHealthCheck) {
                await this.performHealthCheck();
            }

            const metrics = this.lastHealthCheck!.metrics;
            const info = [
                `Checkpoints: ${metrics.checkpointCount}`,
                `Sessions: ${metrics.sessionCount}`,
                `Conflicts: ${metrics.conflictCount}`,
                `Success Rate: ${(metrics.performanceMetrics.successRate * 100).toFixed(1)}%`,
                `Avg Creation Time: ${metrics.performanceMetrics.averageCreationTime.toFixed(0)}ms`
            ].join('\n');

            vscode.window.showInformationMessage(t('checkpoint.monitor.checkpointMetrics', { info }));
        });

        registerCanonicalCommand(context, CheckpointCommand.runRecovery, async () => {
            const actions = Array.from(this.recoveryActions.values());
            const items = actions.map(action => ({
                label: action.name,
                description: action.description,
                detail: `Severity: ${action.severity}`,
                action
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: t('checkpoint.monitor.selectRecovery'),
                matchOnDescription: true
            });

            if (selected) {
                try {
                    vscode.window.showInformationMessage(t('checkpoint.monitor.executing', { name: selected.action.name }));
                    const success = await selected.action.action();

                    if (success) {
                        vscode.window.showInformationMessage(t('checkpoint.monitor.recoveryCompleted', { name: selected.action.name }));
                    } else {
                        vscode.window.showErrorMessage(t('checkpoint.monitor.recoveryFailed', { name: selected.action.name }));
                    }
                } catch (error) {
                    vscode.window.showErrorMessage(t('checkpoint.monitor.recoveryError', { error }));
                }
            }
        });
    }

    /**
     * Get current system status
     */
    getSystemStatus(): HealthCheckResult | undefined {
        return this.lastHealthCheck;
    }

    /**
     * Dispose monitoring system
     */
    dispose(): void {
        console.log('🧹 Disposing checkpoint monitor...');
        
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = undefined;
        }
        if (this.statusBarAgeInterval) {
            clearInterval(this.statusBarAgeInterval);
            this.statusBarAgeInterval = undefined;
        }

        this.errorLog = [];
        this.performanceLog = [];
        this.recoveryActions.clear();
        this.lastHealthCheck = undefined;
        
        console.log('✅ Checkpoint monitor disposed');
    }
}
