import { ILLM } from "..";

import { BuiltInToolNames } from "./builtIn";

/**
 * Tool names that should use the View/Read model when available
 */
export const VIEW_READ_TOOLS = [
  BuiltInToolNames.ReadFile,
  BuiltInToolNames.ReadCurrentlyOpenFile,
  BuiltInToolNames.ViewSubdirectory,
  BuiltInToolNames.ViewRepoMap,
  BuiltInToolNames.ViewDiff,
  BuiltInToolNames.ExactSearch,
  BuiltInToolNames.EnhancedSearch,
  BuiltInToolNames.AwaitShell,
  BuiltInToolNames.GitStatus,
  BuiltInToolNames.GitDiff,
  BuiltInToolNames.GitLog,
  BuiltInToolNames.GitBlame,
  BuiltInToolNames.Plan,
] as const;

/**
 * Tool names that should use the Chat model for code generation and editing
 */
export const CHAT_MODEL_TOOLS = [
  BuiltInToolNames.CreateNewFile,
  BuiltInToolNames.RunTerminalCommand,
  BuiltInToolNames.Task,
  BuiltInToolNames.GitCommit,
  BuiltInToolNames.GitBisect,
] as const;

/**
 * Operations that can benefit from View/Read model for cost optimization
 */
export const VIEW_READ_OPERATION_TYPES = {
  // Tool execution - already handled above
  TOOL_EXECUTION: 'tool_execution',
  
  // Post-tool analysis and response generation
  TOOL_OUTPUT_ANALYSIS: 'tool_output_analysis',
  
  // Simple question answering based on context
  CONTEXT_BASED_QA: 'context_based_qa',
  
  // Code explanation and documentation
  CODE_EXPLANATION: 'code_explanation',
  
  // Error analysis and diagnostics
  ERROR_ANALYSIS: 'error_analysis',
  
  // Cache operations (token cache read/write)
  CACHE_OPERATIONS: 'cache_operations',
  
  // Simple summarization tasks
  SUMMARIZATION: 'summarization',
  
  // File/directory listing analysis
  STRUCTURE_ANALYSIS: 'structure_analysis'
} as const;

/**
 * Tool names that should use the RealTimeSearch model for web search operations
 */
export const REAL_TIME_SEARCH_TOOLS = [
  BuiltInToolNames.SearchWeb,
] as const;

/**
 * Determines which model to use for a given tool call with support for dynamic switching
 * @param toolName - The name of the tool being called
 * @param chatModel - The main chat model
 * @param viewReadModel - The view/read model (optional)
 * @param realTimeSearchModel - The real-time search model (optional)
 * @param preferredModel - Optional preference for model selection ('chat' | 'viewRead' | 'realTimeSearch')
 * @returns The appropriate model to use
 */
