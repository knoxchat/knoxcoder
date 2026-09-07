import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IdeMessengerContext } from '../../context/IdeMessenger';
import { CollaborativePanel } from './CollaborativePanel';
import { CheckpointsPanel } from './CheckpointsPanel';
import { PerformanceDashboard } from './PerformanceDashboard';
import { CheckpointAnalysisPanel } from './CheckpointAnalysisPanel';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>) => {
      if (typeof fallback === 'string') {
        return fallback;
      }
      if (fallback && typeof fallback === 'object' && 'defaultValue' in fallback) {
        return String(fallback.defaultValue).replace('{{count}}', String(fallback.count ?? ''));
      }
      if (fallback && typeof fallback === 'object' && 'count' in fallback) {
        return `${key}(${fallback.count})`;
      }
      return key;
    },
  }),
}));

vi.mock('./index', () => ({
  Checkpoints: () => null,
}));

vi.mock('./CheckpointConfig', () => ({
  CheckpointConfig: () => null,
}));

beforeEach(() => {
  (HTMLElement.prototype as any).hasPointerCapture ??= () => false;
  (HTMLElement.prototype as any).setPointerCapture ??= () => undefined;
  (HTMLElement.prototype as any).releasePointerCapture ??= () => undefined;
  (HTMLElement.prototype as any).scrollIntoView ??= () => undefined;
  if (!(globalThis as any).ResizeObserver) {
    (globalThis as any).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

describe('PerformanceDashboard', () => {
  it('renders dashboard metrics and switches between tabs', async () => {
    const user = userEvent.setup();
    render(
      <PerformanceDashboard
        data={{
            currentStorage: {
            timestamp: '2026-04-20T12:00:00.000Z',
            totalBytes: 2048,
            checkpointDataBytes: 1024,
            blobCount: 4,
            checkpointCount: 3,
          },
          storageHistory: [
            {
              timestamp: '2026-04-19T12:00:00.000Z',
              totalBytes: 1024,
              checkpointDataBytes: 512,
              blobCount: 2,
              checkpointCount: 1,
            },
            {
              timestamp: '2026-04-20T12:00:00.000Z',
              totalBytes: 2048,
              checkpointDataBytes: 1024,
              blobCount: 4,
              checkpointCount: 3,
            },
          ],
          creationFrequency: [
            { bucket: '2026-04-19T00:00:00.000Z', count: 1 },
            { bucket: '2026-04-20T00:00:00.000Z', count: 2 },
          ],
          restorationEvents: [
            {
              timestamp: '2026-04-20T12:05:00.000Z',
              checkpointId: 'cp-12345678',
              success: true,
              durationMs: 120,
              filesRestored: 2,
              filesFailed: 0,
            },
          ],
          aiSessionMetrics: [
            {
              sessionId: 'session-12345678',
              startedAt: '2026-04-20T11:50:00.000Z',
              endedAt: '2026-04-20T12:00:00.000Z',
              filesChanged: 2,
              linesAdded: 10,
              linesDeleted: 4,
              checkpointsCreated: 2,
              rollbacks: 1,
              durationSeconds: 600,
            },
          ],
          summary: {
            totalCheckpointsCreated: 3,
            totalRestorations: 1,
            restorationSuccessRate: 100,
            avgCreationTimeMs: 45,
            avgRestorationTimeMs: 120,
            totalAiSessions: 1,
            avgChangesPerSession: 2,
            totalRollbacks: 1,
          },
        }}
      />,
    );

    expect(screen.getByText('Performance Dashboard')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText('100%')).toBeTruthy();

    await user.click(screen.getByRole('tab', { name: 'Activity' }));
    expect(screen.getByText('Restoration History')).toBeTruthy();
    expect(screen.getByText('2 files')).toBeTruthy();

    await user.click(screen.getByRole('tab', { name: 'AI Sessions' }));
    expect(screen.getByText('AI Session Metrics')).toBeTruthy();
    expect(screen.getByText('+10')).toBeTruthy();
    expect(screen.getByText('-4')).toBeTruthy();
  });
});

describe('CollaborativePanel', () => {
  it('renders shared bundles and expands audit trail details', async () => {
    const user = userEvent.setup();
    render(
      <CollaborativePanel
        bundles={[
          {
            id: 'bundle-1',
            description: 'Refactor bundle',
            sharedAt: '2026-04-20T10:00:00.000Z',
            checkpointCount: 2,
            checkpointIds: ['cp-a', 'cp-b'],
            filePath: '/tmp/refactor.knoxcp.json',
            sharedBy: 'machine-1',
            machineId: 'machine-1',
            exists: true,
          },
        ]}
        auditRecords={[
          {
            id: 'audit-1',
            timestamp: '2026-04-20T10:05:00.000Z',
            userId: 'machine-1',
            machineId: 'machine-1',
            action: 'share',
            resourceType: 'checkpoint_bundle',
            resourceId: '/tmp/refactor.knoxcp.json',
            outcome: 'Success',
            details: '{"count":"2"}',
          },
        ]}
      />,
    );

    expect(screen.getByText('Share Bundles')).toBeTruthy();
    expect(screen.getByText('Refactor bundle')).toBeTruthy();
    expect(screen.getByText('2 checkpoints')).toBeTruthy();
    expect(screen.getByText('/tmp/refactor.knoxcp.json')).toBeTruthy();

    await user.click(screen.getByRole('tab', { name: /Audit Trail/i }));
    expect(screen.getByText('share')).toBeTruthy();

    fireEvent.click(screen.getByText('share').closest('button') as HTMLElement);
    expect(screen.getByText(/Machine:/)).toBeTruthy();
    expect(screen.getByText('{"count":"2"}')).toBeTruthy();
  });
});

describe('CheckpointsPanel dashboard tab', () => {
  it('loads restoration history from the host dashboard API', async () => {
    const request = vi.fn().mockResolvedValue({
      status: 'success',
      content: {
        success: true,
        data: {
          currentStorage: {
            timestamp: '2026-08-17T12:00:00.000Z',
            totalBytes: 2048,
            checkpointDataBytes: 1024,
            blobCount: 2,
            checkpointCount: 1,
          },
          storageHistory: [],
          creationFrequency: [],
          restorationEvents: [
            {
              timestamp: '2026-08-17T12:05:00.000Z',
              checkpointId: 'cp-restore1',
              success: true,
              durationMs: 80,
              filesRestored: 3,
              filesFailed: 0,
            },
          ],
          aiSessionMetrics: [],
          summary: {
            totalCheckpointsCreated: 1,
            totalRestorations: 1,
            restorationSuccessRate: 100,
            avgCreationTimeMs: 20,
            avgRestorationTimeMs: 80,
            totalAiSessions: 0,
            avgChangesPerSession: 0,
            totalRollbacks: 0,
          },
        },
      },
    });
    const messenger = {
      request,
      post: vi.fn(),
      respond: vi.fn(),
      streamRequest: vi.fn(),
      llmStreamChat: vi.fn(),
      ide: {} as any,
    } as any;

    const user = userEvent.setup();
    render(
      <IdeMessengerContext.Provider value={messenger}>
        <CheckpointsPanel initialTabId="dashboard" padded={false} />
      </IdeMessengerContext.Provider>,
    );

    await waitFor(() => {
      expect(request).toHaveBeenCalledWith('getPerformanceDashboard', { historyDays: 30 });
    });
    expect(screen.getByText('Performance Dashboard')).toBeTruthy();

    await user.click(screen.getByRole('tab', { name: 'Activity' }));
    expect(screen.getByText('Restoration History')).toBeTruthy();
    expect(screen.getByText('3 files')).toBeTruthy();
  });
});

describe('CheckpointsPanel share tab', () => {
  it('loads local share bundles from the host API', async () => {
    const request = vi.fn().mockResolvedValue({
      status: 'success',
      content: {
        success: true,
        bundles: [
          {
            id: 'bundle-1',
            description: 'USB handoff',
            sharedAt: '2026-08-17T12:00:00.000Z',
            checkpointCount: 1,
            checkpointIds: ['cp-1'],
            filePath: '/tmp/handoff.knoxcp.json',
            sharedBy: 'machine-1',
            machineId: 'machine-1',
            exists: true,
          },
        ],
        auditRecords: [],
      },
    });
    const messenger = {
      request,
      post: vi.fn(),
      respond: vi.fn(),
      streamRequest: vi.fn(),
      llmStreamChat: vi.fn(),
      ide: {} as any,
    } as any;

    render(
      <IdeMessengerContext.Provider value={messenger}>
        <CheckpointsPanel initialTabId="share" padded={false} />
      </IdeMessengerContext.Provider>,
    );

    await waitFor(() => {
      expect(request).toHaveBeenCalledWith('getSharedCheckpointBundles', { limit: 100 });
    });
    expect(screen.getByText('Share Bundles')).toBeTruthy();
    expect(screen.getByText('USB handoff')).toBeTruthy();
    expect(screen.getByText('/tmp/handoff.knoxcp.json')).toBeTruthy();
  });
});

describe('CheckpointAnalysisPanel', () => {
  it('renders heuristic counts from the analysis payload, not hardcoded zeros', () => {
    render(
      <CheckpointAnalysisPanel
        analysis={{
          generatedDescription: 'Delta · 3 file(s) · scope Module',
          riskAssessment: {
            level: 'Medium',
            score: 2.5,
            factors: [{
              category: 'config',
              description: 'package.json changed',
              weight: 1.5,
              affectedFiles: ['package.json'],
            }],
            recommendations: ['Reinstall or re-sync dependencies if you restore this checkpoint.'],
          },
          impactAnalysis: {
            affectedFeatures: [{ name: 'src', impactLevel: 'Medium', changedFiles: ['src/a.ts'] }],
            affectedLayers: ['src'],
            scope: 'Module',
            uniqueDirectories: 2,
            testFilesChanged: true,
            linesAdded: 12,
            linesDeleted: 4,
          },
          groupingSuggestion: {
            id: 'session:abc',
            kind: 'session',
            groupName: 'Session abc',
            rationale: 'Same bound session',
            confidence: 0.8,
            checkpointIds: ['cp-1', 'cp-2'],
          },
          counts: {
            changed: 3,
            created: 1,
            deleted: 0,
            modified: 2,
            binary: 0,
            config: 1,
            lockfile: 0,
            tests: 1,
          },
        }}
      />,
    );

    expect(screen.getByText('Delta · 3 file(s) · scope Module')).toBeTruthy();
    expect(screen.getByText(/Changed:\s*3/)).toBeTruthy();
    expect(screen.getByText(/Tests:\s*1/)).toBeTruthy();
    expect(screen.getByText(/Config:\s*1/)).toBeTruthy();
    expect(screen.getByText(/\+12 \/ -4/)).toBeTruthy();
    expect(screen.queryByText('test coverage')).toBeNull();
    expect(screen.queryByText('bug density')).toBeNull();
    expect(screen.getByText(/Session abc/)).toBeTruthy();
  });
});

describe('CheckpointsPanel timeline tab', () => {
  it('loads named branch lines from the host timeline API', async () => {
    const request = vi.fn().mockResolvedValue({
      status: 'success',
      content: {
        success: true,
        checkpoints: [
          {
            id: 'cp-main',
            description: 'On main',
            created: '2026-08-17T10:00:00.000Z',
            type: 'manual',
            branchId: 'br_main',
            tags: [],
            isIncremental: false,
          },
          {
            id: 'cp-feat',
            description: 'On feature',
            created: '2026-08-17T11:00:00.000Z',
            type: 'manual',
            branchId: 'br_feature',
            tags: [],
            isIncremental: true,
          },
        ],
        branches: [
          {
            id: 'br_main',
            name: 'main',
            color: '#3b82f6',
            baseCheckpointId: 'cp-main',
            checkpoints: ['cp-main'],
            isActive: true,
          },
          {
            id: 'br_feature',
            name: 'feature',
            color: '#10b981',
            baseCheckpointId: 'cp-main',
            checkpoints: ['cp-feat'],
            isActive: false,
          },
        ],
        activeBranchId: 'br_main',
      },
    });
    const messenger = {
      request,
      post: vi.fn(),
      respond: vi.fn(),
      streamRequest: vi.fn(),
      llmStreamChat: vi.fn(),
      ide: {} as any,
    } as any;

    render(
      <IdeMessengerContext.Provider value={messenger}>
        <CheckpointsPanel initialTabId="timeline" padded={false} />
      </IdeMessengerContext.Provider>,
    );

    await waitFor(() => {
      expect(request).toHaveBeenCalledWith('getCheckpointTimeline', { limit: 500 });
    });
    expect(await screen.findByText('On main')).toBeTruthy();
    expect(screen.getByText('On feature')).toBeTruthy();
    expect(screen.getByText('feature')).toBeTruthy();
  });
});

describe('CheckpointsPanel analysis tab', () => {
  it('loads groups and analyzes the selected checkpoint from the host APIs', async () => {
    const request = vi.fn().mockImplementation(async (method: string) => {
      if (method === 'listCheckpoints') {
        return {
          status: 'success',
          content: {
            checkpoints: [{ id: 'cp-1', description: 'Before lockfile bump', dateCreated: '2026-08-17T12:00:00.000Z' }],
            compareCatalog: [{ id: 'cp-1', description: 'Before lockfile bump', dateCreated: '2026-08-17T12:00:00.000Z' }],
            total: 1,
            offset: 0,
            limit: 50,
            hasMore: false,
          },
        };
      }
      if (method === 'suggestCheckpointGroups') {
        return {
          status: 'success',
          content: {
            success: true,
            groups: [{
              id: 'session:s1',
              kind: 'session',
              groupName: 'Session s1',
              rationale: 'Same bound session',
              confidence: 0.9,
              checkpointIds: ['cp-1'],
            }],
          },
        };
      }
      if (method === 'analyzeCheckpoint') {
        return {
          status: 'success',
          content: {
            success: true,
            analysis: {
              checkpointId: 'cp-1',
              generatedDescription: 'Delta · 2 file(s) · scope Isolated',
              riskAssessment: {
                level: 'Low',
                score: 0.5,
                factors: [],
                recommendations: ['Low-risk change set; restore is unlikely to affect project config.'],
              },
              impactAnalysis: {
                affectedFeatures: [],
                affectedLayers: ['src'],
                scope: 'Isolated',
                uniqueDirectories: 1,
                testFilesChanged: false,
                linesAdded: 5,
                linesDeleted: 1,
              },
              counts: {
                changed: 2,
                created: 0,
                deleted: 0,
                modified: 2,
                binary: 0,
                config: 0,
                lockfile: 0,
                tests: 0,
              },
            },
          },
        };
      }
      return { status: 'success', content: {} };
    });
    const messenger = {
      request,
      post: vi.fn(),
      respond: vi.fn(),
      streamRequest: vi.fn(),
      llmStreamChat: vi.fn(),
      ide: {} as any,
    } as any;

    render(
      <IdeMessengerContext.Provider value={messenger}>
        <CheckpointsPanel initialTabId="analysis" padded={false} />
      </IdeMessengerContext.Provider>,
    );

    await waitFor(() => {
      expect(request).toHaveBeenCalledWith('suggestCheckpointGroups', { limit: 50 });
    });
    await waitFor(() => {
      expect(request).toHaveBeenCalledWith('analyzeCheckpoint', { checkpointId: 'cp-1' });
    });
    expect(screen.getByText('Delta · 2 file(s) · scope Isolated')).toBeTruthy();
    expect(screen.getByText(/Changed:\s*2/)).toBeTruthy();
    expect(screen.getByText('Session s1')).toBeTruthy();
  });
});
