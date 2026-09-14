/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IKnoxContextItem } from './knoxChatTypes.js';

export interface IKnoxRepoTreeNode {
	name: string;
	path: string;
	isDirectory: boolean;
	children: IKnoxRepoTreeNode[];
	gitStatus?: string;
	detail?: string;
}

export interface IKnoxRepoTreeStats {
	files: number;
	folders: number;
	total: number;
	size?: string;
}

export interface IKnoxDirectoryFilters {
	directoryPath?: string;
	depth?: number;
	fileTypes?: string[];
	pattern?: string;
	includeStats?: boolean;
	includeGitStatus?: boolean;
}

export interface IKnoxDirectoryContents {
	structure: string;
	summary: string;
	notice: string;
	enhanced: boolean;
}

interface MutableTreeNode {
	name: string;
	path: string;
	isDirectory: boolean;
	children: Map<string, MutableTreeNode>;
	gitStatus?: string;
	detail?: string;
}

function skipPreamble(line: string): boolean {
	const trimmed = line.trim();
	return !trimmed
		|| trimmed.startsWith('Below is a repository map')
		|| trimmed.startsWith('For each file')
		|| trimmed.startsWith('this map contains');
}

function looksLikeTree(content: string): boolean {
	return content.includes('├──') || content.includes('└──');
}

function parseGitAndDetail(name: string): { name: string; gitStatus?: string; detail?: string } {
	let rest = name.trim();
	let gitStatus: string | undefined;
	const git = rest.match(/\[([MAD?])\]\s*$/);
	if (git) {
		gitStatus = git[1];
		rest = rest.slice(0, git.index).trim();
	}
	let detail: string | undefined;
	const stats = rest.match(/\s+(\([^)]+\))$/);
	if (stats) {
		detail = stats[1];
		rest = rest.slice(0, stats.index).trim();
	}
	return { name: rest, gitStatus, detail };
}

function insertPath(
	root: MutableTreeNode,
	parts: string[],
	meta?: { gitStatus?: string; detail?: string },
): void {
	let current = root;
	for (let i = 0; i < parts.length; i++) {
		const part = parts[i];
		const isLast = i === parts.length - 1;
		const isDirectory = !isLast || part.endsWith('/');
		const name = part.replace(/\/$/, '');
		if (!name) {
			continue;
		}
		let child = current.children.get(name);
		if (!child) {
			child = {
				name,
				path: current.path ? `${current.path}/${name}` : name,
				isDirectory,
				children: new Map(),
			};
			current.children.set(name, child);
		} else if (isDirectory) {
			child.isDirectory = true;
		}
		if (isLast) {
			if (meta?.gitStatus) {
				child.gitStatus = meta.gitStatus;
			}
			if (meta?.detail) {
				child.detail = meta.detail;
			}
		}
		current = child;
	}
}

function freezeNode(node: MutableTreeNode): IKnoxRepoTreeNode {
	const children = [...node.children.values()]
		.sort((a, b) => {
			if (a.isDirectory !== b.isDirectory) {
				return a.isDirectory ? -1 : 1;
			}
			return a.name.localeCompare(b.name);
		})
		.map(freezeNode);
	return {
		name: node.name,
		path: node.path,
		isDirectory: node.isDirectory || children.length > 0,
		children,
		gitStatus: node.gitStatus,
		detail: node.detail,
	};
}

export function knoxPathsToTree(content: string): IKnoxRepoTreeNode[] {
	const root: MutableTreeNode = { name: '', path: '', isDirectory: true, children: new Map() };
	for (const line of content.split('\n')) {
		if (skipPreamble(line)) {
			continue;
		}
		const parsed = parseGitAndDetail(line.replace(/\\/g, '/'));
		if (!parsed.name) {
			continue;
		}
		const parts = parsed.name.split('/').filter(Boolean);
		if (parsed.name.endsWith('/')) {
			parts[parts.length - 1] = `${parts[parts.length - 1]}/`;
		}
		insertPath(root, parts, parsed);
	}
	return freezeNode(root).children;
}

