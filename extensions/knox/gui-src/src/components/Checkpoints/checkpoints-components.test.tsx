import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CheckpointConfig } from './CheckpointConfig';
import { PierreDiffViewer } from './PierreDiffViewer';
import { CheckpointTimeline } from './CheckpointTimeline';
import { CheckpointTableRow } from './CheckpointTableRow';
import { IdeMessengerContext } from '../../context/IdeMessenger';
import { VscThemeContext } from '../../context/VscTheme';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('../../util/indexedDB', () => ({
  indexedDBManager: {
    getItem: vi.fn().mockResolvedValue(undefined),
    setItem: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../gui/Tooltip', () => ({
  ToolTip: () => null,
}));

afterEach(() => {
  vi.clearAllMocks();
});

const themeValue = {
  theme: {
    '.hljs-keyword': '#2563eb',
    '.hljs-title': '#0f766e',
    '.hljs-string': '#dc2626',
  },
};

function renderWithTheme(ui: React.ReactElement) {
  return render(
    <VscThemeContext.Provider value={themeValue}>
      {ui}
    </VscThemeContext.Provider>,
  );
}

describe('PierreDiffViewer', () => {
  it('renders a modified file and toggles view mode', async () => {
    renderWithTheme(
      <PierreDiffViewer
        oldCheckpoint={{
          id: 'old-checkpoint',
          description: 'Old',
          created: '2026-04-01T00:00:00.000Z',
          fileSnapshots: [{
            relativePath: 'src/example.ts',
            content: 'function foo() {\n  return 1;\n}\n',
            encoding: 'utf8',
            lastModified: new Date('2026-04-01T00:00:00.000Z'),
            size: 28,
          }],
        }}
        newCheckpoint={{
          id: 'new-checkpoint',
          description: 'New',
          created: '2026-04-02T00:00:00.000Z',
          fileSnapshots: [{
            relativePath: 'src/example.ts',
            content: 'function bar() {\n  return 2;\n}\n',
            encoding: 'utf8',
            lastModified: new Date('2026-04-02T00:00:00.000Z'),
            size: 28,
          }],
        }}
      />,
    );

    expect(await screen.findByText('example.ts')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'unified' }));
    expect(screen.getByRole('button', { name: 'split' })).toBeTruthy();
  });
});

describe('CheckpointTimeline', () => {
  it('renders branches and completes compare selection across two checkpoints', () => {
    const onCompare = vi.fn();
    const onBranchSwitch = vi.fn();

    render(
      <CheckpointTimeline
        checkpoints={[
          {
            id: 'cp-1',
            description: 'First checkpoint',
            created: new Date('2026-04-01T00:00:00.000Z'),
            type: 'manual',
          },
          {
            id: 'cp-2',
            description: 'Second checkpoint',
            created: new Date('2026-04-02T00:00:00.000Z'),
            type: 'ai',
          },
        ]}
        branches={[
          {
            id: 'main',
            name: 'main',
            color: '#3b82f6',
            baseCheckpointId: 'cp-1',
            checkpoints: ['cp-1', 'cp-2'],
            isActive: true,
          },
        ]}
        onCheckpointSelect={vi.fn()}
        onCheckpointRestore={vi.fn()}
        onCheckpointDelete={vi.fn()}
        onCompare={onCompare}
        onBranchSwitch={onBranchSwitch}
      />,
    );

    fireEvent.click(screen.getAllByRole('button', { name: 'main' })[1]);
    expect(onBranchSwitch).toHaveBeenCalledWith('main');

    const cards = screen.getAllByTestId('checkpoint-timeline-card');
    const secondCard = screen.getByText('Second checkpoint').closest('[data-testid="checkpoint-timeline-card"]');
    const firstCard = screen.getByText('First checkpoint').closest('[data-testid="checkpoint-timeline-card"]');

    expect(secondCard).toBeTruthy();
    expect(firstCard).toBeTruthy();
    expect(cards).toHaveLength(2);

    fireEvent.click(within(secondCard as HTMLElement).getAllByRole('button')[0]);
    fireEvent.click(within(firstCard as HTMLElement).getAllByRole('button')[0]);

    fireEvent.click(within(secondCard as HTMLElement).getByRole('button', { name: 'compare' }));
    expect(document.body.textContent).toContain('selectCheckpointToCompare');
    fireEvent.click(within(firstCard as HTMLElement).getByRole('button', { name: 'compare' }));

    expect(onCompare).toHaveBeenCalledWith('cp-2', 'cp-1');
  });

  it('wraps long titles and meta instead of overflowing the card', () => {
    render(
      <CheckpointTimeline
        checkpoints={[
          {
            id: 'cp_07231abcdef',
            description: 'Auto: 6 files changed (README.md, Cargo.lock +4 more) at 05:49',
            created: new Date('2026-08-21T05:49:00.000Z'),
            type: 'auto',
            isIncremental: true,
            deltaDepth: 0,
            fileChanges: { added: 0, modified: 0, deleted: 5 },
            tags: ['session'],
          },
        ]}
        onCheckpointSelect={vi.fn()}
        onCheckpointRestore={vi.fn()}
        onCheckpointDelete={vi.fn()}
      />,
    );

    const item = screen.getByTestId('checkpoint-timeline-item');
    const card = screen.getByTestId('checkpoint-timeline-card');
    const title = screen.getByText(/Auto: 6 files changed/);

    expect(item.className).toContain('min-w-0');
    expect(card.className).toContain('min-w-0');
    expect(card.className).toContain('overflow-hidden');
    expect(title.className).toContain('line-clamp-2');
    expect(title.className).toContain('break-words');
    expect(screen.getByText('cp_07231').parentElement?.className).toContain('flex-wrap');
  });
});

