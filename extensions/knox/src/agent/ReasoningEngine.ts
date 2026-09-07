import * as vscode from 'vscode';

/**
 * Legacy extension helper. Product Agent planning is Core `builtin_plan`
 * (HL-17). Do not treat this class as the GUI chat harness (HL-38).
 */

/**
 * Analysis result from the reasoning engine
 */
export interface TaskAnalysisResult {
  analysis: string;
  steps: string[];
  estimatedComplexity: 'simple' | 'medium' | 'complex';
}

/* ── Language detection ────────────────────────────────────────────── */

/**
 * Detect the primary language of the input text.
 * Returns an ISO 639-1 code ('en', 'zh', etc.).
 */
function detectInputLanguage(text: string): string {
  // Count CJK characters (Chinese / Japanese / Korean Unified Ideographs)
  const cjkChars = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
  // Count Latin characters
  const latinChars = (text.match(/[a-zA-Z]/g) || []).length;
  const totalSignificant = cjkChars + latinChars;

  if (totalSignificant === 0) return 'en';

  // If more than 20% of significant chars are CJK, treat as Chinese
  if (cjkChars / totalSignificant > 0.2) return 'zh';

  return 'en';
}

/* ── Multilingual task decomposition prompts ───────────────────────── */

const TASK_DECOMPOSITION_PROMPTS: Record<string, string> = {
  en: `You are a task decomposition assistant.
Given a user request, break it down into concrete, actionable implementation steps.

Rules:
- Each step should be a single, focused action (e.g. "Create the Express server entry point", "Add JWT middleware").
- Steps should be in logical execution order.
- Keep step descriptions concise (one sentence each).
- Estimate overall complexity: "simple" (1-2 steps), "medium" (3-5 steps), "complex" (6+ steps).
- Return ONLY valid JSON — no markdown, no explanation outside the JSON.

Respond with this exact JSON structure:
{
  "analysis": "<brief summary of what the task involves>",
  "steps": ["<step 1>", "<step 2>", ...],
  "complexity": "simple" | "medium" | "complex"
}

User request:
`,

  zh: `你是一个任务分解助手。
根据用户的请求，将其分解为具体的、可执行的实施步骤。

规则：
- 每个步骤应该是单一、聚焦的操作（例如："创建 Express 服务器入口"、"添加 JWT 中间件"）。
- 步骤应按照逻辑执行顺序排列。
- 步骤描述要简洁（每个步骤一句话）。
- 评估整体复杂度："simple"（1-2 步）、"medium"（3-5 步）、"complex"（6步以上）。
- 只返回有效的 JSON — 不要有 markdown 格式，不要有 JSON 外的解释。
- 所有步骤描述必须使用中文。

返回以下 JSON 结构：
{
  "analysis": "<任务简要概述>",
  "steps": ["<步骤1>", "<步骤2>", ...],
  "complexity": "simple" | "medium" | "complex"
}

用户请求：
`,
};

/**
 * Get the task decomposition prompt for a given language.
 * Falls back to English if the language is not supported.
 */
function getDecompositionPrompt(lang: string): string {
  return TASK_DECOMPOSITION_PROMPTS[lang] || TASK_DECOMPOSITION_PROMPTS.en;
}

/** Timeout for the task-decomposition LLM call. */
const ANALYSIS_TIMEOUT_MS = 20_000;

/**
 * Race a promise against a timeout so a hung LLM call can never
 * block session creation indefinitely.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

/**
 * ReasoningEngine provides structured reasoning capabilities for AI tasks
 * to break down complex problems, plan solutions, and improve task comprehension.
 *
 * Uses a real LLM call via the `knox.llmComplete` VS Code command, which
 * routes through Core's `llm/complete` handler.
 */
export class ReasoningEngine implements vscode.Disposable {
  private static instance: ReasoningEngine;
  private disposables: vscode.Disposable[] = [];
  
  // Event emitters
  private _onAnalysisCompleted = new vscode.EventEmitter<TaskAnalysisResult>();
  public readonly onAnalysisCompleted = this._onAnalysisCompleted.event;

  /**
   * Get the singleton instance
   */
  public static getInstance(): ReasoningEngine {
    if (!ReasoningEngine.instance) {
      ReasoningEngine.instance = new ReasoningEngine();
    }
    return ReasoningEngine.instance;
  }

  /**
   * Private constructor to enforce singleton pattern
   */
  private constructor() {
    // Register commands
    this.registerCommands();
  }
  
  /**
   * Register commands for the reasoning engine
   */
  private registerCommands(): void {
    // Register analyze task command
    this.disposables.push(
      vscode.commands.registerCommand('knox.analyzeTask', async (task: string) => {
        return await this.performTaskAnalysis(task);
      })
    );
  }
  
