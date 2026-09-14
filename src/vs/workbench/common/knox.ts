/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExtensionIdentifier } from '../../platform/extensions/common/extensions.js';
import { ViewContainerLocation } from './views.js';

/** System extension id for the in-tree Knox product (`extensions/knox`). */
export const KNOX_EXTENSION_ID = 'vscode.knox';

/** View-container key used before the GUI moved into the workbench contrib. The workbench prefixes it as {@link KNOX_VIEW_CONTAINER_ID}. */
export const KNOX_VIEWS_CONTAINER_KEY = 'knoxchat';

/** First-party Knox chat container. Lives only on the Secondary Side Bar. Registered by `src/vs/workbench/contrib/knox`. */
export const KNOX_VIEW_CONTAINER_ID = `workbench.view.extension.${KNOX_VIEWS_CONTAINER_KEY}`;

/** Native Knox chat pane registered by `src/vs/workbench/contrib/knox`. `vscode.knox` still runs Core and the protocol. */
export const KNOX_VIEW_ID = 'knoxchat.knoxGUIView';

export function isKnoxExtension(identifier: ExtensionIdentifier | undefined): boolean {
	return !!identifier && ExtensionIdentifier.equals(identifier, KNOX_EXTENSION_ID);
}

export function isKnoxViewsContainerKey(id: string): boolean {
	return id === KNOX_VIEWS_CONTAINER_KEY;
}

export function isKnoxViewContainer(id: string): boolean {
	return id === KNOX_VIEW_CONTAINER_ID;
}

export function isKnoxView(id: string): boolean {
	return id === KNOX_VIEW_ID;
}

/** The Secondary Side Bar is Knox-only: no other containers or views may occupy it. */
export function isKnoxExclusiveAuxiliaryBar(location: ViewContainerLocation): boolean {
	return location === ViewContainerLocation.AuxiliaryBar;
}
