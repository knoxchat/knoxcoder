/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface IKnoxSessionTab {
	id: string;
	title: string;
	isActive: boolean;
	sessionId?: string;
}

export interface IKnoxSessionChangePayload {
	currentSessionId: string;
	currentSessionTitle: string;
	newTabId?: string;
}

export function knoxSetActiveTab(tabs: readonly IKnoxSessionTab[], id: string): IKnoxSessionTab[] {
	return tabs.map(tab => ({
		...tab,
		isActive: tab.id === id,
	}));
}

export function knoxAddTab(tabs: readonly IKnoxSessionTab[], tab: IKnoxSessionTab): IKnoxSessionTab[] {
	return tabs
		.map(existing => ({ ...existing, isActive: tab.isActive ? false : existing.isActive }))
		.concat(tab);
}

export function knoxRemoveTab(tabs: readonly IKnoxSessionTab[], id: string): IKnoxSessionTab[] {
	return tabs.filter(tab => tab.id !== id);
}

export function knoxHandleSessionChange(
	tabs: readonly IKnoxSessionTab[],
	payload: IKnoxSessionChangePayload,
): IKnoxSessionTab[] {
	const { currentSessionId, currentSessionTitle, newTabId } = payload;
	const activeTab = tabs.find(tab => tab.isActive);
	if (!activeTab) {
		return tabs.slice();
	}

	if (activeTab.sessionId === currentSessionId) {
		return tabs.map(tab =>
			tab.id === activeTab.id
				? { ...tab, title: currentSessionTitle }
				: tab,
		);
	}

	const existingTabWithSession = tabs.find(tab => tab.sessionId === currentSessionId);
	if (existingTabWithSession) {
		return tabs
			.filter(tab => tab.sessionId || tab.id === existingTabWithSession.id)
			.map(tab => ({
				...tab,
				isActive: tab.id === existingTabWithSession.id,
				title: tab.sessionId === currentSessionId
					? currentSessionTitle
					: tab.title,
			}));
	}

	if (!activeTab.sessionId) {
		return tabs.map(tab =>
			tab.id === activeTab.id
				? {
					...tab,
					sessionId: currentSessionId,
					title: currentSessionTitle,
				}
				: tab,
		);
	}

	return knoxAddTab(tabs, {
		id: newTabId || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`,
		title: currentSessionTitle,
		isActive: true,
		sessionId: currentSessionId,
	});
}

export function knoxSerializeTabs(tabs: readonly IKnoxSessionTab[]): string {
	return JSON.stringify(tabs);
}

export function knoxParseTabs(raw: string | undefined): IKnoxSessionTab[] | undefined {
	if (!raw) {
		return undefined;
	}
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed)) {
			return undefined;
		}
		const tabs: IKnoxSessionTab[] = [];
		for (const item of parsed) {
			if (!item || typeof item !== 'object') {
				continue;
			}
			const record = item as Record<string, unknown>;
			if (typeof record.id !== 'string' || typeof record.title !== 'string') {
				continue;
			}
			tabs.push({
				id: record.id,
				title: record.title,
				isActive: record.isActive === true,
				sessionId: typeof record.sessionId === 'string' ? record.sessionId : undefined,
			});
		}
		return tabs.length ? tabs : undefined;
	} catch {
		return undefined;
	}
}

export function knoxShowSessionTabs(ui: Record<string, unknown> | undefined): boolean {
	return ui?.showSessionTabs === true;
}
