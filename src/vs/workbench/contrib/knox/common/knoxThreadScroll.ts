/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const KNOX_SCROLL_BOTTOM_THRESHOLD = 40;
export const KNOX_SCROLL_TOP_THRESHOLD = 5;

export interface IKnoxScrollMetrics {
	scrollTop: number;
	scrollHeight: number;
	clientHeight: number;
}

export interface IKnoxThreadScrollState {
	stickToBottom: boolean;
	isAtTop: boolean;
	isAtBottom: boolean;
	showScrollButtons: boolean;
}

export function knoxIsAtBottom(
	metrics: IKnoxScrollMetrics,
	threshold: number = KNOX_SCROLL_BOTTOM_THRESHOLD,
): boolean {
	return Math.abs(metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight) < threshold;
}

export function knoxIsAtTop(
	metrics: IKnoxScrollMetrics,
	threshold: number = KNOX_SCROLL_TOP_THRESHOLD,
): boolean {
	return metrics.scrollTop < threshold;
}

export function knoxContentIsScrollable(metrics: IKnoxScrollMetrics): boolean {
	return metrics.scrollHeight > metrics.clientHeight + KNOX_SCROLL_TOP_THRESHOLD;
}

export function knoxShouldShowScrollButtons(metrics: IKnoxScrollMetrics, isAtTop: boolean, isAtBottom: boolean): boolean {
	return knoxContentIsScrollable(metrics) && (!isAtTop || !isAtBottom);
}

export function knoxScrollStateFromMetrics(
	metrics: IKnoxScrollMetrics,
	previous: IKnoxThreadScrollState,
	programmatic: boolean,
): IKnoxThreadScrollState {
	const isAtTop = knoxIsAtTop(metrics);
	const isAtBottom = knoxIsAtBottom(metrics);
	const showScrollButtons = knoxShouldShowScrollButtons(metrics, isAtTop, isAtBottom);

	let stickToBottom = previous.stickToBottom;
	if (!programmatic) {
		if (isAtBottom) {
			stickToBottom = true;
		} else {
			stickToBottom = false;
		}
	} else if (isAtBottom) {
		stickToBottom = true;
	}

	return { stickToBottom, isAtTop, isAtBottom, showScrollButtons };
}

export function knoxResetScrollState(): IKnoxThreadScrollState {
	return {
		stickToBottom: true,
		isAtTop: true,
		isAtBottom: true,
		showScrollButtons: false,
	};
}
