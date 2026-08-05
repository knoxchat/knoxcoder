/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import fs from 'fs';
import path from 'path';
import { generateFonts, FontAssetType } from 'fantasticon';
import SVGFixer from 'oslllo-svg-fixer';

const root = path.join(import.meta.dirname, '..', '..');
const codiconsLibraryPath = path.join(root, 'src', 'vs', 'base', 'common', 'codiconsLibrary.ts');
const lucideIconsDir = path.join(root, 'node_modules', 'lucide-static', 'icons');
const knoxLucideDir = path.join(root, 'src', 'vs', 'workbench', 'browser', 'media', 'knox', 'lucide');
const knoxTtfPath = path.join(knoxLucideDir, 'codicon.ttf');
const runtimeTtfPath = path.join(root, 'src', 'vs', 'base', 'browser', 'ui', 'codicons', 'codicon', 'codicon.ttf');
const iconMapPath = path.join(knoxLucideDir, 'icon-map.json');

/**
 * Codicon id → Lucide icon basename (without .svg) for common mismatches.
 * Exact `{id}.svg` matches are preferred when no alias is present.
 */
const LUCIDE_ALIASES: Record<string, string> = {
	'account': 'circle-user',
	'activate-breakpoints': 'circle-dot',
	'add': 'plus',
	'add-compact': 'plus',
	'add-small': 'plus',
	'agent': 'bot',
	'agent-compact': 'bot',
	'alert': 'triangle-alert',
	'array': 'brackets',
	'arrow-both': 'arrow-left-right',
	'arrow-circle-down': 'circle-arrow-down',
	'arrow-circle-left': 'circle-arrow-left',
	'arrow-circle-right': 'circle-arrow-right',
	'arrow-circle-up': 'circle-arrow-up',
	'arrow-small-down': 'arrow-down',
	'arrow-small-left': 'arrow-left',
	'arrow-small-right': 'arrow-right',
	'arrow-small-up': 'arrow-up',
	'arrow-swap': 'arrow-left-right',
	'ask': 'message-circle-question',
	'ask-compact': 'message-circle-question',
	'assist-export': 'upload',
	'assist-import': 'download',
	'assist-sparkle': 'sparkles',
	'assist-sparkle-error': 'sparkles',
	'assist-sparkle-warning': 'sparkles',
	'assistant': 'bot',
	'assistant-blocked': 'bot-off',
	'assistant-compact': 'bot',
	'assistant-error': 'bot',
	'assistant-in-progress': 'loader-circle',
	'assistant-large': 'bot',
	'assistant-not-connected': 'bot-off',
	'assistant-snooze': 'bot',
	'assistant-success': 'bot',
	'assistant-unavailable': 'bot-off',
	'assistant-warning': 'bot',
	'assistant-warning-large': 'bot',
	'attach': 'paperclip',
	'attach-compact': 'paperclip',
	'azure': 'cloud',
	'azure-devops': 'cloud',
	'beaker': 'flask-conical',
	'beaker-compact': 'flask-conical',
	'beaker-stop': 'flask-conical-off',
	'bell-dot': 'bell',
	'bell-slash': 'bell-off',
	'bell-slash-dot': 'bell-off',
	'blank': 'circle',
	'bracket-dot': 'brackets',
	'bracket-error': 'brackets',
	'broadcast': 'radio',
	'browser': 'globe',
	'build': 'hammer',
	'call-incoming': 'phone-incoming',
	'call-outgoing': 'phone-outgoing',
	'check-all': 'check-check',
	'check-compact': 'check',
	'checklist': 'list-checks',
	'checklist-compact': 'list-checks',
	'chevron-down-compact': 'chevron-down',
	'chevron-left-compact': 'chevron-left',
	'chevron-right-compact': 'chevron-right',
	'chevron-up-compact': 'chevron-up',
	'chip': 'cpu',
	'chrome-close': 'x',
	'chrome-maximize': 'square',
	'chrome-minimize': 'minus',
	'chrome-restore': 'copy',
	'circle-filled': 'circle',
	'circle-filled-compact': 'circle',
	'circle-large': 'circle',
	'circle-large-filled': 'circle',
	'circle-outline': 'circle',
	'circle-slash': 'circle-off',
	'circle-slash-compact': 'circle-off',
	'circle-small-filled': 'circle',
	'circle-small-filled-compact': 'circle-small',
	'claude': 'sparkles',
	'clear-all': 'brush-cleaning',
	'clippy': 'clipboard',
	'clockface': 'clock',
	'clone': 'copy',
	'close': 'x',
	'close-all': 'x',
	'close-compact': 'x',
	'cloud-compact': 'cloud',
	'cloud-small': 'cloud',
	'code-oss': 'code',
	'code-review': 'file-search',
	'collapse-all': 'fold-vertical',
	'collapse-all-compact': 'fold-vertical',
	'collection': 'library',
	'collection-small': 'library',
	'color-mode': 'sun-moon',
	'comment': 'message-square',
	'comment-compact': 'message-square',
	'comment-discussion': 'messages-square',
	'comment-discussion-quote': 'messages-square',
	'comment-discussion-sparkle': 'messages-square',
	'comment-draft': 'message-square-dashed',
	'comment-unresolved': 'message-square-dot',
	'comment-unresolved-compact': 'message-square-dot',
	'compass-active': 'compass',
	'compass-dot': 'compass',
	'coverage': 'pie-chart',
	'cursor': 'mouse-pointer-2',
	'dash': 'minus',
	'dashboard': 'layout-dashboard',
	'debug': 'bug',
	'debug-all': 'bug',
	'debug-alt': 'bug-play',
	'debug-alt-small': 'bug-play',
	'debug-breakpoint-conditional': 'circle-help',
	'debug-breakpoint-conditional-unverified': 'circle-help',
	'debug-breakpoint-data': 'circle-dot',
	'debug-breakpoint-data-unverified': 'circle-dot',
	'debug-breakpoint-function': 'circle-dot',
	'debug-breakpoint-function-unverified': 'circle-dot',
	'debug-breakpoint-log': 'circle-dot',
	'debug-breakpoint-log-unverified': 'circle-dot',
	'debug-breakpoint-unsupported': 'circle-off',
	'debug-connected': 'bug',
	'debug-connected-compact': 'bug',
	'debug-console': 'terminal',
	'debug-continue': 'play',
	'debug-continue-small': 'play',
	'debug-coverage': 'pie-chart',
	'debug-disconnect': 'unplug',
	'debug-disconnect-compact': 'unplug',
	'debug-line-by-line': 'list-ordered',
	'debug-pause': 'pause',
	'debug-rerun': 'rotate-cw',
	'debug-restart': 'rotate-cw',
	'debug-restart-frame': 'rotate-cw',
	'debug-reverse-continue': 'play',
	'debug-stackframe': 'bookmark',
	'debug-stackframe-active': 'bookmark',
	'debug-start': 'play',
	'debug-step-back': 'arrow-left-to-line',
	'debug-step-into': 'arrow-down-to-line',
	'debug-step-out': 'arrow-up-from-line',
	'debug-step-over': 'arrow-right-to-line',
	'debug-stop': 'square',
	'developer-tools': 'wrench',
	'device-camera': 'camera',
	'device-camera-video': 'video',
	'device-mobile': 'smartphone',
	'diff-added': 'plus',
	'diff-ignored': 'eye-off',
	'diff-modified': 'pencil',
	'diff-multiple': 'files',
	'diff-removed': 'minus',
	'diff-renamed': 'arrow-right-left',
	'diff-single': 'file-diff',
	'discard': 'undo-2',
	'edit': 'pencil',
	'edit-code': 'square-pen',
	'edit-compact': 'pencil',
	'edit-session': 'pencil',
	'edit-sparkle': 'sparkles',
	'editor-layout': 'panels-top-left',
	'empty-window': 'square-dashed',
	'error': 'circle-x',
	'error-compact': 'circle-x',
	'error-small': 'circle-x',
	'exclude': 'circle-off',
	'expand-all': 'unfold-vertical',
	'export': 'upload',
	'extensions': 'blocks',
	'extensions-large': 'blocks',
	'eye-closed': 'eye-off',
	'feedback': 'message-circle',
	'file-binary': 'file-digit',
	'file-media': 'file-image',
	'file-media-compact': 'file-image',
	'file-pdf': 'file-text',
	'file-submodule': 'file-code',
	'file-symlink-directory': 'folder-symlink',
	'file-symlink-file': 'file-symlink',
	'file-zip': 'file-archive',
	'files': 'folder-tree',
	'filter': 'funnel',
	'filter-filled': 'funnel',
	'fold': 'fold-vertical',
	'fold-down': 'chevrons-down',
	'fold-up': 'chevrons-up',
	'folder-active': 'folder',
	'folder-compact': 'folder',
	'folder-library': 'library',
	'folder-opened': 'folder-open',
	'folder-opened-compact': 'folder-open',
	'game': 'gamepad-2',
	'gear': 'settings',
	'gear-compact': 'settings',
	'gist': 'code',
	'gist-fork': 'git-fork',
	'gist-private': 'lock',
	'gist-secret': 'lock',
	'git-branch-changes': 'git-branch',
	'git-branch-compact': 'git-branch',
	'git-branch-conflicts': 'git-branch',
	'git-branch-staged-changes': 'git-branch',
	'git-commit': 'git-commit-horizontal',
	'git-fetch': 'download',
	'git-pull-request-comment': 'git-pull-request',
	'git-pull-request-done': 'git-pull-request',
	'git-pull-request-error': 'git-pull-request',
	'git-pull-request-go-to-changes': 'git-pull-request-arrow',
	'git-pull-request-new-changes': 'git-pull-request-create',
	'git-stash': 'archive',
	'git-stash-apply': 'archive-restore',
	'git-stash-pop': 'archive-restore',
	'github-action': 'zap',
	'github-alt': 'code-2',
	'github-inverted': 'code-2',
	'github-project': 'folder-kanban',
	'go-to-editing-session': 'pencil',
	'go-to-search': 'search',
	'grabber': 'grip',
	'graph': 'chart-bar',
	'graph-left': 'chart-bar',
	'graph-line': 'chart-line',
	'graph-scatter': 'chart-scatter',
	'gripper': 'grip-vertical',
	'group-by-ref-type': 'group',
	'heart-filled': 'heart',
	'horizontal-rule': 'minus',
	'hubot': 'bot',
	'important': 'circle-alert',
	'important-compact': 'circle-alert',
	'index-zero': 'list-ordered',
	'insert': 'between-horizontal-start',
	'inspect': 'scan-search',
	'issue-draft': 'circle-dashed',
	'issue-reopened': 'refresh-cw',
	'issues': 'circle-dot',
	'jersey': 'shirt',
	'json': 'braces',
	'kebab-vertical': 'ellipsis-vertical',
	'keyboard-tab': 'arrow-right-to-line',
	'keyboard-tab-above': 'arrow-up-to-line',
	'keyboard-tab-below': 'arrow-down-to-line',
	'law': 'scale',
	'layers-active': 'layers',
	'layers-dot': 'layers',
	'layout-activitybar-left': 'panel-left',
	'layout-activitybar-right': 'panel-right',
	'layout-centered': 'focus',
	'layout-menubar': 'panel-top',
	'layout-panel': 'panel-bottom',
	'layout-panel-center': 'panel-bottom',
	'layout-panel-dock': 'panel-bottom',
	'layout-panel-justify': 'panel-bottom',
	'layout-panel-off': 'panel-bottom-close',
	'layout-panel-right': 'panel-right',
	'layout-sidebar-left': 'panel-left',
	'layout-sidebar-left-dock': 'panel-left',
	'layout-sidebar-left-off': 'panel-left-close',
	'layout-sidebar-right': 'panel-right',
	'layout-sidebar-right-dock': 'panel-right',
	'layout-sidebar-right-off': 'panel-right-close',
	'layout-statusbar': 'panel-bottom',
	'library-compact': 'library',
	'lightbulb-autofix': 'lightbulb',
	'lightbulb-compact': 'lightbulb',
	'lightbulb-empty': 'lightbulb',
	'lightbulb-sparkle': 'sparkles',
	'link-external': 'external-link',
	'list-flat': 'list',
	'list-selection': 'list-checks',
	'list-unordered': 'list',
	'live-share': 'share-2',
	'loading': 'loader-circle',
	'loading-compact': 'loader-circle',
	'location': 'map-pin',
	'lock-small': 'lock',
	'logo-github': 'code-2',
	'mail-read': 'mail-open',
	'mail-reply': 'reply',
	'map-filled': 'map',
	'map-vertical': 'map',
	'map-vertical-filled': 'map',
	'markdown': 'book-open-text',
	'mention': 'at-sign',
	'merge-into': 'git-merge',
	'mic-filled': 'mic',
	'mirror': 'copy',
	'more': 'ellipsis',
	'mortar-board': 'graduation-cap',
	'multiple-windows': 'app-window',
	'mute': 'volume-x',
	'new-collection': 'library',
	'new-file': 'file-plus',
	'new-folder': 'folder-plus',
	'new-session': 'plus',
	'newline': 'corner-down-left',
	'no-newline': 'corner-down-left',
	'note': 'sticky-note',
	'notebook-template': 'book-template',
	'octoface': 'code-2',
	'open-in-product': 'external-link',
	'open-in-window': 'app-window',
	'open-preview': 'eye',
	'openai': 'sparkles',
	'organization': 'users',
	'output': 'panel-bottom',
	'paintcan': 'paint-bucket',
	'pass': 'circle-check',
	'pass-compact': 'circle-check',
	'pass-filled': 'circle-check',
	'pass-filled-compact': 'circle-check',
	'percentage': 'percent',
	'person': 'user',
	'person-add': 'user-plus',
	'pinned': 'pin',
	'pinned-dirty': 'pin',
	'preserve-case': 'case-sensitive',
	'preview': 'eye',
	'primitive-square': 'square',
	'project': 'folder-kanban',
	'project-compact': 'folder-kanban',
	'pulse': 'activity',
	'python': 'file-code',
	'question': 'circle-help',
	'quotes': 'quote',
	'reactions': 'smile',
	'record': 'circle',
	'record-keys': 'keyboard',
	'record-keys-compact': 'keyboard',
	'record-small': 'circle',
	'references': 'link-2',
	'refresh': 'refresh-cw',
	'refresh-compact': 'refresh-cw',
	'remote': 'cloud',
	'remote-compact': 'cloud',
	'remote-explorer': 'hard-drive',
	'remove': 'minus',
	'remove-small': 'minus',
	'rename': 'pencil',
	'repo': 'book-marked',
	'repo-clone': 'copy',
	'repo-compact': 'book-marked',
	'repo-fetch': 'download',
	'repo-force-push': 'upload',
	'repo-forked-compact': 'git-fork',
	'repo-pinned': 'book-marked',
	'repo-pull': 'download',
	'repo-push': 'upload',
	'repo-selected': 'book-marked',
	'repo-sync': 'refresh-cw',
	'report': 'flag',
	'request-changes': 'message-square-warning',
	'right-panel-hide': 'panel-right-close',
	'right-panel-show': 'panel-right-open',
	'robot': 'bot',
	'rocket-compact': 'rocket',
	'root-folder': 'folder',
	'root-folder-opened': 'folder-open',
	'ruby': 'gem',
	'run-above': 'play',
	'run-all': 'play',
	'run-all-coverage': 'pie-chart',
	'run-below': 'play',
	'run-compact': 'play',
	'run-coverage': 'pie-chart',
	'run-errors': 'circle-alert',
	'run-with-deps': 'play',
	'save-as': 'save',
	'screen-cut': 'scissors',
	'screen-full': 'maximize',
	'screen-normal': 'minimize',
	'search-compact': 'search',
	'search-fuzzy': 'search',
	'search-large': 'search',
	'search-sparkle': 'search',
	'search-stop': 'search-x',
	'send-to-remote-agent': 'send',
	'server-environment': 'server',
	'server-process': 'server',
	'session-in-progress': 'loader-circle',
	'session-in-progress-compact': 'loader-circle',
	'settings-compact': 'settings',
	'settings-gear': 'settings',
	'share-window': 'share-2',
	'shield-compact': 'shield',
	'skip': 'fast-forward',
	'smiley': 'smile',
	'snake': 'snail',
	'sort-precedence': 'arrow-up-down',
	'source-control': 'git-branch',
	'sparkle': 'sparkles',
	'sparkle-compact': 'sparkles',
	'sparkle-filled': 'sparkles',
	'split-horizontal': 'separator-horizontal',
	'split-vertical': 'separator-vertical',
	'star-full': 'star',
	'surround-with': 'parentheses',
	'symbol-boolean': 'toggle-left',
	'symbol-class': 'component',
	'symbol-color': 'palette',
	'symbol-color-compact': 'palette',
	'symbol-constant': 'pi',
	'symbol-enum': 'list',
	'symbol-enum-member': 'list',
	'symbol-field': 'rectangle-ellipsis',
	'symbol-file': 'file',
	'symbol-interface': 'waypoints',
	'symbol-key': 'key',
	'symbol-keyword': 'key-round',
	'symbol-method': 'box',
	'symbol-method-arrow': 'box',
	'symbol-misc': 'shapes',
	'symbol-module': 'boxes',
	'symbol-numeric': 'hash',
	'symbol-operator': 'sigma',
	'symbol-parameter': 'sliders-horizontal',
	'symbol-property': 'wrench',
	'symbol-reference': 'link-2',
	'symbol-ruler': 'ruler',
	'symbol-snippet': 'scissors',
	'symbol-string': 'whole-word',
	'symbol-structure': 'braces',
	'sync-compact': 'refresh-cw',
	'sync-ignored': 'refresh-cw-off',
	'tasklist': 'list-todo',
	'terminal-bash': 'terminal',
	'terminal-cmd': 'terminal',
	'terminal-compact': 'terminal',
	'terminal-debian': 'terminal',
	'terminal-git-bash': 'terminal',
	'terminal-linux': 'terminal',
	'terminal-powershell': 'terminal',
	'terminal-secure': 'terminal',
	'terminal-tmux': 'terminal',
	'terminal-ubuntu': 'terminal',
	'text-size': 'a-large-small',
	'thinking': 'brain',
	'three-bars': 'menu',
	'thumbsdown': 'thumbs-down',
	'thumbsdown-filled': 'thumbs-down',
	'thumbsup': 'thumbs-up',
	'thumbsup-filled': 'thumbs-up',
	'tool': 'wrench',
	'tools': 'wrench',
	'trash': 'trash-2',
	'triangle-down': 'triangle',
	'triangle-left': 'triangle',
	'triangle-up': 'triangle',
	'twitter': 'megaphone',
	'type-hierarchy': 'network',
	'type-hierarchy-sub': 'network',
	'type-hierarchy-super': 'network',
	'unarchive': 'archive-restore',
	'unfold': 'unfold-vertical',
	'ungroup-by-ref-type': 'ungroup',
	'unlock': 'lock-open',
	'unmute': 'volume-2',
	'unpin': 'pin-off',
	'unverified': 'badge-help',
	'variable-group': 'variable',
	'verified': 'badge-check',
	'verified-filled': 'badge-check',
	'versions': 'history',
	'vm': 'monitor',
	'vm-active': 'monitor',
	'vm-compact': 'monitor',
	'vm-connect': 'monitor-up',
	'vm-outline': 'monitor',
	'vm-pending': 'monitor',
	'vm-running': 'monitor-play',
	'vm-small': 'monitor',
	'voice-mode': 'mic',
	'voice-mode-compact': 'mic',
	'vr': 'glasses',
	'vscode': 'code',
	'vscode-insiders': 'code',
	'vscode-insiders-outline': 'code',
	'vscode-outline': 'code',
	'warning-compact': 'triangle-alert',
	'whitespace': 'space',
	'window': 'app-window',
	'window-active': 'app-window',
	'window-compact': 'app-window',
	'word-wrap': 'wrap-text',
	'workspace-trusted': 'shield-check',
	'workspace-unknown': 'shield-question',
	'workspace-untrusted': 'shield-alert',
	'worktree': 'folder-tree',
	'worktree-compact': 'folder-tree',
	'worktree-small': 'folder-tree',
};

