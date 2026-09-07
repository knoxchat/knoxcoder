/**
 * Phase 3: Diff System Improvements — Utility Function Tests
 *
 * Tests all pure utility functions from checkpointDiffUtils:
 *   3.1  getLanguageFromPath — file extension → language mapping
 *   3.2  buildLogicalHunks — grouping consecutive changed lines
 *   3.3  detectSemanticAnnotations — rename/refactor detection
 *   3.4  computeAlignedLines — split-view alignment with word-level diffs
 *   3.5  renderJsonDiff / diffObjects — structural JSON diffing
 *   3.6  renderCssDiff — structural CSS diffing
 */

import { describe, expect, it } from 'vitest';
import * as Diff from 'diff';

import {
  getLanguageFromPath,
  buildLogicalHunks,
  detectSemanticAnnotations,
  computeAlignedLines,
  renderJsonDiff,
  diffObjects,
  renderCssDiff,
  type DiffLine,
  type LogicalHunk,
} from './checkpointDiffUtils';

// ─── 3.1  getLanguageFromPath ───────────────────────────────────────────────

describe('3.1 getLanguageFromPath', () => {
  it('maps common extensions to languages', () => {
    expect(getLanguageFromPath('app.ts')).toBe('typescript');
    expect(getLanguageFromPath('app.tsx')).toBe('typescript');
    expect(getLanguageFromPath('app.js')).toBe('javascript');
    expect(getLanguageFromPath('app.jsx')).toBe('javascript');
    expect(getLanguageFromPath('main.py')).toBe('python');
    expect(getLanguageFromPath('Main.java')).toBe('java');
    expect(getLanguageFromPath('lib.rs')).toBe('rust');
    expect(getLanguageFromPath('main.go')).toBe('go');
    expect(getLanguageFromPath('app.rb')).toBe('ruby');
    expect(getLanguageFromPath('index.html')).toBe('html');
    expect(getLanguageFromPath('style.css')).toBe('css');
    expect(getLanguageFromPath('style.scss')).toBe('scss');
    expect(getLanguageFromPath('data.json')).toBe('json');
    expect(getLanguageFromPath('config.yaml')).toBe('yaml');
    expect(getLanguageFromPath('config.yml')).toBe('yaml');
    expect(getLanguageFromPath('README.md')).toBe('markdown');
    expect(getLanguageFromPath('query.sql')).toBe('sql');
    expect(getLanguageFromPath('script.sh')).toBe('bash');
    expect(getLanguageFromPath('page.php')).toBe('php');
  });

  it('handles nested paths', () => {
    expect(getLanguageFromPath('src/components/App.tsx')).toBe('typescript');
    expect(getLanguageFromPath('deep/nested/path/file.py')).toBe('python');
  });

  it('returns plaintext for unknown extensions', () => {
    expect(getLanguageFromPath('file.xyz')).toBe('plaintext');
    expect(getLanguageFromPath('Makefile')).toBe('plaintext');
    expect(getLanguageFromPath('')).toBe('plaintext');
  });

  it('is case-insensitive on extension', () => {
    expect(getLanguageFromPath('FILE.TS')).toBe('typescript');
  });
});

// ─── 3.2  buildLogicalHunks ─────────────────────────────────────────────────

