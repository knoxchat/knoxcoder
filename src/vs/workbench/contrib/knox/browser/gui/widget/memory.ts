/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Memory panel: tab bar and routing, Overview, Memories browser, Sessions, Graph and Settings,
 * plus the in-place row filters.
 * Implementations live in `widget/memory/`; this file is the public surface used by
 * `knoxGuiWidget.ts` and `facade/memoryFacade.ts`.
 */

export { renderMemory } from './memory/page.js';
export { renderMemoryOverview } from './memory/overview.js';
export { renderMemoryBrowser } from './memory/browser.js';
export { renderMemorySessions } from './memory/sessions.js';
export { renderMemoryGraph } from './memory/graph.js';
export { renderMemorySettings } from './memory/settings.js';
export { syncMemoryFilters } from './memory/filters.js';
