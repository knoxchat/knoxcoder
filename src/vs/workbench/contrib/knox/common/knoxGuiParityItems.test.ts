/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { knoxGuiModelSupportsReasoning, knoxGuiResetModelCatalogForTests, knoxGuiShowsThinkingPlaceholder } from './knoxGuiCapabilities.js';
import { CHAT_LOAD_EARLIER_THRESHOLD_PX, knoxGuiNextScrollFollow, knoxGuiShouldLoadEarlier, knoxGuiTranscriptRestoreTop } from './knoxGuiChat.js';
import { alignSplitDiffRows, buildDiffSegments, checkpointGraphFindScroll, checkpointGraphMenuPosition, checkpointGraphRevealScroll, checkpointDiffContentBytes, checkpointDiffSummary, computeLineDiff, checkpointChartTickInterval, checkpointChartYTicks, checkpointConfigFieldErrors, checkpointConfigIsDirty, checkpointConfigNumber, checkpointDetailsDefaultTab, checkpointImageMime, DEFAULT_CHECKPOINT_CONFIG, formatCheckpointDuration, formatDashboardBytes, groupTimelineCheckpoints, checkpointMatchesQuery, checkpointTreeAncestors, clampCheckpointTreeWidth, compareCheckpointTargets, diffFromCheckpointSnapshots, formatSnapshotSize, parseCheckpointDetails } from './knoxGuiCheckpoints.js';
import { MEMORY_SETTING_GROUPS, memoriesToExportJson, memoriesToExportMarkdown, memoryBrowserEmptyKey, memoryConsolidateParts, memoryGraphTypeCounts, parseMemorySettingInput, rangeSelectMemoryIds, visibleMemoryExploreEdges, withMemoryConfigDefaults } from './knoxGuiMemory.js';
import { knoxGuiResolveOpenPath } from './knoxGuiPanels.js';
import { renderToolTemplateHtml } from './knoxGuiTools.js';
import { applySuggestAt, buildTopLevelMentionItems, detectComposerTrigger, fileHitToSuggestItem, IKnoxGuiInputBlock, inputDocToPlainText, isFolderMentionNode, isPathMentionNode, isSlashBookmarked, KNOX_GUI_CHIP_CHAR, KnoxGuiInlineNode, lastRelativePathParts, MENTION_LOADING_ID, MENTION_PANEL_MAX_WIDTH, mentionChipOpenUri, mentionChipTooltip, mentionFloatingPosition, mentionItemMatchesQuery, mergeOpenFileMentions, nextMentionSelectedIndex, openFilesChanged, openFileSuggestItems, paragraphTextBefore, rankMentionItems, removeCodeToEditTrigger, retainMentionItemsWhileLoading, shortestUniqueRelativePaths, splitCamelCaseAndNonAlphaNumeric, submenuHitToSuggestItem, toggleSlashBookmark } from './knoxGuiInput.js';
import { agentProfileDefaults, applyOpenRouterAliasFloorPricing, formatModelPricingPerMillion, formatUsdAmount, fuzzyTitleMatch, historySessionMatchesQuery, knoxChatMetadataContextLength, knoxChatModelPricing, knoxChatPricingHasWebSearch, knoxChatRecommendedMaxTokens, sortPromptsBookmarkedFirst } from './knoxGuiOverlays.js';
import { IKnoxGuiSuggestItem } from './knoxGuiState.js';
import { knoxGuiShortcutKeys } from './knoxGuiChrome.js';
import { composerUndoRecord, composerUndoStep, createComposerUndo, inputDocFromPlainText, knoxGuiCodeBlockOpenAction, knoxGuiCodeBlockTitle, knoxGuiComposerKeyAction, knoxGuiDragHasImages, knoxGuiImageFileAccepted, knoxGuiImageTargetSize, knoxGuiImageUploadToast, knoxGuiNewestCodeBlockIndex, KNOX_COMPOSER_UNDO_GROUP_MS } from './knoxGuiInput.js';
import { healStreamingMarkdown, knoxGuiInitialCodeBlockExpanded, knoxGuiShouldAutoExpandGeneratingCodeBlock, knoxGuiSplitTokenizedLines, knoxGuiTerminalCommand, languageIdFromFence, MAX_EXPANDED_CODE_LINES, shouldShowThinkingIndicator, splitMarkdownBlocks, splitMarkdownParagraphs, stripLeakedToolMarkup, visibleCodeLineRange } from './knoxGuiTranscript.js';

