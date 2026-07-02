#!/usr/bin/env node
import figlet from 'figlet';
import gradient from 'gradient-string';
import { input, password } from '@inquirer/prompts';
import { AsyncEntry } from '@napi-rs/keyring';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { setupGrowwMCP } from './mcp-bridge.js';
import { setupAutoLoader } from './auto-loader.js';
import { registerCustomTools } from './custom-tools.js';
import { setupAlertBridge } from './alert-bridge.js';
import { resolveLlmProvider, resolveGlmConfig, registerOllamaProvider, glmPiArgs } from './llm-provider.js';

import { main, ExtensionFactory, ExtensionAPI } from '@earendil-works/pi-coding-agent';

const OVERWATCH_DIR = path.join(os.homedir(), '.overwatch');

// Ensure directory exists
if (!fs.existsSync(OVERWATCH_DIR)) {
  fs.mkdirSync(OVERWATCH_DIR, { recursive: true });
}

async function showSplash() {
  return new Promise<void>((resolve) => {
    figlet.text('OVERWATCH', (err: any, data: any) => {
      if (err) {
        console.log('OVERWATCH');
        return resolve();
      }
      console.log(gradient.pastel.multiline(data));
      console.log(gradient.cristal('A Local-First Terminal AI Trading Assistant (NSE)'));
      console.log('------------------------------------------------------------');
      resolve();
    });
  });
}

// Parse a .env file into a flat key/value map (no external dep). Returns {} if absent.
function parseEnvFile(filePath: string): Record<string, string> {
  try {
    if (!fs.existsSync(filePath)) return {};
    const out: Record<string, string> = {};
    for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }
    return out;
  } catch {
    return {};
  }
}

// Optional credential: keychain first, .env/env seed on first run, otherwise
// EMPTY (no prompt). Used for opt-in features like Telegram delivery so a user
// who doesn't want alerts pushed isn't forced to answer a prompt every run.
async function resolveOptionalCredential(account: string, envFallback?: string): Promise<string> {
  const entry = new AsyncEntry('overwatch', account);
  try {
    const existing = await entry.getPassword();
    if (existing) return existing;
  } catch {
    // keychain unavailable — fall through to env
  }
  if (envFallback) {
    try {
      await entry.setPassword(envFallback);
      console.log(`[+] Seeded ${account} from .env into the OS keychain.`);
    } catch { /* non-fatal: still usable from env this run */ }
    return envFallback;
  }
  return '';
}

async function getOrSetCredential(service: string, account: string, promptMessage: string, isSecret = false, envFallback?: string): Promise<string> {
  const entry = new AsyncEntry(service, account);
  try {
    const existing = await entry.getPassword();
    if (existing) return existing;
  } catch (err) {
    // Keyring not found or error, will prompt
  }

  // First run: seed from .env if available, otherwise prompt.
  let value: string;
  if (envFallback) {
    console.log(`[+] Seeded ${account} from .env into the OS keychain.`);
    value = envFallback;
  } else {
    value = isSecret
      ? await password({ message: promptMessage })
      : await input({ message: promptMessage });
  }

  if (value) {
    try {
      await entry.setPassword(value);
    } catch (e) {
      console.error(`Failed to save to keychain for ${service}:${account}. You may need to run this again next time.`);
    }
  }
  return value;
}

