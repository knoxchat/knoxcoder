const DEFAULT_MAX_TOKENS = 32000;
const DEFAULT_CONTEXT_LENGTH = 1_000_000;
const DEFAULT_TEMPERATURE = 0.5;

const DEFAULT_ARGS = {
  maxTokens: DEFAULT_MAX_TOKENS,
  temperature: DEFAULT_TEMPERATURE,
};

const GPT_4_CTX_LEN = 200_000;
const CLAUDE_4_CTX_LEN = 1_000_000;

/**
 * Static fallbacks for non-KnoxChat providers / offline use.
 * KnoxChat and knox.chat-compatible models prefer live /v1/models metadata.
 */
const CONTEXT_LENGTH_FOR_MODEL: { [name: string]: number } = {
  "gpt-4o": GPT_4_CTX_LEN,
  "gpt-4o-mini": GPT_4_CTX_LEN,
};

const TOKEN_BUFFER_FOR_SAFETY = 350;
const PROXY_URL = "http://localhost:65433";

const DEFAULT_MAX_CHUNK_SIZE = 2000; // 512 - buffer for safety (in case of differing tokenizers)
const DEFAULT_MAX_BATCH_SIZE = 64;

export {
  CLAUDE_4_CTX_LEN,
  CONTEXT_LENGTH_FOR_MODEL,
  DEFAULT_ARGS,
  DEFAULT_CONTEXT_LENGTH,
  DEFAULT_MAX_BATCH_SIZE,
  DEFAULT_MAX_CHUNK_SIZE,
  DEFAULT_MAX_TOKENS,
  DEFAULT_TEMPERATURE,
  PROXY_URL,
  TOKEN_BUFFER_FOR_SAFETY,
};