describe('3.2 buildLogicalHunks', () => {
  function ctx(content: string, line: number): DiffLine {
    return { type: 'context', oldLineNum: line, newLineNum: line, content };
  }
  function added(content: string, line: number): DiffLine {
    return { type: 'added', oldLineNum: null, newLineNum: line, content };
  }
  function removed(content: string, line: number): DiffLine {
    return { type: 'removed', oldLineNum: line, newLineNum: null, content };
  }

  it('returns empty for all-context lines', () => {
    const aligned = [
      { left: ctx('a', 1), right: ctx('a', 1) },
      { left: ctx('b', 2), right: ctx('b', 2) },
    ];
    expect(buildLogicalHunks(aligned)).toHaveLength(0);
  });

  it('creates a single addition hunk', () => {
    const aligned = [
      { left: ctx('a', 1), right: ctx('a', 1) },
      { left: null, right: added('new line', 2) },
      { left: ctx('b', 2), right: ctx('b', 3) },
    ];
    const hunks = buildLogicalHunks(aligned);
    expect(hunks).toHaveLength(1);
    expect(hunks[0].type).toBe('addition');
    expect(hunks[0].additions).toBe(1);
    expect(hunks[0].deletions).toBe(0);
  });

  it('creates a single deletion hunk', () => {
    const aligned = [
      { left: ctx('a', 1), right: ctx('a', 1) },
      { left: removed('old line', 2), right: null },
      { left: ctx('c', 3), right: ctx('c', 2) },
    ];
    const hunks = buildLogicalHunks(aligned);
    expect(hunks).toHaveLength(1);
    expect(hunks[0].type).toBe('deletion');
    expect(hunks[0].deletions).toBe(1);
    expect(hunks[0].additions).toBe(0);
  });

  it('creates a modification hunk (removed + added)', () => {
    const aligned = [
      { left: removed('old', 1), right: added('new', 1) },
    ];
    const hunks = buildLogicalHunks(aligned);
    expect(hunks).toHaveLength(1);
    expect(hunks[0].type).toBe('modification');
    expect(hunks[0].additions).toBe(1);
    expect(hunks[0].deletions).toBe(1);
  });

  it('separates non-adjacent changes into multiple hunks', () => {
    const aligned = [
      { left: removed('a', 1), right: null },
      { left: ctx('middle', 2), right: ctx('middle', 1) },
      { left: null, right: added('b', 2) },
    ];
    const hunks = buildLogicalHunks(aligned);
    expect(hunks).toHaveLength(2);
    expect(hunks[0].type).toBe('deletion');
    expect(hunks[1].type).toBe('addition');
  });

  it('groups consecutive changes into one hunk', () => {
    const aligned = [
      { left: removed('line1', 1), right: added('new1', 1) },
      { left: removed('line2', 2), right: added('new2', 2) },
      { left: removed('line3', 3), right: added('new3', 3) },
    ];
    const hunks = buildLogicalHunks(aligned);
    expect(hunks).toHaveLength(1);
    expect(hunks[0].additions).toBe(3);
    expect(hunks[0].deletions).toBe(3);
  });

  it('handles empty input', () => {
    expect(buildLogicalHunks([])).toHaveLength(0);
  });

  it('handles changes at end without trailing context', () => {
    const aligned = [
      { left: ctx('a', 1), right: ctx('a', 1) },
      { left: null, right: added('new', 2) },
    ];
    const hunks = buildLogicalHunks(aligned);
    expect(hunks).toHaveLength(1);
    expect(hunks[0].endIndex).toBe(1);
  });
});

// ─── 3.3  detectSemanticAnnotations ─────────────────────────────────────────

