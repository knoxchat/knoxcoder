/**
 * Enhanced Checkpoint Timeline with Visual Branching and Navigation
 * 
 * Features:
 * - Visual timeline with connected checkpoints
 * - Branch visualization
 * - Quick navigation and preview
 * - Comparison mode
 * - Search and filtering
 * - Keyboard shortcuts
 */

import React, { useState, useMemo, useCallback, useRef, useEffect, useContext } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { IdeMessengerContext } from '../../context/IdeMessenger';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import { Separator } from '../ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import {
  GitBranch,
  GitCommit,
  GitMerge,
  Clock,
  Search,
  ChevronRight,
  ChevronDown,
  Eye,
  RotateCcw,
  Trash2,
  Calendar,
  Zap,
  Bot,
  User,
  History,
  Loader2,
} from 'lucide-react';
import { RiskBadge, CheckpointAnalysisData } from './CheckpointAnalysisPanel';
import { CheckpointCompareDialog } from './CheckpointCompareDialog';
import { RestorePreviewDialog } from './RestorePreviewDialog';
import { CP_ICON, CP_ICON_EMPTY, CP_ICON_META, ODP_TYPE_CLASS, remapBranchColor, useCheckpointThemeType } from './checkpointUi';

export interface CheckpointTimelineItem {
  id: string;
  description: string;
  created: Date;
  type: 'manual' | 'auto' | 'ai' | 'merge' | 'branch-point';
  branch?: string;
  parentId?: string;
  childIds?: string[];
  tags?: string[];
  fileChanges?: {
    added: number;
    modified: number;
    deleted: number;
  };
  metadata?: {
    messageContent?: string;
    role?: string;
    aiModel?: string;
    duration?: number;
  };
  analysis?: CheckpointAnalysisData;
  isIncremental?: boolean;
  deltaDepth?: number;
}

export interface TimelineBranch {
  id: string;
  name: string;
  color: string;
  baseCheckpointId: string;
  checkpoints: string[];
  isActive: boolean;
}

interface CheckpointTimelineProps {
  checkpoints: CheckpointTimelineItem[];
  branches?: TimelineBranch[];
  currentCheckpointId?: string;
  onCheckpointSelect: (checkpoint: CheckpointTimelineItem) => void;
  onCheckpointRestore: (checkpointId: string) => void;
  onCheckpointDelete: (checkpointId: string) => void;
  onCompare?: (checkpointId1: string, checkpointId2: string) => void;
  onBranchCreate?: (baseCheckpointId: string, branchName: string) => void;
  onBranchSwitch?: (branchId: string) => void;
}

function getCheckpointIcon(type: CheckpointTimelineItem['type']) {
  switch (type) {
    case 'auto':
      return <Zap className={CP_ICON_META} />;
    case 'ai':
      return <Bot className={CP_ICON_META} />;
    case 'merge':
      return <GitMerge className={CP_ICON_META} />;
    case 'branch-point':
      return <GitBranch className={CP_ICON_META} />;
    default:
      return <GitCommit className={CP_ICON_META} />;
  }
}

function getTypeColor(type: CheckpointTimelineItem['type']) {
  return ODP_TYPE_CLASS[type];
}

// Format relative time
function formatRelativeTime(date: Date, t: (key: string, opts?: any) => string): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 1) return t('justNow');
  if (diffMins < 60) return t('minutesAgo', { count: diffMins });
  if (diffHours < 24) return t('hoursAgo', { count: diffHours });
  if (diffDays < 7) return t('daysAgo', { count: diffDays });
  
  return date.toLocaleDateString();
}

