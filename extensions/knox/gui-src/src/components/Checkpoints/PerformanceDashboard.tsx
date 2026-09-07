/**
 * Performance Monitoring Dashboard
 * 
 * Displays storage usage trends, checkpoint creation frequency,
 * restoration success rates, and AI session metrics.
 */

import React, { useContext, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { 
  BarChart3, Database, HardDrive, Activity, 
  CheckCircle, XCircle, Clock, TrendingUp, Bot, Loader2
} from 'lucide-react';
import { Badge } from '../ui/badge';
import { Card, CardContent } from '../ui/card';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '../ui/chart';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Skeleton } from '../ui/skeleton';
import { cn } from '../../lib/utils';
import { IdeMessengerContext } from '../../context/IdeMessenger';
import {
  CP_ICON,
  compactTabsTriggerClass,
  useCheckpointThemeType,
} from './checkpointUi';

const CREATION_BAR_FILL = { dark: '#c4b5fd', light: '#7c3aed' } as const;
const STORAGE_LINE_FILL = { dark: '#38bdf8', light: '#0284c7' } as const;

const CREATION_CHART_CONFIG = {
  count: {
    label: 'Checkpoints',
    color: CREATION_BAR_FILL.dark,
  },
} satisfies ChartConfig;

const STORAGE_CHART_CONFIG = {
  bytes: {
    label: 'Storage',
    color: STORAGE_LINE_FILL.dark,
  },
} satisfies ChartConfig;

const CHART_MARGIN = { left: 4, right: 8, top: 10, bottom: 4 } as const;
const USAGE_CHART_CLASS = 'aspect-auto h-[228px] w-full min-h-[200px]';
const CHART_MIN_DAYS = 14;

// ========================================
// Types
// ========================================

export interface StorageUsageSnapshot {
  timestamp: string;
  totalBytes: number;
  checkpointDataBytes: number;
  blobCount: number;
  checkpointCount: number;
}

export interface CreationFrequencyPoint {
  bucket: string;
  count: number;
}

export interface RestorationEvent {
  timestamp: string;
  checkpointId: string;
  success: boolean;
  durationMs: number;
  filesRestored: number;
  filesFailed: number;
  error?: string;
}

export interface AISessionMetric {
  sessionId: string;
  startedAt: string;
  endedAt?: string;
  filesChanged: number;
  linesAdded?: number;
  linesDeleted?: number;
  checkpointsCreated: number;
  rollbacks?: number;
  durationSeconds: number;
}

export interface DashboardSummary {
  totalCheckpointsCreated: number;
  totalRestorations: number;
  restorationSuccessRate: number;
  avgCreationTimeMs: number;
  avgRestorationTimeMs: number;
  totalAiSessions: number;
  avgChangesPerSession: number;
  totalRollbacks: number;
}

export interface PerformanceDashboardData {
  currentStorage: StorageUsageSnapshot;
  storageHistory: StorageUsageSnapshot[];
  creationFrequency: CreationFrequencyPoint[];
  restorationEvents: RestorationEvent[];
  aiSessionMetrics: AISessionMetric[];
  summary: DashboardSummary;
}

// ========================================
// Helper Functions
// ========================================

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

export function utcDayKey(iso: string): string {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) {
    return iso.slice(0, 10);
  }
  return new Date(parsed).toISOString().slice(0, 10);
}

export function formatChartTick(isoDay: string): string {
  const parsed = Date.parse(`${isoDay.slice(0, 10)}T00:00:00.000Z`);
  if (!Number.isFinite(parsed)) {
    return isoDay;
  }
  const date = new Date(parsed);
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
}

export function compactAxisNumber(value: number): string {
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    return `${millions >= 10 || millions % 1 === 0 ? millions.toFixed(0) : millions.toFixed(1)}M`;
  }
  if (value >= 1_000) {
    const thousands = value / 1_000;
    return `${thousands >= 10 || thousands % 1 === 0 ? thousands.toFixed(0) : thousands.toFixed(1)}k`;
  }
  return String(Math.round(value));
}

