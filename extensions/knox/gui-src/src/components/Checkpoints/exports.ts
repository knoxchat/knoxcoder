/**
 * Checkpoint Components Export Index
 *
 * Public product surface: list, config, diffs, selective restore, dashboard
 * (CP-20), local share bundles (CP-27), branch timeline (CP-24/CP-25), and
 * local heuristic analysis (CP-26). Unused D3/kanban viewers were removed.
 */

// Main checkpoint list and management
export { Checkpoints } from './index';
export type { CheckpointMetadata } from './index';

// Individual row component
export { CheckpointTableRow } from './CheckpointTableRow';

// Diff viewers (Shiki + @pierre/diffs)
export { PierreDiffViewer } from './PierreDiffViewer';
export type { PierreDiffViewerProps, FileSnapshot } from './PierreDiffViewer';

// Diff utilities (used by tests)
export {
  getLanguageFromPath,
  buildLogicalHunks,
  detectSemanticAnnotations,
  computeAlignedLines,
  renderJsonDiff,
  diffObjects,
  renderCssDiff,
} from './checkpointDiffUtils';
export type {
  DiffLine,
  LogicalHunk,
  SemanticAnnotation,
  WordChange,
} from './checkpointDiffUtils';

// Code viewer with Shiki syntax highlighting
export { CodeViewer } from './CodeViewer';

// Configuration panel
export { CheckpointConfig } from './CheckpointConfig';
export { CheckpointsPanel } from './CheckpointsPanel';
export { PerformanceDashboard, ConnectedPerformanceDashboard } from './PerformanceDashboard';
export type { PerformanceDashboardData } from './PerformanceDashboard';
export { CollaborativePanel, ConnectedCollaborativePanel } from './CollaborativePanel';
export type { SharedBundle, AuditRecord } from './CollaborativePanel';
export { CheckpointTimeline, ConnectedCheckpointTimeline } from './CheckpointTimeline';
export {
  CheckpointAnalysisPanel,
  ConnectedCheckpointAnalysisPanel,
  GroupingSuggestionsList,
  RiskBadge,
} from './CheckpointAnalysisPanel';
export type { CheckpointAnalysisData, GroupingSuggestion } from './CheckpointAnalysisPanel';

// File tree view
export { FileTreeView } from './FileTreeView';

// Utility components
export { ResizableSplitter } from './ResizableSplitter';
