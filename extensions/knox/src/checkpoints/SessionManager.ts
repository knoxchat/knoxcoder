import * as vscode from 'vscode';

import { CheckpointManager } from './CheckpointManager';
import { resolveCheckpointStoragePath } from './manager/persistence';
import { canonicalizeWorkspacePath, workspacePathsEqual } from './store/workspaceStore';
import {
    loadSessionMap,
    saveSessionMap,
    type PersistedSessionRecord,
} from './store/durableState';

/**
 * Session types for checkpoint isolation
 */
export enum SessionType {
    CHAT = 'chat',
    MANUAL = 'manual',
    AGENT = 'agent',
    DEBUG = 'debug'
}

/**
 * Session context for checkpoint operations
 */
export interface SessionContext {
    id: string;
    type: SessionType;
    workspacePath: string;
    created: Date;
    lastAccessed: Date;
    metadata: { [key: string]: any };
}

function isSessionType(value: string): value is SessionType {
    return value === SessionType.CHAT
        || value === SessionType.MANUAL
        || value === SessionType.AGENT
        || value === SessionType.DEBUG;
}

/**
 * Manages checkpoint sessions to prevent conflicts between different modes
 */
export class CheckpointSessionManager {
    private static instance: CheckpointSessionManager | undefined;
    private activeSessions: Map<string, SessionContext> = new Map();
    private workspaceSessionMap: Map<string, string> = new Map();
    private currentChatSessionId: string | undefined;
    private currentManualSessionId: string | undefined;
    private sessionLocks: Map<string, Promise<void>> = new Map();
    private sessionLockResolvers: Map<string, () => void> = new Map();
    private persistenceEnabled = false;
    private overrideStoragePath: string | undefined;
    private initialized = false;

    static getInstance(): CheckpointSessionManager {
        if (!CheckpointSessionManager.instance) {
            CheckpointSessionManager.instance = new CheckpointSessionManager();
        }
        return CheckpointSessionManager.instance;
    }

    /**
     * Load persisted sessions for the current workspace folder(s) and bind
     * the latest one onto CheckpointManager so new manifests keep the same id.
     */
    async initialize(options?: { storagePath?: string }): Promise<void> {
        this.persistenceEnabled = true;
        if (options?.storagePath) {
            this.overrideStoragePath = options.storagePath;
        }
        await this.reloadFromStores();
        this.initialized = true;
    }

    /** @internal test helper — clears in-memory state and disables disk writes. */
    resetForTests(): void {
        this.activeSessions.clear();
        this.workspaceSessionMap.clear();
        this.currentChatSessionId = undefined;
        this.currentManualSessionId = undefined;
        this.sessionLocks.clear();
        this.sessionLockResolvers.clear();
        this.persistenceEnabled = false;
        this.overrideStoragePath = undefined;
        this.initialized = false;
    }

    /**
     * Get or create a session for the given type and workspace
     */
    async getSession(type: SessionType, workspacePath: string): Promise<SessionContext> {
        const sessionKey = this.sessionKey(type, workspacePath);

        if (this.activeSessions.has(sessionKey)) {
            const session = this.activeSessions.get(sessionKey)!;
            session.lastAccessed = new Date();
            this.rememberCurrentSession(session);
            await this.notifyCheckpointManagerOfSession(session);
            await this.persistSessions();
            return session;
        }

        const sessionId = this.generateSessionId(type, workspacePath);
        const session: SessionContext = {
            id: sessionId,
            type,
            workspacePath,
            created: new Date(),
            lastAccessed: new Date(),
            metadata: {}
        };

        this.activeSessions.set(sessionKey, session);
        this.rememberCurrentSession(session);
        await this.notifyCheckpointManagerOfSession(session);
        await this.persistSessions();

        console.log(`📝 Created new ${type} session: ${sessionId.substring(0, 8)}... for ${workspacePath}`);
        return session;
    }

    /**
     * Get the current chat session ID
     */
    getCurrentChatSession(workspacePath: string): string | undefined {
        return this.activeSessions.get(this.sessionKey(SessionType.CHAT, workspacePath))?.id;
    }

    /**
     * Get the current manual session ID
     */
    getCurrentManualSession(workspacePath: string): string | undefined {
        return this.activeSessions.get(this.sessionKey(SessionType.MANUAL, workspacePath))?.id;
    }

    /**
     * Switch to a different session type (e.g., from chat to manual)
     */
    async switchSession(fromType: SessionType, toType: SessionType, workspacePath: string): Promise<SessionContext> {
        await this.flushSession(fromType, workspacePath);
        return await this.getSession(toType, workspacePath);
    }

    /**
     * Acquire a lock for session operations to prevent conflicts
     */
    async acquireSessionLock(sessionId: string): Promise<void> {
        while (this.sessionLocks.has(sessionId)) {
            await this.sessionLocks.get(sessionId);
        }

        let resolveLock!: () => void;
        const lockPromise = new Promise<void>((resolve) => {
            resolveLock = resolve;
        });

        this.sessionLocks.set(sessionId, lockPromise);
        this.sessionLockResolvers.set(sessionId, resolveLock);

        setTimeout(() => {
            this.releaseSessionLock(sessionId);
        }, 30000);
    }