interface CodiconEntry {
	id: string;
	codepoint: number;
}

function parseCodiconsLibrary(sourceText: string): CodiconEntry[] {
	const re = /register\('([^']+)',\s*(0x[0-9a-fA-F]+)\)/g;
	const byCodepoint = new Map<number, string>();
	let match: RegExpExecArray | null;
	while ((match = re.exec(sourceText)) !== null) {
		const id = match[1];
		const codepoint = Number.parseInt(match[2], 16);
		if (!byCodepoint.has(codepoint)) {
			byCodepoint.set(codepoint, id);
		}
	}
	return [...byCodepoint.entries()]
		.map(([codepoint, id]) => ({ id, codepoint }))
		.sort((a, b) => a.codepoint - b.codepoint);
}

function resolveLucideId(codiconId: string, available: Set<string>): { lucideId: string; mapped: boolean } {
	const alias = LUCIDE_ALIASES[codiconId];
	if (alias && available.has(alias)) {
		return { lucideId: alias, mapped: true };
	}
	if (available.has(codiconId)) {
		return { lucideId: codiconId, mapped: true };
	}
	// Strip common size/state suffixes and retry
	const stripped = codiconId
		.replace(/-compact$/u, '')
		.replace(/-small$/u, '')
		.replace(/-large$/u, '')
		.replace(/-filled$/u, '')
		.replace(/-outline$/u, '');
	if (stripped !== codiconId) {
		const viaAlias = LUCIDE_ALIASES[stripped];
		if (viaAlias && available.has(viaAlias)) {
			return { lucideId: viaAlias, mapped: true };
		}
		if (available.has(stripped)) {
			return { lucideId: stripped, mapped: true };
		}
	}
	return { lucideId: 'circle', mapped: false };
}

