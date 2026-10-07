/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { knoxGuiLocaleKeys, knoxGuiT } from './gui/knoxGuiI18n.js';

const knoxGuiCssDir = join(process.cwd(), 'src/vs/workbench/contrib/knox/browser/media');
const knoxGuiCssFiles = [
	'knoxGui.css',
	'knoxGuiChat.css',
	'knoxGuiComposer.css',
	'knoxGuiPanels.css',
	'knoxGuiThinking.css',
	'knoxGuiPages.css',
	'knoxGuiCheckpoints/base.css',
	'knoxGuiCheckpoints/tokens.css',
	'knoxGuiCheckpoints/ui-button.css',
	'knoxGuiCheckpoints/ui-responsive.css',
	'knoxGuiCheckpoints/ui-badge.css',
	'knoxGuiCheckpoints/ui-checkbox-select.css',
	'knoxGuiCheckpoints/ui-input.css',
	'knoxGuiCheckpoints/ui-dialog.css',
	'knoxGuiCheckpoints/list.css',
	'knoxGuiCheckpoints/card.css',
	'knoxGuiCheckpoints/timeline-header.css',
	'knoxGuiCheckpoints/timeline-list.css',
	'knoxGuiCheckpoints/restore.css',
	'knoxGuiCheckpoints/compare.css',
	'knoxGuiCheckpoints/diff-viewer.css',
	'knoxGuiCheckpoints/file-tree.css',
	'knoxGuiCheckpoints/diff-pane.css',
	'knoxGuiCheckpoints/diff-binary.css',
	'knoxGuiCheckpoints/details-dialog.css',
	'knoxGuiCheckpoints/details-snapshots.css',
	'knoxGuiCheckpoints/details-viewer.css',
	'knoxGuiCheckpoints/details-compare.css',
	'knoxGuiCheckpoints/details-actions.css',
	'knoxGuiMemory.css',
	'knoxGuiGraph.css',
	'knoxGuiConfig.css',
	'knoxGuiCheckpointDetails.css',
];

