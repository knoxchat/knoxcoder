/**
 * Smart Checkpoint System - VSCode Integration
 * 
 * High-performance, memory-efficient checkpoint system designed specifically 
 * for AI agent workflows. Focuses on tracking only AI-generated changes.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';

import { getGlobalCheckpointsPath } from 'core/util/paths';

import { t } from '../i18n';
import { CheckpointManager } from './CheckpointManager';
import {
    SMART_CHECKPOINT_DEFAULTS,
    readSmartCheckpointSettings,
} from './checkpointSettings';
import {
    countSessionRollbacks,
    measureSessionLineCounts,
    newestCheckpointId,
} from './manager/aiSessionMetrics';
import { normalizeCapturePath, toPosixRelative } from './manager/pathFilter';

export enum OperationMode {
    Chat = 'chat',
    Agent = 'agent', 
    Manual = 'manual'
}

export interface SmartCheckpointConfig {
    enabled: boolean;
    agentModeOnly: boolean;
    maxTrackedFiles: number;
    maxMemoryUsageMB: number;
    maxCheckpoints: number;
    maxFileSizeKB: number;
    storagePath: string;
    verboseLogging: boolean;
    enableMetrics: boolean;
}

export interface SmartStats {
    files_tracked: number;
    changes_detected: number;
    memory_usage_bytes?: number;
    last_scan_duration_ms?: number;
    mode: string;
    session_id?: string;
    tracked_files?: string[];
}

export interface AISession {
    id: string;
    metricsId: string;
    startTime: Date;
    trackedFiles: Set<string>;
    operationMode: OperationMode;
    baselineCheckpointId?: string;
}

/**
 * Smart Checkpoint Manager - VSCode Integration
 * 
 * Provides AI session management, automatic checkpoint creation for agent activities,
 * and integration with VSCode file system events with performance monitoring.
 */
export class SmartCheckpointManager {
    private static instance: SmartCheckpointManager | undefined;
    private currentSession: AISession | null = null;
    private operationMode: OperationMode = OperationMode.Chat;
    private config: SmartCheckpointConfig;
    private checkpointManager: CheckpointManager;
    private initialized = false;
    private configurationWatchRegistered = false;
    
    private constructor() {
        this.checkpointManager = CheckpointManager.getInstance();
        this.config = this.getDefaultConfig();
    }
    
    static getInstance(): SmartCheckpointManager {
        if (!SmartCheckpointManager.instance) {
            SmartCheckpointManager.instance = new SmartCheckpointManager();
        }
        return SmartCheckpointManager.instance;
    }
    
    /**
     * Initialize the smart checkpoint system
     */
    async initialize(context: vscode.ExtensionContext): Promise<void> {
        try {
            this.loadConfiguration();
            if (!this.configurationWatchRegistered) {
                context.subscriptions.push(
                    vscode.workspace.onDidChangeConfiguration((event) => {
                        if (event.affectsConfiguration('knox.checkpoints.smart')) {
                            this.reloadConfiguration();
                        }
                    }),
                );
                this.configurationWatchRegistered = true;
            }

            if (this.config.enabled) {
                this.initialized = true;
            }

            console.log(
                this.config.enabled
                    ? '✅ Smart Checkpoint Manager initialized'
                    : 'Smart checkpoints disabled; settings changes still apply without reload',
            );
        } catch (error) {
            console.error('Failed to initialize Smart Checkpoint Manager:', error);
            vscode.window.showErrorMessage(t('checkpoint.smart.failedInit'));
            throw error;
        }
    }
    
    /**
     * Start an AI session for smart checkpoint tracking
     */
    async startAISession(sessionId: string): Promise<void> {
        await this.checkpointManager.startAgentSession(sessionId);

        if (!this.initialized || !this.config.enabled) {
            return;
        }
        
        if (this.currentSession) {
            console.warn(`AI session ${this.currentSession.id} already active, stopping it first`);
            try {
                await this.stopAISession();
            } catch (error) {
                console.warn('Failed to stop previous AI session cleanly:', error);
            }
        }
        
        this.operationMode = OperationMode.Agent;

        let baselineCheckpointId: string | undefined;
        if (typeof this.checkpointManager.getCheckpointHistoryForWorkspace === 'function') {
            baselineCheckpointId = newestCheckpointId(
                this.checkpointManager.getCheckpointHistoryForWorkspace(),
            );
        }
        if (!baselineCheckpointId && typeof this.checkpointManager.createAgentCheckpoint === 'function') {
            baselineCheckpointId = await this.checkpointManager.createAgentCheckpoint({
                description: `AI session start ${sessionId}`,
                tags: ['smart', 'ai-session-start'],
                sessionId,
            });
        }

        this.currentSession = {
            id: sessionId,
            metricsId: randomUUID(),
            startTime: new Date(),
            trackedFiles: new Set(),
            operationMode: OperationMode.Agent,
            baselineCheckpointId,
        };
        
        if (this.config.verboseLogging) {
            console.log(`🤖 Started AI session: ${sessionId}`);
        }
    }
    
