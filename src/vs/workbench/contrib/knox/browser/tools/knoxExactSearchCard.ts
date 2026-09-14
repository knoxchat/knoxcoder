/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, isHTMLElement } from '../../../../../base/browser/dom.js';
import { getDefaultHoverDelegate } from '../../../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { localize } from '../../../../../nls.js';
import { knoxGuiIconClass } from '../knoxGuiIcons.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { ILanguageService } from '../../../../../editor/common/languages/language.js';
import { PLAINTEXT_LANGUAGE_ID } from '../../../../../editor/common/languages/modesRegistry.js';
import { tokenizeToString } from '../../../../../editor/common/languages/textToHtmlTokenizer.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IKnoxContextItem, IKnoxToolCallState } from '../../common/knoxChatTypes.js';
import { IKnoxGuiBridge } from '../../common/knoxGuiProtocol.js';
import {
	knoxEscapeHtml,
	knoxExactSearchQuery,
	knoxExactSearchStats,
	knoxExtractExactSearchContent,
	knoxHighlightSearchQuery,
	knoxParseExactSearchResults,
	IKnoxSearchMatch,
} from '../../common/knoxExactSearch.js';
import { knoxToolIsStreaming } from '../../common/knoxToolCard.js';
import { knoxShowFile, renderKnoxClickableFilePath } from '../markdown/knoxClickablePath.js';
import { knoxSetTokenizedHtml } from '../knoxTrustedTypes.js';
import { IKnoxToolUiState } from './knoxToolCard.js';

export interface IKnoxExactSearchServices {
	language: ILanguageService;
	hover: IHoverService;
	bridge: IKnoxGuiBridge;
	workspace: IWorkspaceContextService;
}

export function renderKnoxExactSearchCard(
	parent: HTMLElement,
	state: IKnoxToolCallState,
	output: readonly IKnoxContextItem[],
	toolId: string,
	ui: IKnoxToolUiState,
	services: IKnoxExactSearchServices,
	store: DisposableStore,
	onDidChangeHeight: () => void,
): void {
	const query = knoxExactSearchQuery(state.parsedArgs);
	const streaming = knoxToolIsStreaming(state.status);
	const results = knoxParseExactSearchResults(knoxExtractExactSearchContent(output));
	const stats = knoxExactSearchStats(results);
	const expanded = !ui.searchCollapsed.has(toolId);

	const root = append(parent, $('.knox-search-card'));
	const header = append(root, $('.knox-search-header'));
	const left = append(header, $('.knox-search-header-left'));
	const icon = append(left, $('span.knox-search-icon'));
	icon.className = knoxGuiIconClass('magnifying-glass');
	icon.setAttribute('aria-hidden', 'true');
	append(left, $('span.knox-search-title')).textContent = localize('knox.exactSearch', "Exact Search");
	append(left, $('code.knox-search-query')).textContent = query || '…';
	const statsEl = append(left, $('span.knox-search-stats'));
	statsEl.textContent = streaming
		? localize('knox.searching', "Searching…")
		: stats.files > 0
			? localize('knox.matchesInFiles', "{0} match(es) in {1} file(s)", stats.matches, stats.files)
			: localize('knox.noMatchesFound', "No matches found");

	const toggle = append(header, $<HTMLButtonElement>('button.knox-icon-button.knox-search-toggle'));
	toggle.type = 'button';
	toggle.setAttribute('aria-expanded', String(expanded));
	const hint = expanded
		? localize('knox.hideSearchResults', "Hide search results")
		: localize('knox.showSearchResults', "Show search results");
	toggle.setAttribute('aria-label', hint);
	append(toggle, $('span')).className = knoxGuiIconClass(expanded ? 'lucide-chevron-up' : 'lucide-chevron-down');
	store.add(services.hover.setupManagedHover(getDefaultHoverDelegate('mouse'), toggle, hint));
	store.add(addDisposableListener(toggle, 'click', e => {
		e.preventDefault();
		e.stopPropagation();
		if (ui.searchCollapsed.has(toolId)) {
			ui.searchCollapsed.delete(toolId);
		} else {
			ui.searchCollapsed.add(toolId);
		}
		onDidChangeHeight();
	}));

	if (!expanded) {
		return;
	}

	const body = append(root, $('.knox-search-body'));
	if (streaming) {
		append(body, $('div.knox-search-empty')).textContent = localize('knox.searchingRepository', "Searching repository…");
		return;
	}
	if (!results.length) {
		append(body, $('div.knox-search-empty')).textContent = localize('knox.noMatchesFound', "No matches found");
		return;
	}

	for (const file of results) {
		renderFile(body, file, query, services, store);
	}
}

function renderFile(
	parent: HTMLElement,
	file: IKnoxSearchMatch,
	query: string,
	services: IKnoxExactSearchServices,
	store: DisposableStore,
): void {
	const section = append(parent, $('.knox-search-file'));
	const heading = append(section, $('.knox-search-file-header'));
	renderKnoxClickableFilePath(heading, file.filePath, { showIcon: true }, services.bridge, services.workspace, store);
	append(heading, $('span.knox-search-lang')).textContent = file.language;

	for (const line of file.lines) {
		const row = append(section, $<HTMLButtonElement>('button.knox-search-line'));
		row.type = 'button';
		row.classList.toggle('match', line.isMatch);
		row.title = `${file.filePath}:${line.lineNum}`;
		append(row, $('span.knox-search-gutter')).textContent = String(line.lineNum);
		const code = append(row, $('code.knox-search-code'));
		const escaped = knoxEscapeHtml(line.content);
		const html = line.isMatch ? knoxHighlightSearchQuery(escaped, query) : escaped;
		setHtml(code, html);
		store.add(addDisposableListener(row, 'click', e => {
			e.preventDefault();
			e.stopPropagation();
			knoxShowFile(services.bridge, services.workspace, file.filePath, {
				startLine: line.lineNum,
				endLine: line.lineNum,
			});
		}));
		if (line.content) {
			void highlightLine(code, line.content, file.language, file.filePath, line.isMatch ? query : '', services.language);
		}
	}
}

function knoxLanguageId(languageService: ILanguageService, alias: string, filepath: string): string {
	if (alias && alias !== 'plaintext') {
		const id = languageService.getLanguageIdByLanguageName(alias)
			?? languageService.getLanguageIdByLanguageName(alias.toLowerCase());
		if (id) {
			return id;
		}
	}
	if (filepath) {
		const guessed = languageService.guessLanguageIdByFilepathOrFirstLine(URI.file(filepath));
		if (guessed) {
			return guessed;
		}
	}
	return PLAINTEXT_LANGUAGE_ID;
}

async function highlightLine(
	host: HTMLElement,
	code: string,
	language: string,
	filepath: string,
	query: string,
	languageService: ILanguageService,
): Promise<void> {
	try {
		const languageId = knoxLanguageId(languageService, language, filepath);
		const tokenized = await tokenizeToString(languageService, code, languageId);
		const inner = extractTokenizedSource(tokenized) ?? knoxEscapeHtml(code);
		setHtml(host, knoxHighlightSearchQuery(inner, query));
	} catch {
		// Keep the escaped fallback already painted.
	}
}

function extractTokenizedSource(html: string): string | undefined {
	const match = html.match(/<div class="monaco-tokenized-source">([\s\S]*)<\/div>/);
	return match?.[1];
}

function setHtml(host: HTMLElement, html: string): void {
	knoxSetTokenizedHtml(host, html);
	if (isHTMLElement(host.firstElementChild) && host.children.length === 1) {
		host.firstElementChild.classList.add('knox-search-tokens');
	}
}