  /**
   * Analyze a task and break it down into structured steps using
   * a real LLM completion. Automatically detects the user's language
   * and returns steps in the same language.
   *
   * @param task The task description to analyze
   * @param modelTitle Title of the model to use (defaults to the user's selected chat model when provided)
   * @returns Structured analysis result
   */
  public async performTaskAnalysis(task: string, modelTitle?: string): Promise<TaskAnalysisResult> {
    // Detect the user's language so we can prompt accordingly
    const detectedLang = detectInputLanguage(task);

    try {
      const prompt = getDecompositionPrompt(detectedLang) + task;

      // Call the LLM via the registered VS Code command.
      // `knox.llmComplete` → Core's `llm/complete` handler → configHandler.llmFromTitle → model.complete()
      const completion = await withTimeout(
        Promise.resolve(
          vscode.commands.executeCommand<string>(
            'knox.llmComplete',
            { prompt, title: modelTitle || 'default', completionOptions: { maxTokens: 2048 } },
          ),
        ),
        ANALYSIS_TIMEOUT_MS,
        'Task analysis LLM call',
      );

      if (!completion || typeof completion !== 'string') {
        throw new Error('LLM returned empty or non-string completion');
      }

      // Extract JSON from the response (the model may wrap it in markdown fences)
      const jsonStr = this.extractJson(completion);
      const parsed = JSON.parse(jsonStr) as {
        analysis?: string;
        steps?: string[];
        complexity?: string;
      };

      // Validate & normalise
      if (!parsed.steps || !Array.isArray(parsed.steps) || parsed.steps.length === 0) {
        throw new Error('LLM response missing valid steps array');
      }

      const validComplexities = ['simple', 'medium', 'complex'] as const;
      const complexity = validComplexities.includes(parsed.complexity as any)
        ? (parsed.complexity as 'simple' | 'medium' | 'complex')
        : this.inferComplexity(parsed.steps.length);

      const analysisResult: TaskAnalysisResult = {
        analysis: parsed.analysis || `Task breakdown for: ${task}`,
        steps: parsed.steps.map((s) => (typeof s === 'string' ? s : String(s))),
        estimatedComplexity: complexity,
      };

      // Emit event
      this._onAnalysisCompleted.fire(analysisResult);

      return analysisResult;
    } catch (error) {
      console.error('[ReasoningEngine] LLM task analysis failed, falling back to local:', error);

      // Fallback: local NLP decomposition (no LLM required)
      return this.performLocalAnalysis(task);
    }
  }

  /**
   * Extract the first JSON object or array from a string that may
   * contain surrounding markdown fences or prose.
   */
  private extractJson(raw: string): string {
    // Try to find JSON within markdown code fences
    const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      return fenceMatch[1].trim();
    }

    // Try to find a JSON object directly
    const braceStart = raw.indexOf('{');
    const braceEnd = raw.lastIndexOf('}');
    if (braceStart !== -1 && braceEnd > braceStart) {
      return raw.substring(braceStart, braceEnd + 1);
    }

    // Return as-is and let JSON.parse throw if invalid
    return raw.trim();
  }

  /**
   * Infer complexity from step count when the LLM doesn't provide it.
   */
  private inferComplexity(stepCount: number): 'simple' | 'medium' | 'complex' {
    if (stepCount <= 2) { return 'simple'; }
    if (stepCount <= 5) { return 'medium'; }
    return 'complex';
  }

  /**
   * Local fallback analysis — simple sentence-based splitting.
   * Used when the LLM is unavailable or returns invalid output.
   * Language-aware: handles CJK sentence boundaries.
   */
  private performLocalAnalysis(task: string): TaskAnalysisResult {
    const lang = detectInputLanguage(task);
    const steps: string[] = [];

    let sentences: string[];
    if (lang === 'zh') {
      // Chinese: split on Chinese punctuation + semicolons + conjunctions
      sentences = task
        .split(/[。！？；\n]+|[,，]\s*(?:然后|接着|再|并且|同时)/g)
        .map((s) => s.trim())
        .filter((s) => s.length > 2);
    } else {
      // English: standard sentence boundaries
      sentences = task
        .split(/[.!?]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 5);
    }

    if (sentences.length <= 1) {
      if (lang === 'zh') {
        // Chinese: try splitting on commas / conjunctions
        const parts = task
          .split(/[,，、;；]|\s*(?:和|与|以及|并且)\s*/g)
          .map((s) => s.trim())
          .filter((s) => s.length > 2);
        if (parts.length > 1) {
          steps.push(...parts);
        } else {
          steps.push(`分析需求：${task}`);
          steps.push(`实现解决方案`);
          steps.push(`验证并测试实现`);
        }
      } else {
        // English: before falling back to generic steps, try splitting the
        // (often punctuation-less) prompt on commas and sequencing words so
        // each clause becomes its own actionable step.
        const parts = task
          .split(/[,;]+|\bthen\b|\band then\b|\bafter that\b|\bfinally\b/i)
          .map((s) => s.trim())
          .filter((s) => s.length > 10);
        if (parts.length > 1) {
          steps.push(...parts);
        } else {
          steps.push(`Analyze requirements: ${task}`);
          steps.push(`Implement the solution`);
          steps.push(`Verify and test the implementation`);
        }
      }
    } else {
      for (const sentence of sentences) {
        steps.push(sentence);
      }
    }

    const complexity = this.inferComplexity(steps.length);

    const result: TaskAnalysisResult = {
      analysis: `Task breakdown for: ${task}`,
      steps,
      estimatedComplexity: complexity,
    };

    this._onAnalysisCompleted.fire(result);
    return result;
  }

  /**
   * Dispose of resources
   */
  public dispose(): void {
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];
  }
} 