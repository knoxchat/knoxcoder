/**
 * Thin TypeSafe System One types (Jev). Kept local so tests and Core
 * do not depend on @typesafe-ai/sdk at runtime.
 */

export type JevJson =
  | string
  | number
  | boolean
  | null
  | JevJson[]
  | { [key: string]: JevJson };

export interface JevNoulQuestion {
  type: "noul";
  instructions: JevJson;
  criteria?: { true?: JevJson; false?: JevJson } | null;
}

export interface JevChoiceQuestion {
  type: "choice";
  instructions: JevJson;
  criteria: Record<string, JevJson | null>;
}

export interface JevScoreQuestion {
  type: "score";
  instructions: JevJson;
  criteria: JevJson[];
}

export type JevQuestion = JevNoulQuestion | JevChoiceQuestion | JevScoreQuestion;

export interface JevNoulAnswer {
  type: "noul";
  noul: number;
}

export interface JevChoiceAnswer {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities?: Record<string, number>;
}

export interface JevScoreAnswer {
  type: "score";
  score: number;
  confidence: number;
  probabilities?: Record<string, number>;
}

export type JevAnswer = JevNoulAnswer | JevChoiceAnswer | JevScoreAnswer;

export interface JevSystemOneRequest {
  state: JevJson;
  questions: Record<string, JevQuestion>;
  model?: string;
}

export interface JevSystemOneResult {
  model: string;
  answers: Record<string, JevAnswer>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export interface JevClient {
  systemOne(
    request: JevSystemOneRequest,
    options?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<JevSystemOneResult>;
}

export interface JevYamlConfig {
  enabled?: boolean;
  model?: string;
  apiKey?: string;
  timeoutMs?: number;
  failOpen?: boolean;
  baseUrl?: string;
}

export interface JevRuntime {
  enabled: boolean;
  model: string;
  timeoutMs: number;
  failOpen: boolean;
  apiKey: string;
  baseUrl: string;
}