describe('CheckpointConfig', () => {
  it('loads configuration, tracks edits, and saves changes through the IDE messenger', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({
        status: 'success',
        content: {
          config: {
            maxCheckpoints: 100,
            retentionDays: 14,
          },
        },
      })
      .mockResolvedValueOnce({
        status: 'success',
        content: {},
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
        <CheckpointConfig />
      </IdeMessengerContext.Provider>,
    );

    const maxCheckpointsInput = await screen.findByLabelText('maxCheckpoints');
    fireEvent.change(maxCheckpointsInput, { target: { value: '250' } });

    const saveButton = screen.getByRole('button', { name: 'save' });
    expect((saveButton as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(request).toHaveBeenNthCalledWith(2, 'saveCheckpointConfig', {
        config: expect.objectContaining({
          maxCheckpoints: 250,
          retentionDays: 14,
        }),
      });
    });
  });

  it('uses a stacked settings layout and accepts direct config response content', async () => {
    const request = vi.fn().mockResolvedValueOnce({
      status: 'success',
      content: {
        maxCheckpoints: 321,
        retentionDays: 21,
        enableAutoCheckpoints: false,
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
        <CheckpointConfig />
      </IdeMessengerContext.Provider>,
    );

    const sections = await screen.findByTestId('checkpoint-config-sections');
    expect(sections.className).toContain('space-y-2');
    expect(sections.className).not.toContain('grid-cols-2');
    expect((screen.getByLabelText('maxCheckpoints') as HTMLInputElement).value).toBe('321');
    expect((screen.getByLabelText('retentionPeriodDays') as HTMLInputElement).value).toBe('21');
    expect(screen.getByLabelText('enableTimedAutoCheckpoints')).toBeTruthy();
    expect(screen.getByLabelText('autoMinIntervalSeconds')).toBeTruthy();
  });

  it('blocks saving invalid storage input', async () => {
    const request = vi.fn().mockResolvedValueOnce({
      status: 'success',
      content: { config: {} },
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
        <CheckpointConfig />
      </IdeMessengerContext.Provider>,
    );

    const storageInput = await screen.findByLabelText('maxStorageSize');
    fireEvent.change(storageInput, { target: { value: 'not a size' } });

    expect(screen.getByText('checkpointInvalidStorageSize')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'save' }) as HTMLButtonElement).disabled).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe('CheckpointTableRow tags', () => {
  it('renders stored tags in the checkpoint list', () => {
    const messenger = {
      request: vi.fn(),
      post: vi.fn(),
      respond: vi.fn(),
      streamRequest: vi.fn(),
      llmStreamChat: vi.fn(),
      ide: {} as any,
    } as any;

    render(
      <IdeMessengerContext.Provider value={messenger}>
        <CheckpointTableRow
          checkpointMetadata={{
            id: 'cp_tagged_1',
            description: 'Tagged checkpoint',
            dateCreated: '2026-08-17T00:00:00.000Z',
            tags: ['manual', 'filtered'],
          }}
          date={new Date('2026-08-17T00:00:00.000Z')}
          isSelectionMode={false}
          isSelected={false}
          onSelect={vi.fn()}
        />
      </IdeMessengerContext.Provider>,
    );

    expect(screen.getByText('manual')).toBeTruthy();
    expect(screen.getByText('filtered')).toBeTruthy();
  });

  it('renders a delete action when onDelete is provided', () => {
    const onDelete = vi.fn();
    const messenger = {
      request: vi.fn(),
      post: vi.fn(),
      respond: vi.fn(),
      streamRequest: vi.fn(),
      llmStreamChat: vi.fn(),
      ide: {} as any,
    } as any;

    render(
      <IdeMessengerContext.Provider value={messenger}>
        <CheckpointTableRow
          checkpointMetadata={{
            id: 'cp_1786956984634_090rjh79j',
            description: 'Auto: 8 files changed',
            dateCreated: '2026-08-17T08:56:24.634Z',
          }}
          date={new Date('2026-08-17T08:56:24.634Z')}
          isSelectionMode={false}
          isSelected={false}
          onSelect={vi.fn()}
          onDelete={onDelete}
        />
      </IdeMessengerContext.Provider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'deleteAction' }));
    expect(onDelete).toHaveBeenCalledWith('cp_1786956984634_090rjh79j');
  });

  it('colors action labels and added/modified/deleted stats', () => {
    const messenger = {
      request: vi.fn(),
      post: vi.fn(),
      respond: vi.fn(),
      streamRequest: vi.fn(),
      llmStreamChat: vi.fn(),
      ide: {} as any,
    } as any;

    render(
      <IdeMessengerContext.Provider value={messenger}>
        <CheckpointTableRow
          checkpointMetadata={{
            id: 'cp_stats_1',
            description: 'Colored stats checkpoint',
            dateCreated: '2026-08-17T00:00:00.000Z',
            fileStats: { total: 3, created: 1, modified: 1, deleted: 1 },
          }}
          date={new Date('2026-08-17T00:00:00.000Z')}
          isSelectionMode={false}
          isSelected={false}
          onSelect={vi.fn()}
          onDelete={vi.fn()}
        />
      </IdeMessengerContext.Provider>,
    );

    expect(screen.getByText('+1').className).toContain('odp-text-green');
    expect(screen.getByText('~1').className).toContain('odp-text-yellow');
    expect(screen.getByText('−1').className).toContain('odp-text-red');
    expect(screen.getByRole('button', { name: 'pinCheckpoint' }).className).toContain('odp-text-yellow');
    expect(screen.getByRole('button', { name: 'details' }).className).toContain('odp-text-blue');
    expect(screen.getByRole('button', { name: 'restore' }).className).toContain('odp-text-cyan');
    expect(screen.getByRole('button', { name: 'restoreWithMemory' }).className).toContain('odp-text-purple');
    expect(screen.getByRole('button', { name: 'deleteAction' }).className).toContain('odp-text-red');
  });
});

describe('Restore preview', () => {
  beforeEach(() => {
    (HTMLElement.prototype as any).hasPointerCapture ??= () => false;
    (HTMLElement.prototype as any).setPointerCapture ??= () => undefined;
    (HTMLElement.prototype as any).releasePointerCapture ??= () => undefined;
    (HTMLElement.prototype as any).scrollIntoView ??= () => undefined;
  });
  const preview = {
    checkpointId: 'cp_preview_1',
    description: 'Before refactor',
    modified: 1,
    added: 1,
    deleted: 1,
    files: [
      { relativePath: 'src/a.ts', action: 'overwrite' as const, additions: 2, deletions: 1, hunkCount: 1 },
      { relativePath: 'src/b.ts', action: 'create' as const, additions: 4, deletions: 0, hunkCount: 1 },
      { relativePath: 'src/c.ts', action: 'delete' as const, additions: 0, deletions: 3, hunkCount: 1 },
    ],
    writePaths: ['src/a.ts', 'src/b.ts'],
    extraPaths: ['src/c.ts'],
    skippedFiles: [],
  };

  it('shows restore preview then restores all after confirm', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({
        status: 'success',
        content: { success: true, preview },
      })
      .mockResolvedValueOnce({
        status: 'success',
        content: { success: true },
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
        <CheckpointTableRow
          checkpointMetadata={{
            id: 'cp_preview_1',
            description: 'Before refactor',
            dateCreated: '2026-08-17T00:00:00.000Z',
          }}
          date={new Date('2026-08-17T00:00:00.000Z')}
          isSelectionMode={false}
          isSelected={false}
          onSelect={vi.fn()}
        />
      </IdeMessengerContext.Provider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'restore' }));

    expect(await screen.findByTestId('restore-preview-dialog')).toBeTruthy();
    await waitFor(() => {
      expect(request).toHaveBeenCalledWith('previewRestore', { checkpointId: 'cp_preview_1' });
    });
    expect(await screen.findByText('src/a.ts')).toBeTruthy();
    expect(screen.getByText('src/b.ts')).toBeTruthy();
    expect(screen.getByText('src/c.ts')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'restoreAll' }));

    await waitFor(() => {
      expect(request).toHaveBeenCalledWith('restoreCheckpoint', {
        checkpointId: 'cp_preview_1',
        rewindMemory: false,
      });
    });
  });

  it('restores only selected files from the preview', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({
        status: 'success',
        content: { success: true, preview },
      })
      .mockResolvedValueOnce({
        status: 'success',
        content: { success: true, restoredFiles: ['src/a.ts'], failedFiles: [] },
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
        <CheckpointTableRow
          checkpointMetadata={{
            id: 'cp_preview_1',
            description: 'Before refactor',
            dateCreated: '2026-08-17T00:00:00.000Z',
          }}
          date={new Date('2026-08-17T00:00:00.000Z')}
          isSelectionMode={false}
          isSelected={false}
          onSelect={vi.fn()}
        />
      </IdeMessengerContext.Provider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'restore' }));
    expect(await screen.findByLabelText('src/b.ts')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('src/b.ts'));

    fireEvent.click(screen.getByRole('button', { name: /restoreSelectedCount/ }));

    await waitFor(() => {
      expect(request).toHaveBeenCalledWith('restoreCheckpointFiles', {
        checkpointId: 'cp_preview_1',
        relativePaths: ['src/a.ts'],
      });
    });
  });
});