suite('Knox native GUI i18n', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('i18n tables include chat and settings keys in en and zh', () => {
		assert.strictEqual(knoxGuiT('en', 'askAnything').length > 0, true);
		assert.strictEqual(knoxGuiT('zh', 'askAnything').length > 0, true);
		assert.notStrictEqual(knoxGuiT('en', 'askAnything'), knoxGuiT('zh', 'askAnything'));
		assert.ok(knoxGuiT('en', 'checkpointGraph.title').includes('Checkpoint'));
		assert.ok(knoxGuiT('en', 'restoreSelectedCount', { count: 3 }).includes('3'));
		assert.ok(knoxGuiT('en', 'restorePreviewTitle').length > 0);
		assert.ok(knoxGuiT('en', 'checkpointDashboard.tab').length > 0);
		assert.ok(knoxGuiT('zh', 'checkpointAnalysis.tab').length > 0);
		assert.ok(knoxGuiT('en', 'newChat').length > 0);
		assert.ok(knoxGuiT('en', 'sendMessage').length > 0);
		assert.strictEqual(knoxGuiT('en', 'send'), 'Send');
		assert.ok(knoxGuiT('en', 'webSearchTooltipInactive').includes('web search'));
		assert.ok(knoxGuiT('en', 'permissionModeGroup').length > 0);
		assert.ok(knoxGuiT('en', 'permissionModeTriggerHint').includes('Jev'));
		assert.ok(knoxGuiT('en', 'permissionModeAsk').includes('Ask'));
		assert.notStrictEqual(knoxGuiT('en', 'permissionModeTriggerHint'), knoxGuiT('zh', 'permissionModeTriggerHint'));
		assert.ok(knoxGuiT('en', 'loadingConversation').includes('Loading'));
		assert.ok(knoxGuiT('zh', 'loadingConversation').length > 0);
		assert.notStrictEqual(knoxGuiT('en', 'loadingConversation'), knoxGuiT('zh', 'loadingConversation'));
		assert.ok(knoxGuiT('en', 'largeSessionBanner').includes('large'));
		assert.ok(knoxGuiT('en', 'loadEarlierMessages', { count: 12 }).includes('12'));
		assert.ok(knoxGuiT('en', 'chatTab', { number: 2 }).includes('2'));
		assert.ok(knoxGuiT('en', 'matchCount', { current: 1, total: 4 }).includes('1'));
		assert.ok(knoxGuiT('en', 'failedToLoadConfiguration').length > 0);
		assert.ok(knoxGuiT('en', 'scrollToTop').length > 0);
		assert.ok(knoxGuiT('en', 'thinkingEllipsis').includes('Thinking'));
		assert.ok(knoxGuiT('en', 'reject').length > 0);
		assert.ok(knoxGuiT('en', 'accept').length > 0);
		assert.notStrictEqual(knoxGuiT('en', 'reject'), knoxGuiT('zh', 'reject'));
		assert.ok(knoxGuiT('en', 'activityStepsUsed', { used: 2, max: 10 }).includes('2'));
		assert.ok(knoxGuiT('en', 'activityTokens', { count: '4.2k' }).includes('4.2k'));
		assert.ok(knoxGuiT('en', 'activityJevSkill', { route: 'view_read', skill: 'qemu' }).includes('qemu'));
		assert.ok(knoxGuiT('en', 'activityTokensPerSecond', { count: '42' }).includes('tok/s'));
		assert.ok(knoxGuiT('en', 'applyingChanges').length > 0);
		assert.ok(knoxGuiT('zh', 'thinking').length > 0);
		assert.ok(knoxGuiT('en', 'dailyTokens').includes('Daily'));
		assert.ok(knoxGuiT('en', 'tokenConsumptionByModel').includes('Model'));
		assert.ok(knoxGuiT('en', 'noTokenUsageYet').includes('No token'));
		assert.notStrictEqual(knoxGuiT('en', 'noTokenUsageYet'), knoxGuiT('zh', 'noTokenUsageYet'));
		assert.ok(knoxGuiT('en', 'tokenUsageKnoxChatBilling').includes('not local token accounting'), 'stats copy matches the original (no local token tables, S-14)');
		assert.ok(knoxGuiT('zh', 'tokenUsageKnoxChatBilling').includes('不做本地 token 计数'));
		assert.strictEqual(knoxGuiT('en', 'loading'), 'Loading');
		assert.strictEqual(knoxGuiT('en', 'restoring'), 'Restoring');
		// Documented productization (the only shared GUI keys whose wording differs from the original common.json):
		// provider blurbs describe the native Add Model catalog; restoreCheckpoint names the checkpoint id; browsingEntireRepo carries the bullet the original JSX prefixes.
        assert.ok(knoxGuiT('en', 'accessModelsDescription').includes('KnoxStudio'));
		assert.ok(knoxGuiT('en', 'openaiDescription').includes('GPT-6.1 Sol'));
		assert.ok(knoxGuiT('en', 'anthropicDescription').includes('Claude'));
		assert.ok(knoxGuiT('en', 'browsingEntireRepo').startsWith('• '));
		assert.ok(knoxGuiT('en', 'taskPlanTitle').length > 0);
		assert.ok(knoxGuiT('en', 'jobsCount', { count: 2 }).includes('2'));
		assert.ok(knoxGuiT('en', 'memoryInjectedTitle', { count: 3 }).includes('3'));
		assert.ok(knoxGuiT('en', 'autonomousBannerRunning', { iteration: 2, max: 5 }).includes('2'));
		assert.ok(knoxGuiT('en', 'worktreeApply').length > 0);
		assert.ok(knoxGuiT('en', 'filesChanged', { count: 4 }).includes('4'));
		assert.notStrictEqual(knoxGuiT('en', 'compactionAppliedTitle'), knoxGuiT('zh', 'compactionAppliedTitle'));
		assert.ok(knoxGuiT('en', 'bookmark').length > 0);
		assert.ok(knoxGuiT('en', 'applying').length > 0);
		assert.notStrictEqual(knoxGuiT('en', 'bookmark'), knoxGuiT('zh', 'bookmark'));
		assert.ok(knoxGuiT('en', 'promptPath').length > 0);
		assert.ok(knoxGuiT('zh', 'batchDiff').length > 0);
		assert.ok(knoxGuiT('en', 'enterSearchFile').length > 0);
		assert.ok(knoxGuiT('en', 'mentionTruncated', { count: 40 }).includes('40'));
		assert.ok(knoxGuiT('en', 'dragAndDropImages').length > 0);
		assert.ok(knoxGuiT('en', 'retry').length > 0);
		assert.ok(knoxGuiT('en', 'thinkingDots').includes('Thinking'));
		assert.ok(knoxGuiT('en', 'knoxGeneration').length > 0);
		assert.ok(knoxGuiT('en', 'errorExclamation').includes('Error'));
		assert.ok(knoxGuiT('en', 'learnMore').length > 0);
		assert.ok(knoxGuiT('en', 'rateLimited', { model: 'Grok', provider: 'xAI' }).includes('Grok'));
		assert.ok(knoxGuiT('en', 'toolGenerating').includes('Generating'));
		assert.ok(knoxGuiT('en', 'toolWouldLikeTo').length > 0);
		assert.ok(knoxGuiT('en', 'terminal').length > 0);
		assert.ok(knoxGuiT('en', 'copyOutput').length > 0);
		assert.notStrictEqual(knoxGuiT('en', 'toolCanceled'), knoxGuiT('zh', 'toolCanceled'));
		assert.ok(knoxGuiT('en', 'locallyDefinedRule').includes('Local'));
		assert.ok(knoxGuiT('en', 'inlineRule').includes('Inline'));
		assert.ok(knoxGuiT('en', 'explore').length > 0);
		assert.notStrictEqual(knoxGuiT('en', 'explore'), knoxGuiT('zh', 'explore'));
		assert.ok(knoxGuiT('en', 'add').length > 0);
		assert.ok(knoxGuiT('en', 'rules').length > 0);
		assert.ok(knoxGuiT('en', 'expand').length > 0);
		assert.ok(knoxGuiT('en', 'addPrompt').includes('Prompt'));
		assert.ok(knoxGuiT('en', 'addNewPromptFile').includes('.prompt'));
		assert.ok(knoxGuiT('en', 'createNewPromptFile').includes('.prompt'));
		assert.ok(knoxGuiT('en', 'commandNameTooltip').includes('slash'));
		assert.ok(knoxGuiT('en', 'promptsCanBeUsed').length > 0);
		assert.notStrictEqual(knoxGuiT('en', 'editPrompt'), knoxGuiT('zh', 'editPrompt'));
		assert.ok(knoxGuiT('en', 'askOnWrite').includes('Ask'));
		assert.ok(knoxGuiT('en', 'yoloPreset').includes('YOLO'));
		assert.ok(knoxGuiT('en', 'policyTitle').length > 0);
		assert.ok(knoxGuiT('en', 'groupDisabled').length > 0);
		assert.notStrictEqual(knoxGuiT('en', 'toolRequiresApproval'), knoxGuiT('zh', 'toolRequiresApproval'));
		assert.ok(knoxGuiT('en', 'paste').length > 0);
		assert.ok(knoxGuiT('en', 'oopsSomethingWentWrong').includes('Oops'));
		assert.ok(knoxGuiT('en', 'noConfigErrorsFound').length > 0);
		assert.notStrictEqual(knoxGuiT('en', 'paste'), knoxGuiT('zh', 'paste'));
		assert.ok(knoxGuiT('en', 'memoryOverview').length > 0);
		assert.ok(knoxGuiT('en', 'memorySystemStatus').length > 0);
		assert.ok(knoxGuiT('en', 'memoryLoadingDashboard').includes('Loading'));
		assert.ok(knoxGuiT('en', 'memoryTierHot').length > 0);
		assert.ok(knoxGuiT('en', 'memoryHealthScore').length > 0);
		assert.ok(knoxGuiT('en', 'memoryTimeNever').length > 0);
		assert.ok(knoxGuiT('en', 'memoryTimeMinutesAgo', { count: 3 }).includes('3'));
		assert.notStrictEqual(knoxGuiT('en', 'memoryOverview'), knoxGuiT('zh', 'memoryOverview'));
		assert.ok(knoxGuiT('en', 'memorySelectMultiple').length > 0);
		assert.ok(knoxGuiT('en', 'memorySessionHistoryTitle').length > 0);
		assert.ok(knoxGuiT('en', 'memoryExplore').length > 0);
		assert.ok(knoxGuiT('en', 'memoryHealSystem').length > 0);
		assert.ok(knoxGuiT('en', 'checkpointGraph.loading').includes('Loading'));
		assert.ok(knoxGuiT('en', 'checkpointGraph.openFolder').length > 0);
		assert.ok(knoxGuiT('en', 'checkpointGraph.retry').length > 0);
		assert.ok(knoxGuiT('en', 'checkpointGraph.create').length > 0);
		assert.ok(knoxGuiT('en', 'checkpointGraph.failed').length > 0);
		assert.notStrictEqual(knoxGuiT('en', 'checkpointGraph.noWorkspace'), knoxGuiT('zh', 'checkpointGraph.noWorkspace'));
		assert.ok(knoxGuiT('en', 'checkpointGraph.find').length > 0);
		assert.ok(knoxGuiT('en', 'checkpointGraph.workingTree').includes('Uncheckpointed'));
		assert.ok(knoxGuiT('en', 'checkpointGraph.menu.restore').includes('Restore'));
		assert.ok(knoxGuiT('en', 'checkpointGraph.justNow').length > 0);
		assert.ok(knoxGuiT('en', 'restorePreviewWillOverwrite').includes('overwrite'));
		assert.notStrictEqual(knoxGuiT('en', 'checkpointGraph.workingTree'), knoxGuiT('zh', 'checkpointGraph.workingTree'));
		assert.ok(knoxGuiT('en', 'oauthErrorDenied').includes('denied'));
		assert.ok(knoxGuiT('zh', 'oauthErrorTimeout').length > 0);
		assert.notStrictEqual(knoxGuiT('en', 'signInKnoxStudio'), knoxGuiT('zh', 'signInKnoxStudio'));
		assert.notStrictEqual(knoxGuiT('en', 'signInOpenRouter'), knoxGuiT('zh', 'signInOpenRouter'));
		assert.ok(knoxGuiT('en', 'signInOpenRouter').includes('OpenRouter'));
		assert.ok(knoxGuiT('en', 'oauthErrorExpired').includes('expired'));
		assert.ok(knoxGuiT('en', 'oauthErrorOpenRouterPortInUse').includes('8734'));
		assert.ok(knoxGuiT('en', 'oauthErrorOpenRouterExchange').includes('OpenRouter'));
		assert.ok(knoxGuiT('en', 'oauthErrorOpenRouterOffline').includes('OpenRouter'));
		assert.ok(knoxGuiT('en', 'oauthErrorOpenRouterTls').includes('OpenRouter'));
		assert.notStrictEqual(knoxGuiT('en', 'oauthErrorOpenRouterExchange'), knoxGuiT('zh', 'oauthErrorOpenRouterExchange'));
		assert.ok(knoxGuiT('en', 'openrouterDescription').includes('OpenRouter') || knoxGuiT('en', 'openrouterLongDescription').includes('OpenRouter'));
		assert.ok(knoxGuiT('en', 'oauthErrorPortInUse').includes('8733'));
		assert.ok(knoxGuiT('en', 'textDialogMilestoneTitle').includes('300'));
		assert.ok(knoxGuiT('en', 'invalidFindRegex').length > 0);
		assert.ok(knoxGuiT('en', 'addModelOption1').length > 0);
		assert.ok(knoxGuiT('en', 'addModelOption2').length > 0);
		assert.ok(knoxGuiT('en', 'startWithProvider').length > 0);
		assert.ok(knoxGuiT('en', 'selectSpecificModel').length > 0);
		assert.ok(knoxGuiT('en', 'selectModelBelow').length > 0);
		assert.ok(knoxGuiT('en', 'openaiDescription').includes('GPT'));
		assert.ok(knoxGuiT('en', 'anthropicDescription').includes('Claude'));
		assert.notStrictEqual(knoxGuiT('en', 'selectModelBelow'), knoxGuiT('zh', 'selectModelBelow'));
		assert.ok(knoxGuiT('en', 'cannotSubmitWhileAwaitingTool').includes('tool'));
	});

	test('en and zh tables have identical keys (KN-381)', () => {
		const enKeys = knoxGuiLocaleKeys('en');
		const zhKeys = knoxGuiLocaleKeys('zh');
		assert.deepStrictEqual(zhKeys, enKeys);
		assert.ok(enKeys.includes('askAnything'));
		assert.ok(enKeys.includes('checkpointGraph.title'));
		assert.ok(enKeys.includes('memoryOverview'));
		assert.ok(enKeys.length > 1000);
	});

	test('workbench CSP allows knoxGui Trusted Types policy', () => {
		for (const name of ['workbench.html', 'workbench-dev.html']) {
			const html = readFileSync(join(process.cwd(), 'src/vs/code/electron-browser/workbench', name), 'utf8');
			assert.ok(/\n\s+knoxGui\n/.test(html), `${name} must allow trusted-types knoxGui`);
		}
	});

	test('knox.contributions.ts loads knoxGui CSS files in cascade order', () => {
		const contributions = readFileSync(join(process.cwd(), 'src/vs/workbench/contrib/knox/browser/knox.contributions.ts'), 'utf8');
		const imports = [...contributions.matchAll(/import '\.\/media\/(knoxGui[^']*\.css)';/g)].map(match => match[1]);
		assert.deepStrictEqual(imports, knoxGuiCssFiles);
		const onDisk = readdirSync(knoxGuiCssDir, { withFileTypes: true }).flatMap(entry => {
			if (entry.isDirectory() && /^knoxGui/.test(entry.name)) {
				return readdirSync(join(knoxGuiCssDir, entry.name)).filter(name => /\.css$/.test(name)).map(name => `${entry.name}/${name}`);
			}
			return entry.isFile() && /^knoxGui.*\.css$/.test(entry.name) ? [entry.name] : [];
		}).sort();
		assert.deepStrictEqual(onDisk, [...knoxGuiCssFiles].sort());
	});

	test('knoxGui CSS keeps lump icons 14px and checkpoint graph rules', () => {
		const css = knoxGuiCssFiles.map(name => readFileSync(join(knoxGuiCssDir, name), 'utf8')).join('\n');
		assert.strictEqual(css.split('.knox-gui-starters {').length - 1, 1);
		assert.ok(css.includes('.knox-gui-msg-hit'));
		assert.ok(css.includes('.knox-gui-lump .knox-gui-svg'));
		assert.ok(css.includes('width: 14px'));
		assert.ok(css.includes('.knox-gui-job {'));
		assert.ok(css.includes('.knox-gui-job-command'));
		assert.ok(css.includes('.knox-gui-job-detail'));
		assert.ok(css.includes('.knox-gui-turn {'));
		assert.ok(css.includes('.knox-gui-policy-title'));
		assert.ok(css.includes('.knox-gui-tier {'));
		assert.ok(css.includes('.knox-gui-raw-md'));
		assert.ok(css.includes('.knox-gui-rule-card {'));
		assert.ok(css.includes('.knox-gui-graph-table'));
		assert.ok(css.includes('.knox-gui-restore-overwrite'));
		assert.ok(css.includes('.knox-gui-meter-track'));
		assert.ok(!/\.knox-gui-meter\s*\{[^}]*height:\s*6px/.test(css));
		assert.ok(css.includes('.knox-gui-overlay {'));
		assert.ok(css.includes('.knox-gui-page {'));
		assert.ok(!css.includes('.knox-gui-overlay,\n.knox-gui-page {'));
		assert.ok(css.includes('minmax(300px, 1fr)'));
		assert.ok(css.includes('.knox-gui .rendered-markdown h1'));
		assert.ok(css.includes('.knox-gui-md-fence'));
		assert.ok(css.includes('.knox-gui-listbox-btn'));
		assert.ok(/\.knox-gui-listbox-btn \{[^}]*border-radius:\s*4px/.test(css));
		assert.ok(/\.knox-gui-role-menu \{[^}]*border-radius:\s*4px/.test(css));
		assert.ok(css.includes('.knox-gui-checkpoint-card'));
		assert.ok(css.includes('.knox-gui-knoxchat-item'));
		assert.ok(css.includes('.knox-gui-add-model-form'));
		assert.ok(css.includes('.knox-gui-page-intro'));
		assert.ok(css.includes('.knox-gui-lump-shell'));
		assert.ok(css.includes('.knox-gui-diff-hunk-head'));
		assert.ok(css.includes('.knox-gui-config-card'));
		assert.ok(css.includes('.knox-gui-chart'));
		assert.ok(css.includes('width: 32px'));
		assert.ok(css.includes('.knox-gui-graph-force-mount'));
		assert.ok(css.includes('.knox-gui-diff-word-alt'));
		assert.ok(css.includes('.knox-gui-chart-tooltip'));
		assert.ok(css.includes('.odp-chip'));
		assert.ok(css.includes('.pierre-diff-container'));
		assert.ok(css.includes('.knox-gui-stats-billing'));
		assert.ok(!css.includes('.knox-gui-stats-table'));
		assert.ok(css.includes('.knox-gui-fatal'));
		assert.ok(css.includes('.knox-gui-tabs'));
		assert.ok(css.includes('.knox-gui-find'));
		assert.ok(css.includes('.knox-gui-find.is-closed'));
		assert.ok(css.includes('.knox-gui-text-dialog'));
		assert.ok(css.includes('.knox-gui-alert-dialog'));
		assert.ok(css.includes('.knox-gui-alert-dialog-btn.is-destructive'));
		assert.ok(css.includes('.knox-gui-image-viewer-img'));
		assert.ok(css.includes('.knox-gui-add-model-toggle'));
		assert.ok(css.includes('.knox-gui-add-model-form-toggle'));
		assert.ok(css.includes('.knox-gui-xs-hide'));
		assert.ok(css.includes('.knox-gui-page-header-plain'));
		assert.ok(css.includes('.knox-gui-reasoning-body.no-scroll'));
		assert.ok(css.includes('.knox-gui-body-chat'));
		assert.ok(css.includes('overscroll-behavior: contain'));
		assert.ok(css.includes('.knox-gui-turn.last-message'));
		assert.ok(css.includes('.knox-gui-thinking-redacted'));
		assert.ok(css.includes('.knox-gui-stream-anchor'));
		assert.ok(css.includes('width: 36px'));
		assert.ok(css.includes('.knox-gui-ar-short'));
		assert.ok(css.includes('.knox-gui-ask-progress-fill'));
		assert.ok(css.includes('.knox-gui-batch-panel'));
		assert.ok(css.includes('.knox-gui-number-step'));
		assert.ok(css.includes('max-width: 249px'));
		assert.ok(css.includes('max-width: 329px'));
		assert.ok(css.includes('.knox-gui-accept-reject-all'));
		assert.ok(css.includes('.knox-gui-accept-reject-streaming'));
		assert.ok(css.includes('.knox-gui-history-loading'));
		assert.ok(css.includes('.knox-gui-history-list'));
		assert.ok(css.includes('.knox-gui-history-footer'));
		assert.ok(css.includes('.knox-gui-history-footer-icon'));
		assert.ok(css.includes('.knox-gui-history-current'));
		assert.ok(css.includes('.knox-gui-history-row.selected'));
		assert.ok(css.includes('.knox-gui-loading-grid'));
		assert.ok(css.includes('.knox-gui-history-editor .knox-gui-input'));
		assert.ok(css.includes('.knox-sent-frame-inner > .knox-gui-input-wrap'));
		assert.ok(css.includes('max-height: none'));
		assert.ok(css.includes('@keyframes knox-gui-term-appear'));
		assert.ok(css.includes('--knox-primary: #159994'));
		assert.ok(css.includes('--knox-fill: #159994'));
		assert.ok(css.includes('--knox-fill: #0f7a76'));
		assert.ok(css.includes('--knox-accent: #0f7a76'));
		assert.ok(css.includes('.knox-gui-collapse-chevron'));
		assert.ok(css.includes('color: var(--knox-primary, #159994)'));
		assert.ok(css.includes('.knox-gui-term:focus-within'));
		assert.ok(css.includes('.knox-gui-tree-body.is-repo-map'));
		assert.ok(css.includes('.knox-gui-search-line.match .knox-gui-search-ln'));
		assert.ok(css.includes('.knox-gui-search-line:not(.match) .knox-gui-search-code'));
		assert.ok(css.includes('.knox-gui-code-block.knox-gui-code-generic'));
		assert.ok(css.includes('.knox-gui-code-block.knox-gui-code-generic:hover > .knox-gui-code-actions.knox-gui-code-hover'));
		assert.ok(css.includes('.knox-gui.show-file-icons .knox-gui-search-query::before'));
		assert.ok(css.includes('.knox-gui-tree-notice.is-light'));
		assert.ok(css.includes('.knox-gui-ask-choice-desc'));
		assert.ok(css.includes('.knox-gui-tool-permissions > .knox-gui-icon-btn .knox-gui-lump-label'));
		assert.ok(css.includes('.knox-gui-ask-actions > .knox-gui-icon-btn .knox-gui-lump-label'));
		assert.ok(css.includes('.knox-gui-tool-approve'));
		assert.ok(!/\.knox-gui-tool-approve \{[^}]*--vscode-button-background/.test(css));
		assert.ok(css.includes('.knox-gui .rendered-markdown :not(pre) > code'));
		assert.ok(css.includes('.knox-gui-input-bar-icons'));
		assert.ok(css.includes('.knox-gui-model-wrap {\n	flex: 0 1 auto;'));
		assert.ok(css.includes('overflow: visible;'));
		assert.ok(css.includes('.knox-gui-popover-anchored'));
		assert.ok(css.includes('.knox-gui-attach-wrap'));
		assert.ok(css.includes('.knox-gui-attached {\n	margin: 0;'));
		assert.ok(css.includes('.knox-gui-composer-editor-pad {\n	padding: 0;'));
		assert.ok(!css.includes('.knox-gui-attached {\n	margin: 0 2px;'));
		assert.ok(!/\.knox-gui-attached \{[^}]*border-top-left-radius:\s*8px/.test(css));
		assert.ok(css.includes('.knox-gui-attached-collapse'));
		assert.ok(css.includes('transition: max-height 0.3s ease-in-out, opacity 0.3s ease-in-out'));
		assert.ok(css.includes('@media (prefers-reduced-motion: reduce)'));
		assert.ok(css.includes('@property --knox-border-angle'));
		assert.ok(css.includes('from var(--knox-border-angle)'));
		assert.ok(!css.includes('to { transform: rotate(360deg); }'));
	});
});