export function selectModelForTool(
  toolName: string,
  chatModel: ILLM,
  viewReadModel: ILLM | null = null,
  realTimeSearchModel: ILLM | null = null,
  preferredModel?: 'chat' | 'viewRead' | 'realTimeSearch'
): ILLM {
  console.log(`[selectModelForTool] Input - toolName: '${toolName}', hasViewReadModel: ${!!viewReadModel}, hasRealTimeSearchModel: ${!!realTimeSearchModel}, preferredModel: ${preferredModel || 'auto'}`);
  console.log(`[selectModelForTool] VIEW_READ_TOOLS: [${VIEW_READ_TOOLS.join(', ')}]`);
  console.log(`[selectModelForTool] REAL_TIME_SEARCH_TOOLS: [${REAL_TIME_SEARCH_TOOLS.join(', ')}]`);
  
  // If a preferred model is specified, use it if the model is available
  if (preferredModel === 'viewRead' && viewReadModel) {
    console.log(`[selectModelForTool] Using preferred View/Read model for tool: ${toolName}`);
    return viewReadModel;
  } else if (preferredModel === 'realTimeSearch' && realTimeSearchModel) {
    console.log(`[selectModelForTool] Using preferred RealTimeSearch model for tool: ${toolName}`);
    return realTimeSearchModel;
  } else if (preferredModel === 'chat') {
    console.log(`[selectModelForTool] Using preferred Chat model for tool: ${toolName}`);
    return chatModel;
  }

  // Default behavior: categorize tools by their primary purpose
  const isViewReadTool = VIEW_READ_TOOLS.includes(toolName as any);
  const isChatModelTool = CHAT_MODEL_TOOLS.includes(toolName as any);
  const isRealTimeSearchTool = REAL_TIME_SEARCH_TOOLS.includes(toolName as any);
  
  console.log(`[selectModelForTool] Tool '${toolName}' categorization - viewRead: ${isViewReadTool}, chat: ${isChatModelTool}, realTimeSearch: ${isRealTimeSearchTool}`);
  
  if (isViewReadTool && viewReadModel) {
    console.log(`[selectModelForTool] Selecting View/Read model for tool: ${toolName}`);
    return viewReadModel;
  } else if (isRealTimeSearchTool && realTimeSearchModel) {
    console.log(`[selectModelForTool] Selecting RealTimeSearch model for tool: ${toolName}`);
    return realTimeSearchModel;
  } else if (isChatModelTool) {
    console.log(`[selectModelForTool] Selecting Chat model for tool: ${toolName}`);
    return chatModel;
  }

  // For tools not explicitly categorized, or when specialized models are unavailable, use the chat model as default
  console.log(`[selectModelForTool] Using Chat model as default for tool: ${toolName} (specialized model unavailable or tool uncategorized)`);
  return chatModel;
}

/**
 * Checks if a tool should use the View/Read model
 */
export function isViewReadTool(toolName: string): boolean {
  return VIEW_READ_TOOLS.includes(toolName as any);
}

/**
 * Checks if a tool should use the Chat model
 */
export function isChatModelTool(toolName: string): boolean {
  return CHAT_MODEL_TOOLS.includes(toolName as any);
}

/**
 * Checks if a tool should use the RealTimeSearch model
 */
export function isRealTimeSearchTool(toolName: string): boolean {
  return REAL_TIME_SEARCH_TOOLS.includes(toolName as any);
}

/**
 * Analyzes a user message to determine if it can be handled by the View/Read model for cost optimization
 * @param message - The user's message
 * @param hasContext - Whether there's relevant context available (files, tool outputs, etc.)
 * @returns Object indicating if View/Read model should be used and the operation type
 */
