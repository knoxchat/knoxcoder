import { describe, expect, it } from 'vitest';

import en from '../../locales/en/common.json';
import zh from '../../locales/zh/common.json';

function flattenKeys(value: unknown, prefix = ''): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return prefix ? [prefix] : [];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => {
    const next = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      return flattenKeys(child, next);
    }
    return [next];
  });
}

describe('checkpoint i18n (CP-33)', () => {
  it('ships en and zh keys for checkpoint screens and encryption', () => {
    const enKeys = new Set(flattenKeys(en));
    const zhKeys = new Set(flattenKeys(zh));
    const required = [
      'checkpointTimeline.tab',
      'checkpointAnalysis.tab',
      'checkpointDashboard.tab',
      'checkpointShare.tab',
      'encryptAtRest',
      'checkpointEncryptAtRestHelp',
      'checkpointDashboard.restorations',
      'checkpointShare.shareHint',
      'deleteCheckpointTooltip',
    ];
    for (const key of required) {
      expect(enKeys.has(key), `en missing ${key}`).toBe(true);
      expect(zhKeys.has(key), `zh missing ${key}`).toBe(true);
    }
  });
});
