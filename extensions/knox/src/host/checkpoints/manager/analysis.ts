import { isBinarySnapshotExtension } from './fileClassification';
import {
    checkpointSessionId,
    isListableCheckpoint,
    searchablePaths,
} from './listQuery';
import { computeCheckpointDiff } from './diff';
import type { CheckpointEngineHost } from './host';
import { countLineDelta } from './restorePreview';
import { toPosixRelative } from './pathFilter';
import type {
    CheckpointAnalysis,
    CheckpointAffectedFeature,
    CheckpointFileDiff,
    CheckpointImpactAnalysis,
    CheckpointImpactScope,
    CheckpointInfo,
    CheckpointRiskAssessment,
    CheckpointRiskFactor,
    CheckpointRiskLevel,
    FileSnapshot,
    SuggestedCheckpointGroup,
} from './types';
import { getCheckpointHistoryForWorkspace } from './workspace';

export const ANALYSIS_TIME_GAP_MS = 30 * 60 * 1000;
export const ANALYSIS_GROUP_LIMIT = 50;

const LOCKFILE_NAMES = new Set([
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    'bun.lock',
    'bun.lockb',
    'cargo.lock',
    'poetry.lock',
    'pipfile.lock',
    'go.sum',
    'gemfile.lock',
    'composer.lock',
    'flake.lock',
]);

const CONFIG_BASENAMES = new Set([
    'package.json',
    'tsconfig.json',
    'jsconfig.json',
    'cargo.toml',
    'go.mod',
    'pyproject.toml',
    'setup.py',
    'setup.cfg',
    'requirements.txt',
    'pipfile',
    'dockerfile',
    'docker-compose.yml',
    'docker-compose.yaml',
    'makefile',
    'cmakelists.txt',
    'turbo.json',
    '.eslintrc.json',
    '.eslintrc.cjs',
    'eslint.config.js',
    'eslint.config.mjs',
]);

const LAYER_NAMES = new Set([
    'src', 'lib', 'core', 'gui', 'extensions', 'test', 'tests', 'spec',
    'docs', 'scripts', 'config', 'packages', 'apps',
]);

export interface AnalysisPathInput {
    relativePath: string;
    encoding?: string;
    deleted?: boolean;
    changeType?: string;
    size?: number;
}

export function posixRelative(filePath: string): string {
    return toPosixRelative(filePath);
}

export function pathBasename(filePath: string): string {
    const posix = posixRelative(filePath);
    const index = posix.lastIndexOf('/');
    return (index >= 0 ? posix.slice(index + 1) : posix).toLowerCase();
}

export function pathDirname(filePath: string): string {
    const posix = posixRelative(filePath);
    const index = posix.lastIndexOf('/');
    return index >= 0 ? posix.slice(0, index) : '.';
}

export function topLevelSegment(filePath: string): string {
    const posix = posixRelative(filePath);
    const index = posix.indexOf('/');
    return index >= 0 ? posix.slice(0, index) : posix;
}

export function isDeletedPath(input: AnalysisPathInput): boolean {
    return input.deleted === true || input.changeType === 'deleted';
}

export function isBinaryPath(input: AnalysisPathInput): boolean {
    const encoding = (input.encoding || '').toLowerCase();
    if (encoding === 'base64') {
        return true;
    }
    return isBinarySnapshotExtension(input.relativePath);
}

export function isLockfilePath(filePath: string): boolean {
    return LOCKFILE_NAMES.has(pathBasename(filePath));
}

export function isConfigPath(filePath: string): boolean {
    const posix = posixRelative(filePath).toLowerCase();
    const base = pathBasename(filePath);
    if (CONFIG_BASENAMES.has(base)) {
        return true;
    }
    if (posix.includes('.github/workflows/')) {
        return true;
    }
    return /\.config\.(js|ts|mjs|cjs)$/.test(base);
}