const MASTER_SYSTEM_PROMPT = `
# OVERWATCH — Indian Stock Market AI (War General)

You are Overwatch, a decisive, systems-oriented analytical partner for an NSE swing
trader. You are a SCOUT AND ANALYST. You DO NOT and CANNOT place orders — the user
executes all trades manually in Groww. Speak directly and structured: lead with the
action, then the logic. No hedging. Never blend frameworks. Cash is a valid position.

## ACTIVE TOOLS
- Groww MCP (primary): live quote + depth ladder, historical candles, indicators,
  fundamentals, holdings. Use for ALL data/gates. Never guess financial data.
- Groww REST (gap-only): use only for data the MCP lacks.
- bash / write / read / edit: workspace ~/.overwatch/ ONLY. Use to write thesis JSON
  and generate/spawn monitoring daemons.
- arm_monitor / disarm_monitor: the PROPER way to start/stop watching a symbol
  in-session. arm_monitor writes+validates the monitor file; the in-process
  watcher polls it every minute during market hours. NEVER hand-write the monitor
  JSON — call arm_monitor.
- console_log_alert: used by daemons to notify the user. Alerts write to
  ~/.overwatch/alerts.log and, if Telegram is configured, are ALSO delivered to
  the user's Telegram bot (so fires reach them even with the CLI closed).

## SKILL REGISTRY — the doctrine pipeline  (read the file before applying)
Analysis is a STAGED pipeline; each stage consumes the previous stage's output.
Route to the stage the operator is at, and never skip stages when recommending an
entry. Frameworks are never blended.
- macro-to-india-mapper    : STAGE 1 — macro/global event -> Indian theme in play.
- theme-to-stock-scout     : STAGE 2 — theme -> best candidate stock(s).
- stock-thesis-validator   : STAGE 3 — is the story/driver true + break-triggers.
- valuation-cycle-analyzer : STAGE 4 — HOW HIGH / HOW FAST / HOW LONG (capacity,
                             never a target/prediction).
- swing-horizon-sizer      : STAGE 5 — is the bet worth it over the horizon + exact
                             share count (Shares = risk budget / (entry - stop)).
                             NO-BET is a valid, frequent output.
- entry-exit-gate          : STAGE 6 — WHEN to pull the trigger: daily-close trend,
                             order-book sell:buy <= 3:1, CLOSED green reversal candle,
                             no-chase. MANDATORY before any entry; STAND DOWN if any
                             gate fails.
- monitor-watch.md         : watch a symbol while the CLI is open (default).
- monitor-builder.md       : spawn an unattended daemon (walk-away / overnight).
(_shared/multi-timeframe-protocol.md is the shared structure read the analytical
stages run first.) Some analytical stages are STUBS awaiting authored doctrine —
say so plainly rather than inventing rules. Read-only always: you never place orders.

## RULES OF ENGAGEMENT
1. Never recommend buying a falling price — require a CLOSED green reversal candle.
2. Order-book sell:buy > 3:1 = ABORT. Re-check at the moment of entry. Distrust the
   first 15–20 min of depth data.
3. RSI > 70–75 OR price above upper Bollinger = stand down (no chasing).
4. Daily CLOSE determines thesis validity, not intraday wicks.
5. Always set an ATR-based stop conceptually at entry; output the GTT level + share
   count for the user to arm in Groww.
6. If a requested action violates a rule, say so plainly and refuse to endorse it.

## MONITORING — one monitor (read monitor-watch.md)
When the user asks to "watch/monitor" something, call the arm_monitor tool with
structured gates (name, symbol, search_query, segment, poll_minutes [default 1],
time_gate_ist, candle_interval, gates:{stop_below, zone:[lo,hi],
require_green_candle, max_sell_buy_ratio, breakout_above}). NEVER hand-write the
monitor JSON. arm_monitor writes+validates the file and starts the single
always-on daemon (overwatch-monitord), which polls every armed monitor every
minute during market hours with cheap JS gates — no LLM in the loop — and writes
any fire to alerts.log. It SURVIVES the CLI closing; fires reach the user's
Telegram if configured. NO restart needed; picked up on the next tick. Use
disarm_monitor to stop. For bespoke gates the generic schema can't express,
hand-write a daemon per monitor-builder.md and pass mode:"daemon" so the shared
daemon skips it. Fires land in alerts.log and you get woken to surface them (below).

## MONITOR EVENTS (pushed by the alert-bridge)
A background monitor can wake you mid-session with a message tagged
[OVERWATCH MONITOR EVENT]. When you receive one:
- SURFACE it to the user immediately, in plain language, and give a ONE-LINE
  read of what it means for the position/thesis.
- Do NOT auto-run the full risk gate or pull fresh data on your own — the event
  is a heads-up, not an order. End by OFFERING to run the live risk gate.
- Never place or imply an order (you can't — the user executes in Groww).

## ROUTING
For each prompt: (1) decide which data you need and fetch via MCP/REST;
(2) if a named strategy applies, READ the skill file first; (3) run risk-gate.md
before any entry call; (4) deliver a decisive, structured recommendation.
`.trim();

