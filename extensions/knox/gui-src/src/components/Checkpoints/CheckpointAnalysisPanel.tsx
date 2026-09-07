/**
 * Checkpoint analysis panel.
 *
 * Shows local heuristics from the host (risk, impact, grouping) — not LLM output
 * and not fake complexity / coverage metrics.
 */

import React, { useContext, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Shield, ShieldCheck, ShieldAlert, Info, Layers, FileText, Target, Loader2 } from 'lucide-react';
import { Badge } from '../ui/badge';
import { Card, CardContent } from '../ui/card';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import { Label } from '../ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { cn } from '../../lib/utils';
import { IdeMessengerContext } from '../../context/IdeMessenger';
import { CP_ICON, CP_ICON_META } from './checkpointUi';

export interface RiskFactor {
  category: string;
  description: string;
  weight: number;
  affectedFiles: string[];
}

export interface RiskAssessment {
  level: 'Low' | 'Medium' | 'High' | 'Critical';
  score: number;
  factors: RiskFactor[];
  recommendations: string[];
}

export interface AffectedFeature {
  name: string;
  impactLevel: 'Low' | 'Medium' | 'High';
  changedFiles: string[];
}

export interface ImpactAnalysis {
  affectedFeatures: AffectedFeature[];
  affectedLayers: string[];
  scope: 'Isolated' | 'Module' | 'CrossModule' | 'SystemWide';
  uniqueDirectories?: number;
  testFilesChanged?: boolean;
  linesAdded?: number;
  linesDeleted?: number;
}

export interface GroupingSuggestion {
  id?: string;
  kind?: 'session' | 'time' | 'path';
  groupName: string;
  rationale: string;
  confidence: number;
  checkpointIds: string[];
}

export interface CheckpointAnalysisCounts {
  changed: number;
  created: number;
  deleted: number;
  modified: number;
  binary: number;
  config: number;
  lockfile: number;
  tests: number;
}

export interface CheckpointAnalysisData {
  checkpointId?: string;
  generatedDescription: string;
  riskAssessment: RiskAssessment;
  impactAnalysis: ImpactAnalysis;
  groupingSuggestion?: GroupingSuggestion;
  counts?: CheckpointAnalysisCounts;
}

interface RiskBadgeProps {
  level: RiskAssessment['level'];
  score?: number;
  compact?: boolean;
}

export const RiskBadge: React.FC<RiskBadgeProps> = ({ level, score, compact = false }) => {
  const { t } = useTranslation();
  const config = {
    Low: { icon: ShieldCheck, chip: 'odp-chip-green' },
    Medium: { icon: Shield, chip: 'odp-chip-yellow' },
    High: { icon: ShieldAlert, chip: 'odp-chip-orange' },
    Critical: { icon: AlertTriangle, chip: 'odp-chip-red' },
  };

  const { icon: Icon, chip } = config[level];
  const label = t(`checkpointAnalysis.risk.${level}`, level);

  if (compact) {
    return (
      <span className={cn('odp-chip', chip)}>
        <Icon className={CP_ICON_META} />
        {label}
      </span>
    );
  }

  return (
    <Badge variant="outline" className={cn('odp-chip gap-1 border shadow-none', chip)}>
      <Icon className={CP_ICON_META} />
      {label}
      {score !== undefined && <span className="text-[10px] opacity-75">({score.toFixed(1)})</span>}
    </Badge>
  );
};

interface ScopeBadgeProps {
  scope: ImpactAnalysis['scope'];
}

export const ScopeBadge: React.FC<ScopeBadgeProps> = ({ scope }) => {
  const { t } = useTranslation();
  const chip = {
    Isolated: 'odp-chip-muted',
    Module: 'odp-chip-blue',
    CrossModule: 'odp-chip-purple',
    SystemWide: 'odp-chip-red',
  }[scope];

  return (
    <Badge variant="outline" className={cn('odp-chip border shadow-none', chip)}>
      <Target className={CP_ICON_META} />
      {t(`checkpointAnalysis.scope.${scope}`, scope)}
    </Badge>
  );
};

interface CheckpointAnalysisPanelProps {
  analysis: CheckpointAnalysisData;
  className?: string;
}