    /**
     * Stop the current AI session
     */
    async stopAISession(): Promise<void> {
        if (!this.currentSession) {
            return;
        }
        
        if (this.config.verboseLogging) {
            console.log(`🛑 Stopping AI session: ${this.currentSession.id}`);
        }
        
        const session = this.currentSession;
        let checkpointsCreated = 0;
        let endCheckpointId: string | undefined;
        if (session.trackedFiles.size > 0) {
            endCheckpointId = await this.createAgentCheckpoint({
                description: `Session ${session.id} completed`,
                sessionId: session.id,
            });
            if (endCheckpointId) {
                checkpointsCreated = 1;
            }
        }

        if (this.config.enableMetrics && typeof this.checkpointManager.recordAISessionMetrics === 'function') {
            const loc = await measureSessionLineCounts(
                this.checkpointManager,
                session.baselineCheckpointId,
                endCheckpointId,
                [...session.trackedFiles],
            );
            const rollbacks = await countSessionRollbacks(this.checkpointManager, session.startTime);
            await this.checkpointManager.recordAISessionMetrics({
                sessionId: session.metricsId,
                startedAt: session.startTime.toISOString(),
                endedAt: new Date().toISOString(),
                filesChanged: loc?.filesChanged ?? session.trackedFiles.size,
                linesAdded: loc?.linesAdded,
                linesDeleted: loc?.linesDeleted,
                checkpointsCreated,
                rollbacks,
                durationSeconds: Math.max(
                    0,
                    (Date.now() - session.startTime.getTime()) / 1000,
                ),
            });
        }
        
        this.currentSession = null;
        this.operationMode = OperationMode.Chat;
        await this.checkpointManager.stopAgentSession();
    }
    
    /**
     * Set the operation mode
     */
    async setOperationMode(mode: OperationMode): Promise<void> {
        this.operationMode = mode;
        
        if (this.config.verboseLogging) {
            console.log(`📝 Set operation mode to: ${mode}`);
        }
        
        // If switching away from agent mode, stop current session
        if (mode !== OperationMode.Agent && this.currentSession) {
            await this.stopAISession();
        }
    }
    
    /**
     * Track specific files that AI will modify
     */
    async trackAIFiles(filePaths: string[]): Promise<void> {
        const workspacePath = this.checkpointManager.getCurrentWorkspacePath?.();
        const accepted: string[] = [];
        for (const filePath of filePaths) {
            const trimmed = filePath.trim();
            if (!trimmed) {
                continue;
            }
            if (
                this.initialized
                && this.config.enabled
                && await this.isOverSmartFileSizeLimit(trimmed, workspacePath)
            ) {
                if (this.config.verboseLogging) {
                    console.log(
                        `Skipping oversized file (${this.config.maxFileSizeKB}KB cap): ${trimmed}`,
                    );
                }
                continue;
            }
            accepted.push(trimmed);
        }

        await this.checkpointManager.trackAIFiles(accepted);

        if (!this.initialized || !this.config.enabled) {
            return;
        }
        if (this.config.agentModeOnly && this.operationMode !== OperationMode.Agent) {
            return;
        }
        
        if (!this.currentSession) {
            console.warn('No active AI session, cannot track files');
            return;
        }
        
        for (const trimmed of accepted) {
            const relative = workspacePath
                ? normalizeCapturePath(workspacePath, trimmed)
                : toPosixRelative(trimmed);
            if (relative && relative !== '.' && !relative.startsWith('../') && relative !== '..') {
                this.currentSession.trackedFiles.add(relative);
            } else {
                this.currentSession.trackedFiles.add(toPosixRelative(trimmed));
            }
        }
        
        if (this.config.verboseLogging) {
            console.log(`👀 Tracking ${accepted.length} files for AI changes:`, accepted);
        }
        
        await this.checkMemoryLimits();
    }
    