export function analyzeForViewReadModel(message: string, hasContext: boolean = false): {
  shouldUseViewRead: boolean;
  operationType: string;
  confidence: number;
  reason: string;
} {
  const lowerMessage = message.toLowerCase();
  
  // Patterns that indicate code generation/editing (should use Chat model)
  const codeGenerationPatterns = [
    /create|write|generate|build|implement|develop/,
    /add|insert|modify|change|update|edit|refactor/,
    /fix\s+(?:the\s+)?(?:bug|error|issue|problem)/,
    /optimize|improve|enhance/,
    /delete|remove|cleanup/
  ];
  
  // Patterns that indicate View/Read model can handle (cost optimization)
  const viewReadPatterns = [
    {
      patterns: [/what(?:\s+is|\s+does|\s+are)|how(?:\s+does|\s+do|\s+is)|explain|describe|tell\s+me|show\s+me/],
      type: VIEW_READ_OPERATION_TYPES.CODE_EXPLANATION,
      reason: 'Question asking for explanation or information'
    },
    {
      patterns: [/error|exception|fail|problem|issue|wrong|broken/],
      type: VIEW_READ_OPERATION_TYPES.ERROR_ANALYSIS,
      reason: 'Error analysis and diagnostics'
    },
    {
      patterns: [/summarize|summary|overview|brief|outline/],
      type: VIEW_READ_OPERATION_TYPES.SUMMARIZATION,
      reason: 'Summarization task'
    },
    {
      patterns: [/structure|organization|layout|architecture|contains|includes|files|directories|list|listing/],
      type: VIEW_READ_OPERATION_TYPES.STRUCTURE_ANALYSIS,
      reason: 'Structure and organization analysis'
    },
    {
      patterns: [/read|view|see|look|check|examine|inspect|analyze|review|browse/],
      type: VIEW_READ_OPERATION_TYPES.CONTEXT_BASED_QA,
      reason: 'Context-based reading and analysis'
    }
  ];
  
  // Check if this is clearly a code generation/editing request
  for (const pattern of codeGenerationPatterns) {
    if (pattern.test(lowerMessage)) {
      return {
        shouldUseViewRead: false,
        operationType: 'code_generation',
        confidence: 0.8,
        reason: 'Message indicates code generation/editing - requires Chat model'
      };
    }
  }
  
  // Check if this can be handled by View/Read model
  for (const { patterns, type, reason } of viewReadPatterns) {
    for (const pattern of patterns) {
      if (pattern.test(lowerMessage)) {
        // Higher confidence if we have context to work with
        const confidence = hasContext ? 0.8 : 0.6;
        return {
          shouldUseViewRead: true,
          operationType: type,
          confidence,
          reason
        };
      }
    }
  }
  
  // Default: use Chat model for ambiguous cases
  return {
    shouldUseViewRead: false,
    operationType: 'ambiguous',
    confidence: 0.3,
    reason: 'Ambiguous request - defaulting to Chat model for safety'
  };
}

/**
 * Determines if tool output analysis should use View/Read model for cost optimization
 * @param toolName - Name of the tool that was executed
 * @param outputSize - Approximate size of the tool output (in characters)
 * @param analysisType - Type of analysis needed
 * @returns Whether to use View/Read model for the response
 */
export function shouldUseViewReadForToolResponse(
  toolName: string, 
  outputSize: number = 0, 
  analysisType: 'simple' | 'complex' | 'auto' = 'auto'
): {
  shouldUseViewRead: boolean;
  reason: string;
  confidence: number;
} {
  // Always use View/Read model for View/Read tools (consistency)
  if (isViewReadTool(toolName)) {
    return {
      shouldUseViewRead: true,
      reason: 'Tool output from View/Read tool - maintaining model consistency',
      confidence: 0.9
    };
  }
  
  // For other tools, analyze the complexity
  if (analysisType === 'simple' || (analysisType === 'auto' && outputSize < 2000)) {
    return {
      shouldUseViewRead: true,
      reason: 'Simple tool output analysis - View/Read model sufficient',
      confidence: 0.8
    };
  }
  
  if (analysisType === 'complex' || (analysisType === 'auto' && outputSize > 5000)) {
    return {
      shouldUseViewRead: false,
      reason: 'Complex tool output requires Chat model analysis',
      confidence: 0.7
    };
  }
  
  // Medium complexity - use View/Read model for cost optimization
  return {
    shouldUseViewRead: true,
    reason: 'Medium complexity output - using View/Read model for cost optimization',
    confidence: 0.6
  };
}

/**
 * Creates a model switching context that allows dynamic model selection during operations
 */
export interface ModelSwitchingContext {
  chatModel: ILLM;
  viewReadModel: ILLM | null;
  realTimeSearchModel: ILLM | null;
  currentModel: ILLM;
  preferredModel?: 'chat' | 'viewRead' | 'realTimeSearch';
  switchToViewRead: () => ILLM | null;
  switchToChat: () => ILLM;
  switchToRealTimeSearch: () => ILLM | null;
  switchForTool: (toolName: string, preferredModel?: 'chat' | 'viewRead' | 'realTimeSearch') => ILLM;
  