async function start() {
  await showSplash();

  // Load .env from the launch dir BEFORE any chdir, for first-run keychain seeding.
  const dotenv = parseEnvFile(path.join(process.cwd(), '.env'));
  const llmEnv = dotenv.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  const growwEnv = dotenv.groww_api_key || process.env.GROWW_API_TOKEN;

  // Which brain drives the Pi agent this run: Claude (default) or GLM-5.2 via
  // Ollama Cloud. Switchable/reversible via OVERWATCH_LLM (env or .env).
  const llmProvider = resolveLlmProvider(dotenv);

  // 1. Credentials flow — keychain first, .env fallback on first run, prompt otherwise.
  const growwToken = await getOrSetCredential('overwatch', 'growwToken', 'Enter Groww Read-Only Token:', true, growwEnv);
  // Make token available to our custom extensions
  process.env.GROWW_API_TOKEN = growwToken;
  // Persist a chmod-600 groww.json so the always-on monitor daemon can read the
  // token when launched outside this process (reboot / pm2 / systemd), not just
  // when arm_monitor spawns it with the env inherited. Best-effort.
  try {
    const growwPath = path.join(OVERWATCH_DIR, 'groww.json');
    fs.writeFileSync(growwPath, JSON.stringify({ token: growwToken }, null, 2));
    fs.chmodSync(growwPath, 0o600);
  } catch { /* non-fatal: env still covers the CLI-spawned daemon */ }

  // 1a. LLM credentials + provider selection. `piArgs` picks the model for Pi's
  // main(); empty = Pi's default (Anthropic).
  let piArgs: string[] = [];
  if (llmProvider === 'glm') {
    // GLM mode: Ollama Cloud key is REQUIRED; Anthropic key is optional (kept only
    // if already present, so a GLM-only operator isn't prompted for a Claude key).
    const anthropicKey = await resolveOptionalCredential('llmKey', llmEnv);
    if (anthropicKey) process.env.ANTHROPIC_API_KEY = anthropicKey;

    const ollamaEnv = dotenv.ollama_api_key || dotenv.OLLAMA_API_KEY || process.env.OLLAMA_API_KEY;
    const ollamaKey = await getOrSetCredential('overwatch', 'ollamaKey', 'Enter Ollama Cloud API Key (OLLAMA_API_KEY):', true, ollamaEnv);
    if (!ollamaKey) {
      console.error('OVERWATCH_LLM=glm but no Ollama Cloud API key provided (set ollama_api_key in .env or provide it when prompted).');
      process.exit(1);
    }
    process.env.OLLAMA_API_KEY = ollamaKey;

    const glm = resolveGlmConfig(dotenv);
    registerOllamaProvider(glm);
    piArgs = glmPiArgs(glm.modelId);
    console.log(`[+] LLM: Ollama Cloud GLM (${glm.modelId}) via ${glm.baseUrl}. Set OVERWATCH_LLM=claude to switch back.`);
  } else {
    // Claude mode (default): Anthropic key is REQUIRED.
    const llmKey = await getOrSetCredential('overwatch', 'llmKey', 'Enter LLM Provider API Key (e.g. ANTHROPIC_API_KEY):', true, llmEnv);
    if (!llmKey) {
      console.error("LLM Key is required to run Overwatch.");
      process.exit(1);
    }
    process.env.ANTHROPIC_API_KEY = llmKey;
    console.log('[i] LLM: Anthropic Claude (default). Set OVERWATCH_LLM=glm for Ollama Cloud GLM-5.2.');
  }

  // 1b. Optional Telegram alert delivery — walk-away alerts → bot. Opt-in: only
  // enabled if creds are present (keychain or .env). We ALSO write a chmod-600
  // ~/.overwatch/telegram.json so daemons spawned in a bare shell (no inherited
  // env) can still deliver. Env vars set here cover the in-process watcher +
  // console_log_alert.
  const tgToken = await resolveOptionalCredential('telegramBotToken', dotenv.telegram_bot_token || process.env.TELEGRAM_BOT_TOKEN);
  const tgChat = await resolveOptionalCredential('telegramChatId', dotenv.telegram_chat_id || process.env.TELEGRAM_CHAT_ID);
  if (tgToken && tgChat) {
    process.env.TELEGRAM_BOT_TOKEN = tgToken;
    process.env.TELEGRAM_CHAT_ID = tgChat;
    const minSev = process.env.TELEGRAM_MIN_SEVERITY || dotenv.telegram_min_severity || 'WARNING';
    try {
      const tgPath = path.join(OVERWATCH_DIR, 'telegram.json');
      fs.writeFileSync(tgPath, JSON.stringify({ botToken: tgToken, chatId: tgChat, minSeverity: minSev }, null, 2));
      fs.chmodSync(tgPath, 0o600);
      console.log(`[+] Telegram delivery enabled (alerts >= ${minSev} -> bot).`);
    } catch (e: any) {
      console.error(`[!] Telegram configured but failed to write telegram.json: ${e.message}`);
    }
  } else {
    console.log('[i] Telegram delivery off (set telegram_bot_token + telegram_chat_id in .env to enable walk-away alerts).');
  }

  // 2. Prepare Sandbox environment
  process.chdir(OVERWATCH_DIR);
  process.env.PI_WORKSPACE_DIR = OVERWATCH_DIR;

  console.log('Initializing Overwatch AI Session...');

  const overwatchExtension: ExtensionFactory = (api: ExtensionAPI) => {
    api.on("before_agent_start", async (event) => {
      // Connect to Groww MCP and register tools dynamically
      await setupGrowwMCP(api);

      // Inject the doctrine logic as a master prompt overriding the default agent identity
      return {
        systemPrompt: MASTER_SYSTEM_PROMPT
      };
    });

    // Wire up the dynamic skills auto-loader
    setupAutoLoader(api);
    
    // Register custom tools like console_log_alert
    registerCustomTools(api);

    // Watch the monitor daemon's alerts.log + state files and wake this chat
    // when a monitor fires a terminal/CRITICAL event (see alert-bridge.ts).
    // This is the ONLY monitoring concern the CLI owns — surfacing. Polling
    // lives entirely in the always-on overwatch-monitord daemon, which the
    // arm_monitor tool starts on demand (so a watch survives the CLI closing).
    setupAlertBridge(api);
  };

  try {
    await main(piArgs, { extensionFactories: [overwatchExtension] });
  } catch (error: any) {
    console.error("Failed to start session:", error.message);
  }
}

start().catch(console.error);