export function isTestPath(filePath: string): boolean {
    const posix = posixRelative(filePath).toLowerCase();
    const base = pathBasename(filePath);
    if (/\.(test|spec)\.[a-z0-9]+$/.test(base)) {
        return true;
    }
    if (base.startsWith('test_') && base.endsWith('.py')) {
        return true;
    }
    if (base.endsWith('_test.go') || base.endsWith('_test.ts') || base.endsWith('_test.js')) {
        return true;
    }
    return /\/(__tests__|tests?|spec)\//.test(`/${posix}`);
}

export function classifyChangedPaths(paths: AnalysisPathInput[]): CheckpointAnalysis['counts'] {
    const unique = new Map<string, AnalysisPathInput>();
    for (const input of paths) {
        const relativePath = posixRelative(input.relativePath);
        if (!relativePath) {
            continue;
        }
        unique.set(relativePath, { ...input, relativePath });
    }
    const values = [...unique.values()];
    const deleted = values.filter(isDeletedPath);
    const live = values.filter((input) => !isDeletedPath(input));
    const created = live.filter((input) => input.changeType === 'created');
    const modified = live.filter((input) => input.changeType !== 'created');
    return {
        changed: values.length,
        created: created.length,
        deleted: deleted.length,
        modified: modified.length,
        binary: values.filter(isBinaryPath).length,
        config: values.filter((input) => isConfigPath(input.relativePath)).length,
        lockfile: values.filter((input) => isLockfilePath(input.relativePath)).length,
        tests: values.filter((input) => isTestPath(input.relativePath)).length,
    };
}

export function impactScope(
    paths: string[],
    counts: CheckpointAnalysis['counts'],
): { scope: CheckpointImpactScope; uniqueDirectories: number; topLevels: string[] } {
    const dirs = new Set(paths.map(pathDirname));
    const topLevels = [...new Set(paths.map(topLevelSegment).filter(Boolean))].sort();
    let scope: CheckpointImpactScope = 'Isolated';
    if (counts.config > 0 || counts.lockfile > 0 || topLevels.length >= 4) {
        scope = 'SystemWide';
    } else if (topLevels.length >= 2) {
        scope = 'CrossModule';
    } else if (dirs.size > 1 || paths.length > 3) {
        scope = 'Module';
    }
    return { scope, uniqueDirectories: dirs.size, topLevels };
}

function featureImpactLevel(fileCount: number): CheckpointAffectedFeature['impactLevel'] {
    if (fileCount >= 8) {
        return 'High';
    }
    if (fileCount >= 3) {
        return 'Medium';
    }
    return 'Low';
}

export function affectedFeatures(paths: string[]): CheckpointAffectedFeature[] {
    const byTop = new Map<string, string[]>();
    for (const filePath of paths) {
        const top = topLevelSegment(filePath) || '.';
        const list = byTop.get(top) ?? [];
        list.push(filePath);
        byTop.set(top, list);
    }
    return [...byTop.entries()]
        .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
        .map(([name, changedFiles]) => ({
            name,
            impactLevel: featureImpactLevel(changedFiles.length),
            changedFiles,
        }));
}

export function affectedLayers(paths: string[]): string[] {
    const layers = new Set<string>();
    for (const filePath of paths) {
        for (const segment of posixRelative(filePath).split('/')) {
            if (LAYER_NAMES.has(segment.toLowerCase())) {
                layers.add(segment.toLowerCase());
            }
        }
        if (isTestPath(filePath)) {
            layers.add('test');
        }
        if (isConfigPath(filePath) || isLockfilePath(filePath)) {
            layers.add('config');
        }
    }
    return [...layers].sort();
}