export const CheckpointAnalysisPanel: React.FC<CheckpointAnalysisPanelProps> = ({
  analysis,
  className,
}) => {
  const { t } = useTranslation();
  const counts = analysis.counts;
  const impact = analysis.impactAnalysis;

  return (
    <Card className={cn('shadow-none', className)}>
      <CardContent className="space-y-3 p-3">
      <div className="odp-callout space-y-1">
        <div className="flex items-center gap-1 font-medium odp-text-comment">
          <FileText className={CP_ICON_META} />
          {t('checkpointAnalysis.summary', 'Summary')}
        </div>
        <p className="text-xs leading-relaxed">{analysis.generatedDescription}</p>
      </div>

      {counts && (
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span>{t('checkpointAnalysis.changed', 'Changed')}: {counts.changed}</span>
          <span>{t('checkpointAnalysis.tests', 'Tests')}: {counts.tests}</span>
          <span>{t('checkpointAnalysis.config', 'Config')}: {counts.config}</span>
          <span>{t('checkpointAnalysis.lockfiles', 'Lockfiles')}: {counts.lockfile}</span>
          {impact.linesAdded !== undefined && (
            <span>
              +{impact.linesAdded} / -{impact.linesDeleted ?? 0} {t('checkpointAnalysis.lines', 'lines')}
            </span>
          )}
          {impact.uniqueDirectories !== undefined && (
            <span>{t('checkpointAnalysis.directories', 'Directories')}: {impact.uniqueDirectories}</span>
          )}
        </div>
      )}

      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <RiskBadge level={analysis.riskAssessment.level} score={analysis.riskAssessment.score} />
          <ScopeBadge scope={analysis.impactAnalysis.scope} />
        </div>

        {analysis.riskAssessment.factors.length > 0 && (
          <div className="space-y-1">
            {analysis.riskAssessment.factors.map((factor, i) => (
              <div key={i} className="flex items-start gap-1.5 text-[11px]">
                <AlertTriangle className={`${CP_ICON_META} mt-0.5 shrink-0 odp-text-yellow`} />
                <div>
                  <span className="font-medium capitalize">{factor.category}</span>
                  <span className="text-muted-foreground"> — {factor.description}</span>
                  {factor.affectedFiles.length > 0 && (
                    <span className="text-muted-foreground/75"> ({factor.affectedFiles.length} {t('checkpointAnalysis.files', 'files')})</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {analysis.riskAssessment.recommendations.length > 0 && (
          <Alert className="odp-callout-blue px-2.5 py-2 [&>svg]:top-2.5 [&>svg]:left-2.5 [&>svg]:size-3.5 [&>svg]:text-[var(--odp-blue)] [&>svg~*]:pl-6">
            <Info />
            <AlertTitle className="text-[11px] font-medium text-[var(--odp-blue)]">
              {t('checkpointAnalysis.recommendations', 'Recommendations')}
            </AlertTitle>
            <AlertDescription className="text-[11px] text-muted-foreground">
              <ul className="list-disc list-inside space-y-0.5">
                {analysis.riskAssessment.recommendations.map((rec, i) => (
                  <li key={i}>{rec}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}
      </div>

      {analysis.impactAnalysis.affectedFeatures.length > 0 && (
        <div>
          <div className="mb-1 flex items-center gap-1 text-xs font-medium text-muted-foreground">
            <Layers className={CP_ICON_META} />
            {t('checkpointAnalysis.affectedAreas', 'Affected areas')}
          </div>
          <div className="flex flex-wrap gap-1">
            {analysis.impactAnalysis.affectedFeatures.map((feature, i) => {
              const chip = feature.impactLevel === 'High'
                ? 'odp-chip-red'
                : feature.impactLevel === 'Medium'
                  ? 'odp-chip-yellow'
                  : 'odp-chip-green';
              return (
                <Badge key={i} variant="outline" className={cn('odp-chip border shadow-none', chip)}>
                  {feature.name} ({feature.changedFiles.length})
                </Badge>
              );
            })}
          </div>
        </div>
      )}

      {analysis.impactAnalysis.affectedLayers.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {analysis.impactAnalysis.affectedLayers.map((layer, i) => (
            <Badge key={i} variant="outline" className="odp-chip odp-chip-muted border shadow-none">
              {layer}
            </Badge>
          ))}
        </div>
      )}

      {analysis.groupingSuggestion && (
        <div className="odp-callout-purple space-y-0.5">
          <div className="font-medium">
            {t('checkpointAnalysis.group', 'Group')}: {analysis.groupingSuggestion.groupName}
            {analysis.groupingSuggestion.kind && (
              <span className="ml-1 font-normal opacity-75">({analysis.groupingSuggestion.kind})</span>
            )}
          </div>
          <div className="text-muted-foreground">{analysis.groupingSuggestion.rationale}</div>
          <div className="text-muted-foreground/75">
            {t('checkpointAnalysis.confidence', 'Confidence')}: {(analysis.groupingSuggestion.confidence * 100).toFixed(0)}%
            {' · '}
            {analysis.groupingSuggestion.checkpointIds.length} {t('checkpointAnalysis.checkpoints', 'checkpoints')}
          </div>
        </div>
      )}
      </CardContent>
    </Card>
  );
};

interface GroupingSuggestionsListProps {
  suggestions: GroupingSuggestion[];
  onGroupSelect?: (group: GroupingSuggestion) => void;
  className?: string;
}

export const GroupingSuggestionsList: React.FC<GroupingSuggestionsListProps> = ({
  suggestions,
  onGroupSelect,
  className,
}) => {
  const { t } = useTranslation();
  if (suggestions.length === 0) return null;

  return (
    <div className={cn('space-y-2', className)}>
      <div className="text-xs font-medium text-muted-foreground">
        {t('checkpointAnalysis.suggestedGroups', 'Suggested groups')}
      </div>
      {suggestions.map((suggestion, i) => (
        <Card
          key={suggestion.id ?? i}
          className={cn(
            'shadow-none',
            onGroupSelect && 'cursor-pointer hover:bg-muted/50 transition-colors',
          )}
          onClick={() => onGroupSelect?.(suggestion)}
        >
          <CardContent className="p-2 text-xs">
          <div className="flex items-center justify-between mb-1">
            <span className="font-medium">{suggestion.groupName}</span>
            <Badge variant="secondary" className="text-[10px]">
              {suggestion.checkpointIds.length} {t('checkpointAnalysis.checkpoints', 'checkpoints')}
            </Badge>
          </div>
          {suggestion.kind && (
            <div className="text-muted-foreground/75 mb-0.5">{suggestion.kind}</div>
          )}
          <p className="text-muted-foreground">{suggestion.rationale}</p>
          <div className="mt-1 text-muted-foreground/75">
            {t('checkpointAnalysis.confidence', 'Confidence')}: {(suggestion.confidence * 100).toFixed(0)}%
          </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
};

export function ConnectedCheckpointAnalysisPanel({ className }: { className?: string }) {
  const { t } = useTranslation();
  const ideMessenger = useContext(IdeMessengerContext);
  const [groups, setGroups] = useState<GroupingSuggestion[]>([]);
  const [catalog, setCatalog] = useState<Array<{ id: string; description: string }>>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [analysis, setAnalysis] = useState<CheckpointAnalysisData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [listed, grouped] = await Promise.all([
          ideMessenger.request('listCheckpoints', { limit: 50, thisSessionOnly: false }),
          ideMessenger.request('suggestCheckpointGroups', { limit: 50 }),
        ]);
        if (cancelled) {
          return;
        }
        const nextCatalog = listed.status === 'success'
          ? (listed.content.compareCatalog ?? listed.content.checkpoints ?? []).map((item) => ({
              id: item.id,
              description: item.description,
            }))
          : [];
        setCatalog(nextCatalog);
        setGroups(grouped.status === 'success' && grouped.content.success ? grouped.content.groups : []);
        setSelectedId((current) => current || nextCatalog[0]?.id || '');
      } catch (error) {
        console.error('Failed to load checkpoint analysis:', error);
        if (!cancelled) {
          setCatalog([]);
          setGroups([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ideMessenger]);

  useEffect(() => {
    if (!selectedId) {
      setAnalysis(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const response = await ideMessenger.request('analyzeCheckpoint', { checkpointId: selectedId });
        if (cancelled) {
          return;
        }
        if (response.status === 'success' && response.content.success && response.content.analysis) {
          setAnalysis(response.content.analysis);
        } else {
          setAnalysis(null);
        }
      } catch (error) {
        console.error('Failed to analyze checkpoint:', error);
        if (!cancelled) {
          setAnalysis(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ideMessenger, selectedId]);

  if (loading) {
    return (
      <div className={cn('flex items-center gap-2 py-6 text-sm text-muted-foreground', className)}>
        <Loader2 className={`${CP_ICON} animate-spin`} />
        {t('checkpointAnalysis.loading', 'Loading analysis…')}
      </div>
    );
  }

  return (
    <div className={cn('space-y-3 py-2', className)}>
      <div>
        <h2 className="text-base font-semibold">{t('checkpointAnalysis.title', 'Analysis')}</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {t('checkpointAnalysis.subtitle', 'Local heuristics from manifests and diffs. Not an LLM summary.')}
        </p>
      </div>

      {catalog.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t('checkpointAnalysis.empty', 'No checkpoints to analyze.')}
        </p>
      ) : (
        <div className="space-y-1.5">
          <Label htmlFor="checkpoint-analysis-select" className="text-xs text-muted-foreground">
            {t('checkpointAnalysis.selectCheckpoint', 'Checkpoint')}
          </Label>
          <Select value={selectedId} onValueChange={setSelectedId}>
            <SelectTrigger id="checkpoint-analysis-select" className="h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {catalog.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.description || item.id.slice(0, 8)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {analysis ? (
        <CheckpointAnalysisPanel analysis={analysis} />
      ) : selectedId ? (
        <p className="text-sm text-muted-foreground">
          {t('checkpointAnalysis.unavailable', 'No analysis for this checkpoint.')}
        </p>
      ) : null}

      <GroupingSuggestionsList
        suggestions={groups}
        onGroupSelect={(group) => {
          const nextId = group.checkpointIds.find((id) => catalog.some((item) => item.id === id))
            ?? group.checkpointIds[0];
          if (nextId) {
            setSelectedId(nextId);
          }
        }}
      />
    </div>
  );
}

export default CheckpointAnalysisPanel;