export function CheckpointTimeline({
  checkpoints,
  branches = [],
  currentCheckpointId,
  onCheckpointSelect,
  onCheckpointRestore,
  onCheckpointDelete,
  onCompare,
  onBranchCreate,
  onBranchSwitch,
}: CheckpointTimelineProps) {
  const { t } = useTranslation();
  const themeType = useCheckpointThemeType();
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<string | null>(null);
  const [selectedForCompare, setSelectedForCompare] = useState<string | null>(null);
  const [expandedCheckpoints, setExpandedCheckpoints] = useState<Set<string>>(new Set());
  const [hoveredCheckpoint, setHoveredCheckpoint] = useState<string | null>(null);
  const [showBranches, setShowBranches] = useState(true);
  
  const timelineRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Filter and sort checkpoints
  const filteredCheckpoints = useMemo(() => {
    let filtered = checkpoints;
    
    // Apply search filter
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(cp => 
        cp.description.toLowerCase().includes(term) ||
        cp.id.toLowerCase().includes(term) ||
        cp.tags?.some(tag => tag.toLowerCase().includes(term))
      );
    }
    
    // Apply type filter
    if (filterType) {
      filtered = filtered.filter(cp => cp.type === filterType);
    }
    
    // Sort by date (newest first)
    return filtered.sort((a, b) => b.created.getTime() - a.created.getTime());
  }, [checkpoints, searchTerm, filterType]);

  // Group checkpoints by date
  const groupedCheckpoints = useMemo(() => {
    const groups: { date: string; checkpoints: CheckpointTimelineItem[] }[] = [];
    let currentDate = '';
    
    filteredCheckpoints.forEach(cp => {
      const dateStr = cp.created.toDateString();
      if (dateStr !== currentDate) {
        currentDate = dateStr;
        groups.push({ date: dateStr, checkpoints: [] });
      }
      groups[groups.length - 1].checkpoints.push(cp);
    });
    
    return groups;
  }, [filteredCheckpoints]);

  // Handle compare mode
  const handleCompareClick = useCallback((checkpointId: string) => {
    if (!selectedForCompare) {
      setSelectedForCompare(checkpointId);
    } else if (selectedForCompare !== checkpointId) {
      onCompare?.(selectedForCompare, checkpointId);
      setSelectedForCompare(null);
    }
  }, [selectedForCompare, onCompare]);

  // Cancel compare mode
  const cancelCompare = useCallback(() => {
    setSelectedForCompare(null);
  }, []);

  // Toggle checkpoint expansion
  const toggleExpanded = useCallback((checkpointId: string) => {
    setExpandedCheckpoints(prev => {
      const next = new Set(prev);
      if (next.has(checkpointId)) {
        next.delete(checkpointId);
      } else {
        next.add(checkpointId);
      }
      return next;
    });
  }, []);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '/' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
      if (e.key === 'Escape') {
        cancelCompare();
        setSearchTerm('');
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [cancelCompare]);

  // Render checkpoint node
  const renderCheckpointNode = (checkpoint: CheckpointTimelineItem, isLast: boolean) => {
    const isSelected = checkpoint.id === currentCheckpointId;
    const isExpanded = expandedCheckpoints.has(checkpoint.id);
    const isHovered = hoveredCheckpoint === checkpoint.id;
    const isCompareSelected = selectedForCompare === checkpoint.id;
    const hasBadges = Boolean(checkpoint.analysis?.riskAssessment || checkpoint.isIncremental);
    
    // Find branch color
    const branch = branches.find(b => b.checkpoints.includes(checkpoint.id));
    const branchColor = remapBranchColor(branch?.color, themeType);
    
    return (
      <div
        key={checkpoint.id}
        className={cn(
          "group flex min-w-0 items-stretch gap-2",
          isCompareSelected && "rounded-lg ring-1 ring-inset ring-primary"
        )}
        data-testid="checkpoint-timeline-item"
        onMouseEnter={() => setHoveredCheckpoint(checkpoint.id)}
        onMouseLeave={() => setHoveredCheckpoint(null)}
      >
        {/* Rail stays aligned as the card height changes */}
        <div className="flex w-5 shrink-0 flex-col items-center" aria-hidden>
          <div
            className={cn(
              "relative z-10 mt-2 flex size-5 items-center justify-center rounded-full",
              getTypeColor(checkpoint.type)
            )}
          >
            {getCheckpointIcon(checkpoint.type)}
          </div>
          {!isLast && (
            <div
              className="mt-1 w-px min-h-3 flex-1 opacity-50"
              style={{ backgroundColor: branchColor }}
            />
          )}
        </div>
        
        {/* Checkpoint card */}
        <div
          className={cn(
            "@container mb-3 min-w-0 flex-1 overflow-hidden rounded-lg border p-2.5 transition-all cursor-pointer",
            isLast && "mb-0",
            isSelected && "bg-primary/5 border-primary",
            !isSelected && "bg-card hover:bg-muted/50",
            isHovered && "shadow-md"
          )}
          data-testid="checkpoint-timeline-card"
          onClick={() => onCheckpointSelect(checkpoint)}
        >
          <div className="flex min-w-0 items-start gap-1.5">
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex min-w-0 items-start gap-1.5">
                {branch && (
                  <span
                    className="mt-1.5 size-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: branchColor }}
                    title={branch.name}
                  />
                )}
                <span
                  className="min-w-0 flex-1 text-sm font-medium leading-snug break-words [overflow-wrap:anywhere] line-clamp-2"
                  title={checkpoint.description}
                >
                  {checkpoint.description}
                </span>
              </div>
              
              {/* Meta info */}
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                <span className="inline-flex min-w-0 max-w-full items-center gap-1">
                  <Clock className={CP_ICON_META} />
                  <span className="min-w-0 truncate">{formatRelativeTime(checkpoint.created, t)}</span>
                </span>
                <span className="shrink-0 font-mono">{checkpoint.id.substring(0, 8)}</span>
                
                {checkpoint.fileChanges && (
                  <span className="inline-flex shrink-0 items-center gap-1 tabular-nums">
                    {checkpoint.fileChanges.added > 0 && (
                      <span className="odp-text-green">+{checkpoint.fileChanges.added}</span>
                    )}
                    {checkpoint.fileChanges.modified > 0 && (
                      <span className="odp-text-yellow">~{checkpoint.fileChanges.modified}</span>
                    )}
                    {checkpoint.fileChanges.deleted > 0 && (
                      <span className="odp-text-red">-{checkpoint.fileChanges.deleted}</span>
                    )}
                  </span>
                )}
              </div>
              
              {hasBadges && (
                <div className="flex min-w-0 flex-wrap items-center gap-1">
                  {checkpoint.analysis?.riskAssessment && (
                    <RiskBadge level={checkpoint.analysis.riskAssessment.level} compact />
                  )}
                  {checkpoint.isIncremental && (
                    <Badge variant="outline" className="odp-chip odp-chip-purple border px-1 py-0 shadow-none">
                      Δ{checkpoint.deltaDepth || 0}
                    </Badge>
                  )}
                </div>
              )}

              {checkpoint.tags && checkpoint.tags.length > 0 && (
                <div className="flex min-w-0 flex-wrap gap-1">
                  {checkpoint.tags.map(tag => (
                    <Badge key={tag} variant="outline" className="max-w-full truncate text-[10px] px-1 py-0">
                      {tag}
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            <button
              type="button"
              className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-expanded={isExpanded}
              aria-label={isExpanded ? t('collapse', 'Collapse') : t('expand', 'Expand')}
              onClick={(e) => {
                e.stopPropagation();
                toggleExpanded(checkpoint.id);
              }}
            >
              {isExpanded ? (
                <ChevronDown className={CP_ICON_META} />
              ) : (
                <ChevronRight className={CP_ICON_META} />
              )}
            </button>
          </div>
          
          {/* Expanded content */}
          {isExpanded && (
            <div className="mt-2.5 space-y-2 border-t pt-2.5">
              {checkpoint.metadata?.messageContent && (
                <div className="rounded bg-muted/50 p-2 text-xs">
                  <div className="mb-1 flex min-w-0 items-center gap-1 text-muted-foreground">
                    {checkpoint.metadata.role === 'user' ? (
                      <User className={CP_ICON_META} />
                    ) : (
                      <Bot className={CP_ICON_META} />
                    )}
                    <span className="truncate">{checkpoint.metadata.role === 'user' ? t('user') : t('ai')}</span>
                  </div>
                  <p className="min-w-0 break-words [overflow-wrap:anywhere] line-clamp-3">{checkpoint.metadata.messageContent}</p>
                </div>
              )}
              
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 shrink-0 gap-1 px-2 text-xs"
                  aria-label={t('restore')}
                  onClick={(e) => {
                    e.stopPropagation();
                    onCheckpointRestore(checkpoint.id);
                  }}
                >
                  <RotateCcw className={CP_ICON} />
                  <span className="hidden @[18rem]:inline">{t('restore')}</span>
                </Button>
                
                {onCompare && (
                  <Button
                    variant={isCompareSelected ? "default" : "outline"}
                    size="sm"
                    className="h-7 shrink-0 gap-1 px-2 text-xs"
                    aria-label={isCompareSelected ? t('selectSecond') : t('compare')}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCompareClick(checkpoint.id);
                    }}
                  >
                    <Eye className={CP_ICON} />
                    <span className="hidden @[18rem]:inline">
                      {isCompareSelected ? t('selectSecond') : t('compare')}
                    </span>
                  </Button>
                )}
                
                {onBranchCreate && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 shrink-0 gap-1 px-2 text-xs"
                    aria-label={t('branch')}
                    onClick={(e) => {
                      e.stopPropagation();
                      const name = prompt(t('enterBranchName'));
                      if (name) {
                        onBranchCreate(checkpoint.id, name);
                      }
                    }}
                  >
                    <GitBranch className={CP_ICON} />
                    <span className="hidden @[18rem]:inline">{t('branch')}</span>
                  </Button>
                )}
                
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 shrink-0 gap-1 px-2 text-xs text-destructive hover:text-destructive"
                  aria-label={t('deleteAction')}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(t('deleteCheckpointConfirm'))) {
                      onCheckpointDelete(checkpoint.id);
                    }
                  }}
                >
                  <Trash2 className={CP_ICON} />
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="@container flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 space-y-2 border-b p-2">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <History className={`${CP_ICON} text-primary`} />
            <span className="truncate text-sm font-medium">{t('timeline')}</span>
            <Badge variant="secondary" className="shrink-0 text-[11px] font-normal">
              {filteredCheckpoints.length}
            </Badge>
          </div>
          
          {branches.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 max-w-[min(12rem,50%)] shrink-0 gap-1 px-2 text-xs"
              onClick={() => setShowBranches(!showBranches)}
            >
              <GitBranch className={CP_ICON} />
              <span className="truncate">
                {branches.find(b => b.isActive)?.name
                  ?? t('checkpointTimeline.noActiveBranch', 'No active line')}
              </span>
            </Button>
          )}
        </div>
        
        <div className="flex min-w-0 flex-col gap-2 @[22rem]:flex-row @[22rem]:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className={`absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground ${CP_ICON}`} />
            <Input
              ref={searchInputRef}
              placeholder={t('searchCheckpoints')}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="h-8 pl-8 text-sm"
            />
          </div>
          
          <Select
            value={filterType || 'all'}
            onValueChange={(value) => setFilterType(value === 'all' ? null : value)}
          >
            <SelectTrigger className="h-8 w-full shrink-0 text-xs @[22rem]:w-[7.5rem]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('allTypes')}</SelectItem>
              <SelectItem value="manual">{t('manual')}</SelectItem>
              <SelectItem value="auto">{t('auto')}</SelectItem>
              <SelectItem value="ai">{t('ai')}</SelectItem>
              <SelectItem value="merge">{t('merge')}</SelectItem>
              <SelectItem value="branch-point">{t('branchPoint')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        
        {/* Compare mode indicator */}
        {selectedForCompare && (
          <div className="flex min-w-0 items-center justify-between gap-2 rounded bg-primary/10 p-2">
            <span className="min-w-0 text-xs">
              {t('selectCheckpointToCompare')}{' '}
              <code className="break-all font-mono">{selectedForCompare.substring(0, 8)}</code>
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 shrink-0 text-xs"
              onClick={cancelCompare}
            >
              {t('cancel')}
            </Button>
          </div>
        )}
      </div>
      
      {/* Branch list (collapsible) */}
      {showBranches && branches.length > 0 && (
        <div className="shrink-0 border-b bg-muted/30 p-2">
          <div className="flex min-w-0 items-center gap-2 overflow-x-auto">
            {branches.map(branch => (
              <Button
                key={branch.id}
                variant={branch.isActive ? "default" : "outline"}
                size="sm"
                className="h-6 max-w-[10rem] shrink-0 text-xs"
                onClick={() => onBranchSwitch?.(branch.id)}
              >
                <div 
                  className="mr-1 size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: remapBranchColor(branch.color, themeType) }}
                />
                <span className="truncate">{branch.name}</span>
              </Button>
            ))}
          </div>
        </div>
      )}
      
      {/* Timeline */}
      <div ref={timelineRef} className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-2 py-3">
          {groupedCheckpoints.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              <History className={`${CP_ICON_EMPTY} mx-auto mb-2 opacity-30`} />
              <p className="text-sm">{t('noCheckpointsFound')}</p>
              {searchTerm && (
                <Button
                  variant="link"
                  size="sm"
                  onClick={() => setSearchTerm('')}
                >
                  {t('clearSearch')}
                </Button>
              )}
            </div>
          ) : (
            groupedCheckpoints.map(group => (
              <div key={group.date} className="mb-5 min-w-0 last:mb-0">
                {/* Date header */}
                <div className="mb-2 flex min-w-0 items-center gap-2">
                  <Calendar className={`${CP_ICON_META} shrink-0 text-muted-foreground`} />
                  <span className="min-w-0 truncate text-xs font-medium text-muted-foreground">
                    {new Date(group.date).toLocaleDateString(undefined, {
                      weekday: 'long',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </span>
                  <Separator className="min-w-0 flex-1" />
                </div>
                
                {/* Checkpoints */}
                <div className="min-w-0">
                  {group.checkpoints.map((cp, idx) =>
                    renderCheckpointNode(cp, idx === group.checkpoints.length - 1)
                  )}
                </div>
              </div>
            ))
          )}
      </div>
      
      {/* Footer stats */}
      <div className="shrink-0 border-t bg-muted/30 px-2 py-1.5 text-xs text-muted-foreground">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
          <span className="min-w-0 truncate">
            {t('totalCheckpoints', { count: checkpoints.length })}
          </span>
          <span className="min-w-0 truncate">
            {t('checkpointTimeline.totalBranches', { count: branches.length, defaultValue: '{{count}} lines' })}
          </span>
        </div>
      </div>
    </div>
  );
}

function toTimelineItem(item: {
  id: string;
  description: string;
  created: string;
  type: CheckpointTimelineItem['type'];
  branchId?: string;
  parentId?: string;
  tags: string[];
  fileChanges?: CheckpointTimelineItem['fileChanges'];
  metadata?: CheckpointTimelineItem['metadata'];
  isIncremental: boolean;
}): CheckpointTimelineItem {
  return {
    id: item.id,
    description: item.description,
    created: new Date(item.created),
    type: item.type,
    branch: item.branchId,
    parentId: item.parentId,
    tags: item.tags,
    fileChanges: item.fileChanges,
    metadata: item.metadata,
    isIncremental: item.isIncremental,
  };
}

export function ConnectedCheckpointTimeline({ className }: { className?: string }) {
  const { t } = useTranslation();
  const ideMessenger = useContext(IdeMessengerContext);
  const [checkpoints, setCheckpoints] = useState<CheckpointTimelineItem[]>([]);
  const [branches, setBranches] = useState<TimelineBranch[]>([]);
  const [currentCheckpointId, setCurrentCheckpointId] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [restoreId, setRestoreId] = useState<string | null>(null);
  const [comparePair, setComparePair] = useState<{ leftId: string; rightId: string } | null>(null);

  const reload = useCallback(async () => {
    const response = await ideMessenger.request('getCheckpointTimeline', { limit: 500 });
    if (response.status === 'success' && response.content.success) {
      const items = (response.content.checkpoints ?? []).map(toTimelineItem);
      setCheckpoints(items);
      setBranches(response.content.branches ?? []);
      const active = (response.content.branches ?? []).find((branch) => branch.isActive);
      setCurrentCheckpointId(active?.checkpoints[0] ?? items[0]?.id);
    } else {
      setCheckpoints([]);
      setBranches([]);
    }
  }, [ideMessenger]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await reload();
      } catch (error) {
        console.error('Failed to load checkpoint timeline:', error);
        if (!cancelled) {
          setCheckpoints([]);
          setBranches([]);
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
  }, [reload]);

  if (loading) {
    return (
      <p className={cn('flex items-center gap-2 py-6 text-sm text-muted-foreground', className)}>
        <Loader2 className={`${CP_ICON} animate-spin`} />
        {t('checkpointTimeline.loading', 'Loading timeline…')}
      </p>
    );
  }

  return (
    <div className={cn('h-full min-h-0 min-w-0', className)}>
      <CheckpointTimeline
        checkpoints={checkpoints}
        branches={branches}
        currentCheckpointId={currentCheckpointId}
        onCheckpointSelect={(checkpoint) => setCurrentCheckpointId(checkpoint.id)}
        onCheckpointRestore={(checkpointId) => setRestoreId(checkpointId)}
        onCheckpointDelete={async (checkpointId) => {
          const response = await ideMessenger.request('deleteCheckpoints', {
            checkpointIds: [checkpointId],
          });
          if (response.status === 'success' && response.content.success) {
            await reload();
          }
        }}
        onCompare={(leftId, rightId) => setComparePair({ leftId, rightId })}
        onBranchCreate={async (baseCheckpointId, branchName) => {
          const response = await ideMessenger.request('createCheckpointBranch', {
            name: branchName,
            baseCheckpointId,
          });
          if (response.status === 'success' && response.content.success) {
            await reload();
          }
        }}
        onBranchSwitch={async (branchId) => {
          const response = await ideMessenger.request('switchCheckpointBranch', { branchId });
          if (response.status === 'success' && response.content.success) {
            await reload();
          }
        }}
      />
      {restoreId && (
        <RestorePreviewDialog
          open={true}
          checkpointId={restoreId}
          checkpointDescription={checkpoints.find((item) => item.id === restoreId)?.description}
          onOpenChange={(open) => {
            if (!open) {
              setRestoreId(null);
            }
          }}
        />
      )}
      <CheckpointCompareDialog
        open={comparePair !== null}
        leftId={comparePair?.leftId ?? null}
        rightId={comparePair?.rightId ?? null}
        leftLabel={checkpoints.find((item) => item.id === comparePair?.leftId)?.description}
        rightLabel={checkpoints.find((item) => item.id === comparePair?.rightId)?.description}
        onOpenChange={(open) => {
          if (!open) {
            setComparePair(null);
          }
        }}
      />
    </div>
  );
}
