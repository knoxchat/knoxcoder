/**
 * Local share bundles panel.
 *
 * Share writes a checksummed bundle file (USB / email / PR artifact).
 * The list is this machine's audit of files it wrote — not a remote inbox.
 */

import React, { useContext, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Share2, Shield, Clock, FileText,
  ChevronDown, ChevronRight, Monitor, FolderOpen, Download, Loader2,
} from 'lucide-react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { cn } from '../../lib/utils';
import { IdeMessengerContext } from '../../context/IdeMessenger';
import { CP_ICON, CP_ICON_EMPTY, CP_ICON_META, compactTabsTriggerClass } from './checkpointUi';

export interface SharedBundle {
  id: string;
  description: string;
  sharedAt: string;
  checkpointCount: number;
  checkpointIds?: string[];
  filePath: string;
  sharedBy: string;
  machineId: string;
  exists?: boolean;
}

export interface AuditRecord {
  id: string;
  timestamp: string;
  userId: string;
  machineId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  outcome: string;
  details: string;
}

interface SharedBundlesSectionProps {
  bundles: SharedBundle[];
  onShare?: () => void;
  onImport?: (bundle: SharedBundle) => void;
  onReveal?: (bundle: SharedBundle) => void;
}

function SharedBundlesSection({ bundles, onShare, onImport, onReveal }: SharedBundlesSectionProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex min-w-0 items-center gap-1.5 text-sm font-semibold">
          <Share2 className={CP_ICON} />
          {t('checkpointShare.sharedBundles', 'Shared Bundles')}
        </h3>
        {onShare && (
          <Button size="sm" className="h-7 px-2 text-xs" onClick={onShare}>
            {t('checkpointShare.shareNew', 'Share Checkpoints')}
          </Button>
        )}
      </div>

      {bundles.length === 0 ? (
        <Card className="shadow-none">
          <CardContent className="flex flex-col items-center p-6 text-center text-muted-foreground">
            <Share2 className={`${CP_ICON_EMPTY} mb-2 opacity-50`} />
            <p className="text-sm">{t('checkpointShare.noBundles', 'No shared bundles yet')}</p>
            <p className="mt-1 text-xs">
              {t('checkpointShare.shareHint', 'Write a checksummed bundle file to share over USB, email, or a PR. Nothing is uploaded.')}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {bundles.map(bundle => (
            <Card key={bundle.id} className="shadow-none">
              <CardContent className="p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <p className="font-medium text-sm">{bundle.description || t('checkpointShare.untitled', 'Untitled bundle')}</p>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Monitor className={CP_ICON_META} />
                        {t('checkpointShare.thisMachine', 'This machine')}
                        {bundle.machineId && bundle.machineId !== 'unknown' ? ` · ${bundle.machineId.slice(0, 8)}` : ''}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className={CP_ICON_META} />
                        {new Date(bundle.sharedAt).toLocaleDateString()}
                      </span>
                    </div>
                    {bundle.filePath && (
                      <p className="flex items-center gap-1 truncate text-xs text-muted-foreground" title={bundle.filePath}>
                        <FileText className={`${CP_ICON_META} shrink-0`} />
                        {bundle.filePath}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Badge variant="secondary">
                      {bundle.checkpointCount} {t('checkpointShare.checkpointsLabel', 'checkpoints')}
                    </Badge>
                    {bundle.exists === false && (
                      <Badge variant="destructive">
                        {t('checkpointShare.missingFile', 'Missing file')}
                      </Badge>
                    )}
                  </div>
                </div>
                {(onImport || onReveal) && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {onImport && bundle.exists !== false && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 gap-1 px-2 text-xs"
                        onClick={() => onImport(bundle)}
                      >
                        <Download className={CP_ICON} />
                        {t('checkpointShare.import', 'Import')}
                      </Button>
                    )}
                    {onReveal && bundle.exists !== false && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 gap-1 px-2 text-xs"
                        onClick={() => onReveal(bundle)}
                      >
                        <FolderOpen className={CP_ICON} />
                        {t('checkpointShare.reveal', 'Show in Explorer')}
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

interface AuditTrailSectionProps {
  records: AuditRecord[];
}

function isSuccessOutcome(outcome: string): boolean {
  return outcome === 'success' || outcome.includes('Success');
}

function isFailureOutcome(outcome: string): boolean {
  return outcome === 'failure' || outcome.includes('Failure');
}

function AuditTrailSection({ records }: AuditTrailSectionProps) {
  const { t } = useTranslation();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const getActionColor = (action: string) => {
    if (action.includes('create') || action.includes('share')) return 'odp-text-green';
    if (action.includes('delete') || action.includes('remove')) return 'odp-text-red';
    if (action.includes('restore') || action.includes('rollback')) return 'odp-text-orange';
    return 'odp-text-blue';
  };

  const getOutcomeVariant = (outcome: string): 'default' | 'destructive' | 'secondary' => {
    if (isSuccessOutcome(outcome)) return 'default';
    if (isFailureOutcome(outcome)) return 'destructive';
    return 'secondary';
  };

  return (
    <div className="space-y-3">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold">
        <Shield className={CP_ICON} />
        {t('checkpointShare.auditTrail', 'Audit Trail')}
      </h3>

      {records.length === 0 ? (
        <Card className="shadow-none">
          <CardContent className="flex flex-col items-center p-6 text-center text-muted-foreground">
            <Shield className={`${CP_ICON_EMPTY} mb-2 opacity-50`} />
            <p className="text-sm">{t('checkpointShare.noAudit', 'No audit records')}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="max-h-96 space-y-1 overflow-y-auto">
          {records.map(record => (
            <Card key={record.id} className="shadow-none">
              <button
                onClick={() => setExpandedId(expandedId === record.id ? null : record.id)}
                className="flex w-full items-center gap-2 p-2 text-sm transition-colors hover:bg-accent/50"
              >
                {expandedId === record.id ? (
                  <ChevronDown className={`${CP_ICON_META} shrink-0`} />
                ) : (
                  <ChevronRight className={`${CP_ICON_META} shrink-0`} />
                )}
                <span className={cn('font-mono text-xs', getActionColor(record.action))}>
                  {record.action}
                </span>
                <span className="min-w-0 flex-1 truncate text-left text-muted-foreground">
                  {record.resourceType}/{record.resourceId.slice(0, 8)}...
                </span>
                <Badge variant={getOutcomeVariant(record.outcome)} className="text-xs">
                  {isSuccessOutcome(record.outcome) ? 'OK' : isFailureOutcome(record.outcome) ? 'FAIL' : 'PARTIAL'}
                </Badge>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {new Date(record.timestamp).toLocaleTimeString()}
                </span>
              </button>

              {expandedId === record.id && (
                <div className="space-y-1 border-t bg-muted/30 px-4 pb-3 pt-1 text-xs">
                  <div className="flex gap-4">
                    <span><strong>{t('checkpointShare.machine', 'Machine')}:</strong> {record.machineId || record.userId}</span>
                  </div>
                  <div>
                    <strong>{t('checkpointShare.resource', 'Resource')}:</strong> {record.resourceType} / {record.resourceId}
                  </div>
                  {record.details && record.details !== '{}' && (
                    <div>
                      <strong>{t('checkpointShare.details', 'Details')}:</strong>
                      <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 text-xs">
                        {record.details}
                      </pre>
                    </div>
                  )}
                  <div>
                    <strong>{t('checkpointShare.outcome', 'Outcome')}:</strong> {record.outcome}
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

interface CollaborativePanelProps {
  bundles: SharedBundle[];
  auditRecords: AuditRecord[];
  onShare?: () => void;
  onImport?: (bundle: SharedBundle) => void;
  onReveal?: (bundle: SharedBundle) => void;
  className?: string;
}

export function CollaborativePanel({
  bundles,
  auditRecords,
  onShare,
  onImport,
  onReveal,
  className,
}: CollaborativePanelProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'shared' | 'audit'>('shared');

  return (
    <div className={cn('space-y-3 py-2', className)}>
      <div>
        <h2 className="flex items-center gap-1.5 text-base font-semibold">
          <Share2 className={CP_ICON} />
          {t('checkpointShare.title', 'Share Bundles')}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {t('checkpointShare.subtitle', 'Local files only. Share is an export you can copy; this list is not a network inbox.')}
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as typeof activeTab)} className="gap-3">
        <TabsList className="grid h-8 w-full grid-cols-2 gap-0.5 rounded-md bg-muted p-0.5">
          <TabsTrigger value="shared" className={cn(compactTabsTriggerClass, 'gap-1')}>
            <Share2 className={CP_ICON} />
            {t('checkpointShare.shared', 'Shared')}
            {bundles.length > 0 && (
              <Badge variant="secondary" className="ml-0.5 h-4 px-1 text-[10px]">{bundles.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="audit" className={cn(compactTabsTriggerClass, 'gap-1')}>
            <Shield className={CP_ICON} />
            {t('checkpointShare.audit', 'Audit Trail')}
            {auditRecords.length > 0 && (
              <Badge variant="secondary" className="ml-0.5 h-4 px-1 text-[10px]">{auditRecords.length}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="shared" className="mt-0">
          <SharedBundlesSection
            bundles={bundles}
            onShare={onShare}
            onImport={onImport}
            onReveal={onReveal}
          />
        </TabsContent>

        <TabsContent value="audit" className="mt-0">
          <AuditTrailSection records={auditRecords} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export function ConnectedCollaborativePanel({ className }: { className?: string }) {
  const { t } = useTranslation();
  const ideMessenger = useContext(IdeMessengerContext);
  const [bundles, setBundles] = useState<SharedBundle[]>([]);
  const [auditRecords, setAuditRecords] = useState<AuditRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    const response = await ideMessenger.request('getSharedCheckpointBundles', { limit: 100 });
    if (response.status === 'success' && response.content.success) {
      setBundles(response.content.bundles ?? []);
      setAuditRecords(response.content.auditRecords ?? []);
    } else {
      setBundles([]);
      setAuditRecords([]);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await ideMessenger.request('getSharedCheckpointBundles', { limit: 100 });
        if (cancelled) {
          return;
        }
        if (response.status === 'success' && response.content.success) {
          setBundles(response.content.bundles ?? []);
          setAuditRecords(response.content.auditRecords ?? []);
        } else {
          setBundles([]);
          setAuditRecords([]);
        }
      } catch (error) {
        console.error('Failed to load shared checkpoint bundles:', error);
        if (!cancelled) {
          setBundles([]);
          setAuditRecords([]);
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

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Loader2 className={`${CP_ICON} animate-spin`} />
        {t('checkpointShare.loading', 'Loading share bundles…')}
      </div>
    );
  }

  return (
    <CollaborativePanel
      className={className}
      bundles={bundles}
      auditRecords={auditRecords}
      onShare={async () => {
        const response = await ideMessenger.request('shareCheckpoints', {});
        if (response.status === 'success' && response.content.success) {
          await reload();
        }
      }}
      onImport={async (bundle) => {
        const response = await ideMessenger.request('importSharedBundle', { filePath: bundle.filePath });
        if (response.status === 'success' && response.content.success) {
          await reload();
        }
      }}
      onReveal={async (bundle) => {
        await ideMessenger.request('revealSharedBundle', { filePath: bundle.filePath });
      }}
    />
  );
}
