/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { clearNode } from '../../../../../base/browser/dom.js';
import { MarkdownString } from '../../../../../base/common/htmlContent.js';
import { DisposableStore, IDisposable } from '../../../../../base/common/lifecycle.js';
import { IMarkdownRendererService } from '../../../../../platform/markdown/browser/markdownRenderer.js';

export function renderKnoxMarkdown(
	container: HTMLElement,
	source: string,
	markdownRenderer: IMarkdownRendererService,
	store: DisposableStore,
	options?: { fillInIncompleteTokens?: boolean },
): IDisposable {
	clearNode(container);
	const rendered = markdownRenderer.render(new MarkdownString(source, { supportThemeIcons: false }), {
		fillInIncompleteTokens: options?.fillInIncompleteTokens,
		markedOptions: { gfm: true, breaks: true },
	});
	container.appendChild(rendered.element);
	store.add(rendered);
	return rendered;
}
