export interface CheckpointMetadata {
  id: string;
  description: string;
  dateCreated: string;
  workspacePath?: string;
  messageId?: string;
  fileSnapshots?: Array<{
    relativePath: string;
    content: string;
    encoding?: string;
    lastModified?: string | Date;
    size?: number;
  }>;
  conversationContext?: {
    messageContent: string;
    role: string;
    timestamp: string;
    index: number;
    sessionId?: string;
  };
  sessionId?: string;
  pinned?: boolean;
  tags?: string[];
  changedPaths?: string[];
  /** Lightweight change stats provided by the extension */
  fileStats?: {
    total: number;
    created: number;
    modified: number;
    deleted: number;
  };
}