export function fillDailyCounts(
  points: Array<{ bucket: string; count: number }>,
  minDays: number = CHART_MIN_DAYS,
): Array<{ date: string; count: number; iso: string }> {
  const byDay = new Map<string, number>();
  for (const point of points) {
    const key = utcDayKey(point.bucket);
    byDay.set(key, (byDay.get(key) ?? 0) + point.count);
  }

  const keys = [...byDay.keys()].sort();
  const end = keys.length > 0
    ? new Date(`${keys[keys.length - 1]}T00:00:00.000Z`)
    : new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  const paddedStart = new Date(end);
  paddedStart.setUTCDate(paddedStart.getUTCDate() - (Math.max(minDays, 1) - 1));
  const dataStart = keys.length > 0 ? new Date(`${keys[0]}T00:00:00.000Z`) : paddedStart;
  const start = dataStart < paddedStart ? dataStart : paddedStart;

  const maxSpanMs = 30 * 24 * 60 * 60 * 1000;
  const clampedStart = end.getTime() - start.getTime() > maxSpanMs
    ? new Date(end.getTime() - maxSpanMs)
    : start;

  const rows: Array<{ date: string; count: number; iso: string }> = [];
  for (let cursor = new Date(clampedStart); cursor.getTime() <= end.getTime(); cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const iso = cursor.toISOString().slice(0, 10);
    rows.push({
      iso,
      date: formatChartTick(iso),
      count: byDay.get(iso) ?? 0,
    });
  }
  return rows;
}

export function fillDailyCarryForward(
  points: Array<{ bucket: string; value: number }>,
  minDays: number = CHART_MIN_DAYS,
): Array<{ date: string; value: number; iso: string }> {
  const byDay = new Map<string, number>();
  for (const point of [...points].sort((a, b) => a.bucket.localeCompare(b.bucket))) {
    byDay.set(utcDayKey(point.bucket), point.value);
  }
  const skeleton = fillDailyCounts(
    [...byDay.entries()].map(([bucket, count]) => ({ bucket, count })),
    minDays,
  );
  let last = 0;
  return skeleton.map((row) => {
    if (byDay.has(row.iso)) {
      last = byDay.get(row.iso) ?? last;
    }
    return { date: row.date, iso: row.iso, value: last };
  });
}

function xAxisInterval(length: number): number {
  if (length <= 8) {
    return 0;
  }
  return Math.max(0, Math.ceil(length / 7) - 1);
}

// ========================================
// Stat Card Component
// ========================================

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  subtitle?: string;
  className?: string;
}