describe('3.3 detectSemanticAnnotations', () => {
  function removed(content: string): DiffLine {
    return { type: 'removed', oldLineNum: 1, newLineNum: null, content };
  }
  function added(content: string): DiffLine {
    return { type: 'added', oldLineNum: null, newLineNum: 1, content };
  }

  it('detects function rename', () => {
    const alignedLines = [
      { left: removed('function foo() {'), right: added('function bar() {') },
    ];
    const hunks: LogicalHunk[] = [{
      label: 'Change 1: +1/-1', startIndex: 0, endIndex: 0,
      type: 'modification', additions: 1, deletions: 1,
    }];
    const annotations = detectSemanticAnnotations(hunks, alignedLines);
    expect(annotations).toHaveLength(1);
    expect(annotations[0].type).toBe('rename');
    expect(annotations[0].label).toContain('foo');
    expect(annotations[0].label).toContain('bar');
  });

  it('detects class rename', () => {
    const alignedLines = [
      { left: removed('class OldService {'), right: added('class NewService {') },
    ];
    const hunks: LogicalHunk[] = [{
      label: 'Change 1', startIndex: 0, endIndex: 0,
      type: 'modification', additions: 1, deletions: 1,
    }];
    const annotations = detectSemanticAnnotations(hunks, alignedLines);
    expect(annotations).toHaveLength(1);
    expect(annotations[0].type).toBe('rename');
    expect(annotations[0].label).toContain('OldService');
    expect(annotations[0].label).toContain('NewService');
  });

  it('detects Rust fn rename', () => {
    const alignedLines = [
      { left: removed('pub fn process_data() {'), right: added('pub fn transform_data() {') },
    ];
    const hunks: LogicalHunk[] = [{
      label: 'Change 1', startIndex: 0, endIndex: 0,
      type: 'modification', additions: 1, deletions: 1,
    }];
    const annotations = detectSemanticAnnotations(hunks, alignedLines);
    expect(annotations).toHaveLength(1);
    expect(annotations[0].label).toContain('process_data');
    expect(annotations[0].label).toContain('transform_data');
  });

  it('does not flag same-name changes as rename', () => {
    const alignedLines = [
      { left: removed('function foo(a) {'), right: added('function foo(a, b) {') },
    ];
    const hunks: LogicalHunk[] = [{
      label: 'Change 1', startIndex: 0, endIndex: 0,
      type: 'modification', additions: 1, deletions: 1,
    }];
    const annotations = detectSemanticAnnotations(hunks, alignedLines);
    expect(annotations).toHaveLength(0);
  });

  it('returns empty for no hunks', () => {
    expect(detectSemanticAnnotations([], [])).toHaveLength(0);
  });

  it('handles hunks with no function/class definitions', () => {
    const alignedLines = [
      { left: removed('  const x = 1;'), right: added('  const x = 2;') },
    ];
    const hunks: LogicalHunk[] = [{
      label: 'Change 1', startIndex: 0, endIndex: 0,
      type: 'modification', additions: 1, deletions: 1,
    }];
    const annotations = detectSemanticAnnotations(hunks, alignedLines);
    expect(annotations).toHaveLength(0);
  });
});

// ─── 3.4  computeAlignedLines ───────────────────────────────────────────────

describe('3.4 computeAlignedLines', () => {
  it('aligns identical content as context', () => {
    const changes = Diff.diffLines('hello\nworld\n', 'hello\nworld\n');
    const aligned = computeAlignedLines(changes);
    expect(aligned.length).toBeGreaterThan(0);
    for (const { left, right } of aligned) {
      expect(left?.type).toBe('context');
      expect(right?.type).toBe('context');
    }
  });

  it('aligns pure additions', () => {
    const changes = Diff.diffLines('a\n', 'a\nb\n');
    const aligned = computeAlignedLines(changes);
    const addedLines = aligned.filter(({ right }) => right?.type === 'added');
    expect(addedLines.length).toBeGreaterThanOrEqual(1);
  });

  it('aligns pure removals', () => {
    const changes = Diff.diffLines('a\nb\n', 'a\n');
    const aligned = computeAlignedLines(changes);
    const removedLines = aligned.filter(({ left }) => left?.type === 'removed');
    expect(removedLines.length).toBeGreaterThanOrEqual(1);
  });

  it('pairs removed+added as modifications with word changes', () => {
    const changes = Diff.diffLines('const x = 1;\n', 'const x = 2;\n');
    const aligned = computeAlignedLines(changes);
    // Should have a removed line on left and added line on right
    const mods = aligned.filter(
      ({ left, right }) => left?.type === 'removed' && right?.type === 'added',
    );
    expect(mods.length).toBeGreaterThanOrEqual(1);
    // Word changes should be computed
    const mod = mods[0];
    expect(mod.left?.wordChanges).toBeDefined();
    expect(mod.right?.wordChanges).toBeDefined();
  });

  it('handles empty input', () => {
    const aligned = computeAlignedLines([]);
    expect(aligned).toHaveLength(0);
  });

  it('handles multi-line modifications', () => {
    const changes = Diff.diffLines('line1\nline2\nline3\n', 'line1\nchanged2\nchanged3\n');
    const aligned = computeAlignedLines(changes);
    expect(aligned.length).toBeGreaterThanOrEqual(3);
    // First line should be context
    expect(aligned[0].left?.type).toBe('context');
  });

  it('tracks line numbers correctly', () => {
    const changes = Diff.diffLines('a\nb\n', 'a\nc\n');
    const aligned = computeAlignedLines(changes);
    // Context line should have oldLineNum = 1
    expect(aligned[0].left?.oldLineNum).toBe(1);
    expect(aligned[0].right?.newLineNum).toBe(1);
  });
});

// ─── 3.5  renderJsonDiff / diffObjects ──────────────────────────────────────

