import { configureStore } from '@reduxjs/toolkit';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Checkpoints } from './index';
import { CheckpointCompareDialog } from './CheckpointCompareDialog';
import {
  buildCheckpointSearchDocument,
  chronologicalCheckpointPair,
  compareCheckpointTargets,
  selectCheckpointIdRange,
} from './checkpointListQuery';
import { IdeMessengerContext } from '../../context/IdeMessenger';
import type { CheckpointMetadata } from './checkpointTypes';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { shown?: number; total?: number }) => {
      if (key === 'showingCheckpoints') {
        return `showing ${opts?.shown} of ${opts?.total}`;
      }
      return key;
    },
  }),
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

vi.mock('../../hooks/useWebviewListener', () => ({
  useWebviewListener: () => undefined,
}));

vi.mock('../gui/Shortcut', () => ({
  default: ({ children }: { children: unknown }) => <span>{children as any}</span>,
}));

vi.mock('../gui/Tooltip', () => ({
  ToolTip: () => null,
}));

vi.mock('../../util/indexedDB', () => ({
  indexedDBManager: {
    getItem: vi.fn().mockResolvedValue(undefined),
    setItem: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('./PierreDiffViewer', () => ({
  PierreDiffViewer: () => <div data-testid="pierre-diff">diff</div>,
}));

vi.mock('./RestorePreviewDialog', () => ({
  RestorePreviewDialog: ({
    open,
    checkpointId,
  }: {
    open: boolean;
    checkpointId: string;
  }) => (open ? <div data-testid="restore-preview">{checkpointId}</div> : null),
}));

afterEach(() => {
  vi.clearAllMocks();
});

function metadata(partial: Partial<CheckpointMetadata> & Pick<CheckpointMetadata, 'id' | 'description' | 'dateCreated'>): CheckpointMetadata {
  return partial;
}

describe('checkpoint list query (CP-32)', () => {
  it('indexes tag, path, and session for MiniSearch', () => {
    const doc = buildCheckpointSearchDocument(metadata({
      id: 'cp_1',
      description: 'Auth work',
      dateCreated: '2026-08-17T00:00:00.000Z',
      tags: ['manual', 'auth'],
      sessionId: 'sess-9',
      changedPaths: ['src/auth.ts', 'src/login.tsx'],
    }));
    expect(doc.tags).toContain('auth');
    expect(doc.sessionId).toBe('sess-9');
    expect(doc.paths).toContain('src/login.tsx');
  });

  it('selects an inclusive range and orders compare targets including newer checkpoints', () => {
    expect(selectCheckpointIdRange(['a', 'b', 'c', 'd'], 'b', 'd')).toEqual(['b', 'c', 'd']);
    const catalog = [
      metadata({ id: 'cp-a', description: 'A', dateCreated: '2026-04-01T00:00:00.000Z' }),
      metadata({ id: 'cp-b', description: 'B', dateCreated: '2026-04-02T00:00:00.000Z' }),
      metadata({ id: 'cp-c', description: 'C', dateCreated: '2026-04-03T00:00:00.000Z' }),
    ];
    const fromA = compareCheckpointTargets(catalog, 'cp-a').map((item) => item.id);
    expect(fromA).toEqual(['cp-c', 'cp-b']);
    const [older, newer] = chronologicalCheckpointPair(catalog[2], catalog[0]);
    expect(older.id).toBe('cp-a');
    expect(newer.id).toBe('cp-c');
  });
});

describe('Checkpoints overlay scale (CP-32)', () => {
  it('renders a page of 50 instead of 500 rows', async () => {
    const page = Array.from({ length: 50 }, (_, index) => metadata({
      id: `cp_${index}`,
      description: `Checkpoint ${index}`,
      dateCreated: `2026-08-17T00:00:${String(index).padStart(2, '0')}.000Z`,
    }));
    const request = vi.fn().mockResolvedValue({
      status: 'success',
      content: {
        checkpoints: page,
        total: 500,
        offset: 0,
        limit: 50,
        hasMore: true,
        compareCatalog: page.slice(0, 3),
        workspaceFolders: [],
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

    const store = configureStore({
      reducer: {
        session: (state = { id: 'sess-test' }) => state,
      },
    });
    const { container } = render(
      <Provider store={store}>
        <IdeMessengerContext.Provider value={messenger}>
          <Checkpoints />
        </IdeMessengerContext.Provider>
      </Provider>,
    );

    await waitFor(() => {
      expect(request).toHaveBeenCalledWith('listCheckpoints', expect.objectContaining({
        limit: 50,
        offset: 0,
      }));
    });
    expect(await screen.findByTestId('checkpoint-list')).toBeTruthy();
    expect(container.querySelectorAll('[data-testid="checkpoint-row"]').length).toBe(50);
    expect(screen.getByText('showing 50 of 500')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'loadMoreCheckpoints' })).toBeTruthy();

    const list = screen.getByTestId('checkpoint-list');
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    fireEvent.keyDown(list, { key: 'Enter' });
    expect((await screen.findByTestId('restore-preview')).textContent).toBe('cp_0');
  });
});

describe('CheckpointCompareDialog (CP-32)', () => {
  it('diffs two explicit checkpoint ids', async () => {
    const request = vi.fn().mockResolvedValue({
      status: 'success',
      content: {
        success: true,
        diff: {
          oldCheckpoint: { id: 'cp-a', description: 'A', created: '2026-04-01T00:00:00.000Z' },
          newCheckpoint: { id: 'cp-c', description: 'C', created: '2026-04-03T00:00:00.000Z' },
          files: [{
            relativePath: 'src/a.ts',
            status: 'modified',
            oldContent: 'a',
            newContent: 'c',
            oldEncoding: 'utf8',
            newEncoding: 'utf8',
          }],
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

    render(
      <IdeMessengerContext.Provider value={messenger}>
        <CheckpointCompareDialog
          open={true}
          leftId="cp-a"
          rightId="cp-c"
          leftLabel="A"
          rightLabel="C"
          onOpenChange={vi.fn()}
        />
      </IdeMessengerContext.Provider>,
    );

    await waitFor(() => {
      expect(request).toHaveBeenCalledWith('computeCheckpointDiff', {
        checkpointId: 'cp-c',
        compareToCheckpointId: 'cp-a',
      });
    });
    expect(await screen.findByTestId('checkpoint-compare-dialog')).toBeTruthy();
    expect(await screen.findByTestId('pierre-diff')).toBeTruthy();
  });
});