export function scoreRisk(
    counts: CheckpointAnalysis['counts'],
    impact: Pick<CheckpointImpactAnalysis, 'scope' | 'linesAdded' | 'linesDeleted'>,
): CheckpointRiskAssessment {
    const factors: CheckpointRiskFactor[] = [];
    let score = 0;

    if (counts.deleted > 0) {
        const weight = Math.min(4, counts.deleted * 1.5);
        score += weight;
        factors.push({
            category: 'Deletions',
            description: `${counts.deleted} file(s) removed from the reconstructed tree`,
            weight,
            affectedFiles: [],
        });
    }
    if (counts.binary > 0) {
        const weight = Math.min(2, counts.binary);
        score += weight;
        factors.push({
            category: 'Binary',
            description: `${counts.binary} binary file(s) changed`,
            weight,
            affectedFiles: [],
        });
    }
    if (counts.config > 0) {
        score += 2;
        factors.push({
            category: 'Config',
            description: `${counts.config} project config file(s) changed`,
            weight: 2,
            affectedFiles: [],
        });
    }
    if (counts.lockfile > 0) {
        score += 1.5;
        factors.push({
            category: 'Lockfile',
            description: `${counts.lockfile} dependency lockfile(s) changed`,
            weight: 1.5,
            affectedFiles: [],
        });
    }
    const loc = impact.linesAdded + impact.linesDeleted;
    if (loc >= 800) {
        score += 2;
        factors.push({
            category: 'Diff size',
            description: `${loc} lines changed`,
            weight: 2,
            affectedFiles: [],
        });
    } else if (loc >= 200) {
        score += 1;
        factors.push({
            category: 'Diff size',
            description: `${loc} lines changed`,
            weight: 1,
            affectedFiles: [],
        });
    }
    if (impact.scope === 'SystemWide') {
        score += 1.5;
        factors.push({
            category: 'Scope',
            description: 'Changes span config or many top-level directories',
            weight: 1.5,
            affectedFiles: [],
        });
    } else if (impact.scope === 'CrossModule') {
        score += 0.5;
        factors.push({
            category: 'Scope',
            description: 'Changes span multiple top-level directories',
            weight: 0.5,
            affectedFiles: [],
        });
    }

    score = Math.min(10, Math.round(score * 10) / 10);
    let level: CheckpointRiskLevel = 'Low';
    if (score >= 7.5) {
        level = 'Critical';
    } else if (score >= 5) {
        level = 'High';
    } else if (score >= 2.5) {
        level = 'Medium';
    }

    const recommendations: string[] = [];
    if (counts.deleted > 0) {
        recommendations.push('Review deleted paths before restoring this checkpoint.');
    }
    if (counts.config > 0 || counts.lockfile > 0) {
        recommendations.push('Reinstall or re-sync dependencies if you restore this checkpoint.');
    }
    if (counts.tests > 0) {
        recommendations.push('Run the affected tests after restore or merge.');
    }
    if (level === 'High' || level === 'Critical') {
        recommendations.push('Pin this checkpoint if it is a known-good rollback point.');
    }
    if (recommendations.length === 0) {
        recommendations.push('Low-risk change set; restore is unlikely to affect project config.');
    }

    return { level, score, factors, recommendations };
}

export function describeAnalysis(
    checkpoint: Pick<CheckpointInfo, 'description' | 'captureMode'>,
    counts: CheckpointAnalysis['counts'],
    impact: CheckpointImpactAnalysis,
): string {
    const parts = [
        checkpoint.captureMode === 'baseline' ? 'Full-tree baseline' : 'Delta',
        `${counts.changed} file(s)`,
        `${impact.uniqueDirectories} director${impact.uniqueDirectories === 1 ? 'y' : 'ies'}`,
        `scope ${impact.scope}`,
    ];
    if (impact.linesAdded || impact.linesDeleted) {
        parts.push(`+${impact.linesAdded}/-${impact.linesDeleted} lines`);
    }
    if (counts.deleted) {
        parts.push(`${counts.deleted} deleted`);
    }
    if (counts.config) {
        parts.push('includes config');
    }
    if (counts.tests) {
        parts.push('includes tests');
    }
    const summary = parts.join(', ');
    const title = checkpoint.description?.trim();
    return title ? `${title} — ${summary}.` : `${summary}.`;
}