  // Cost optimization methods
  selectModelForMessage: (message: string, hasContext?: boolean) => ILLM;
  selectModelForToolResponse: (toolName: string, outputSize?: number, analysisType?: 'simple' | 'complex' | 'auto') => ILLM;
  analyzeMessage: (message: string, hasContext?: boolean) => {
    shouldUseViewRead: boolean;
    operationType: string;
    confidence: number;
    reason: string;
  };
}

/**
 * Creates a model switching context for dynamic model selection
 */
export function createModelSwitchingContext(
  chatModel: ILLM,
  viewReadModel: ILLM | null = null,
  realTimeSearchModel: ILLM | null = null,
  initialModel?: ILLM
): ModelSwitchingContext {
  let currentModel = initialModel || chatModel;
  
  const context: ModelSwitchingContext = {
    chatModel,
    viewReadModel,
    realTimeSearchModel,
    currentModel,
    
    switchToViewRead: () => {
      if (viewReadModel) {
        currentModel = viewReadModel;
        console.log(`[ModelSwitchingContext] Switched to View/Read model`);
        return viewReadModel;
      }
      console.log(`[ModelSwitchingContext] No View/Read model available, staying with current model`);
      return null;
    },
    
    switchToChat: () => {
      currentModel = chatModel;
      console.log(`[ModelSwitchingContext] Switched to Chat model`);
      return chatModel;
    },
    
    switchToRealTimeSearch: () => {
      if (realTimeSearchModel) {
        currentModel = realTimeSearchModel;
        console.log(`[ModelSwitchingContext] Switched to RealTimeSearch model`);
        return realTimeSearchModel;
      }
      console.log(`[ModelSwitchingContext] No RealTimeSearch model available, staying with current model`);
      return null;
    },
    
    switchForTool: (toolName: string, preferredModel?: 'chat' | 'viewRead' | 'realTimeSearch') => {
      const selectedModel = selectModelForTool(toolName, chatModel, viewReadModel, realTimeSearchModel, preferredModel);
      currentModel = selectedModel;
      const modelType = selectedModel === chatModel ? 'Chat' : 
                       selectedModel === viewReadModel ? 'View/Read' : 
                       selectedModel === realTimeSearchModel ? 'RealTimeSearch' : 'Unknown';
      console.log(`[ModelSwitchingContext] Switched to ${modelType} model for tool: ${toolName}`);
      return selectedModel;
    },
    
    // Cost optimization methods
    selectModelForMessage: (message: string, hasContext: boolean = false) => {
      const analysis = analyzeForViewReadModel(message, hasContext);
      if (analysis.shouldUseViewRead && viewReadModel) {
        currentModel = viewReadModel;
        console.log(`[ModelSwitchingContext] 💰 Cost optimization: Using View/Read model for message analysis`);
        console.log(`[ModelSwitchingContext] Analysis: ${analysis.reason} (confidence: ${analysis.confidence})`);
        return viewReadModel;
      } else {
        currentModel = chatModel;
        console.log(`[ModelSwitchingContext] Using Chat model for message: ${analysis.reason}`);
        return chatModel;
      }
    },
    
    selectModelForToolResponse: (toolName: string, outputSize: number = 0, analysisType: 'simple' | 'complex' | 'auto' = 'auto') => {
      const analysis = shouldUseViewReadForToolResponse(toolName, outputSize, analysisType);
      if (analysis.shouldUseViewRead && viewReadModel) {
        currentModel = viewReadModel;
        console.log(`[ModelSwitchingContext] 💰 Cost optimization: Using View/Read model for tool response`);
        console.log(`[ModelSwitchingContext] Analysis: ${analysis.reason} (confidence: ${analysis.confidence})`);
        return viewReadModel;
      } else {
        currentModel = chatModel;
        console.log(`[ModelSwitchingContext] Using Chat model for tool response: ${analysis.reason}`);
        return chatModel;
      }
    },
    
    analyzeMessage: (message: string, hasContext: boolean = false) => {
      return analyzeForViewReadModel(message, hasContext);
    }
  };
  
  return context;
}