    /**
     * Create a checkpoint specifically for agent-generated changes
     */
    async createAgentCheckpoint(options: {
        description?: string;
        tags?: string[];
        sessionId?: string;
    }): Promise<string | undefined> {
        if (!this.initialized || !this.config.enabled) {
            return this.checkpointManager.createAgentCheckpoint(options);
        }

        const history = typeof this.checkpointManager.getCheckpointHistoryForWorkspace === 'function'
            ? this.checkpointManager.getCheckpointHistoryForWorkspace()
            : [];
        if (history.length >= this.config.maxCheckpoints) {
            if (this.config.verboseLogging) {
                console.warn(
                    `Smart checkpoint cap reached (${this.config.maxCheckpoints}); skipping create`,
                );
            }
            return undefined;
        }
        
        try {
            const description = options.description || 'AI agent changes';
            
            if (this.config.verboseLogging) {
                console.log(`📸 Creating smart agent checkpoint: ${description}`);
            }
            
            // Use the existing checkpoint manager for actual checkpoint creation
            const checkpointId = await this.checkpointManager.createAgentCheckpoint({
                description: `Smart: ${description}`,
                tags: ['smart', 'ai', ...(options.tags || [])],
                sessionId: options.sessionId || this.currentSession?.id
            });
            
            if (checkpointId && this.config.verboseLogging) {
                console.log(`✅ Smart agent checkpoint created: ${checkpointId.substring(0, 8)}...`);
            }
            
            return checkpointId;
        } catch (error) {
            console.error('❌ Failed to create smart agent checkpoint:', error);
            // Fallback to regular checkpoint manager
            return this.checkpointManager.createAgentCheckpoint(options);
        }
    }
    
    /**
     * Check if there are pending AI changes
     */
    async hasAIChanges(): Promise<boolean> {
        if (!this.initialized || !this.config.enabled) {
            return this.checkpointManager.hasAIChanges();
        }
        if (this.config.agentModeOnly && this.operationMode !== OperationMode.Agent) {
            return this.checkpointManager.hasAIChanges();
        }
        
        // Check if current session has tracked files with changes
        if (this.currentSession && this.currentSession.trackedFiles.size > 0) {
            return this.checkpointManager.hasWorkspaceChanges();
        }
        
        return false;
    }
    
    /**
     * Get statistics about the smart checkpoint system
     */
    async getSmartStats(): Promise<SmartStats> {
        const engineStats = typeof this.checkpointManager.getChangesetStats === 'function'
            ? await this.checkpointManager.getChangesetStats()
            : {
                files_tracked: 0,
                changes_detected: 0,
                mode: 'fallback' as const,
            };

        if (!this.initialized || !this.config.enabled) {
            return engineStats;
        }

        try {
            const memoryUsage = process.memoryUsage();
            const tracked = this.currentSession
                ? Array.from(this.currentSession.trackedFiles)
                : engineStats.tracked_files ?? [];
            return {
                files_tracked: tracked.length,
                changes_detected: engineStats.changes_detected,
                memory_usage_bytes: memoryUsage.heapUsed + memoryUsage.external,
                mode: this.operationMode,
                session_id: this.currentSession?.id ?? engineStats.session_id,
                tracked_files: tracked,
            };
        } catch (error) {
            console.error('Failed to get smart stats:', error);
            return engineStats;
        }
    }
    
    /**
     * Check if currently in agent mode
     */
    isInAgentMode(): boolean {
        return this.operationMode === OperationMode.Agent;
    }
    
    /**
     * Get current session information
     */
    getCurrentSession(): AISession | null {
        return this.currentSession;
    }
    
    /**
     * Check memory limits and take action if exceeded
     */
    private async isOverSmartFileSizeLimit(
        filePath: string,
        workspacePath?: string,
    ): Promise<boolean> {
        const maxBytes = this.config.maxFileSizeKB * 1024;
        if (maxBytes < 1) {
            return false;
        }
        const absolute = path.isAbsolute(filePath)
            ? filePath
            : workspacePath
                ? path.join(workspacePath, filePath)
                : filePath;
        try {
            const stat = await fs.stat(absolute);
            return stat.size > maxBytes;
        } catch {
            return false;
        }
    }