export function buildCheckpointAnalysis(input: {
    checkpointId: string;
    description?: string;
    captureMode?: CheckpointInfo['captureMode'];
    paths: AnalysisPathInput[];
    linesAdded?: number;
    linesDeleted?: number;
    groupingSuggestion?: SuggestedCheckpointGroup;
}): CheckpointAnalysis {
    const counts = classifyChangedPaths(input.paths);
    const livePaths = input.paths
        .map((entry) => posixRelative(entry.relativePath))
        .filter(Boolean);
    const { scope, uniqueDirectories } = impactScope(livePaths, counts);
    const impactAnalysis: CheckpointImpactAnalysis = {
        affectedFeatures: affectedFeatures(livePaths),
        affectedLayers: affectedLayers(livePaths),
        scope,
        uniqueDirectories,
        testFilesChanged: counts.tests > 0,
        linesAdded: input.linesAdded ?? 0,
        linesDeleted: input.linesDeleted ?? 0,
    };
    const riskAssessment = scoreRisk(counts, impactAnalysis);
    return {
        checkpointId: input.checkpointId,
        generatedDescription: describeAnalysis(
            { description: input.description ?? '', captureMode: input.captureMode },
            counts,
            impactAnalysis,
        ),
        riskAssessment,
        impactAnalysis,
        groupingSuggestion: input.groupingSuggestion,
        counts,
    };
}

function sortByCreated(a: CheckpointInfo, b: CheckpointInfo): number {
    return a.created.getTime() - b.created.getTime();
}

function recentListable(history: CheckpointInfo[], limit: number): CheckpointInfo[] {
    return [...history]
        .filter(isListableCheckpoint)
        .sort(sortByCreated)
        .slice(-Math.max(1, limit));
}

function emitGroup(
    kind: SuggestedCheckpointGroup['kind'],
    groupName: string,
    rationale: string,
    confidence: number,
    checkpoints: CheckpointInfo[],
): SuggestedCheckpointGroup | null {
    if (checkpoints.length < 2) {
        return null;
    }
    return {
        id: `${kind}:${groupName}:${checkpoints[0].id}`,
        kind,
        groupName,
        rationale,
        confidence,
        checkpointIds: checkpoints.map((checkpoint) => checkpoint.id),
    };
}

export function dominantPathPrefix(checkpoint: CheckpointInfo): string | undefined {
    const paths = searchablePaths(checkpoint).map(posixRelative).filter(Boolean);
    if (paths.length === 0) {
        return undefined;
    }
    const counts = new Map<string, number>();
    for (const filePath of paths) {
        const top = topLevelSegment(filePath);
        if (!top) {
            continue;
        }
        counts.set(top, (counts.get(top) ?? 0) + 1);
    }
    let best: string | undefined;
    let bestCount = 0;
    for (const [prefix, count] of counts) {
        if (count > bestCount) {
            best = prefix;
            bestCount = count;
        }
    }
    return bestCount > 0 ? best : undefined;
}

