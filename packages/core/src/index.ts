// @overwatch/core — the Overwatch doctrine as a transport-agnostic library.
// Consumed by @overwatch/cli (terminal), and (later) @overwatch/server and
// @overwatch/worker. No terminal/UI assumptions live here.

export { makeOverwatchExtension, MASTER_SYSTEM_PROMPT } from './doctrine.js';
export type { OverwatchExtensionOptions } from './doctrine.js';
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
export { GrowwMcpBridge } from './mcp-bridge.js';
export type { GrowwStatus } from './mcp-bridge.js';
export { notifyTelegram, telegramEnabled } from './telegram.js';
export { FileStore, sanitizeName } from './file-store.js';
export { setupAutoLoader, scoreSkills } from './auto-loader.js';
export { registerCustomTools } from './custom-tools.js';
export { GrowwDataClient } from './groww-client.js';
export {
  evaluateGates,
  fail,
  recover,
  marketOpen,
  istClock,
  initMonitorState,
  DEFAULT_WATCHDOG,
} from './monitor-gates.js';
export type { WatchdogOpts, WatchdogAlert, GateFire, IstClock } from './monitor-gates.js';
export type {
  UserContext,
  OverwatchStore,
  Monitor,
  MonitorGates,
  MonitorState,
  Alert,
  AlertSeverity,
  JournalRecord,
  TelegramConfig,
  OllamaConfig,
} from './types.js';