function StatCard({ icon, label, value, subtitle, className }: StatCardProps) {
  return (
    <Card className={cn('shadow-none', className)}>
      <CardContent className="flex items-center gap-2.5 p-2.5">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground [&>svg]:size-4">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-muted-foreground" title={label}>{label}</p>
          <p className="truncate text-lg font-semibold leading-tight tabular-nums">{value}</p>
          {subtitle && <p className="truncate text-[11px] text-muted-foreground">{subtitle}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

// ========================================
// Storage Usage Section
// ========================================

interface StorageUsageSectionProps {
  current: StorageUsageSnapshot;
  history: StorageUsageSnapshot[];
}

function StorageUsageSection({ current, history }: StorageUsageSectionProps) {
  const { t } = useTranslation();
  const theme = useCheckpointThemeType();
  const barFill = STORAGE_LINE_FILL[theme];
  const chartData = useMemo(
    () =>
      fillDailyCarryForward(
        history.map((snap) => ({ bucket: snap.timestamp, value: snap.totalBytes })),
      ).map((row) => ({ date: row.date, bytes: row.value })),
    [history],
  );
  const dayCount = chartData.length;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-medium">
          <HardDrive className={CP_ICON} />
          {t('checkpointDashboard.storageUsage', 'Storage Usage')}
        </h3>
      </div>
      
      <div className="grid grid-cols-1 gap-2 min-[380px]:grid-cols-2">
        <StatCard
          icon={<Database />}
          label={t('checkpointDashboard.totalStorage', 'Total Storage')}
          value={formatBytes(current.totalBytes)}
        />
        <StatCard
          icon={<HardDrive />}
          label={t('checkpointDashboard.checkpoints', 'Checkpoints')}
          value={current.checkpointCount}
          subtitle={`${current.blobCount} blobs`}
        />
      </div>

      {history.length > 0 && (
        <Card className="shadow-none">
          <CardContent className="p-3">
            <div className="mb-3 flex items-center gap-2">
              <p className="text-sm font-medium">
                {t('checkpointDashboard.storageTrend', 'Storage Trend')}
              </p>
              <span className="rounded-full bg-[color-mix(in_srgb,var(--odp-purple)_22%,transparent)] px-2 py-0.5 text-[10px] font-medium leading-none text-[var(--odp-purple)]">
                {t('checkpointDashboard.lastDays', { count: dayCount, defaultValue: '{{count}}d' })}
              </span>
            </div>
            <ChartContainer config={STORAGE_CHART_CONFIG} className={USAGE_CHART_CLASS}>
              <BarChart data={chartData} margin={CHART_MARGIN} barCategoryGap="28%">
                <CartesianGrid vertical={false} stroke="currentColor" className="opacity-20" />
                <YAxis
                  dataKey="bytes"
                  tickLine={false}
                  axisLine={false}
                  width={44}
                  tickMargin={4}
                  tickFormatter={(value) => formatBytes(Number(value))}
                  allowDecimals={false}
                />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={10}
                  interval={xAxisInterval(chartData.length)}
                  angle={-35}
                  textAnchor="end"
                  height={48}
                />
                <ChartTooltip
                  cursor={{ fill: 'currentColor', opacity: 0.06 }}
                  content={
                    <ChartTooltipContent
                      indicator="dot"
                      formatter={(value) => (
                        <div className="flex flex-1 items-center justify-between gap-4">
                          <span className="text-muted-foreground">
                            {STORAGE_CHART_CONFIG.bytes.label}
                          </span>
                          <span className="font-mono font-medium tabular-nums text-foreground">
                            {formatBytes(Number(value))}
                          </span>
                        </div>
                      )}
                    />
                  }
                />
                <Bar
                  dataKey="bytes"
                  fill={barFill}
                  maxBarSize={18}
                  radius={0}
                />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ========================================
// Creation Frequency Section
// ========================================

interface CreationFrequencySectionProps {
  data: CreationFrequencyPoint[];
}

function CreationFrequencySection({ data }: CreationFrequencySectionProps) {
  const { t } = useTranslation();
  const theme = useCheckpointThemeType();
  const barFill = CREATION_BAR_FILL[theme];
  const chartData = useMemo(() => fillDailyCounts(data), [data]);
  const dayCount = chartData.length;
  const totalCreated = useMemo(
    () => chartData.reduce((sum, row) => sum + row.count, 0),
    [chartData],
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-medium">
          <BarChart3 className={CP_ICON} />
          {t('checkpointDashboard.creationFrequency', 'Creation Frequency')}
        </h3>
        <span className="rounded-full bg-[color-mix(in_srgb,var(--odp-purple)_22%,transparent)] px-2 py-0.5 text-[10px] font-medium leading-none text-[var(--odp-purple)]">
          {t('checkpointDashboard.lastDays', { count: dayCount, defaultValue: '{{count}}d' })}
        </span>
      </div>

      {data.length === 0 ? (
        <Card className="shadow-none">
          <CardContent className="p-4 text-center text-xs text-muted-foreground">
            {t('checkpointDashboard.noData', 'No data available')}
          </CardContent>
        </Card>
      ) : (
        <Card className="shadow-none">
          <CardContent className="p-3 pt-2">
            <ChartContainer config={CREATION_CHART_CONFIG} className={USAGE_CHART_CLASS}>
              <BarChart data={chartData} margin={CHART_MARGIN} barCategoryGap="28%">
                <CartesianGrid vertical={false} stroke="currentColor" className="opacity-20" />
                <YAxis
                  dataKey="count"
                  tickLine={false}
                  axisLine={false}
                  width={32}
                  tickMargin={4}
                  allowDecimals={false}
                  tickFormatter={compactAxisNumber}
                />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={10}
                  interval={xAxisInterval(chartData.length)}
                  angle={-35}
                  textAnchor="end"
                  height={48}
                />
                <ChartTooltip
                  cursor={{ fill: 'currentColor', opacity: 0.06 }}
                  content={<ChartTooltipContent indicator="dot" hideLabel={false} />}
                />
                <Bar
                  dataKey="count"
                  name={CREATION_CHART_CONFIG.count.label}
                  fill={barFill}
                  maxBarSize={18}
                  radius={0}
                />
              </BarChart>
            </ChartContainer>
            <p className="mt-1 text-[10px] text-muted-foreground">
              {t('checkpointDashboard.createdInRange', {
                count: totalCreated,
                defaultValue: '{{count}} created in this range',
              })}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ========================================
// Restoration Events Section
// ========================================

interface RestorationEventsSectionProps {
  events: RestorationEvent[];
  successRate: number;
}

function RestorationEventsSection({ events, successRate }: RestorationEventsSectionProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-3">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold">
        <Activity className={CP_ICON} />
        {t('checkpointDashboard.restorations', 'Restoration History')}
      </h3>

      <div className="mb-1 flex flex-wrap items-center gap-2">
        <Badge variant={successRate >= 90 ? 'default' : successRate >= 70 ? 'secondary' : 'destructive'}>
          {successRate.toFixed(0)}% {t('checkpointDashboard.successRate', 'success rate')}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {events.length} {t('checkpointDashboard.totalEvents', 'total events')}
        </span>
      </div>

      {events.length === 0 ? (
        <Card className="shadow-none">
          <CardContent className="p-4 text-center text-xs text-muted-foreground">
            {t('checkpointDashboard.noRestorations', 'No restoration events recorded')}
          </CardContent>
        </Card>
      ) : (
        <div className="max-h-48 space-y-1.5 overflow-y-auto">
          {events.slice(0, 10).map((event, i) => (
            <Card key={i} className="shadow-none">
              <CardContent className="flex items-center gap-2 p-2 text-sm">
                {event.success ? (
                  <CheckCircle className={`${CP_ICON} shrink-0 odp-text-green`} />
                ) : (
                  <XCircle className={`${CP_ICON} shrink-0 odp-text-red`} />
                )}
                <span className="min-w-0 flex-1 truncate font-mono text-xs">
                  {event.checkpointId.slice(0, 8)}...
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {event.filesRestored} {t('checkpointDashboard.files', 'files')}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatDuration(event.durationMs)}
                </span>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ========================================
// AI Session Metrics Section
// ========================================

interface AISessionMetricsSectionProps {
  metrics: AISessionMetric[];
  summary: DashboardSummary;
}

function AISessionMetricsSection({ metrics, summary }: AISessionMetricsSectionProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-3">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold">
        <Bot className={CP_ICON} />
        {t('checkpointDashboard.aiSessions', 'AI Session Metrics')}
      </h3>

      <div className="grid grid-cols-1 gap-2 min-[380px]:grid-cols-3">
        <StatCard
          icon={<Bot />}
          label={t('checkpointDashboard.totalSessions', 'Total Sessions')}
          value={summary.totalAiSessions}
        />
        <StatCard
          icon={<TrendingUp />}
          label={t('checkpointDashboard.avgChanges', 'Avg Changes/Session')}
          value={summary.avgChangesPerSession.toFixed(1)}
        />
        <StatCard
          icon={<Activity />}
          label={t('checkpointDashboard.totalRollbacks', 'Total Rollbacks')}
          value={summary.totalRollbacks}
        />
      </div>

      {metrics.length > 0 && (
        <div className="max-h-48 space-y-1.5 overflow-y-auto">
          {metrics.slice(0, 5).map((session, i) => (
            <Card key={i} className="shadow-none">
              <CardContent className="space-y-1 p-2.5 text-sm">
                <div className="flex justify-between gap-2">
                  <span className="truncate font-mono text-xs">{session.sessionId.slice(0, 8)}...</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{formatDuration(session.durationSeconds * 1000)}</span>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                  <span>{session.filesChanged} {t('checkpointDashboard.files', 'files')}</span>
                  {typeof session.linesAdded === 'number' && (
                    <span className="odp-text-green">+{session.linesAdded}</span>
                  )}
                  {typeof session.linesDeleted === 'number' && (
                    <span className="odp-text-red">-{session.linesDeleted}</span>
                  )}
                  <span>{session.checkpointsCreated} {t('checkpointDashboard.checkpoints', 'checkpoints')}</span>
                  {(session.rollbacks ?? 0) > 0 && (
                    <span className="odp-text-orange">{session.rollbacks} {t('checkpointDashboard.rollbacks', 'rollbacks')}</span>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ========================================
// Main Performance Dashboard Component
// ========================================

interface PerformanceDashboardProps {
  data: PerformanceDashboardData;
  className?: string;
}

export function PerformanceDashboard({ data, className }: PerformanceDashboardProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'overview' | 'storage' | 'activity' | 'ai'>('overview');

  return (
    <div className={cn('@container space-y-3 py-2', className)}>
      <h2 className="flex items-center gap-1.5 text-base font-semibold">
        <BarChart3 className={CP_ICON} />
        {t('checkpointDashboard.title', 'Performance Dashboard')}
      </h2>

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as typeof activeTab)}
        className="gap-3"
      >
        <TabsList className="grid h-8 w-full grid-cols-2 gap-0.5 rounded-md bg-muted p-0.5 min-[420px]:grid-cols-4">
          <TabsTrigger value="overview" className={compactTabsTriggerClass}>
            {t('checkpointDashboard.overview', 'Overview')}
          </TabsTrigger>
          <TabsTrigger value="storage" className={compactTabsTriggerClass}>
            {t('checkpointDashboard.storage', 'Storage')}
          </TabsTrigger>
          <TabsTrigger value="activity" className={compactTabsTriggerClass}>
            {t('checkpointDashboard.activity', 'Activity')}
          </TabsTrigger>
          <TabsTrigger value="ai" className={compactTabsTriggerClass}>
            {t('checkpointDashboard.ai', 'AI Sessions')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-0 space-y-3">
          <div className="grid grid-cols-1 gap-2 min-[380px]:grid-cols-2">
            <StatCard
              icon={<Database />}
              label={t('checkpointDashboard.totalCheckpoints', 'Total Checkpoints')}
              value={data.summary.totalCheckpointsCreated}
            />
            <StatCard
              icon={<Activity />}
              label={t('checkpointDashboard.restorationRate', 'Success Rate')}
              value={`${data.summary.restorationSuccessRate.toFixed(0)}%`}
            />
            <StatCard
              icon={<Clock />}
              label={t('checkpointDashboard.avgCreateTime', 'Avg Create Time')}
              value={formatDuration(data.summary.avgCreationTimeMs)}
            />
            <StatCard
              icon={<HardDrive />}
              label={t('checkpointDashboard.storageUsed', 'Storage Used')}
              value={formatBytes(data.currentStorage.totalBytes)}
            />
          </div>
          <CreationFrequencySection data={data.creationFrequency} />
        </TabsContent>

        <TabsContent value="storage" className="mt-0">
          <StorageUsageSection
            current={data.currentStorage}
            history={data.storageHistory}
          />
        </TabsContent>

        <TabsContent value="activity" className="mt-0">
          <RestorationEventsSection
            events={data.restorationEvents}
            successRate={data.summary.restorationSuccessRate}
          />
        </TabsContent>

        <TabsContent value="ai" className="mt-0">
          <AISessionMetricsSection
            metrics={data.aiSessionMetrics}
            summary={data.summary}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export function ConnectedPerformanceDashboard({ className }: { className?: string }) {
  const { t } = useTranslation();
  const ideMessenger = useContext(IdeMessengerContext);
  const [data, setData] = useState<PerformanceDashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await ideMessenger.request('getPerformanceDashboard', { historyDays: 30 });
        if (cancelled) {
          return;
        }
        if (response.status === 'success' && response.content.success && response.content.data) {
          setData(response.content.data);
        } else {
          setData(null);
        }
      } catch (error) {
        console.error('Failed to load checkpoint dashboard:', error);
        if (!cancelled) {
          setData(null);
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
      <div className="space-y-2 py-3">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-8 w-full" />
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className={`${CP_ICON} animate-spin`} />
          {t('checkpointDashboard.loading', 'Loading dashboard…')}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <p className="py-8 text-sm text-muted-foreground">
        {t('checkpointDashboard.noData', 'No data available')}
      </p>
    );
  }

  return <PerformanceDashboard data={data} className={className} />;
}