export function suggestCheckpointGroupsFromHistory(
    history: CheckpointInfo[],
    limit: number = ANALYSIS_GROUP_LIMIT,
): SuggestedCheckpointGroup[] {
    const recent = recentListable(history, limit);
    const groups: SuggestedCheckpointGroup[] = [];

    const bySession = new Map<string, CheckpointInfo[]>();
    for (const checkpoint of recent) {
        const sessionId = checkpointSessionId(checkpoint);
        if (!sessionId) {
            continue;
        }
        const list = bySession.get(sessionId) ?? [];
        list.push(checkpoint);
        bySession.set(sessionId, list);
    }
    for (const [sessionId, checkpoints] of bySession) {
        const group = emitGroup(
            'session',
            `session ${sessionId.slice(0, 8)}`,
            `${checkpoints.length} checkpoints from the same session`,
            0.9,
            checkpoints,
        );
        if (group) {
            groups.push(group);
        }
    }

    let cluster: CheckpointInfo[] = [];
    const flushTime = () => {
        const group = emitGroup(
            'time',
            cluster.length > 0
                ? `burst ${cluster[0].created.toISOString().slice(0, 16)}`
                : 'burst',
            `${cluster.length} checkpoints within ${Math.round(ANALYSIS_TIME_GAP_MS / 60000)} minutes`,
            0.7,
            cluster,
        );
        if (group) {
            groups.push(group);
        }
        cluster = [];
    };
    for (const checkpoint of recent) {
        if (cluster.length === 0) {
            cluster = [checkpoint];
            continue;
        }
        const previous = cluster[cluster.length - 1];
        if (checkpoint.created.getTime() - previous.created.getTime() <= ANALYSIS_TIME_GAP_MS) {
            cluster.push(checkpoint);
        } else {
            flushTime();
            cluster = [checkpoint];
        }
    }
    flushTime();

    const byPrefix = new Map<string, CheckpointInfo[]>();
    for (const checkpoint of recent) {
        const prefix = dominantPathPrefix(checkpoint);
        if (!prefix) {
            continue;
        }
        const list = byPrefix.get(prefix) ?? [];
        list.push(checkpoint);
        byPrefix.set(prefix, list);
    }
    for (const [prefix, checkpoints] of byPrefix) {
        const group = emitGroup(
            'path',
            prefix,
            `${checkpoints.length} checkpoints mainly changing ${prefix}/`,
            0.6,
            checkpoints,
        );
        if (group) {
            groups.push(group);
        }
    }

    return groups.sort((a, b) => b.confidence - a.confidence || b.checkpointIds.length - a.checkpointIds.length);
}

function snapshotsToPathInputs(snapshots: FileSnapshot[] | undefined, fallbackPaths: string[]): AnalysisPathInput[] {
    if (snapshots && snapshots.length > 0) {
        return snapshots.map((snapshot) => ({
            relativePath: snapshot.relativePath,
            encoding: snapshot.encoding,
            deleted: snapshot.deleted,
            changeType: snapshot.changeType,
            size: snapshot.size,
        }));
    }
    return fallbackPaths.map((relativePath) => ({ relativePath }));
}

function locFromDiff(files: CheckpointFileDiff[]): { linesAdded: number; linesDeleted: number } {
    let linesAdded = 0;
    let linesDeleted = 0;
    for (const file of files) {
        const encoding = file.newEncoding || file.oldEncoding || 'utf8';
        if (encoding === 'base64' || isBinarySnapshotExtension(file.relativePath)) {
            continue;
        }
        const delta = countLineDelta(file.oldContent ?? '', file.newContent ?? '');
        linesAdded += delta.additions;
        linesDeleted += delta.deletions;
    }
    return { linesAdded, linesDeleted };
}

export async function analyzeCheckpoint(
    host: CheckpointEngineHost,
    checkpointId: string,
): Promise<CheckpointAnalysis | null> {
    const history = getCheckpointHistoryForWorkspace(
        host.checkpointHistory,
        host.currentWorkspacePath,
    );
    const checkpoint = history.find((entry) => entry.id === checkpointId)
        ?? host.checkpointHistory.find((entry) => entry.id === checkpointId);
    if (!checkpoint) {
        return null;
    }

    const fromDisk = await host.loadCheckpointFromDisk(checkpointId);
    const paths = snapshotsToPathInputs(
        fromDisk?.fileSnapshots ?? checkpoint.fileSnapshots,
        checkpoint.changedPaths ?? checkpoint.fileInventory ?? [],
    );

    let linesAdded = 0;
    let linesDeleted = 0;
    const diff = await computeCheckpointDiff(host, checkpointId);
    if (diff && diff.files.length > 0) {
        const loc = locFromDiff(diff.files);
        linesAdded = loc.linesAdded;
        linesDeleted = loc.linesDeleted;
    } else {
        for (const snapshot of fromDisk?.fileSnapshots ?? []) {
            if (isDeletedPath(snapshot) || isBinaryPath(snapshot) || snapshot.content == null) {
                continue;
            }
            linesAdded += snapshot.content.length === 0 ? 0 : snapshot.content.split('\n').length;
        }
    }

    const groups = suggestCheckpointGroupsFromHistory(history);
    const groupingSuggestion = groups.find((group) =>
        group.kind === 'session' && group.checkpointIds.includes(checkpointId),
    ) ?? groups.find((group) => group.checkpointIds.includes(checkpointId));

    return buildCheckpointAnalysis({
        checkpointId,
        description: checkpoint.description,
        captureMode: fromDisk?.captureMode ?? checkpoint.captureMode,
        paths,
        linesAdded,
        linesDeleted,
        groupingSuggestion,
    });
}