describe('3.5 renderJsonDiff / diffObjects', () => {
  it('detects added keys', () => {
    const result = renderJsonDiff('{"a": 1}', '{"a": 1, "b": 2}');
    const added = result.find(r => r.path === 'b');
    expect(added).toBeDefined();
    expect(added!.type).toBe('added');
    expect(added!.newVal).toBe('2');
  });

  it('detects removed keys', () => {
    const result = renderJsonDiff('{"a": 1, "b": 2}', '{"a": 1}');
    const removed = result.find(r => r.path === 'b');
    expect(removed).toBeDefined();
    expect(removed!.type).toBe('removed');
  });

  it('detects modified values', () => {
    const result = renderJsonDiff('{"a": 1}', '{"a": 2}');
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('modified');
    expect(result[0].oldVal).toBe('1');
    expect(result[0].newVal).toBe('2');
  });

  it('handles nested objects', () => {
    const result = renderJsonDiff(
      '{"config": {"debug": true, "port": 3000}}',
      '{"config": {"debug": false, "port": 3000}}',
    );
    const changed = result.find(r => r.path === 'config.debug');
    expect(changed).toBeDefined();
    expect(changed!.type).toBe('modified');
    expect(changed!.oldVal).toBe('true');
    expect(changed!.newVal).toBe('false');
  });

  it('returns empty for identical JSON', () => {
    const result = renderJsonDiff('{"a": 1}', '{"a": 1}');
    expect(result).toHaveLength(0);
  });

  it('returns empty for invalid JSON', () => {
    const result = renderJsonDiff('not json', 'also not json');
    expect(result).toHaveLength(0);
  });

  it('handles arrays as values', () => {
    const result = renderJsonDiff('{"list": [1, 2]}', '{"list": [1, 2, 3]}');
    const changed = result.find(r => r.path === 'list');
    expect(changed).toBeDefined();
    expect(changed!.type).toBe('modified');
  });

  it('diffObjects works with empty objects', () => {
    expect(diffObjects({}, {}, '')).toHaveLength(0);
  });

  it('diffObjects handles null-ish inputs', () => {
    const result = diffObjects(null, { a: 1 }, '');
    expect(result.find(r => r.path === 'a')).toBeDefined();
  });
});

// ─── 3.6  renderCssDiff ────────────────────────────────────────────────────

describe('3.6 renderCssDiff', () => {
  it('detects added property', () => {
    const result = renderCssDiff(
      '.btn { color: red; }',
      '.btn { color: red; padding: 10px; }',
    );
    const added = result.find(r => r.property === 'padding');
    expect(added).toBeDefined();
    expect(added!.type).toBe('added');
    expect(added!.newVal).toBe('10px');
  });

  it('detects removed property', () => {
    const result = renderCssDiff(
      '.btn { color: red; padding: 10px; }',
      '.btn { color: red; }',
    );
    const removed = result.find(r => r.property === 'padding');
    expect(removed).toBeDefined();
    expect(removed!.type).toBe('removed');
  });

  it('detects modified property value', () => {
    const result = renderCssDiff(
      '.btn { color: red; }',
      '.btn { color: blue; }',
    );
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('modified');
    expect(result[0].oldVal).toBe('red');
    expect(result[0].newVal).toBe('blue');
  });

  it('detects added selector', () => {
    const result = renderCssDiff(
      '.btn { color: red; }',
      '.btn { color: red; } .icon { size: 16px; }',
    );
    const added = result.find(r => r.selector === '.icon');
    expect(added).toBeDefined();
    expect(added!.type).toBe('added');
  });

  it('returns empty for identical CSS', () => {
    const css = 'body { margin: 0; }';
    expect(renderCssDiff(css, css)).toHaveLength(0);
  });

  it('handles empty CSS', () => {
    expect(renderCssDiff('', '')).toHaveLength(0);
  });

  it('handles multiple selectors and properties', () => {
    const old = '.a { color: red; } .b { font-size: 14px; }';
    const newCss = '.a { color: blue; } .b { font-size: 14px; } .c { display: flex; }';
    const result = renderCssDiff(old, newCss);
    expect(result.length).toBeGreaterThanOrEqual(2); // color changed + .c added
  });
});