    private async checkMemoryLimits(): Promise<void> {
        try {
            const stats = await this.getSmartStats();
            const memoryLimitBytes = this.config.maxMemoryUsageMB * 1024 * 1024;
            const memoryBytes = stats.memory_usage_bytes ?? 0;
            
            if (memoryBytes > memoryLimitBytes) {
                console.warn(`⚠️ Memory usage (${Math.round(memoryBytes / 1024 / 1024)}MB) exceeds limit (${this.config.maxMemoryUsageMB}MB)`);
                
                // Take corrective action
                if (this.currentSession) {
                    // Reduce tracked files if possible
                    const trackedArray = Array.from(this.currentSession.trackedFiles);
                    if (trackedArray.length > this.config.maxTrackedFiles / 2) {
                        // Keep only the most recently added files
                        const keepCount = Math.floor(this.config.maxTrackedFiles / 2);
                        const toKeep = trackedArray.slice(-keepCount);
                        this.currentSession.trackedFiles = new Set(toKeep);
                        
                        console.log(`🧹 Reduced tracked files from ${trackedArray.length} to ${toKeep.length}`);
                    }
                }
            }
        } catch (error) {
            console.error('Failed to check memory limits:', error);
        }
    }
    
    /**
     * Load configuration from VSCode settings
     */
    loadConfiguration(): void {
        const loaded = readSmartCheckpointSettings();
        this.config = {
            ...this.getDefaultConfig(),
            ...loaded,
        };
    }

    reloadConfiguration(): void {
        this.loadConfiguration();
        if (this.config.enabled) {
            this.initialized = true;
        }
    }
    
    /**
     * Get default configuration
     */
    private getDefaultConfig(): SmartCheckpointConfig {
        return {
            ...SMART_CHECKPOINT_DEFAULTS,
            storagePath: getGlobalCheckpointsPath(),
        };
    }

    // ========================================
    // Phase 8.1: Incremental Checkpointing
    // ========================================

    /**
     * Create an incremental checkpoint during an AI session
     */
    async createIncrementalCheckpoint(description?: string): Promise<string | undefined> {
        if (!this.currentSession) {
            console.warn('No active AI session for incremental checkpoint');
            return undefined;
        }

        return this.checkpointManager.createIncrementalCheckpoint({
            description: description || `AI session incremental - ${this.currentSession.id}`,
            tags: ['ai-session', 'incremental', this.operationMode],
        });
    }

    // ========================================
    // Phase 8.3: AI Analysis
    // ========================================

    /**
     * Analyze a checkpoint and return risk/impact information
     */
    async analyzeCheckpoint(checkpointId: string): Promise<any> {
        return this.checkpointManager.analyzeCheckpoint(checkpointId);
    }

    /**
     * Get grouping suggestions for recent checkpoints
     */
    async suggestGroups(limit: number = 50): Promise<any[]> {
        return this.checkpointManager.suggestCheckpointGroups(limit);
    }
}

/**
 * AI Checkpoint Integration
 * 
 * Handles AI workflow integration with the smart checkpoint system.
 * Provides methods for AI agents to interact with checkpoints during their workflows.
 */
export class AICheckpointIntegration {
    private smartManager: SmartCheckpointManager;
    private checkpointManager: CheckpointManager;
    
    constructor() {
        this.smartManager = SmartCheckpointManager.getInstance();
        this.checkpointManager = CheckpointManager.getInstance();
    }
    
