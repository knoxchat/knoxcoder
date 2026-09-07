/**
 * Phase 5: GUI Visualization — Unit Tests
 *
 * Dashboard formatters remain shipped. D3 viewers and kanban grouping were
 * retired in CP-25.
 */

import { describe, expect, it } from 'vitest';

import { formatBytes, formatDuration, formatDate, fillDailyCounts, compactAxisNumber, formatChartTick } from './PerformanceDashboard';

describe('PerformanceDashboard — formatBytes', () => {
  it('returns "0 B" for zero bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
  });

  it('formats bytes correctly', () => {
    expect(formatBytes(512)).toBe('512 B');
  });

  it('formats kilobytes', () => {
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
  });

  it('formats megabytes', () => {
    expect(formatBytes(1048576)).toBe('1 MB');
    expect(formatBytes(2621440)).toBe('2.5 MB');
  });

  it('formats gigabytes', () => {
    expect(formatBytes(1073741824)).toBe('1 GB');
  });
});

describe('PerformanceDashboard — formatDuration', () => {
  it('formats sub-second durations in ms', () => {
    expect(formatDuration(150)).toBe('150ms');
    expect(formatDuration(0)).toBe('0ms');
    expect(formatDuration(999)).toBe('999ms');
  });

  it('formats durations >= 1s in seconds', () => {
    expect(formatDuration(1000)).toBe('1.0s');
    expect(formatDuration(1500)).toBe('1.5s');
    expect(formatDuration(60000)).toBe('60.0s');
  });
});

describe('PerformanceDashboard — formatDate', () => {
  it('formats ISO strings to short dates', () => {
    const result = formatDate('2026-04-20T12:00:00.000Z');
    expect(result).toMatch(/Apr/);
    expect(result).toMatch(/20/);
  });

  it('handles different months', () => {
    const result = formatDate('2026-01-15T00:00:00.000Z');
    expect(result).toMatch(/Jan/);
    expect(result).toMatch(/15/);
  });
});

describe('PerformanceDashboard — chart series', () => {
  it('pads a single day out to 14 daily bars', () => {
    const rows = fillDailyCounts([{ bucket: '2026-08-17T00:00:00.000Z', count: 1 }]);
    expect(rows).toHaveLength(14);
    expect(rows[rows.length - 1]).toMatchObject({ iso: '2026-08-17', count: 1 });
    expect(rows.slice(0, 13).every((row) => row.count === 0)).toBe(true);
    expect(formatChartTick('2026-08-17')).toBe('8/17');
  });

  it('formats compact axis ticks like the usage chart', () => {
    expect(compactAxisNumber(0)).toBe('0');
    expect(compactAxisNumber(7)).toBe('7');
    expect(compactAxisNumber(30_000_000)).toBe('30M');
  });
});