    /**
     * Release a session lock
     */
    releaseSessionLock(sessionId: string): void {
        const resolver = this.sessionLockResolvers.get(sessionId);
        this.sessionLocks.delete(sessionId);
        this.sessionLockResolvers.delete(sessionId);
        resolver?.();
    }

    /**
     * Flush any pending operations for a session
     */
    private async flushSession(type: SessionType, workspacePath: string): Promise<void> {
        const session = this.activeSessions.get(this.sessionKey(type, workspacePath));

        if (session) {
            await this.acquireSessionLock(session.id);
            await new Promise(resolve => setTimeout(resolve, 100));
            this.releaseSessionLock(session.id);
        }
    }

    /**
     * Handle workspace folder changes
     */
    async onWorkspaceChanged(event: vscode.WorkspaceFoldersChangeEvent): Promise<void> {
        for (const removed of event.removed) {
            await this.cleanupWorkspaceSessions(removed.uri.fsPath);
        }

        for (const added of event.added) {
            await this.reloadFromStore(added.uri.fsPath);
            await this.getSession(SessionType.CHAT, added.uri.fsPath);
        }
    }

    /**
     * Clean up sessions for a workspace
     */
    private async cleanupWorkspaceSessions(workspacePath: string): Promise<void> {
        const sessionsToRemove: string[] = [];
        const sessionsToNotify: SessionContext[] = [];

        for (const [key, session] of this.activeSessions.entries()) {
            if (workspacePathsEqual(session.workspacePath, workspacePath)) {
                await this.flushSession(session.type, workspacePath);
                sessionsToRemove.push(key);
                sessionsToNotify.push(session);
            }
        }

        for (const session of sessionsToNotify) {
            await this.notifyCheckpointManagerOfSessionCleanup(session);
        }

        for (const key of sessionsToRemove) {
            this.activeSessions.delete(key);
        }

        await this.persistSessions();
        console.log(`🧹 Cleaned up ${sessionsToRemove.length} sessions for workspace: ${workspacePath}`);
    }

    /**
     * Bind the session id onto CheckpointManager so subsequent manifests
     * carry the same session label after reload.
     */
    private async notifyCheckpointManagerOfSession(session: SessionContext): Promise<void> {
        try {
            const checkpointManager = CheckpointManager.getInstance();
            checkpointManager.bindWorkspaceSession(session.id, session.type);
            session.metadata.checkpointManagerNotified = true;
            session.metadata.sessionType = session.type;
        } catch (error) {
            console.warn('Failed to notify CheckpointManager about new session:', error);
        }
    }

    /**
     * Notify CheckpointManager about session cleanup
     */
    private async notifyCheckpointManagerOfSessionCleanup(session: SessionContext): Promise<void> {
        try {
            const checkpointManager = CheckpointManager.getInstance();
            checkpointManager.clearWorkspaceSession(session.id);
        } catch (error) {
            console.warn('Failed to notify CheckpointManager about session cleanup:', error);
        }
    }

    /**
     * Get session context for a checkpoint operation
     */
    getSessionContext(sessionId: string): SessionContext | undefined {
        for (const session of this.activeSessions.values()) {
            if (session.id === sessionId) {
                return session;
            }
        }
        return undefined;
    }

    /**
     * Get all sessions for a specific workspace
     */
    getWorkspaceSessions(workspacePath: string): SessionContext[] {
        const workspaceSessions: SessionContext[] = [];

        for (const session of this.activeSessions.values()) {
            if (workspacePathsEqual(session.workspacePath, workspacePath)) {
                workspaceSessions.push(session);
            }
        }

        return workspaceSessions;
    }

    /**
     * Check if a session is active
     */
    isSessionActive(sessionId: string): boolean {
        for (const session of this.activeSessions.values()) {
            if (session.id === sessionId) {
                return true;
            }
        }
        return false;
    }

    /**
     * Get session statistics for monitoring
     */
    getSessionStats(): {
        totalSessions: number;
        sessionsByType: { [key: string]: number };
        oldestSession: Date | null;
        newestSession: Date | null;
    } {
        const sessionsByType: { [key: string]: number } = {};
        let oldestSession: Date | null = null;
        let newestSession: Date | null = null;

        for (const session of this.activeSessions.values()) {
            sessionsByType[session.type] = (sessionsByType[session.type] || 0) + 1;

            if (!oldestSession || session.created < oldestSession) {
                oldestSession = session.created;
            }
            if (!newestSession || session.created > newestSession) {
                newestSession = session.created;
            }
        }

        return {
            totalSessions: this.activeSessions.size,
            sessionsByType,
            oldestSession,
            newestSession
        };
    }

    /**
     * Generate a unique session ID
     */
    private generateSessionId(type: SessionType, workspacePath: string): string {
        const timestamp = Date.now();
        const workspaceHash = this.hashString(workspacePath);
        return `${type}_${workspaceHash}_${timestamp}`;
    }