suite('Knox native parity items', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	suite('remaining composer, chat and chrome items', () => {
		test('I-02 / I-04 image type and size checks, 1024px fit, upload toasts, image-only drags', () => {
			assert.strictEqual(knoxGuiImageFileAccepted({ type: 'image/png', size: 1024 }), true);
			assert.strictEqual(knoxGuiImageFileAccepted({ type: 'image/bmp', size: 1024 }), false);
			assert.strictEqual(knoxGuiImageFileAccepted({ type: 'image/jpeg', size: 10 * 1024 * 1024 }), false);
			assert.strictEqual(knoxGuiImageFileAccepted({ type: '', size: 1024, name: 'shot.png' }), true);
			assert.strictEqual(knoxGuiImageFileAccepted({ type: 'image/svg+xml', size: 1024, name: 'icon.svg' }), true);
			assert.deepStrictEqual(knoxGuiImageTargetSize(2048, 1024), { width: 1024, height: 512 });
			assert.deepStrictEqual(knoxGuiImageTargetSize(256, 512), { width: 512, height: 1024 });
			assert.deepStrictEqual(knoxGuiImageUploadToast(2, 3, 1), { level: 'warning', key: 'imageUploadPartialSuccess', params: { success: 2, total: 3, failed: 1 } });
			assert.strictEqual(knoxGuiImageUploadToast(0, 2, 2), undefined);
			assert.strictEqual(knoxGuiImageUploadToast(1, 1, 0), undefined);
			assert.deepStrictEqual(knoxGuiImageUploadToast(3, 3, 0), { level: 'info', key: 'imageUploadSuccess', params: { count: 3 } });
			assert.strictEqual(knoxGuiDragHasImages([{ type: 'text/plain' }, { type: 'image/png' }]), true);
			assert.strictEqual(knoxGuiDragHasImages([{ type: 'text/uri-list' }]), false);
		});

		test('I-03 composer undo groups fast edits, redo walks forward, Mod+Z / Mod+Shift+Z / Mod+Y map to undo and redo', () => {
			let undo = createComposerUndo(inputDocFromPlainText(''));
			undo = composerUndoRecord(undo, inputDocFromPlainText('a'), 1000);
			undo = composerUndoRecord(undo, inputDocFromPlainText('ab'), 1000 + KNOX_COMPOSER_UNDO_GROUP_MS - 1);
			undo = composerUndoRecord(undo, inputDocFromPlainText('abc'), 1000 + KNOX_COMPOSER_UNDO_GROUP_MS * 3);
			assert.strictEqual(undo.stack.length, 3);
			assert.strictEqual(composerUndoRecord(undo, inputDocFromPlainText('abc'), 99999), undo);
			const back = composerUndoStep(undo, -1)!;
			assert.deepStrictEqual(back.doc, inputDocFromPlainText('ab'));
			assert.deepStrictEqual(composerUndoStep(back.undo, 1)!.doc, inputDocFromPlainText('abc'));
			assert.strictEqual(composerUndoStep(undo, 1), undefined);
			const branched = composerUndoRecord(back.undo, inputDocFromPlainText('x'), 50000);
			assert.strictEqual(composerUndoStep(branched, 1), undefined);
			const ctx = { suggestOpen: false, inSubmenu: false, isStreaming: false, caretAtStart: false, caretAtEnd: false, suggestSelected: 0, suggestCount: 0 };
			const key = (k: string, mods: Partial<{ shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; altKey: boolean }>) => knoxGuiComposerKeyAction({ key: k, shiftKey: false, altKey: false, metaKey: false, ctrlKey: false, ...mods }, ctx).type;
			assert.strictEqual(key('z', { metaKey: true }), 'undo');
			assert.strictEqual(key('Z', { metaKey: true, shiftKey: true }), 'redo');
			assert.strictEqual(key('y', { ctrlKey: true }), 'redo');
			assert.notStrictEqual(key('z', {}), 'undo');
		});

		test('I-05 code block title, open action and newest-expanded index', () => {
			assert.strictEqual(knoxGuiCodeBlockTitle({ type: 'codeBlock', code: 'x', filepath: '/w/src/a.ts', range: { start: 0, end: 4 } }), 'a.ts (1-5)');
			assert.strictEqual(knoxGuiCodeBlockTitle({ type: 'codeBlock', code: 'x' }), 'code');
			assert.deepStrictEqual(knoxGuiCodeBlockOpenAction({ type: 'codeBlock', code: 'x', filepath: '/w/a.ts', range: { start: 2, end: 3 } }), { type: 'showLines', filepath: '/w/a.ts', startLine: 2, endLine: 3 });
			assert.strictEqual(knoxGuiCodeBlockOpenAction({ type: 'codeBlock', code: 'x', filepath: 'file:///w/a.ts' }).type, 'showFile');
			assert.strictEqual(knoxGuiCodeBlockOpenAction({ type: 'codeBlock', code: 'x', itemName: 'snippet' }).type, 'showVirtualFile');
			const doc: IKnoxGuiInputBlock[] = [{ type: 'codeBlock', code: 'a' }, { type: 'paragraph', content: [] }, { type: 'codeBlock', code: 'b' }, { type: 'paragraph', content: [] }];
			assert.strictEqual(knoxGuiNewestCodeBlockIndex(doc), 2);
			assert.strictEqual(knoxGuiNewestCodeBlockIndex(inputDocFromPlainText('hi')), -1);
		});

		test('I-09 shortcut labels follow the platform', () => {
			assert.deepStrictEqual(knoxGuiShortcutKeys('meta L', true), [['⌘', 'L']]);
			assert.deepStrictEqual(knoxGuiShortcutKeys('meta L', false), [['Ctrl', 'L']]);
			assert.deepStrictEqual(knoxGuiShortcutKeys('shift + cmd/ctrl + p', false), [['Shift', 'Ctrl', 'P']]);
			assert.deepStrictEqual(knoxGuiShortcutKeys('alt enter, backspace', true), [['⌥', 'Enter ⏎'], ['Delete ⌫']]);
			assert.deepStrictEqual(knoxGuiShortcutKeys('alt backspace', false), [['Alt', 'Backspace ⌫']]);
		});

		test('C-13 stable markdown blocks and remend-style healing of the live block', () => {
			assert.deepStrictEqual(splitMarkdownParagraphs('# Title\n\npara one\nstill one\n\n- a\n\n- b\n  more\n\n    indented\n\ntail'), [
				'# Title',
				'para one\nstill one',
				'- a\n\n- b\n  more\n\n    indented',
				'tail',
			]);
			assert.deepStrictEqual(splitMarkdownParagraphs('\n\n'), []);
			assert.deepStrictEqual(splitMarkdownParagraphs('Hello\n## Title'), ['Hello', '## Title']);
			assert.strictEqual(healStreamingMarkdown('some **bold'), 'some **bold**');
			assert.strictEqual(healStreamingMarkdown('some **bold '), 'some **bold**');
			assert.strictEqual(healStreamingMarkdown('call `foo'), 'call `foo`');
			assert.strictEqual(healStreamingMarkdown('call `'), 'call ');
			assert.strictEqual(healStreamingMarkdown('an *em and ~~gone'), 'an *em and ~~gone~~*');
			assert.strictEqual(healStreamingMarkdown('dangling **'), 'dangling ');
			assert.strictEqual(healStreamingMarkdown('see [docs](https://exa'), 'see docs');
			assert.strictEqual(healStreamingMarkdown('* item one\n* item **two'), '* item one\n* item **two**');
			assert.strictEqual(healStreamingMarkdown('done **ok** and `x`'), 'done **ok** and `x`');
			assert.strictEqual(healStreamingMarkdown('an _em'), 'an _em_');
			assert.strictEqual(healStreamingMarkdown('snake_case stays'), 'snake_case stays');
			assert.strictEqual(stripLeakedToolMarkup('intro\n< | DSML |  calls>\nfoo').trim(), 'intro');
			assert.strictEqual(stripLeakedToolMarkup('intro\n< | | DSML | |  calls>\nsecret').trim(), 'intro');
			assert.ok(!stripLeakedToolMarkup('hi <tool_calls>x').includes('tool_calls'));
			assert.strictEqual(languageIdFromFence('ts'), 'typescript');
			assert.strictEqual(languageIdFromFence('', 'app.rs'), 'rust');
			assert.strictEqual(languageIdFromFence('rb'), 'ruby');
			assert.strictEqual(languageIdFromFence('patch'), 'diff');
			assert.strictEqual(languageIdFromFence('golang'), 'go');
			assert.strictEqual(languageIdFromFence('mjs'), 'javascript');
			assert.ok(!stripLeakedToolMarkup('hi <function=run>x').includes('function=run'));
			const tilde = splitMarkdownBlocks('intro\n~~~ts\nconst x = 1;');
			assert.strictEqual(tilde[0].type, 'markdown');
			assert.strictEqual(tilde[1]?.type, 'fence');
			assert.strictEqual(tilde[1].type === 'fence' && tilde[1].closed, false);
			assert.strictEqual(tilde[1].type === 'fence' && tilde[1].code.includes('const x = 1;'), true);
			assert.deepStrictEqual(knoxGuiSplitTokenizedLines('<div class="monaco-tokenized-source">a<br>b<br/>c</div>'), ['a', 'b', 'c']);
		});
	});

	suite('C chat rendering', () => {
		test('C-03 scroll follow ignores programmatic and shrink scrolls, pauses on scroll up, resumes at bottom', () => {
			const following = { following: true, lastScrollTop: 500, lastScrollHeight: 1000 };
			assert.strictEqual(knoxGuiNextScrollFollow(following, { scrollTop: 100, scrollHeight: 1000, clientHeight: 400, programmatic: true }).following, true);
			assert.strictEqual(knoxGuiNextScrollFollow(following, { scrollTop: 100, scrollHeight: 600, clientHeight: 400, programmatic: false }).following, true);
			const paused = knoxGuiNextScrollFollow(following, { scrollTop: 300, scrollHeight: 1000, clientHeight: 400, programmatic: false });
			assert.deepStrictEqual(paused, { following: false, lastScrollTop: 300, lastScrollHeight: 1000 });
			assert.strictEqual(knoxGuiNextScrollFollow(paused, { scrollTop: 350, scrollHeight: 1000, clientHeight: 400, programmatic: false }).following, false);
			assert.strictEqual(knoxGuiNextScrollFollow(paused, { scrollTop: 590, scrollHeight: 1000, clientHeight: 400, programmatic: false }).following, true);
			assert.strictEqual(knoxGuiTranscriptRestoreTop({ following: true, previousScrollTop: 100, previousScrollHeight: null, scrollHeight: 1000, clientHeight: 400 }), 600);
			assert.strictEqual(knoxGuiTranscriptRestoreTop({ following: false, previousScrollTop: 250, previousScrollHeight: null, scrollHeight: 1000, clientHeight: 400 }), 250);
			assert.strictEqual(knoxGuiTranscriptRestoreTop({ following: false, previousScrollTop: 40, previousScrollHeight: 800, scrollHeight: 1400, clientHeight: 400 }), 640);
			assert.strictEqual(knoxGuiShouldLoadEarlier({ programmatic: false, scrollTop: 20, displayStart: 50, loadingEarlier: false }), true);
			assert.strictEqual(knoxGuiShouldLoadEarlier({ programmatic: true, scrollTop: 20, displayStart: 50, loadingEarlier: false }), false);
			assert.strictEqual(knoxGuiShouldLoadEarlier({ programmatic: false, scrollTop: 20, displayStart: 0, loadingEarlier: false }), false);
			assert.strictEqual(CHAT_LOAD_EARLIER_THRESHOLD_PX, 48);
		});

		test('C-09 thinking indicator waits for context and needs a reasoning model', () => {
			const base = { isStreaming: true, isLast: true, hasContent: false, hasReasoning: false };
			assert.strictEqual(shouldShowThinkingIndicator({ ...base, isGatheringContext: true, showForModel: true }), false);
			assert.strictEqual(shouldShowThinkingIndicator({ ...base, isGatheringContext: false, showForModel: false }), false);
			assert.strictEqual(shouldShowThinkingIndicator({ ...base, isGatheringContext: false, showForModel: true }), true);
			knoxGuiResetModelCatalogForTests();
			assert.strictEqual(knoxGuiModelSupportsReasoning({ title: 'a', provider: 'x', model: 'a', supportedParameters: ['include_reasoning'] }), true);
			assert.strictEqual(knoxGuiModelSupportsReasoning({ title: 'b', provider: 'x', model: 'b', capabilities: { reasoning: true } }), true);
			assert.strictEqual(knoxGuiShowsThinkingPlaceholder({ title: 'c', provider: 'x', model: 'c', supportedParameters: ['reasoning_effort'] }), true);
			assert.strictEqual(knoxGuiShowsThinkingPlaceholder({ title: 'd', provider: 'x', model: 'd' }), false);
			assert.strictEqual(knoxGuiShowsThinkingPlaceholder(undefined), false);
		});

		test('C-14 code line window: 12 collapsed, 400 expanded, end anchor follows the tail and shifts', () => {
			assert.deepStrictEqual(visibleCodeLineRange(0, { isGenerating: false, isExpanded: true }), { start: 0, end: 0 });
			assert.deepStrictEqual(visibleCodeLineRange(30, { isGenerating: true, isExpanded: false }), { start: 18, end: 30 });
			assert.deepStrictEqual(visibleCodeLineRange(1000, { isGenerating: false, isExpanded: true }), { start: 0, end: MAX_EXPANDED_CODE_LINES });
			assert.deepStrictEqual(visibleCodeLineRange(1000, { isGenerating: false, isExpanded: true, anchor: 'end' }), { start: 600, end: 1000 });
			assert.deepStrictEqual(visibleCodeLineRange(1000, { isGenerating: false, isExpanded: true, anchor: 'end', windowShift: 48 }), { start: 552, end: 952 });
			assert.deepStrictEqual(visibleCodeLineRange(1000, { isGenerating: false, isExpanded: true, anchor: 'end', windowShift: 5000 }), { start: 0, end: 400 });
			assert.deepStrictEqual(knoxGuiSplitTokenizedLines('<div class="monaco-tokenized-source"><span class="mtk1">a</span><br/><br/><span class="mtk2">b</span></div>'), ['<span class="mtk1">a</span>', '', '<span class="mtk2">b</span>']);
		});

		test('C-15 code toolbar: `$ ` strip for Run, expand default', () => {
			assert.strictEqual(knoxGuiTerminalCommand('$ npm test'), 'npm test');
			assert.strictEqual(knoxGuiTerminalCommand('npm test'), 'npm test');
			assert.strictEqual(knoxGuiInitialCodeBlockExpanded('code', undefined), true);
			assert.strictEqual(knoxGuiInitialCodeBlockExpanded('  ', undefined), false);
			assert.strictEqual(knoxGuiInitialCodeBlockExpanded('code', false), false);
			assert.strictEqual(knoxGuiShouldAutoExpandGeneratingCodeBlock(true, 'code', undefined), true);
			assert.strictEqual(knoxGuiShouldAutoExpandGeneratingCodeBlock(true, '  ', undefined), false);
			assert.strictEqual(knoxGuiShouldAutoExpandGeneratingCodeBlock(true, 'code', false), false);
			assert.strictEqual(knoxGuiShouldAutoExpandGeneratingCodeBlock(false, 'code', undefined), false);
		});

		test('C-18 tool templates render to HTML with escaped arguments', () => {
			assert.strictEqual(renderToolTemplateHtml('read <code>{{{ filepath }}}</code>', { filepath: 'a.ts' }), 'read <code>a.ts</code>');
			assert.strictEqual(renderToolTemplateHtml('run {{command}}', { command: '<img src=x onerror=1>' }), 'run &#60;img src&#61;x onerror&#61;1&#62;');
			assert.strictEqual(renderToolTemplateHtml('x {{missing}}', {}), 'x');
		});
	});

	suite('I composer', () => {
		const para = (...content: KnoxGuiInlineNode[]): IKnoxGuiInputBlock => ({ type: 'paragraph', content });

		test('I-10 `#` opens the code-to-edit picker only in edit mode and is removed on pick', () => {
			const doc = [para({ type: 'text', text: 'fix #app' })];
			assert.deepStrictEqual(detectComposerTrigger(doc, undefined, { mode: 'edit' }), { kind: 'codeToEdit', query: 'app' });
			assert.strictEqual(detectComposerTrigger(doc, undefined, { mode: 'chat' }), undefined);
			const removed = removeCodeToEditTrigger(doc, { block: 0, offset: 8 });
			assert.strictEqual(inputDocToPlainText(removed.doc), 'fix ');
			assert.deepStrictEqual(removed.caret, { block: 0, offset: 4 });
		});

		test('I-11 chips open files, show clean-path tooltips, and providers do not open', () => {
			const file = { type: 'mention' as const, id: 'file:///ws/src/a.ts', label: 'a.ts', itemType: 'file', query: 'file:///ws/src/a.ts' };
			assert.strictEqual(mentionChipOpenUri(file), 'file:///ws/src/a.ts');
			assert.strictEqual(mentionChipTooltip(file), '/ws/src/a.ts');
			assert.strictEqual(mentionChipTooltip({ ...file, description: 'src/a.ts' }), 'src/a.ts');
			assert.strictEqual(mentionChipOpenUri({ id: 'diff', itemType: 'contextProvider' }), undefined);
			assert.strictEqual(isFolderMentionNode({ icon: 'folder' }), true);
			assert.strictEqual(isPathMentionNode({ itemType: 'problems' }), false);
		});

		test('I-12 picker prefers the roomier side, flips, shifts, and caps size', () => {
			const viewport = { width: 1000, height: 900 };
			const low = mentionFloatingPosition({ anchor: { left: 50, top: 800, bottom: 820 }, viewport, contentHeight: 200 });
			assert.strictEqual(low.placement, 'top');
			assert.strictEqual(low.width, MENTION_PANEL_MAX_WIDTH);
			assert.strictEqual(low.top, 800 - 6 - 200);
			assert.ok(low.maxHeight <= 900 * 0.4);
			const high = mentionFloatingPosition({ anchor: { left: 900, top: 100, bottom: 120 }, viewport, contentHeight: 200 });
			assert.strictEqual(high.placement, 'bottom');
			assert.strictEqual(high.left, 1000 - 8 - MENTION_PANEL_MAX_WIDTH);
			const flipped = mentionFloatingPosition({ anchor: { left: 0, top: 150, bottom: 650 }, viewport: { width: 300, height: 900 }, contentHeight: 300 });
			assert.strictEqual(flipped.placement, 'bottom');
			assert.strictEqual(flipped.width, 300 - 16);
			assert.strictEqual(flipped.left, 8);
		});

		test('I-13 `@` triggers mid-text at the caret and `/` at the start of any line', () => {
			const doc = [para({ type: 'text', text: 'see @ap and more' }), para({ type: 'text', text: '/com' })];
			assert.deepStrictEqual(detectComposerTrigger(doc, { block: 0, offset: 7 }), { kind: 'mention', query: 'ap' });
			assert.strictEqual(detectComposerTrigger(doc, { block: 0, offset: 16 }), undefined);
			assert.deepStrictEqual(detectComposerTrigger(doc, { block: 1, offset: 4 }), { kind: 'slash', query: 'com' });
			assert.deepStrictEqual(detectComposerTrigger([para({ type: 'text', text: 'a\n/x' })]), { kind: 'slash', query: 'x' });
			assert.strictEqual(detectComposerTrigger([para({ type: 'text', text: 'a /x' })]), undefined);
			const applied = applySuggestAt(doc, { id: 'src/app.ts', label: 'app.ts', itemType: 'file', query: 'src/app.ts' }, 'mention', { block: 0, offset: 7 });
			const first = applied.doc[0] as { content: KnoxGuiInlineNode[] };
			assert.deepStrictEqual(first.content.map(node => node.type), ['text', 'mention', 'text']);
			assert.strictEqual((first.content[0] as { text: string }).text, 'see ');
			assert.strictEqual((first.content[2] as { text: string }).text, ' and more');
			assert.deepStrictEqual(applied.caret, { block: 0, offset: 6 });
			assert.strictEqual(paragraphTextBefore(first as IKnoxGuiInputBlock & { type: 'paragraph' }, 6), `see ${KNOX_GUI_CHIP_CHAR} `);
			const slash = applySuggestAt(doc, { id: '/commit', label: '/commit', itemType: 'slashCommand', description: 'Commit' }, 'slash', { block: 1, offset: 4 });
			assert.deepStrictEqual((slash.doc[1] as { content: KnoxGuiInlineNode[] }).content[0], { type: 'slash', id: '/commit', label: '/commit', description: 'Commit' });
		});

		test('I-14 query providers become "Title: query" chips', () => {
			const item: IKnoxGuiSuggestItem = { id: 'memory', label: 'Project Memory', itemType: 'contextProvider', providerType: 'normal', query: 'auth flow' };
			const applied = applySuggestAt([para({ type: 'text', text: '@mem' })], { ...item, label: `${item.label}: ${item.query}` }, 'mention');
			const chip = (applied.doc[0] as { content: KnoxGuiInlineNode[] }).content[0];
			assert.strictEqual(chip.type === 'mention' && chip.label, 'Project Memory: auth flow');
			assert.strictEqual(chip.type === 'mention' && chip.query, 'auth flow');
		});

		test('I-15 list keeps the selected row and last rows while refetching', () => {
			const a: IKnoxGuiSuggestItem = { id: 'a', label: 'a' };
			const b: IKnoxGuiSuggestItem = { id: 'b', label: 'b' };
			assert.strictEqual(nextMentionSelectedIndex([b, a], [a, b], 1), 0);
			assert.strictEqual(nextMentionSelectedIndex([a], [a, b], 1), 0);
			assert.deepStrictEqual(retainMentionItemsWhileLoading([], [a, b], true), [a, b]);
			assert.deepStrictEqual(retainMentionItemsWhileLoading([{ id: MENTION_LOADING_ID, label: '' }], [a], false), [a]);
			assert.deepStrictEqual(retainMentionItemsWhileLoading([b], [a], true), [b]);
		});

		test('I-16 ranking: open files, exact, prefix, camel-case, path; integration providers last', () => {
			const rows: IKnoxGuiSuggestItem[] = [
				{ id: 'x/use-button.tsx', label: 'use-button.tsx', description: 'x/use-button.tsx', itemType: 'file' },
				{ id: 'Button.tsx', label: 'Button.tsx', description: 'src/Button.tsx', itemType: 'file' },
				{ id: 'button', label: 'button', description: 'src/button', itemType: 'folder', icon: 'folder' },
				{ id: 'MyButtonGroup.tsx', label: 'MyButtonGroup.tsx', description: 'src/MyButtonGroup.tsx', itemType: 'file' },
				{ id: 'open.ts', label: 'open.ts', description: 'lib/button/open.ts', itemType: 'file' },
			];
			assert.deepStrictEqual(rankMentionItems(rows, 'button', ['open.ts']).map(row => row.id), ['open.ts', 'button', 'Button.tsx', 'x/use-button.tsx', 'MyButtonGroup.tsx']);
			assert.strictEqual(mentionItemMatchesQuery({ label: 'MyButtonGroup.tsx' }, 'group'), true);
			assert.strictEqual(mentionItemMatchesQuery({ label: 'a.ts', description: 'src/deep/a.ts' }, 'src/a'), true);
			assert.deepStrictEqual(splitCamelCaseAndNonAlphaNumeric('myButton-group'), ['my', 'button', 'group']);
			const paths = shortestUniqueRelativePaths(['file:///ws/a/index.ts', 'file:///ws/b/index.ts', 'file:///ws/c/main.ts'], ['file:///ws']);
			assert.deepStrictEqual(paths.map(p => p.uniquePath), ['a/index.ts', 'b/index.ts', 'main.ts']);
			const open = openFileSuggestItems(['file:///ws/c/main.ts'], ['file:///ws']);
			assert.deepStrictEqual(open[0], { id: 'file:///ws/c/main.ts', label: 'main.ts', description: 'main.ts', itemType: 'file', query: 'file:///ws/c/main.ts', icon: 'file' });
			assert.strictEqual(mergeOpenFileMentions([], open, 'mai').length, 1);
			assert.strictEqual(mergeOpenFileMentions([], open, 'zzz').length, 0);
			assert.strictEqual(openFilesChanged(['a'], ['a']), false);
			assert.strictEqual(openFilesChanged(['a', 'b'], ['a']), true);
			const top = buildTopLevelMentionItems({
				query: '',
				files: [],
				providers: [
					{ title: 'jira', displayTitle: 'Jira', category: 'integration' },
					{ title: 'diff', displayTitle: 'Git Diff' },
					{ title: 'file', displayTitle: 'File' },
				],
			});
			assert.deepStrictEqual(top.map(item => item.id), ['file', 'diff', 'jira']);
			assert.strictEqual(fileHitToSuggestItem({ id: 'a', metadata: { truncated: true } }).truncated, true);
			const prompt = submenuHitToSuggestItem({ id: 'p', title: 'p', icon: 'scroll-text' }, 'prompt-files');
			assert.strictEqual(prompt.itemType, 'prompt-files');
			assert.strictEqual(submenuHitToSuggestItem({ id: 'f', title: 'f', icon: 'folder' }, 'prompt-files').itemType, 'folder');
		});

		test('I-17 bookmarks match with or without the leading slash', () => {
			assert.strictEqual(isSlashBookmarked(['/commit'], 'commit'), true);
			assert.strictEqual(isSlashBookmarked(['commit'], '/commit'), true);
			assert.deepStrictEqual(toggleSlashBookmark(['/commit'], 'commit'), []);
			assert.deepStrictEqual(toggleSlashBookmark(['/review'], '/commit'), ['review', 'commit']);
			assert.deepStrictEqual(sortPromptsBookmarkedFirst([{ name: 'a', description: '' }, { name: '/b', description: '' }], ['b']).map(cmd => cmd.name), ['/b', 'a']);
		});

		test('I-18 code-to-edit rows show the last two relative path parts', () => {
			assert.strictEqual(lastRelativePathParts('file:///ws/src/deep/a.ts', ['file:///ws'], 2), 'deep/a.ts');
			assert.strictEqual(lastRelativePathParts('file:///other/a.ts', ['file:///ws'], 2), 'a.ts');
		});
	});

	suite('K checkpoints', () => {
		test('K-17 graph reveal, find scroll, and menu flip math', () => {
			assert.strictEqual(checkpointGraphRevealScroll(400, 700, 0, 300), 400, 'details below the fold scroll their bottom into view');
			assert.strictEqual(checkpointGraphRevealScroll(100, 400, 200, 300), 100, 'row above the fold scrolls to its top');
			assert.strictEqual(checkpointGraphRevealScroll(100, 200, 50, 300), undefined);
			assert.strictEqual(checkpointGraphRevealScroll(400, 700, 0, 0), undefined, 'unmeasured viewport is skipped');
			assert.strictEqual(checkpointGraphFindScroll(1000, 0, 300), 1000);
			assert.strictEqual(checkpointGraphFindScroll(100, 0, 300), undefined);
			assert.deepStrictEqual(checkpointGraphMenuPosition(10, 10, 200, 100, 800, 600), { x: 10, y: 10 });
			assert.deepStrictEqual(checkpointGraphMenuPosition(700, 550, 200, 100, 800, 600), { x: 500, y: 450 });
			assert.deepStrictEqual(checkpointGraphMenuPosition(100, 50, 200, 100, 150, 120), { x: 8, y: 8 });
		});

		test('K-08 diff helpers: aligned split rows, collapsible gaps, summary without unchanged files, base64 sizes', () => {
			const lines = computeLineDiff('a\nb\nc', 'a\nB\nX\nc');
			assert.deepStrictEqual(alignSplitDiffRows(lines).map(row => [row.left === undefined ? '' : lines[row.left].content, row.right === undefined ? '' : lines[row.right].content]), [['a', 'a'], ['b', 'B'], ['', 'X'], ['c', 'c']]);
			const long = computeLineDiff(Array.from({ length: 12 }, (_, i) => `l${i}`).join('\n'), Array.from({ length: 12 }, (_, i) => i === 0 ? 'changed' : `l${i}`).join('\n'));
			assert.deepStrictEqual(buildDiffSegments(long).map(segment => [segment.kind, segment.end - segment.start]), [['lines', 5], ['gap', 8]]);
			assert.deepStrictEqual(buildDiffSegments(computeLineDiff('', 'x')).map(segment => segment.kind), ['lines']);
			assert.deepStrictEqual(checkpointDiffSummary([{ status: 'modified', additions: 2, deletions: 1 }, { status: 'unchanged', additions: 9, deletions: 9 }, { status: 'added', additions: 3, deletions: 0 }]), { filesChanged: 2, additions: 5, deletions: 1 });
			assert.strictEqual(checkpointDiffContentBytes('AAAA', 'base64'), 3);
			assert.strictEqual(checkpointDiffContentBytes('AA==', 'base64'), 1);
			assert.strictEqual(checkpointDiffContentBytes('hello'), 5);
			assert.strictEqual(checkpointDiffContentBytes(null), undefined);
		});

		test('K-11 timeline filter is substring over description, id and tags, newest first, grouped by day', () => {
			const node = (id: string, created: string, kind = 'manual', tags: string[] = []) => ({ id, description: `cp ${id}`, created, kind, tags });
			const nodes = [node('a', '2026-09-25T10:00:00'), node('b', '2026-09-26T09:00:00', 'auto', ['release']), node('c', '2026-09-26T11:00:00')];
			const all = groupTimelineCheckpoints(nodes, '', null);
			assert.strictEqual(all.count, 3);
			assert.deepStrictEqual(all.groups.map(group => group.nodes.map(item => item.id)), [['c', 'b'], ['a']]);
			assert.deepStrictEqual(groupTimelineCheckpoints(nodes, 'RELEASE', null).groups[0].nodes.map(item => item.id), ['b']);
			assert.strictEqual(groupTimelineCheckpoints(nodes, '', 'auto').count, 1);
			assert.strictEqual(groupTimelineCheckpoints(nodes, 'cpa', null).count, 0, 'not fuzzy');
		});

		test('K-14 dashboard formats and chart ticks', () => {
			assert.strictEqual(formatCheckpointDuration(12.4), '12ms');
			assert.strictEqual(formatCheckpointDuration(1500), '1.5s');
			assert.strictEqual(formatDashboardBytes(0), '0 B');
			assert.strictEqual(formatDashboardBytes(1024 * 1024 * 1024), '1 GB');
			assert.strictEqual(formatDashboardBytes(1536), '1.5 KB');
			assert.strictEqual(checkpointChartTickInterval(8), 0);
			assert.strictEqual(checkpointChartTickInterval(14), 1);
			assert.strictEqual(checkpointChartTickInterval(30), 4);
			assert.deepStrictEqual(checkpointChartYTicks(0), [0, 1, 2, 3, 4]);
			assert.deepStrictEqual(checkpointChartYTicks(3), [0, 1, 2, 3, 4]);
			assert.deepStrictEqual(checkpointChartYTicks(17), [0, 5, 10, 15, 20]);
			assert.deepStrictEqual(checkpointChartYTicks(1024), [0, 300, 600, 900, 1200]);
		});

		test('K-16 config field errors use raw size text and dirty counts unparseable storage', () => {
			const config = { ...DEFAULT_CHECKPOINT_CONFIG };
			assert.deepStrictEqual(checkpointConfigFieldErrors(config, '1 GB', '5 MB'), {});
			const errors = checkpointConfigFieldErrors({ ...config, maxCheckpoints: 0, autoMinIntervalMs: 500 }, 'lots', '10 B');
			assert.deepStrictEqual(Object.keys(errors).sort(), ['autoMinIntervalMs', 'maxCheckpoints', 'maxFileSizeBytes', 'maxStorageBytes']);
			assert.strictEqual(errors.maxStorageBytes, 'checkpointInvalidStorageSize');
			assert.strictEqual(checkpointConfigIsDirty(config, config, '953.7 MB'), false);
			assert.strictEqual(checkpointConfigIsDirty(config, config, 'lots'), true);
			assert.strictEqual(checkpointConfigNumber('12abc', 1), 12);
			assert.strictEqual(checkpointConfigNumber('', 1), 1);
		});

		test('K-03 list query is fuzzy over description, id, tags, session and paths', () => {
			const node = { id: 'a1b2c3', description: 'Refactor parser', tags: ['release'], sessionId: 'sess-9', changedPaths: ['src/lib/tokenizer.ts'] };
			assert.ok(checkpointMatchesQuery(node, 'refactr parser'));
			assert.ok(checkpointMatchesQuery(node, 'a1b'));
			assert.ok(checkpointMatchesQuery(node, 'releas'));
			assert.ok(checkpointMatchesQuery(node, 'tokenizer'));
			assert.ok(checkpointMatchesQuery(node, 'sess-9'));
			assert.ok(!checkpointMatchesQuery(node, 'zzzz'));
		});

		test('K-07 details parse, default tab, tree auto-expand, sizes, image previews, splitter bounds', () => {
			assert.strictEqual(parseCheckpointDetails({ success: false, details: null }), undefined);
			const details = parseCheckpointDetails({
				success: true,
				details: { id: 'cp', description: 'd', created: '2026-01-01T00:00:00.000Z', fileSnapshots: [{ relativePath: 'src/lib/a.ts', content: 'abc', encoding: 'utf8' }, { relativePath: '' }] },
			})!;
			assert.strictEqual(details.fileSnapshots.length, 1);
			assert.strictEqual(details.fileSnapshots[0].size, 3);
			assert.strictEqual(details.fileSnapshots[0].lastModified, '2026-01-01T00:00:00.000Z');
			assert.strictEqual(checkpointDetailsDefaultTab(details), 'files');
			assert.strictEqual(checkpointDetailsDefaultTab({ ...details, fileSnapshots: [] }), 'basic');
			assert.deepStrictEqual(checkpointTreeAncestors('src/lib/a.ts'), ['src', 'src/lib']);
			assert.deepStrictEqual([formatSnapshotSize(0), formatSnapshotSize(1536), formatSnapshotSize(512)], ['0 B', '1.5 KB', '512 B']);
			assert.strictEqual(checkpointImageMime('logo.PNG', 'base64'), 'image/png');
			assert.strictEqual(checkpointImageMime('logo.png', 'utf8'), undefined);
			assert.strictEqual(checkpointImageMime('a.bin', 'base64'), undefined);
			assert.strictEqual(clampCheckpointTreeWidth(50, 1000), 200);
			assert.strictEqual(clampCheckpointTreeWidth(900, 1000), 500);
			assert.strictEqual(clampCheckpointTreeWidth(450, 600), 360);
			assert.deepStrictEqual(compareCheckpointTargets([
				{ id: 'a', created: '2026-01-01' }, { id: 'b', created: '2026-01-03' }, { id: 'c', created: '2026-01-02' },
			], 'a').map(cp => cp.id), ['b', 'c']);
		});

		test('K-12 getPreviousCheckpoint fallback diffs raw snapshots', () => {
			const snap = (relativePath: string, content: string) => ({ relativePath, content, encoding: 'utf8', size: content.length, lastModified: '' });
			const diff = diffFromCheckpointSnapshots(
				{ id: 'old', description: 'o', created: '1', fileSnapshots: [snap('a.ts', 'x\n'), snap('gone.ts', 'y')] },
				{ id: 'new', description: 'n', created: '2', fileSnapshots: [snap('a.ts', 'x\nz\n'), snap('b.ts', 'b')] },
			);
			assert.deepStrictEqual(diff.files.map(file => [file.relativePath, file.status]), [['a.ts', 'modified'], ['b.ts', 'added'], ['gone.ts', 'deleted']]);
			assert.strictEqual(diff.oldCheckpoint.id, 'old');
			assert.strictEqual(diff.files[0].additions, 1);
		});
	});

	suite('M memory', () => {
		test('M-03 range select, empty-state key, and reference export formats', () => {
			const ids = ['1', '2', '3', '4'];
			assert.deepStrictEqual([...rangeSelectMemoryIds(ids, null, '2', new Set())], ['2']);
			assert.deepStrictEqual([...rangeSelectMemoryIds(ids, null, '2', new Set(['2']))], []);
			assert.deepStrictEqual([...rangeSelectMemoryIds(ids, '4', '2', new Set(['1']))].sort(), ['1', '2', '3', '4']);
			assert.strictEqual(memoryBrowserEmptyKey('', 'all', 'all'), 'memoryNoMemoriesStored');
			assert.strictEqual(memoryBrowserEmptyKey('', 'all', 'hot'), 'memoryNoResults');
			assert.strictEqual(memoryBrowserEmptyKey('', 'pinned', 'all'), 'memoryNoResults');
			const now = new Date('2026-09-28T00:00:00.000Z');
			const json = JSON.parse(memoriesToExportJson([{ id: '7', title: 't', content: 'c', pinned: true, importance: 0.5 }], now));
			assert.strictEqual(json.version, 'knox-memories-selected-v1');
			assert.strictEqual(json.count, 1);
			assert.deepStrictEqual([json.memories[0].id, json.memories[0].importance_score, json.memories[0].pinned], [7, 0.5, true]);
			const md = memoriesToExportMarkdown([{ id: '7', title: '', content: 'c', keywords: 'a,b', createdAt: '2026-01-01' }], now);
			assert.ok(md.startsWith('# Memories export (1)\n\nExported 2026-09-28T00:00:00.000Z'));
			assert.ok(md.includes('## (untitled)'));
			assert.ok(md.includes('- Category: general · Tier: — · Pin: no'));
			assert.ok(md.includes('- Keywords: a,b'));
		});

		test('M-04 explore edges stay within the visible subgraph and type counts rank by frequency', () => {
			const entity = (id: number) => ({ id, name: `e${id}`, entityType: 'x', mentionCount: 1 });
			const edges = [
				{ id: 1, source: 1, target: 2, relationship: 'uses', weight: 1 },
				{ id: 2, source: 2, target: 9, relationship: 'calls', weight: 1 },
				{ id: 3, source: 1, target: 3, relationship: 'owns', weight: 1 },
			];
			const visible = visibleMemoryExploreEdges({ centerId: 1, entities: [entity(2), entity(3)], edges, entityDepths: { '2': 1, '3': 2 } });
			assert.deepStrictEqual(visible.map(edge => edge.id).sort(), [1, 3], 'edge to unexplored entity 9 is hidden');
			assert.deepStrictEqual(memoryGraphTypeCounts({ tool: 2, file: 5 }, [{ entityType: 'concept' }, { entityType: 'file' }]), [['file', 5], ['tool', 2], ['concept', 0]]);
		});

		test('M-06 settings fields, defaults merge, and number commit validation', () => {
			const keys = MEMORY_SETTING_GROUPS.flatMap(group => group.fields.map(field => field.key));
			for (const key of ['wm_inject_min_relevance', 'summary_inject_min_overlap', 'context_line_compress_chars', 'context_compress_keep_lines', 'graph_neighbor_limit', 'post_turn_min_chars']) {
				assert.ok(keys.includes(key), key);
			}
			assert.strictEqual(new Set(keys).size, keys.length, 'no duplicate setting keys');
			assert.strictEqual(keys.indexOf('max_context_tokens'), keys.indexOf('enable_enhanced_semantic') + 1);
			assert.ok(keys.indexOf('post_turn_min_chars') === keys.indexOf('enable_knowledge_extraction') + 1);
			const merged = withMemoryConfigDefaults({ retrieval_top_k: 7 });
			assert.strictEqual(merged.retrieval_top_k, 7);
			assert.strictEqual(merged.graph_neighbor_limit, 10);
			assert.strictEqual(parseMemorySettingInput({ min: 3, max: 50 }, '12.9'), 12, 'integer fields use parseInt');
			assert.strictEqual(parseMemorySettingInput({ min: 3, max: 50 }, '2'), undefined, 'below min reverts');
			assert.strictEqual(parseMemorySettingInput({ min: 3, max: 50 }, 'abc'), undefined);
			assert.strictEqual(parseMemorySettingInput({ min: 0.1, max: 0.8, percent: true }, '35'), 0.35);
			assert.strictEqual(parseMemorySettingInput({ min: 0.1, max: 0.8, percent: true }, '90'), undefined);
			assert.strictEqual(parseMemorySettingInput({ min: 0, max: 0.5, step: 0.01 }, '0.25'), 0.25);
			assert.deepStrictEqual(memoryConsolidateParts({ promoted: 2, demoted: 0, pruned: 1, merged: 0 }), ['2 promoted', '1 pruned']);
			assert.deepStrictEqual(memoryConsolidateParts({}), []);
			assert.strictEqual(memoryConsolidateParts(undefined), undefined);
		});
	});

	suite('S pages', () => {
		test('S-11 history search ORs terms and allows about one edit per ten characters', () => {
			assert.strictEqual(fuzzyTitleMatch('Refactor the parser', 'parser'), true);
			assert.strictEqual(fuzzyTitleMatch('Refactor the parser', 'nothing parser'), true);
			assert.strictEqual(fuzzyTitleMatch('Refactor the parser', 'parsr'), true);
			assert.strictEqual(fuzzyTitleMatch('Refactor the parser', 'pxrsxr'), false);
			assert.strictEqual(fuzzyTitleMatch('Implementation notes', 'implementasion'), true);
			assert.strictEqual(fuzzyTitleMatch('Implementation notes', 'zzz'), false);
			assert.strictEqual(fuzzyTitleMatch('create a user login form', 'log'), true);
			assert.strictEqual(historySessionMatchesQuery({ id: '1', title: 'Ship API', date: '', workspaceDirectory: '/Users/me/demo' }, 'demo'), true);
			assert.strictEqual(historySessionMatchesQuery({ id: '1', title: 'Ship API', date: '', workspaceDirectory: '/Users/me/demo' }, 'zzz'), false);
		});

		test('S-13 unset max steps and doom loop follow the profile, auto uses default', () => {
			assert.deepStrictEqual([agentProfileDefaults('rust').maxSteps, agentProfileDefaults('rust').doomLoopThreshold], [0, 4]);
			assert.strictEqual(agentProfileDefaults('systems').doomLoopThreshold, 5);
			assert.strictEqual(agentProfileDefaults('auto').doomLoopThreshold, 3);
		});

		test('S-17 KnoxChat pricing badges', () => {
			const perToken = knoxChatModelPricing({ prompt: '0.000003', completion: '0.000015' }, false)!;
			assert.deepStrictEqual(formatModelPricingPerMillion(perToken), { badge: '$3/15', title: '$3 / $15 per 1M tokens' });
			const display = knoxChatModelPricing({ prompt: '0.15', completion: '0.6' }, true)!;
			assert.strictEqual(formatModelPricingPerMillion(display).badge, '$0.15/0.6');
			assert.strictEqual(knoxChatModelPricing({ prompt: '-1', completion: '1' }, false), undefined);
			assert.strictEqual(knoxChatPricingHasWebSearch({ web_search: '0.01' }), true);
			assert.strictEqual(formatUsdAmount(0.00125), '0.0013');
			assert.strictEqual(formatUsdAmount(0.2475), '0.2475');
		});

		test('S-17 OpenRouter ~latest alias floor pricing matches GET /api/v1/models', () => {
			const raw = applyOpenRouterAliasFloorPricing([
				{
					id: 'z-ai/glm-5.3-flash',
					name: 'Z.ai: GLM 5.3 Flash',
					pricing: { prompt: '0.00000015', completion: '0.0000005' },
				},
				{
					id: '~z-ai/glm-flash-latest',
					name: 'Z.ai: GLM Flash Latest',
					alias_target: { name: 'Z.ai: GLM 5.3 Flash', slug: 'z-ai/glm-5.3-flash' },
					pricing: { prompt: '0.00000002', completion: '0.0000002475' },
				},
			]);
			const flash = raw.find(item => (item as { id?: string }).id === 'z-ai/glm-5.3-flash') as { pricing?: unknown };
			const pricing = knoxChatModelPricing(flash.pricing, false)!;
			assert.deepStrictEqual(formatModelPricingPerMillion(pricing), {
				badge: '$0.02/0.2475',
				title: '$0.02 / $0.2475 per 1M tokens',
			});
		});

		test('S-17 KnoxChat model list context and ↑max-token badges follow the reference metadata rules', () => {
			assert.strictEqual(knoxChatMetadataContextLength({ context_length: 200000, top_provider: { context_length: 1000000 } }), 1000000);
			assert.strictEqual(knoxChatMetadataContextLength({ context_length: -1 }), Number.POSITIVE_INFINITY);
			assert.strictEqual(knoxChatMetadataContextLength({}), undefined);
			assert.strictEqual(knoxChatRecommendedMaxTokens({ context_length: 1000000, top_provider: { max_completion_tokens: 128000 } }), 128000);
			assert.strictEqual(knoxChatRecommendedMaxTokens({ context_length: 200000, max_completion_tokens: 64000 }), 50000);
			assert.strictEqual(knoxChatRecommendedMaxTokens({ context_length: -1, max_completion_tokens: 128000 }), 128000);
			assert.strictEqual(knoxChatRecommendedMaxTokens({ context_length: 200000 }), undefined);
		});

		test('clickable transcript paths resolve like the original openFileInEditor', () => {
			const dirs = ['file:///Users/me/snake_game'];
			assert.deepStrictEqual(knoxGuiResolveOpenPath('file:///w/a.rs', dirs), { direct: true, candidates: [], fallback: 'file:///w/a.rs' });
			assert.deepStrictEqual(knoxGuiResolveOpenPath('/Users/me/a b.rs', dirs), { direct: true, candidates: [], fallback: 'file:///Users/me/a%20b.rs' });
			assert.strictEqual(knoxGuiResolveOpenPath('C:\\w\\a.rs', [])?.fallback, 'file:///C:/w/a.rs');
			assert.strictEqual(knoxGuiResolveOpenPath('  ', dirs), undefined);
			// Leading workspace folder name is stripped, so the model's `snake_game/src/main.rs` opens `<ws>/src/main.rs`.
			const rel = knoxGuiResolveOpenPath('snake_game/src/main.rs', dirs)!;
			assert.strictEqual(rel.direct, false);
			assert.deepStrictEqual(rel.candidates, ['file:///Users/me/snake_game/snake_game/src/main.rs', 'file:///Users/me/snake_game/src/main.rs']);
			assert.strictEqual(rel.fallback, 'file:///Users/me/snake_game/src/main.rs');
			assert.strictEqual(knoxGuiResolveOpenPath('./Cargo.toml', dirs)!.candidates[0], 'file:///Users/me/snake_game/Cargo.toml');
			const quoted = knoxGuiResolveOpenPath('>snake_game/src/main.rs', dirs)!;
			assert.strictEqual(quoted.direct, false);
			assert.ok(quoted.candidates.includes('file:///Users/me/snake_game/src/main.rs'));
			assert.strictEqual(knoxGuiResolveOpenPath('">kernel/src/interrupts.rs"', ['file:///ws/kernel'])!.fallback, 'file:///ws/kernel/src/interrupts.rs');
		});
	});
});