    /**
     * Called when AI agent starts working
     */
    async onAgentStart(sessionId: string, filesToWork: string[] = []): Promise<void> {
        let lastError: unknown;
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                await this.smartManager.startAISession(sessionId);
                
                if (filesToWork.length > 0) {
                    await this.smartManager.trackAIFiles(filesToWork);
                }
                
                console.log(`🤖 AI agent started: ${sessionId} (tracking ${filesToWork.length} files)`);
                return;
            } catch (error) {
                lastError = error;
                console.warn(`AI agent session start attempt ${attempt + 1} failed:`, error);
                if (attempt < 2) {
                    const delay = Math.min(500 * Math.pow(2, attempt), 4000);
                    await new Promise(r => setTimeout(r, delay));
                }
            }
        }
        console.error('Failed to start AI agent session after retries:', lastError);
        vscode.window.showWarningMessage(t('checkpoint.smart.failedStartSession'));
    }
    
    /**
     * Called when AI agent completes its work
     */
    async onAgentComplete(description?: string): Promise<string | undefined> {
        try {
            const checkpointId = await this.smartManager.createAgentCheckpoint({
                description: description || 'AI agent task completed',
                tags: ['ai-complete']
            });
            
            await this.smartManager.stopAISession();
            
            console.log(`✅ AI agent completed, checkpoint: ${checkpointId?.substring(0, 8) || 'none'}`);
            return checkpointId;
        } catch (error) {
            console.error('Failed to complete AI agent session:', error);
            return undefined;
        }
    }
    
    /**
     * Called when AI is about to modify specific files
     */
    async onFilesAboutToChange(filePaths: string[]): Promise<void> {
        try {
            await this.smartManager.trackAIFiles(filePaths);
            
            if (filePaths.length > 0) {
                console.log(`📝 AI about to modify ${filePaths.length} files`);
            }
        } catch (error) {
            console.error('Failed to track files about to change:', error);
        }
    }
    
    /**
     * Called when AI has finished modifying files
     */
    async onFilesChanged(description?: string): Promise<string | undefined> {
        try {
            const hasChanges = await this.smartManager.hasAIChanges();
            
            if (!hasChanges) {
                console.log('No AI changes detected, skipping checkpoint');
                return undefined;
            }
            
            return await this.smartManager.createAgentCheckpoint({
                description: description || 'AI file modifications',
                tags: ['ai-changes']
            });
        } catch (error) {
            console.error('Failed to create checkpoint for file changes:', error);
            return undefined;
        }
    }
    
    /**
     * Switch to chat mode (no tracking overhead)
     */
    async enterChatMode(): Promise<void> {
        try {
            await this.smartManager.setOperationMode(OperationMode.Chat);
            console.log('💬 Entered chat mode - checkpoint tracking disabled for performance');
        } catch (error) {
            console.error('Failed to enter chat mode:', error);
        }
    }
    
    /**
     * Switch to agent mode (full tracking)
     */
    async enterAgentMode(): Promise<void> {
        try {
            await this.smartManager.setOperationMode(OperationMode.Agent);
            console.log('🤖 Entered agent mode - checkpoint tracking enabled');
        } catch (error) {
            console.error('Failed to enter agent mode:', error);
        }
    }
    
    /**
     * Get current performance statistics
     */
    async getPerformanceStats(): Promise<SmartStats> {
        return this.smartManager.getSmartStats();
    }
    
    /**
     * Check if AI session is currently active
     */
    isSessionActive(): boolean {
        return this.smartManager.getCurrentSession() !== null;
    }
    
    /**
     * Get current operation mode
     */
    getCurrentMode(): OperationMode {
        return this.smartManager.getCurrentSession()?.operationMode || OperationMode.Chat;
    }
    
    /**
     * Force cleanup of memory and old checkpoints
     */
    async performCleanup(): Promise<void> {
        try {
            console.log('🧹 Performing smart checkpoint cleanup...');
            
            // Clean up old checkpoints using the base manager
            await this.checkpointManager.cleanupOldCheckpoints(7);
            
            // Reset current session if memory is high
            const stats = await this.getPerformanceStats();
            // Use a default memory limit since we can't access private config
            const memoryLimitBytes = 50 * 1024 * 1024; // 50MB default
            
            if ((stats.memory_usage_bytes ?? 0) > memoryLimitBytes * 0.8) {
                console.log('Memory usage high, resetting session');
                if (this.isSessionActive()) {
                    await this.smartManager.stopAISession();
                }
            }
            
            console.log('✅ Smart checkpoint cleanup completed');
        } catch (error) {
            console.error('Failed to perform cleanup:', error);
        }
    }

    /**
     * Build context for query (method expected by VsCodeMessenger)
     */
    async buildContextForQuery(query: string, maxTokens?: number): Promise<any> {
        // Simple implementation that returns basic context
        return {
            query: query,
            maxTokens: maxTokens || 4000,
            context: 'Basic context implementation',
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Provide contextual assistance
     */
    async provideContextualAssistance(cursorPosition?: any, selectedText?: string): Promise<any> {
        return {
            suggestions: [],
            cursorPosition: cursorPosition,
            selectedText: selectedText,
            contextType: 'assistance'
        };
    }

    /**
     * Provide debugging context
     */
    async provideDebuggingContext(errorMessage: string, stackTrace?: string): Promise<any> {
        return {
            errorAnalysis: {
                message: errorMessage,
                stackTrace: stackTrace,
                possibleCauses: [],
                suggestedFixes: []
            },
            contextType: 'debugging'
        };
    }

    /**
     * Provide refactoring context
     */
    async provideRefactoringContext(refactoringType: string, targetElement: string): Promise<any> {
        return {
            refactoringType: refactoringType,
            targetElement: targetElement,
            suggestions: [],
            contextType: 'refactoring'
        };
    }

    /**
     * Get semantic analysis for file
     */
    async getSemanticAnalysisForFile(filePath: string): Promise<any> {
        return {
            filePath: filePath,
            semanticInfo: {
                functions: [],
                classes: [],
                interfaces: [],
                dependencies: []
            },
            contextType: 'semantic'
        };
    }
}

