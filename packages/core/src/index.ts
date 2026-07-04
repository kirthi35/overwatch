// @overwatch/core — the Overwatch doctrine as a transport-agnostic library.
// Consumed by @overwatch/cli (terminal), and (later) @overwatch/server and
// @overwatch/worker. No terminal/UI assumptions live here.

export { overwatchExtension, MASTER_SYSTEM_PROMPT } from './doctrine.js';
export {
  resolveLlmProvider,
  resolveGlmConfig,
  registerOllamaProvider,
  glmPiArgs,
  OLLAMA_PROVIDER,
  DEFAULT_GLM_MODEL,
  DEFAULT_GLM_MODELS,
  DEFAULT_OLLAMA_BASE_URL,
} from './llm-provider.js';
export type { LlmProvider, GlmConfig } from './llm-provider.js';
export { setupGrowwMCP, growwStatus, growwReady, callGroww } from './mcp-bridge.js';
export type { GrowwStatus } from './mcp-bridge.js';
export { notifyTelegram, telegramEnabled } from './telegram.js';