function normalizeSvg(svg: string): string {
	let out = svg;
	// Drop HTML comments / license headers
	out = out.replace(/<!--[\s\S]*?-->/g, '');
	// Force consistent Lucide font-friendly attributes
	if (!/viewBox=["']0 0 24 24["']/.test(out)) {
		out = out.replace(/viewBox=["'][^"']*["']/, 'viewBox="0 0 24 24"');
		if (!/viewBox=/.test(out)) {
			out = out.replace(/<svg\b/, '<svg viewBox="0 0 24 24"');
		}
	}
	if (/stroke-width=["'][^"']*["']/.test(out)) {
		out = out.replace(/stroke-width=["'][^"']*["']/g, 'stroke-width="2"');
	} else {
		out = out.replace(/<svg\b/, '<svg stroke-width="2"');
	}
	out = out.replace(/stroke=["']currentColor["']/g, 'stroke="#000"');
	out = out.replace(/fill=["']currentColor["']/g, 'fill="#000"');
	return out.trim() + '\n';
}

async function main(): Promise<void> {
	if (!fs.existsSync(lucideIconsDir)) {
		throw new Error(`lucide-static icons not found at ${lucideIconsDir}. Run npm install.`);
	}
	if (!fs.existsSync(codiconsLibraryPath)) {
		throw new Error(`codiconsLibrary.ts not found at ${codiconsLibraryPath}`);
	}

	const available = new Set(
		fs.readdirSync(lucideIconsDir)
			.filter(name => name.endsWith('.svg'))
			.map(name => name.slice(0, -4))
	);

	const library = fs.readFileSync(codiconsLibraryPath, 'utf8');
	const entries = parseCodiconsLibrary(library);

	const workDir = path.join(root, '.build', 'knox-lucide-font');
	const rawDir = path.join(workDir, 'raw');
	const fixedDir = path.join(workDir, 'fixed');
	const outDir = path.join(workDir, 'out');

	fs.rmSync(workDir, { recursive: true, force: true });
	fs.mkdirSync(rawDir, { recursive: true });
	fs.mkdirSync(fixedDir, { recursive: true });
	fs.mkdirSync(outDir, { recursive: true });
	fs.mkdirSync(knoxLucideDir, { recursive: true });
	fs.mkdirSync(path.dirname(runtimeTtfPath), { recursive: true });

	const codepoints: Record<string, number> = {};
	const mapDetails: Array<{ id: string; codepoint: string; lucide: string; mapped: boolean }> = [];
	let mappedCount = 0;
	let fallbackCount = 0;

	for (const entry of entries) {
		const resolved = resolveLucideId(entry.id, available);
		const lucideId = resolved.lucideId;
		const isIntentionalCircle = entry.id === 'circle' || entry.id.includes('circle') || entry.id === 'blank' || entry.id.startsWith('record');
		const mapped = resolved.mapped && !(lucideId === 'circle' && !isIntentionalCircle);
		if (mapped) {
			mappedCount++;
		} else {
			fallbackCount++;
		}

		const srcSvgPath = path.join(lucideIconsDir, `${lucideId}.svg`);
		if (!fs.existsSync(srcSvgPath)) {
			throw new Error(`Missing Lucide SVG for ${entry.id} → ${lucideId}`);
		}

		// Fantasticon icon id = filename; keep original codicon id for codepoint mapping
		const destName = `${entry.id}.svg`;
		const normalized = normalizeSvg(fs.readFileSync(srcSvgPath, 'utf8'));
		fs.writeFileSync(path.join(rawDir, destName), normalized, 'utf8');
		codepoints[entry.id] = entry.codepoint;
		mapDetails.push({
			id: entry.id,
			codepoint: '0x' + entry.codepoint.toString(16),
			lucide: lucideId,
			mapped,
		});
	}

	// Convert stroke outlines to filled paths so svgicons2svgfont emits real glyphs
	await SVGFixer(rawDir, fixedDir, { showProgressBar: false }).fix();

	await generateFonts({
		inputDir: fixedDir,
		outputDir: outDir,
		name: 'codicon',
		fontTypes: [FontAssetType.TTF],
		assetTypes: [],
		codepoints,
		normalize: true,
		fontHeight: 1000,
		descent: 150,
		selector: '.codicon',
		prefix: 'codicon',
	});

	const generatedTtf = path.join(outDir, 'codicon.ttf');
	if (!fs.existsSync(generatedTtf)) {
		throw new Error(`fantasticon did not produce ${generatedTtf}`);
	}

	fs.copyFileSync(generatedTtf, knoxTtfPath);
	fs.copyFileSync(generatedTtf, runtimeTtfPath);

	const size = fs.statSync(knoxTtfPath).size;
	const outputs = [knoxTtfPath, runtimeTtfPath];

	// Keep compiled out/ in sync for ./scripts/code.sh without a full recompile.
	const outDirRoot = path.join(root, 'out');
	if (fs.existsSync(outDirRoot)) {
		const outRuntimeTtf = path.join(outDirRoot, 'vs', 'base', 'browser', 'ui', 'codicons', 'codicon', 'codicon.ttf');
		const outKnoxDir = path.join(outDirRoot, 'vs', 'workbench', 'browser', 'media', 'knox', 'lucide');
		fs.mkdirSync(path.dirname(outRuntimeTtf), { recursive: true });
		fs.mkdirSync(outKnoxDir, { recursive: true });
		fs.copyFileSync(generatedTtf, outRuntimeTtf);
		fs.copyFileSync(generatedTtf, path.join(outKnoxDir, 'codicon.ttf'));
		outputs.push(outRuntimeTtf, path.join(outKnoxDir, 'codicon.ttf'));
	}

	const iconMap = {
		generatedAt: new Date().toISOString(),
		total: entries.length,
		mapped: mappedCount,
		fallback: fallbackCount,
		ttfBytes: size,
		outputs,
		icons: mapDetails,
	};
	fs.writeFileSync(iconMapPath, JSON.stringify(iconMap, null, '\t') + '\n', 'utf8');
	if (fs.existsSync(outDirRoot)) {
		fs.copyFileSync(iconMapPath, path.join(outDirRoot, 'vs', 'workbench', 'browser', 'media', 'knox', 'lucide', 'icon-map.json'));
	}

	console.log(`[knox-lucide] mapped: ${mappedCount}`);
	console.log(`[knox-lucide] fallback: ${fallbackCount}`);
	console.log(`[knox-lucide] output: ${knoxTtfPath}`);
	console.log(`[knox-lucide] runtime: ${runtimeTtfPath}`);
	console.log(`[knox-lucide] size: ${size} bytes`);
}

main().catch(err => {
	console.error('[knox-lucide] failed:', err);
	process.exitCode = 1;
});
