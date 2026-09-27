/**
 * Public entry for the workspace checkpoint engine.
 * Implementation is split under `./manager/` so capture, restore, and storage
 * can be changed independently (see checkpoints-imple.md).
 */

export { CheckpointManager } from './manager/CheckpointManager';
export {
    listedCheckpointFileCount,
    computeCheckpointFileStats,
    type CaptureMode,
    type CaptureResult,
    type CheckpointDiffResult,
    type CheckpointFileDiff,
    type RestorePreview,
    type RestorePreviewAction,
    type RestorePreviewFile,
    type CheckpointFileStats,
    type CheckpointHealthIssue,
    type CheckpointInfo,
    type FileCheckpointVersion,
    type ExportCheckpointsOptions,
    type FileSnapshot,
    type ImportCheckpointsOptions,
    type ShareCheckpointsOptions,
    type SharedCheckpointBundle,
    type MessageCheckpointMap,
    type SkippedFile,
    type CheckpointBranch,
    type BranchMergeResult,
    type CheckpointAnalysis,
    type SuggestedCheckpointGroup,
} from './manager/types';
export {
    CheckpointBundleError,
    CheckpointWorkspaceMismatchError,
    isWorkspaceMismatchError,
} from './store/checkpointBundle';
