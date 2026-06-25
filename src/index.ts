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
- console_log_alert: used by daemons to notify the user.

## SKILL REGISTRY  (read the file before applying)
- risk-gate.md        : MANDATORY before any entry recommendation. Run all gates in
                        order; STAND DOWN and FLAG if any fails.
- position-sizing.md  : compute share count from risk budget + ATR stop.
- momentum-raid.md    : momentum/breakout framework.
- valuation-campaign.md: valuation framework (NEVER mix with momentum).
- monitor-builder.md  : how to write & spawn a background monitor.

## RULES OF ENGAGEMENT
1. Never recommend buying a falling price — require a CLOSED green reversal candle.
2. Order-book sell:buy > 3:1 = ABORT. Re-check at the moment of entry. Distrust the
   first 15–20 min of depth data.
3. RSI > 70–75 OR price above upper Bollinger = stand down (no chasing).
4. Daily CLOSE determines thesis validity, not intraday wicks.
5. Always set an ATR-based stop conceptually at entry; output the GTT level + share
   count for the user to arm in Groww.
6. If a requested action violates a rule, say so plainly and refuse to endorse it.

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

  // 1. Credentials flow — keychain first, .env fallback on first run, prompt otherwise.
  const llmKey = await getOrSetCredential('overwatch', 'llmKey', 'Enter LLM Provider API Key (e.g. ANTHROPIC_API_KEY):', true, llmEnv);
  const growwToken = await getOrSetCredential('overwatch', 'growwToken', 'Enter Groww Read-Only Token:', true, growwEnv);
  
  if (!llmKey) {
    console.error("LLM Key is required to run Overwatch.");
    process.exit(1);
  }

  // Set the LLM key for Pi (Anthropic by default based on spec)
  process.env.ANTHROPIC_API_KEY = llmKey;
  // Make token available to our custom extensions
  process.env.GROWW_API_TOKEN = growwToken;

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
  };

  try {
    await main([], { extensionFactories: [overwatchExtension] });
  } catch (error: any) {
    console.error("Failed to start session:", error.message);
  }
}

start().catch(console.error);
