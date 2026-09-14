/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append } from '../../../../base/browser/dom.js';
import { FileAccess } from '../../../../base/common/network.js';
import { Icon } from '../../../../platform/action/common/action.js';
import type { KnoxAgentActivityKind } from '../common/knoxAgentActivity.js';
import type { IKnoxToolCallState } from '../common/knoxChatTypes.js';

/**
 * Live GUI chrome icons from `knox/gui/src/svg-icons`, InputToolbar, and
 * lucide-react used by the product UI. CSS classes use background-image / mask
 * so Trusted Types never sees SVG HTML.
 */
export const KNOX_GUI_ICON_NAMES = [
	'activity',
	'add',
	'alert-circle',
	'alert-triangle',
	'apply',
	'archive',
	'arrow-down',
	'arrow-left',
	'arrow-right',
	'arrow-right-start-on-rectangle',
	'arrow-rotate',
	'arrow-up',
	'arrow-up-right',
	'arrow-uturn-left',
	'arrow-uturn-right',
	'at',
	'bar-chart-3',
	'bolt',
	'book',
	'bookmark',
	'bot',
	'brain',
	'brain-icon',
	'calendar',
	'cancel',
	'chat-bubble',
	'check',
	'check-check',
	'check-circle',
	'check-circle-2',
	'check-square',
	'checkpoints',
	'chevron-down',
	'chevron-down-icon',
	'chevron-left',
	'chevron-right',
	'chevron-up',
	'chevron-up-down',
	'chevron-up-icon',
	'chip-ai',
	'circle-dot',
	'circle-path',
	'circle-slash',
	'clipboard-document',
	'clipboard-list',
	'clock',
	'code-icon',
	'commit',
	'compass',
	'copied',
	'copy',
	'crosshair',
	'database',
	'debugger',
	'delete',
	'discord',
	'doc-icon',
	'document-arrow-up',
	'double-arrow-down',
	'double-arrow-right',
	'down-chevron',
	'download',
	'exclamation-circle',
	'exclamation-triangle',
	'eye',
	'eye-off',
	'file-down',
	'file-json',
	'file-pen-line',
	'file-text',
	'file-warning',
	'files',
	'flag',
	'flask-conical',
	'folder',
	'folder-open',
	'generation',
	'git-branch',
	'git-commit',
	'git-compare',
	'git-diff',
	'git-merge',
	'git-pull-request',
	'github',
	'globe',
	'globe-alt',
	'google',
	'hammer',
	'hard-drive',
	'hash',
	'heart-pulse',
	'history',
	'image',
	'image-ai',
	'info-hover',
	'information-circle',
	'insert',
	'knox-logo',
	'knox-view',
	'layers',
	'lightbulb',
	'link',
	'list-checks',
	'list-todo',
	'loader-2',
	'lucide-arrow-down',
	'lucide-arrow-left',
	'lucide-arrow-right',
	'lucide-arrow-up',
	'lucide-brain',
	'lucide-check',
	'lucide-chevron-down',
	'lucide-chevron-right',
	'lucide-chevron-up',
	'lucide-copy',
	'lucide-database',
	'lucide-download',
	'lucide-file',
	'lucide-folder',
	'lucide-folder-open',
	'lucide-globe',
	'lucide-history',
	'lucide-image',
	'lucide-info',
	'lucide-search',
	'lucide-settings',
	'lucide-terminal',
	'lucide-user',
	'magnifying-glass',
	'maximize-2',
	'memory',
	'memory-graph',
	'memory-sessions',
	'mention',
	'message-circle-question',
	'message-square',
	'minimize-2',
	'minus',
	'minus-circle',
	'models',
	'monitor',
	'new-chat',
	'newspaper',
	'package',
	'panel-left-close',
	'panel-left-open',
	'paperclip',
	'pause',
	'pause-circle',
	'pencil-square',
	'pin',
	'pin-off',
	'play',
	'plus',
	'postgres',
	'problems',
	'prompt',
	'prompts',
	'redo-2',
	'refresh-cw',
	'restore',
	'rotate-ccw',
	'rotate-cw',
	'ruler',
	'rules',
	'save',
	'scan-search',
	'scroll-down',
	'select-all',
	'send',
	'settings',
	'share',
	'share-2',
	'shield',
	'shield-alert',
	'shield-check',
	'sliders-horizontal',
	'sparkles',
	'spinner',
	'split',
	'square',
	'star',
	'stop',
	'table-cells',
	'tag',
	'target',
	'terminal',
	'test-tube',
	'thumbs-down',
	'timer',
	'tool',
	'tools',
	'trash',
	'trash-2',
	'trending-up',
	'tree',
	'type',
	'undo-2',
	'unselect',
	'upload',
	'user-outline',
	'user-solid',
	'wand-2',
	'wrap-text',
	'wrench',
	'x',
	'x-circle',
	'x-mark',
	'zap',
] as const;

export type KnoxGuiIconName = typeof KNOX_GUI_ICON_NAMES[number];

const ICON_NAME_SET = new Set<string>(KNOX_GUI_ICON_NAMES);

export function isKnoxGuiIconName(value: string | undefined): value is KnoxGuiIconName {
	return !!value && ICON_NAME_SET.has(value);
}

