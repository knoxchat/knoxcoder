import { ConfigResult } from "knoxdev-package/config-yaml";

import type {
  BrowserSerializedKnoxConfig,
  ContextItemWithId,
  ContextProviderName,
} from "../index.js";
import type { AgentJobUpdate } from "./agentJobs";

export type ToWebviewFromIdeOrCoreProtocol = {
  configUpdate: [
    {
      result: ConfigResult<BrowserSerializedKnoxConfig>;
      profileId: string | null;
    },
    void,
  ];
  getDefaultModelTitle: [undefined, string | undefined];
  refreshSubmenuItems: [
    {
      providers: "all" | ContextProviderName[];
    },
    void,
  ];
  didCloseFiles: [{ uris: string[] }, void];
  isKnoxInputFocused: [undefined, boolean];
  addContextItem: [
    {
      historyIndex: number;
      item: ContextItemWithId;
    },
    void,
  ];
  getWebviewHistoryLength: [undefined, number];
  getCurrentSessionId: [undefined, string];
  agentStreamingUpdate: [
    {
      content: string;
      isComplete: boolean;
    },
    void,
  ];

  /** Background shell job started / updated / completed (panel + toast). */
  "agent/jobUpdate": [AgentJobUpdate, void];

  /** Incremental tool output while tools/call is still running (terminal stdout). */
  "tools/partialOutput": [
    {
      toolCallId: string;
      contextItems: ContextItemWithId[] | import("../index.js").ContextItem[];
    },
    void,
  ];

  /** Fired when chat context was compacted for the current model request. */
  "compaction/applied": [
    {
      tokensSaved: number;
      originalMessageCount: number;
      compactedMessageCount: number;
      summarized: boolean;
      deduplicated: boolean;
      summarizationMethod: "heuristic" | "llm" | "none";
      summaryText?: string;
    },
    void,
  ];

  /** Memory brain events — autonomous loop */
  "brain/memoryEvent": [
    {
      type: string;
      timestamp: string;
      data: Record<string, unknown>;
    },
    void,
  ];
};
