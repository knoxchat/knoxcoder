/**
 * Phase 7 Coverage Gap Tests — GUI Components
 *
 * Fills gaps:
 *   7.3.1  CheckpointDiffViewer: sync scrolling setup
 *   7.3.3  CheckpointConfig: edge-value validation behavior
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CheckpointConfig } from './CheckpointConfig';
import { PierreDiffViewer } from './PierreDiffViewer';
import { IdeMessengerContext } from '../../context/IdeMessenger';
import { VscThemeContext } from '../../context/VscTheme';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts && 'count' in opts) return `${key}(${opts.count})`;
      if (opts && 'days' in opts) return `${key}(${opts.days})`;
      return key;
    },
  }),
}));

vi.mock('../../util/indexedDB', () => ({
  indexedDBManager: {
    getItem: vi.fn().mockResolvedValue(undefined),
    setItem: vi.fn().mockResolvedValue(undefined),
  },
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

// ─── 7.3.1 PierreDiffViewer: View modes ─────────────────────────────

describe('7.3.1 PierreDiffViewer view modes', () => {
  it('renders split view with Pierre diff container', () => {
    render(
      <VscThemeContext.Provider value={themeValue}>
        <PierreDiffViewer
          oldCheckpoint={{
            id: 'old',
            description: 'Old',
            created: '2026-04-01T00:00:00.000Z',
            fileSnapshots: [{
              relativePath: 'src/app.ts',
              content: Array.from({ length: 50 }, (_, i) => `// line ${i}`).join('\n'),
              encoding: 'utf8',
              lastModified: new Date('2026-04-01'),
              size: 500,
            }],
          }}
          newCheckpoint={{
            id: 'new',
            description: 'New',
            created: '2026-04-02T00:00:00.000Z',
            fileSnapshots: [{
              relativePath: 'src/app.ts',
              content: Array.from({ length: 50 }, (_, i) => `// modified line ${i}`).join('\n'),
              encoding: 'utf8',
              lastModified: new Date('2026-04-02'),
              size: 700,
            }],
          }}
        />
      </VscThemeContext.Provider>,
    );

    expect(document.querySelector('.pierre-diff-container')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'unified' })).toBeTruthy();
  });

  it('defaults to split view and can switch to unified', () => {
    render(
      <VscThemeContext.Provider value={themeValue}>
        <PierreDiffViewer
          oldCheckpoint={{
            id: 'old',
            description: 'Old',
            created: '2026-04-01T00:00:00.000Z',
            fileSnapshots: [{
              relativePath: 'src/x.ts',
              content: 'const x = 1;',
              encoding: 'utf8',
              lastModified: new Date('2026-04-01'),
              size: 12,
            }],
          }}
          newCheckpoint={{
            id: 'new',
            description: 'New',
            created: '2026-04-02T00:00:00.000Z',
            fileSnapshots: [{
              relativePath: 'src/x.ts',
              content: 'const x = 2;',
              encoding: 'utf8',
              lastModified: new Date('2026-04-02'),
              size: 12,
            }],
          }}
        />
      </VscThemeContext.Provider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'unified' }));
    expect(screen.getByRole('button', { name: 'split' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'split' }));
    expect(screen.getByRole('button', { name: 'unified' })).toBeTruthy();
  });
});

// ─── 7.3.3 CheckpointConfig: Validation Behavior ────────────────────

describe('7.3.3 CheckpointConfig validation', () => {
  const mockMessenger = {
    post: vi.fn().mockResolvedValue(undefined),
    request: vi.fn().mockResolvedValue({
      status: 'success',
      content: {
        maxCheckpoints: 1000,
        retentionDays: 7,
        maxStorageBytes: 1000000000,
        maxFilesPerCheckpoint: 100,
        enableCompression: true,
        autoCleanup: true,
        cleanupIntervalHours: 24,
        trackedExtensions: ['ts', 'js', 'py'],
      },
    }),
    ide: {},
    llmByTitle: vi.fn(),
    streamRequest: vi.fn(),
    respond: vi.fn(),
  };

  it('non-numeric input falls back to 1 for number fields', async () => {
    render(
      <IdeMessengerContext.Provider value={mockMessenger as any}>
        <CheckpointConfig />
      </IdeMessengerContext.Provider>,
    );

    // Wait for config to load
    const input = await screen.findByLabelText('maxCheckpoints');
    expect(input).toBeTruthy();

    // Enter non-numeric value — parseInt("abc") || 1 should produce 1
    fireEvent.change(input, { target: { value: 'abc' } });
    expect((input as HTMLInputElement).value).toBe('1');
  });

  it('number fields have min/max HTML attributes', async () => {
    render(
      <IdeMessengerContext.Provider value={mockMessenger as any}>
        <CheckpointConfig />
      </IdeMessengerContext.Provider>,
    );

    const maxCheckpointsInput = await screen.findByLabelText('maxCheckpoints');
    expect(maxCheckpointsInput.getAttribute('min')).toBe('1');
    expect(maxCheckpointsInput.getAttribute('max')).toBe('10000');
    expect(maxCheckpointsInput.getAttribute('type')).toBe('number');

    const retentionInput = screen.getByLabelText('retentionPeriodDays');
    expect(retentionInput.getAttribute('min')).toBe('1');
    expect(retentionInput.getAttribute('max')).toBe('365');
  });

  it('changing a value enables the save button', async () => {
    render(
      <IdeMessengerContext.Provider value={mockMessenger as any}>
        <CheckpointConfig />
      </IdeMessengerContext.Provider>,
    );

    const input = await screen.findByLabelText('maxCheckpoints');
    fireEvent.change(input, { target: { value: '500' } });

    // Save button should be enabled now (not have disabled attribute)
    const saveBtn = screen.getByRole('button', { name: /save/i });
    expect(saveBtn.hasAttribute('disabled')).toBe(false);
  });

  it('tracked extensions field accepts comma-separated values', async () => {
    render(
      <IdeMessengerContext.Provider value={mockMessenger as any}>
        <CheckpointConfig />
      </IdeMessengerContext.Provider>,
    );

    // The tracked extensions field should render with current extensions
    const extInput = await screen.findByLabelText('trackedFileExtensions');
    expect(extInput).toBeTruthy();

    // Change extensions
    fireEvent.change(extInput, { target: { value: 'ts, js, rs, go' } });
    expect((extInput as HTMLInputElement).value).toContain('ts');
  });
});