export function knoxParseTreeText(content: string): IKnoxRepoTreeNode[] {
	if (!looksLikeTree(content)) {
		return knoxPathsToTree(content);
	}

	const root: MutableTreeNode = { name: '', path: '', isDirectory: true, children: new Map() };
	const stack: MutableTreeNode[] = [root];

	for (const raw of content.split('\n')) {
		const line = raw.replace(/\r$/, '');
		if (!line.trim() || skipPreamble(line)) {
			continue;
		}
		const match = line.match(/^(?:[ │\t]*)(?:├── |└── )(.*)$/);
		if (!match) {
			const indentOnly = line.match(/^[ │\t]+$/);
			if (indentOnly) {
				continue;
			}
			const prefix = line.match(/^(?:[ │\t]*)/);
			if (!prefix || !line.trim()) {
				continue;
			}
		}
		const connector = line.indexOf('├── ');
		const lastConnector = line.indexOf('└── ');
		const at = connector >= 0 ? connector : lastConnector;
		if (at < 0) {
			continue;
		}
		const depth = Math.floor(at / 4) + 1;
		const parsed = parseGitAndDetail(match ? match[1] : line.slice(at + 4));
		if (!parsed.name) {
			continue;
		}
		while (stack.length > depth) {
			stack.pop();
		}
		const parent = stack[stack.length - 1] ?? root;
		const isDirectory = parsed.name.endsWith('/');
		const name = parsed.name.replace(/\/$/, '');
		const child: MutableTreeNode = {
			name,
			path: parent.path ? `${parent.path}/${name}` : name,
			isDirectory,
			children: new Map(),
			gitStatus: parsed.gitStatus,
			detail: parsed.detail,
		};
		parent.children.set(name, child);
		parent.isDirectory = true;
		stack[depth] = child;
		stack.length = depth + 1;
	}

	return freezeNode(root).children;
}

export function knoxRepoTreeStats(nodes: readonly IKnoxRepoTreeNode[], summary?: string): IKnoxRepoTreeStats {
	const fileMatch = summary?.match(/Total Files:\s*(\d+)/);
	const dirMatch = summary?.match(/Total Directories:\s*(\d+)/);
	const sizeMatch = summary?.match(/Total Size:\s*([\d.]+\s*[BKMG]B?)/);
	if (fileMatch || dirMatch) {
		const files = fileMatch ? parseInt(fileMatch[1], 10) : 0;
		const folders = dirMatch ? parseInt(dirMatch[1], 10) : 0;
		return {
			files,
			folders,
			total: files + folders,
			size: sizeMatch?.[1],
		};
	}

	let files = 0;
	let folders = 0;
	const visit = (node: IKnoxRepoTreeNode) => {
		if (node.isDirectory) {
			folders++;
			for (const child of node.children) {
				visit(child);
			}
		} else {
			files++;
		}
	};
	for (const node of nodes) {
		visit(node);
	}
	return { files, folders, total: files + folders };
}

export function knoxDirectoryFilterBadges(filters: IKnoxDirectoryFilters): string[] {
	const badges: string[] = [];
	if (filters.fileTypes?.length) {
		badges.push(filters.fileTypes.join(', '));
	}
	if (filters.pattern) {
		badges.push(filters.pattern);
	}
	if (filters.depth !== undefined && filters.depth !== -1) {
		badges.push(`depth: ${filters.depth}`);
	}
	if (filters.includeStats) {
		badges.push('stats');
	}
	if (filters.includeGitStatus) {
		badges.push('git');
	}
	return badges;
}

export function knoxShortDirectoryName(directoryPath: string | undefined): string {
	if (!directoryPath) {
		return '/';
	}
	return directoryPath.split('/').filter(Boolean).pop() || '/';
}

export function knoxExtractDirectoryContents(items: readonly IKnoxContextItem[] | undefined): IKnoxDirectoryContents {
	const list = items ?? [];
	const summary = list.find(item => item.name?.includes('Summary') || item.description?.includes('Analysis'))?.content || '';
	const structure = list.find(item => item.name?.includes('Structure') || item.description?.includes('Structure'))?.content || '';
	const notice = list.find(item => item.name?.includes('Notice'))?.content || '';
	const enhanced = summary.includes('Directory Analysis Summary') || looksLikeTree(structure);
	const fallback = enhanced
		? structure
		: (list.find(item =>
			item.description?.includes('directory')
			|| item.name?.includes('directory')
			|| item.description?.includes('Structure'),
		)?.content || '');
	return {
		structure: fallback,
		summary,
		notice,
		enhanced,
	};
}

export function knoxExtractRepoMapContent(items: readonly IKnoxContextItem[] | undefined): string {
	const list = items ?? [];
	return list.find(item =>
		item.description?.includes('repo')
		|| item.name?.includes('repo')
		|| item.description?.includes('structure'),
	)?.content || list[0]?.content || '';
}

export function knoxFlattenRepoTreePaths(nodes: readonly IKnoxRepoTreeNode[]): string[] {
	const paths: string[] = [];
	const visit = (node: IKnoxRepoTreeNode) => {
		paths.push(node.isDirectory ? `${node.path}/` : node.path);
		for (const child of node.children) {
			visit(child);
		}
	};
	for (const node of nodes) {
		visit(node);
	}
	return paths;
}
