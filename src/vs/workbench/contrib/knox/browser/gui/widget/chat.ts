/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Transcript view: turns, streaming bodies, history editors, context peeks.
 * Implementations live in `widget/chat/`; this file is the public surface used by
 * `knoxGuiWidget.ts` and `facade/chatFacade.ts`.
 */

export { patchLastAssistant, renderAssistantBody, renderAssistantTurn, renderErrorStep } from './chat/assistant.js';
export { renderActivitySteps, renderActivityTimeline, renderTurnLoading } from './chat/activity.js';
export { renderContextItemsPeek, renderContextPeekItem, renderHistoryContextPeek, renderToolOutputPeek } from './chat/contextPeek.js';
export { historyDraftFor, readImageFileIntoDraft, renderHistoricalEditor, setHistoryDraftDoc } from './chat/historyEditor.js';
export { renderChat, renderChatListError, renderHistoryRow, renderMessage, renderRowError } from './chat/list.js';
export type { IKnoxGuiStreamCacheBlock } from './chat/stream.js';
export { renderStreamingAssistantBody, renderStreamingReasoningBody } from './chat/stream.js';
export { renderStreamError } from './chat/streamError.js';
export { renderUserTurn } from './chat/user.js';