export async function suggestCheckpointGroups(
    host: CheckpointEngineHost,
    limit: number = ANALYSIS_GROUP_LIMIT,
): Promise<SuggestedCheckpointGroup[]> {
    const history = getCheckpointHistoryForWorkspace(
        host.checkpointHistory,
        host.currentWorkspacePath,
    );
    const source = history.length > 0 ? history : host.checkpointHistory;
    return suggestCheckpointGroupsFromHistory(source, limit);
}

export function formatCheckpointAnalysisMarkdown(
    analysis: CheckpointAnalysis,
    groups: SuggestedCheckpointGroup[] = [],
): string {
    const lines = [
        `# Checkpoint analysis`,
        '',
        analysis.generatedDescription,
        '',
        `- **Id:** \`${analysis.checkpointId}\``,
        `- **Risk:** ${analysis.riskAssessment.level} (${analysis.riskAssessment.score})`,
        `- **Scope:** ${analysis.impactAnalysis.scope}`,
        `- **Files:** ${analysis.counts.changed} changed, ${analysis.counts.created} created, ${analysis.counts.modified} modified, ${analysis.counts.deleted} deleted`,
        `- **Lines:** +${analysis.impactAnalysis.linesAdded} / -${analysis.impactAnalysis.linesDeleted}`,
        `- **Directories:** ${analysis.impactAnalysis.uniqueDirectories}`,
        `- **Tests changed:** ${analysis.impactAnalysis.testFilesChanged ? 'yes' : 'no'}`,
        `- **Config / lockfile / binary:** ${analysis.counts.config} / ${analysis.counts.lockfile} / ${analysis.counts.binary}`,
    ];
    if (analysis.riskAssessment.factors.length > 0) {
        lines.push('', '## Risk factors');
        for (const factor of analysis.riskAssessment.factors) {
            lines.push(`- **${factor.category}** (${factor.weight}): ${factor.description}`);
        }
    }
    if (analysis.riskAssessment.recommendations.length > 0) {
        lines.push('', '## Recommendations');
        for (const recommendation of analysis.riskAssessment.recommendations) {
            lines.push(`- ${recommendation}`);
        }
    }
    if (analysis.impactAnalysis.affectedFeatures.length > 0) {
        lines.push('', '## Affected areas');
        for (const feature of analysis.impactAnalysis.affectedFeatures) {
            lines.push(`- ${feature.name} (${feature.impactLevel}, ${feature.changedFiles.length} files)`);
        }
    }
    const related = analysis.groupingSuggestion ? [analysis.groupingSuggestion] : [];
    const extra = groups.filter((group) =>
        group.checkpointIds.includes(analysis.checkpointId)
        && group.id !== analysis.groupingSuggestion?.id,
    );
    const allGroups = [...related, ...extra];
    if (allGroups.length > 0) {
        lines.push('', '## Groups');
        for (const group of allGroups) {
            lines.push(
                `- **${group.groupName}** (${group.kind}, ${Math.round(group.confidence * 100)}%): ${group.rationale}`,
            );
        }
    }
    lines.push('');
    return lines.join('\n');
}
