/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IKnoxChatHistoryItem, IKnoxBackgroundJob } from './knoxChatTypes.js';
import { getHistoryToolStates } from './knoxChatHistory.js';
import { KnoxBuiltInToolName } from './knoxToolNames.js';

const TASK_ID_PREFIX = 'task:';

export function isKnoxTaskJobId(id: string): boolean {
	return id.startsWith(TASK_ID_PREFIX);
}

export function knoxTruncateJobTitle(title: string, max = 72): string {
	const trimmed = title.trim().replace(/\s+/g, ' ');
	if (trimmed.length <= max) {
		return trimmed;
	}
	return `${trimmed.slice(0, max - 1)}…`;
}

export function knoxCountRunningJobs(jobs: readonly IKnoxBackgroundJob[]): number {
	return jobs.filter(job => job.status === 'running').length;
}

export function knoxSortBackgroundJobs(jobs: readonly IKnoxBackgroundJob[]): IKnoxBackgroundJob[] {
	return [...jobs].sort((a, b) => {
		const aRun = a.status === 'running' ? 0 : 1;
		const bRun = b.status === 'running' ? 0 : 1;
		if (aRun !== bRun) {
			return aRun - bRun;
		}
		return (b.startedAt ?? 0) - (a.startedAt ?? 0);
	});
}

export function knoxMergeBackgroundJobs(
	shellJobs: readonly IKnoxBackgroundJob[],
	taskJobs: readonly IKnoxBackgroundJob[],
): IKnoxBackgroundJob[] {
	const byId = new Map<string, IKnoxBackgroundJob>();
	for (const job of shellJobs) {
		byId.set(job.id, job);
	}
	for (const job of taskJobs) {
		if (!byId.has(job.id)) {
			byId.set(job.id, job);
		}
	}
	return knoxSortBackgroundJobs([...byId.values()]);
}

export function knoxCollectRunningTaskJobs(history: readonly IKnoxChatHistoryItem[]): IKnoxBackgroundJob[] {
	const jobs: IKnoxBackgroundJob[] = [];
	for (const item of history) {
		for (const state of getHistoryToolStates(item)) {
			const name = state.toolCall?.function?.name;
			if (name !== KnoxBuiltInToolName.Task) {
				continue;
			}
			if (state.status !== 'calling' && state.status !== 'generated' && state.status !== 'generating') {
				continue;
			}
			const args = (state.parsedArgs && typeof state.parsedArgs === 'object')
				? state.parsedArgs as Record<string, unknown>
				: {};
			const prompt = typeof args.prompt === 'string' ? args.prompt : '';
			const profile = typeof args.profile === 'string' ? args.profile : 'explore';
			const id = `${TASK_ID_PREFIX}${state.toolCallId || state.toolCall.id}`;
			jobs.push({
				id,
				kind: 'task',
				title: prompt || profile,
				status: 'running',
				detail: profile,
			});
		}
	}
	return jobs;
}

export function knoxRunningJobCount(
	shellJobs: readonly IKnoxBackgroundJob[],
	history: readonly IKnoxChatHistoryItem[],
): number {
	return knoxCountRunningJobs(knoxMergeBackgroundJobs(shellJobs, knoxCollectRunningTaskJobs(history)));
}

export function knoxParseBackgroundJobs(data: unknown): IKnoxBackgroundJob[] {
	if (!data || typeof data !== 'object') {
		return [];
	}
	const jobs = (data as { jobs?: unknown }).jobs;
	if (!Array.isArray(jobs)) {
		return [];
	}
	const parsed: IKnoxBackgroundJob[] = [];
	for (const item of jobs) {
		if (!item || typeof item !== 'object') {
			continue;
		}
		const job = item as Partial<IKnoxBackgroundJob>;
		if (typeof job.id !== 'string' || !job.id) {
			continue;
		}
		const kind: IKnoxBackgroundJob['kind'] = job.kind === 'task' ? 'task' : 'shell';
		const status: IKnoxBackgroundJob['status'] =
			job.status === 'exited' || job.status === 'killed' ? job.status : 'running';
		parsed.push({
			id: job.id,
			kind,
			title: typeof job.title === 'string' ? job.title : job.id,
			status,
			startedAt: typeof job.startedAt === 'number' ? job.startedAt : undefined,
			endedAt: typeof job.endedAt === 'number' ? job.endedAt : undefined,
			exitCode: typeof job.exitCode === 'number' || job.exitCode === null ? job.exitCode : undefined,
			detail: typeof job.detail === 'string' ? job.detail : undefined,
			output: typeof job.output === 'string' ? job.output : undefined,
			truncated: job.truncated === true,
			logPath: typeof job.logPath === 'string' ? job.logPath : undefined,
		});
	}
	return parsed;
}