    /**
     * Clean up sessions older than the given threshold (default: 1 hour of inactivity)
     */
    cleanupStaleSessions(maxAgeMs: number = 60 * 60 * 1000): number {
        const now = Date.now();
        let cleaned = 0;
        for (const [key, session] of this.activeSessions.entries()) {
            if (now - session.lastAccessed.getTime() > maxAgeMs) {
                CheckpointManager.getInstance().clearWorkspaceSession(session.id);
                this.activeSessions.delete(key);
                this.sessionLocks.delete(session.id);
                cleaned++;
            }
        }
        if (cleaned > 0) {
            console.log(`🧹 Cleaned up ${cleaned} stale sessions`);
            void this.persistSessions();
        }
        return cleaned;
    }

    /**
     * Simple hash function for strings
     */
    private hashString(str: string): string {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return Math.abs(hash).toString(36);
    }

    private sessionKey(type: SessionType, workspacePath: string): string {
        return `${type}_${canonicalizeWorkspacePath(workspacePath)}`;
    }

    private rememberCurrentSession(session: SessionContext): void {
        if (session.type === SessionType.CHAT) {
            this.currentChatSessionId = session.id;
        } else if (session.type === SessionType.MANUAL) {
            this.currentManualSessionId = session.id;
        }
    }

    private serializeSessions(sessions: Iterable<SessionContext> = this.activeSessions.values()): PersistedSessionRecord[] {
        return Array.from(sessions).map((session) => ({
            id: session.id,
            type: session.type,
            workspacePath: session.workspacePath,
            created: session.created.toISOString(),
            lastAccessed: session.lastAccessed.toISOString(),
            metadata: session.metadata,
        }));
    }

    private hydrateSession(record: PersistedSessionRecord): SessionContext | null {
        if (!isSessionType(record.type)) {
            return null;
        }
        return {
            id: record.id,
            type: record.type,
            workspacePath: record.workspacePath,
            created: new Date(record.created),
            lastAccessed: new Date(record.lastAccessed),
            metadata: record.metadata ?? {},
        };
    }

    private storagePathFor(workspacePath: string): string {
        return this.overrideStoragePath || resolveCheckpointStoragePath(workspacePath);
    }

    private async persistSessions(): Promise<void> {
        if (!this.persistenceEnabled) {
            return;
        }
        try {
            if (this.overrideStoragePath) {
                await saveSessionMap(this.overrideStoragePath, this.serializeSessions());
                return;
            }
            const byWorkspace = new Map<string, SessionContext[]>();
            for (const session of this.activeSessions.values()) {
                const key = canonicalizeWorkspacePath(session.workspacePath);
                const list = byWorkspace.get(key) ?? [];
                list.push(session);
                byWorkspace.set(key, list);
            }
            for (const sessions of byWorkspace.values()) {
                await saveSessionMap(
                    this.storagePathFor(sessions[0].workspacePath),
                    this.serializeSessions(sessions),
                );
            }
        } catch (error) {
            console.warn('Failed to persist checkpoint sessions:', error);
        }
    }

    private async reloadFromStore(workspacePath: string): Promise<void> {
        const records = await loadSessionMap(this.storagePathFor(workspacePath));
        for (const record of records) {
            const session = this.hydrateSession(record);
            if (!session) {
                continue;
            }
            this.activeSessions.set(this.sessionKey(session.type, session.workspacePath), session);
            this.rememberCurrentSession(session);
        }
    }

    private async reloadFromStores(): Promise<void> {
        if (this.overrideStoragePath) {
            this.activeSessions.clear();
            await this.reloadFromStore(this.overrideStoragePath);
            this.bindLatestLoadedSession();
            return;
        }

        const folders = vscode.workspace.workspaceFolders ?? [];
        if (folders.length === 0) {
            const current = CheckpointManager.getInstance().getCurrentWorkspacePath();
            if (current) {
                await this.reloadFromStore(current);
            }
            this.bindLatestLoadedSession();
            return;
        }

        for (const folder of folders) {
            await this.reloadFromStore(folder.uri.fsPath);
        }
        this.bindLatestLoadedSession();
    }

    private bindLatestLoadedSession(): void {
        const current = CheckpointManager.getInstance().getCurrentWorkspacePath()
            ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!current) {
            return;
        }
        const latest = this.getWorkspaceSessions(current)
            .sort((a, b) => b.lastAccessed.getTime() - a.lastAccessed.getTime())[0];
        if (latest) {
            void this.notifyCheckpointManagerOfSession(latest);
        }
    }

    /**
     * Dispose of all sessions and cleanup resources
     */
    async dispose(): Promise<void> {
        console.log('🧹 Disposing checkpoint session manager...');

        await this.persistSessions();

        const allSessions = Array.from(this.activeSessions.values());
        for (const session of allSessions) {
            await this.notifyCheckpointManagerOfSessionCleanup(session);
        }

        this.activeSessions.clear();
        this.workspaceSessionMap.clear();
        this.sessionLocks.clear();

        this.currentChatSessionId = undefined;
        this.currentManualSessionId = undefined;
        this.initialized = false;

        console.log('✅ Checkpoint session manager disposed');
    }
}