export function knoxGuiTitleIcon(fileName: string): Icon {
	const uri = FileAccess.asFileUri(`vs/workbench/contrib/knox/browser/media/icons/${fileName}`);
	return { light: uri, dark: uri };
}

export function knoxGuiIconClass(name: KnoxGuiIconName): string {
	return `knox-gui-icon knox-gui-icon-${name}`;
}

export function knoxGuiIconClasses(name: KnoxGuiIconName): string[] {
	return ['knox-gui-icon', `knox-gui-icon-${name}`];
}

export function appendKnoxGuiIcon(parent: HTMLElement, name: KnoxGuiIconName): HTMLElement {
	const span = append(parent, $('span.knox-gui-icon'));
	span.classList.add(`knox-gui-icon-${name}`);
	span.setAttribute('aria-hidden', 'true');
	return span;
}

export function setKnoxGuiIcon(element: HTMLElement, name: KnoxGuiIconName): void {
	element.className = knoxGuiIconClass(name);
	element.setAttribute('aria-hidden', 'true');
}

/** Same map as `knox/gui/src/components/mainInput/icons.tsx` NAMED_ICONS. */
const NAMED_ICONS: Record<string, KnoxGuiIconName> = {
	file: 'files',
	code: 'code-icon',
	terminal: 'terminal',
	diff: 'git-diff',
	search: 'magnifying-glass',
	url: 'globe-alt',
	open: 'folder-open',
	problems: 'problems',
	folder: 'folder',
	docs: 'doc-icon',
	web: 'globe-alt',
	clipboard: 'clipboard-document',
	database: 'database',
	postgres: 'postgres',
	debugger: 'debugger',
	os: 'chip-ai',
	tree: 'tree',
	'prompt-files': 'prompt',
	'repo-map': 'folder',
	discord: 'discord',
	google: 'google',
	trash: 'delete',
	autonomous: 'bot',
	issue: 'circle-dot',
	share: 'share-2',
	cmd: 'lucide-terminal',
	http: 'lucide-globe',
	commit: 'git-commit',
	review: 'scan-search',
	pr: 'git-pull-request',
	changelog: 'newspaper',
	skills: 'wand-2',
	plan: 'list-todo',
	compact: 'minimize-2',
	clear: 'trash-2',
};

export function knoxNamedIcon(id: string | undefined): KnoxGuiIconName | undefined {
	if (!id) {
		return undefined;
	}
	const bare = id.startsWith('/') ? id.slice(1) : id;
	return NAMED_ICONS[bare] ?? NAMED_ICONS[`/${bare}`];
}

export function knoxNamedIconOr(id: string | undefined, fallback: KnoxGuiIconName): KnoxGuiIconName {
	return knoxNamedIcon(id) ?? fallback;
}

export function knoxToolStatusIconName(status: IKnoxToolCallState['status']): KnoxGuiIconName {
	switch (status) {
		case 'generating':
		case 'calling':
			return 'spinner';
		case 'generated':
			return 'arrow-right';
		case 'done':
			return 'check';
		case 'canceled':
			return 'x-mark';
	}
}

export function knoxActivityKindIcon(kind: KnoxAgentActivityKind): KnoxGuiIconName {
	switch (kind) {
		case 'thinking': return 'sparkles';
		case 'read': return 'file-text';
		case 'search': return 'lucide-search';
		case 'edit': return 'file-pen-line';
		case 'test': return 'test-tube';
		case 'shell': return 'lucide-terminal';
		case 'git': return 'git-branch';
		case 'task': return 'bot';
		case 'ask': return 'message-circle-question';
		case 'reply': return 'message-square';
		default: return 'wrench';
	}
}

export function knoxMemoryTabIcon(tab: string): KnoxGuiIconName {
	switch (tab) {
		case 'overview': return 'brain-icon';
		case 'browser': return 'database';
		case 'sessions': return 'memory-sessions';
		case 'graph': return 'memory-graph';
		case 'settings': return 'settings';
		default: return 'brain-icon';
	}
}

export function knoxCheckpointTabIcon(tab: string): KnoxGuiIconName {
	switch (tab) {
		case 'checkpoints': return 'rotate-ccw';
		case 'timeline': return 'lucide-history';
		case 'analysis': return 'lucide-info';
		case 'dashboard': return 'bar-chart-3';
		case 'share': return 'share-2';
		case 'configuration': return 'lucide-settings';
		default: return 'restore';
	}
}

/** Same lucide set as `knox/gui/src/pages/memory/MemorySettings.tsx`. */
export function knoxMemorySettingsSectionIcon(id: string): KnoxGuiIconName {
	switch (id) {
		case 'general': return 'lucide-settings';
		case 'ebbinghaus':
		case 'working': return 'lucide-brain';
		case 'capacity':
		case 'tiering': return 'package';
		case 'precision': return 'crosshair';
		case 'routing':
		case 'modeTuning':
		case 'budget': return 'sliders-horizontal';
		case 'assembly':
		case 'compression': return 'layers';
		case 'fusion':
		case 'graph':
		case 'features': return 'lucide-search';
		case 'timeouts': return 'timer';
		default: return 'lucide-settings';
	}
}
