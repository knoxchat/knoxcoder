/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Contribution id for the Knox view container. The workbench id is
 * `workbench.view.extension.${id}` so saved layouts from the old
 * `contributes.viewsContainers.secondarySidebar` entry still restore.
 * The container itself is registered by the workbench, not package.json.
 */
export const KNOX_VIEWS_CONTAINER_CONTRIBUTION_ID = 'knoxchat';

export const KNOX_VIEW_CONTAINER_ID = `workbench.view.extension.${KNOX_VIEWS_CONTAINER_CONTRIBUTION_ID}`;

export const KNOX_VIEW_ID = 'knoxchat.knoxGUIView';
