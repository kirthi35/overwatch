# OVERWATCH — V1 Technical Specification

> **Build target for Claude Code.** A local-first, terminal AI trading assistant for the Indian stock market (NSE). Analyze → monitor → alert. **No order execution in V1.**

- **Version:** 1.0.0
- **Codename:** Overwatch
- **Distribution:** Standalone Node.js CLI via NPM (`npm install -g overwatch-cli`, launches as `overwatch`)
- **Owner persona:** "War General" — decisive, systems-oriented, defined-risk trading
- **Last verified:** June 2026 (Pi framework facts, package scopes, and the browser package were verified against live sources; items marked **[CONFIRM]** must be re-validated against official docs at build time before coding against them)

---

## 0. Locked Decisions (do not relitigate)

| # | Decision | Rationale |
|---|----------|-----------|
| **D1** | **No order execution.** Analyze / monitor / alert only. User places all trades manually in Groww. | Highest-risk surface removed. The agent *cannot* move money. Auth collapses to read-only. |
| **D2** | **Groww connectivity = MCP primary, REST gap-driven.** REST tools built only for a *named, verified* gap — never speculatively. | Reuses Groww's maintained, official MCP. Avoids hand-rolling wrappers against unconfirmed endpoints. |
| **D3** | **V1 = analyze + monitor + alert.** Browser automation / TradingView screenshots / web search → **V2**. | Keeps the engine driven by structured *numbers* (which the rules can gate on), not pixels. Tight, shippable scope. |

**Critical auth consequence of D1:** provision and use a **read-only Groww API token** (market data + holdings + positions; **no trade scope**). Even a full compromise of Overwatch cannot place an order.

---

## 1. Objective

Build a privacy-first terminal AI that:

1. Analyzes NSE equities using technical + fundamental data pulled live from Groww.
2. Applies the user's **own trading doctrine** as first-class, enforced guardrails (not generic playbooks).
3. Monitors watchlists and holdings, and fires alerts (Telegram/Discord webhook) when defined conditions are met — even after the CLI is closed.
4. Lets the user learn/add new strategies as Markdown skills on the fly.
5. Keeps all data, sessions, keys, and theses **local** (`~/.overwatch/`).

The agent is a **scout and analyst, not a shooter.** It tells the user exactly what to do; the user pulls the trigger in Groww.

---

## 2. Tech Stack (verified)

### Core framework — Pi (terminal coding-agent harness)
Pi is a minimal, extensible TypeScript agent harness (4 built-in tools: read, write, edit, bash; ~300-word system prompt; everything else is extensions/skills). Stewarded by Earendil; MIT core.

| Package (canonical `@earendil-works/` scope) | Role |
|---|---|
| `@earendil-works/pi-coding-agent` | Full agent runtime: `createAgentSession`, `SessionManager` (JSONL persistence + **tree/branching sessions**), `AuthStorage`, `ModelRegistry`, context compaction, skills, extension system. |
| `@earendil-works/pi-agent-core` | Agent loop: tool execution, event streaming, the `Agent` class, and the hooks we rely on — `transformContext`, `beforeToolCall`, `afterToolCall`. |
| `@earendil-works/pi-ai` | Unified LLM API across 15+ providers; **mid-session model switching**; `Type` (typebox) for tool schemas. |
| `@earendil-works/pi-tui` | Terminal UI: differential rendering, markdown display, multi-line editor, spinners. |

> **[CONFIRM]** Package scope at build time. The official pi.dev packages page links the `@earendil-works/` scope (post-acquisition canonical). A legacy `@mariozechner/` scope also exists on npm. Pin whichever the live pi.dev install instructions specify, then lock the version in `package.json`.

**Pi facts that shape the design (verified):**
- **No native MCP.** MCP support is something you *build as an extension* or install as a community package. (See §4.)
- **No sub-agents, no plan mode, no background bash, no permission popups** — all deliberate non-features. Our daemon model accounts for this (§6).
- Four runtime modes: interactive, print/JSON, RPC, **SDK** (we use SDK to embed Pi in our own branded CLI).
- Skills are Markdown files loaded on demand. Extensions are TypeScript modules. Both installable via `pi install npm:<pkg>` / `pi install git:<url>`.

### Data source — Groww
- **Groww MCP server (primary):** `https://mcp.groww.in/mcp` — exposes quotes + full bid/ask depth, historical candles, technical indicators, fundamentals, screeners, option Greeks, OI analysis, and portfolio holdings.
- **Groww REST API (gap-driven only):** used solely when a specific datum the MCP lacks is identified. **[CONFIRM]** official Groww API/MCP developer docs URL, auth flow, read-only token scopes, symbol formats, and rate limits before writing any REST wrapper. **Do not invent endpoints.**

### Alerting
- Outbound webhook → **Telegram** and/or **Discord** (user provides webhook URL / bot token).

### Runtime
- **Node.js v20+**, TypeScript.

### Deferred to V2 (do not build in V1)
- `pi-agent-browser-native` (community ext by `fitchmultz`, wraps upstream `agent-browser` — vercel-labs) for TradingView screenshots / visual chart capture.
- Web search (custom Exa/Brave/Tavily tool, or the browser package's `agent_browser_web_search` companion).
- Options/derivatives strategies, multi-broker (Zerodha/Upstox), cloud/durable execution (Flue).

### Reference links
- Pi home: https://pi.dev/ · Docs: https://pi.dev/docs/latest · Packages: https://pi.dev/packages
- pi-coding-agent (npm): https://www.npmjs.com/package/@earendil-works/pi-coding-agent
- pi-agent-core (npm): https://www.npmjs.com/package/@mariozechner/pi-agent-core
- Pi monorepo (GitHub): https://github.com/earendil-works/pi
- SDK embedding tutorial (OpenClaw pattern): https://nader.substack.com/p/how-to-build-a-custom-agent-framework
- Design philosophy: https://mariozechner.at/posts/2025-11-30-pi-coding-agent/
- (V2) Browser ext: https://pi.dev/packages/pi-agent-browser-native · upstream engine: https://agent-browser.dev/
- (V2) Web search keys: https://dashboard.exa.ai/api-keys · https://api-dashboard.search.brave.com/

---

## 3. Architecture

```
User
  │  (types in terminal)
  ▼
Overwatch CLI  ── branded splash (figlet + gradient), readline loop ──┐
  │                                                                    │
  ▼                                                                    │
Pi SDK (createAgentSession)                                            │
  │   ├─ transformContext hook ──► Registry/Auto-loader (injects the   │
  │   │                            right skill text + tool schemas     │
  │   │                            based on the user's prompt)         │
  │   ├─ built-in tools: read / write / edit / bash                    │
  │   └─ custom tools (registered at init):                            │
  │         • Groww MCP bridge (extension)  ◄── primary data           │
  │         • Groww REST tools (gap-driven) ◄── only confirmed gaps    │
  │         • webhook_alert                                            │
  ▼                                                                    │
Local workspace  ~/.overwatch/  (sessions, skills, scripts, data, cache)
  │                                                                    │
  ▼                                                                    │
Background daemon (Node script written by agent, spawned via bash/pm2) ┘
  └─ polls Groww (MCP/REST) on schedule, evaluates against thesis JSON,
     fires webhook_alert. No LLM in the hot loop. Market-calendar aware.
```

**Key principle — the engine runs on numbers, not pixels.** Every gate (RSI, order-book ratio, ATR, daily close) reads structured data from the Groww MCP. The LLM is the *brain* (analysis, thesis, writing the daemon); the daemon is the *body* (cheap, fast, runs without the LLM).

---

## 4. Tooling Layer

### 4.1 Groww MCP bridge (primary)
Pi has no native MCP, so build a **thin Pi extension** that acts as an MCP client to `https://mcp.groww.in/mcp` and registers each MCP tool as a Pi `customTool` (lazy connect — only dial the server when a tool is actually called).

- Use the standard MCP client SDK (`@modelcontextprotocol/sdk`) inside the extension.
- Map MCP tool definitions → Pi `AgentTool` schemas (typebox `Type.Object`).
- Pass the **read-only** Groww token via env/secret store (§7).
- **[CONFIRM]** the exact MCP tool names and parameter shapes at build time by introspecting the live server (`tools/list`). Expected coverage: live quote + depth ladder, historical candles, technical indicators, fundamentals, holdings/positions.

### 4.2 Groww REST tools (gap-driven)
Build a REST tool **only** when a specific, named datum is confirmed absent from the MCP. Each must:
- Hit a **[CONFIRM]**ed official Groww endpoint with the read-only token.
- Respect documented rate limits (insert sleep/jitter in any loop).
- Be registered the same way as MCP tools (typebox schema + `execute`).

### 4.3 `webhook_alert`
A custom tool that POSTs a formatted JSON payload (ticker, condition, value, timestamp) to the user's Telegram/Discord webhook. Used by the daemon, not the interactive agent.

### 4.4 Built-in (from Pi)
`read` / `write` / `edit` / `bash` — used by the agent to write thesis JSON, generate daemon scripts, and spawn them. **Constrain all file/bash operations to `~/.overwatch/`.**

---

## 5. Skills Layer (the user's doctrine — this is the differentiator)

Skills are Markdown playbooks in `~/.overwatch/skills/`, loaded on demand. **These encode the user's actual rules, not generic templates.** Bundle these at install:

### 5.1 `risk-gate.md` — the hard gates (enforced before any "enter" recommendation)
The agent must run these in order and **stand down** if any fails:
1. **Thesis alignment** — does the setup match the active framework (raid vs campaign)?
2. **Daily trend confirmation** — daily close, not intraday wicks, determines validity.
3. **Order-book gate** — sell:buy ratio **> 3:1 = ABORT, no exceptions.** Must be re-checked at the *actual moment of entry*, and treated as unreliable in the first 15–20 min after open (thin depth ladder).
4. **Confirmed reversal candle** — never recommend buying a falling price. Require a **closed** green reversal candle, not a forming one.
5. **No-chasing filter** — if RSI > 70–75 **or** price above the upper Bollinger Band → stand down.

> The agent must explicitly **flag any proposed entry that violates a rule**, even if the user asks for it. Cash is a valid position.

### 5.2 `position-sizing.md` — ATR-based sizing
Given a per-trade **risk budget** (user-provided) and the **ATR stop distance**, compute exact share count:
`shares = floor(risk_budget / (entry_price − atr_stop_price))`.
Output the stop price (for the user to arm as a GTT in Groww) and the share count. Always set the stop conceptually at entry.

### 5.3 `momentum-raid.md` — momentum/breakout framework
Weights: RSI, MACD, SuperTrend, ADX, ATR, Bollinger, EMA, SMA(20/50), VWAP. Volume-shocker / breakout logic. (CAN-SLIM-style, Indian-context.)

### 5.4 `valuation-campaign.md` — valuation framework (distinct from raids)
Different entry zones, risk/reward, and indicator weights. Fundamental checks: P/E vs industry P/E, EPS TTM, ROE/ROIC, debt-to-equity, PEG, sector premium. Margin-of-safety scoring.

### 5.5 `monitor-builder.md` — how the agent writes a daemon (§6)
Procedural playbook the agent reads when asked to "monitor" something.

> **Frameworks are kept separate.** A momentum raid and a valuation campaign use different gates, zones, and indicator weights. The agent must never blend them.

---

## 6. Background Monitoring (Daemon Engine)

Because Pi has **no background bash**, the agent does *not* babysit monitoring. Instead:

1. **Define state** — agent serializes entry/exit conditions to `~/.overwatch/data/<TICKER>_monitor.json`.
2. **Write the daemon** — agent uses `write` to generate a standalone Node.js script `~/.overwatch/scripts/<TICKER>_daemon.js` that:
   - Reads the state JSON.
   - Polls Groww (MCP/REST) on schedule for the live values.
   - Compares against thresholds; calls `webhook_alert` when met.
   - **Market-calendar aware:** only polls during NSE hours (09:15–15:30 IST); skips weekends and NSE holidays; handles pre-open. **[CONFIRM]** / bundle an NSE holiday calendar (static JSON, refreshed yearly, or fetched).
   - **Alert dedup:** fire-once per condition with a cooldown window; persist `last_fired` so a price hovering at the threshold doesn't spam.
   - **Rate-limit hygiene:** sleep/jitter between ticker calls when monitoring multiple symbols.
3. **Spawn it** — agent uses `bash` to launch the script as a detached background process (`pm2` or `nohup`/`cron`). Confirm PID to the user.
4. **No LLM in the hot loop** — the daemon is a dumb, fast script. The LLM is only re-invoked on a triggered event if a thesis needs re-evaluation.

---

## 7. Secrets & Auth

- **LLM provider keys:** use Pi's `AuthStorage`.
- **Groww read-only token + webhook secrets:** store in OS keychain (recommended: `keytar` or `@napi-rs/keyring`). If keychain is unavailable, fall back to `~/.overwatch/config.json` with `chmod 600` and a clear warning. **Never** log or echo secrets; redact in any output.
- **First-run flow:** prompt for LLM key + Groww **read-only** token + (optional) alert webhook → validate → persist securely.
- **[CONFIRM]** that Groww issues read-only/scoped API tokens; if only full-scope tokens exist, document the residual risk prominently and still never register an order tool (D1).

---

## 8. Model Strategy

Pi switches models mid-session across providers — use it to control cost:
- **Routing / intent detection:** cheap, fast model (or a lightweight local regex pre-check in the interceptor).
- **Thesis / deep analysis:** strong model (Anthropic Sonnet/Opus class recommended; provider-agnostic).
- **Daemon:** no LLM in the loop at all (see §6).

---

## 9. Master System Prompt (Registry Pattern)

Hardcode into the SDK init. It is a **lean dispatcher**, not an encyclopedia — it lists *what exists and when to use it*, and relies on tool-calling + on-demand skill reads for the heavy detail. This avoids the "lost-in-the-middle" failure and keeps token cost down.

```markdown
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
- webhook_alert: used by daemons to notify the user.

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
```

> The **auto-loader** is implemented in the SDK via the `transformContext` hook: inspect the user prompt, and silently inject the relevant skill text + register the needed tool schemas before the LLM turn (regex/keyword routing is fine for V1). Pi does **not** auto-load by magic — this interceptor is what creates the "it just knows" feel.

---

## 10. Directory Structure (`~/.overwatch/`)

```
~/.overwatch/
├── config.json        # non-secret config (secrets go to OS keychain)
├── sessions/          # chat history as JSONL trees (Pi-managed; supports /fork)
├── skills/            # the .md playbooks from §5
├── scripts/           # generated daemons (<TICKER>_daemon.js)
├── data/              # thesis & monitor state (<TICKER>_monitor.json)
└── cache/             # short-lived fundamental/data cache (e.g., 24h)
```

---

## 11. Session Management

Comes free with Pi's `SessionManager` (JSONL tree sessions):
- `overwatch -r` → resume menu of past sessions.
- `overwatch -c` → continue most recent.
- `/fork` in-session → branch a thesis (e.g., test the same ticker as a momentum raid vs a valuation campaign) **without re-fetching data**.
- `/tree` → navigate branches.
- Sessions are local; no cloud, no expiry.

---

## 12. Primary User Flows

**Flow A — First run.** `npm install -g overwatch-cli` → `overwatch` → prompts for LLM key + read-only Groww token + (optional) webhook → validates, stores securely → renders OVERWATCH splash → chat opens.

**Flow B — Analysis.** User: *"Analyze CDSL for a momentum raid."* → agent fetches indicators + depth via MCP → reads `momentum-raid.md` → runs `risk-gate.md` → returns a decisive PASS/STAND-DOWN with levels, ATR stop, and (if PASS) share count from the risk budget.

**Flow C — Monitor.** User: *"Watch Ather. Alert me on a closed green reversal candle in 932–950 with order-book under 3:1."* → agent writes `Ather_monitor.json` + `Ather_daemon.js` → spawns it via bash → confirms PID. Daemon alerts via webhook when conditions hit. User can close the CLI.

**Flow D — Holdings watch.** User: *"Monitor my holdings; alert if any breaks its daily 50 SMA or draws down >5% from my average."* → agent pulls holdings via MCP → seeds a multi-ticker monitor with rate-limit jitter.

**Flow E — Learn/add a skill.** User pastes a strategy or broker doc → agent writes a new `~/.overwatch/skills/<name>.md` → available immediately.

---

## 13. Functional Requirements (checklist)

- [ ] Standalone CLI, `bin: overwatch`, installable via NPM.
- [ ] Branded splash (figlet + gradient-string), ~10 lines, OVERWATCH wordmark + basic commands.
- [ ] First-run secure credential setup (LLM + read-only Groww token + optional webhook).
- [ ] Pi SDK embedded via `createAgentSession`; readline/`pi-tui` loop.
- [ ] `transformContext` auto-loader (skill + tool injection by intent).
- [ ] Groww MCP bridge extension (lazy connect, read-only token).
- [ ] `webhook_alert` tool.
- [ ] The five skills (§5) bundled.
- [ ] Daemon generation + spawn (market-calendar aware, alert dedup, rate-limit jitter).
- [ ] Workspace sandboxed to `~/.overwatch/`.
- [ ] Tree sessions (resume / continue / fork).
- [ ] **Hard guarantee: no order-placement tool exists anywhere in the codebase.**

---

## 14. Non-Goals (V1) / Edge Cases to handle

**Non-goals:** order execution; options/derivatives; multi-broker; browser/screenshots; web search; cloud execution.

**Edge cases to solve before "done":**
1. **Token expiry** — if Groww returns 401, the daemon pauses and fires a webhook: "Overwatch paused: Groww session expired, re-auth via CLI." Never crash-loop.
2. **Rate limits / IP throttle** — generous sleep + jitter in all polling; cache fundamentals (24h) so forks/re-runs don't re-hit the API.
3. **Market closed** — daemon no-ops outside NSE hours/holidays; no false alerts.
4. **Alert storms** — fire-once + cooldown per condition.
5. **First 15–20 min depth** — risk-gate treats early-session order-book data as unreliable.

---

## 15. Implementation Roadmap (phased)

1. **Bootstrap** — Node project, TypeScript, `bin` mapping, install Pi packages. Verify package scope **[CONFIRM]**.
2. **Branding + first-run** — splash screen; secure credential setup (keychain).
3. **Embed Pi** — `createAgentSession`, interactive loop, workspace sandbox, master system prompt.
4. **Groww MCP bridge** — extension + lazy MCP client; introspect + map tools **[CONFIRM]**.
5. **Skills** — write the five `.md` playbooks from §5.
6. **Auto-loader** — `transformContext` interceptor (intent → skill/tool injection).
7. **Alerting + daemon** — `webhook_alert`, `monitor-builder.md`, daemon generation/spawn, calendar + dedup.
8. **Sessions** — wire resume/continue/fork to `~/.overwatch/sessions/`.
9. **Harden** — edge cases §14; verify the no-order guarantee; end-to-end test Flows A–E.

---

## 16. Prerequisites to confirm BEFORE coding (owner action)

- [ ] **[CONFIRM]** Groww developer/API access provisioned; obtain a **read-only** token; locate official MCP + REST docs (endpoints, scopes, symbol formats, rate limits).
- [ ] **[CONFIRM]** current canonical Pi package scope + latest version on pi.dev.
- [ ] Telegram/Discord webhook (or bot token) for alerts.
- [ ] LLM provider API key.
- [ ] NSE holiday calendar source for the daemon.

---

## 17. Build Prompts for Claude Code

Paste these into Claude Code in order. Each assumes this `OVERWATCH_SPEC.md` is in the repo root.

**Kickoff:**
> Read `OVERWATCH_SPEC.md` in full. This is the build order for a CLI called Overwatch. Before writing any code, do two things: (1) verify the current canonical Pi package scope and latest versions from https://pi.dev/packages and https://www.npmjs.com — report what you find and pin them; (2) list every item marked **[CONFIRM]** and tell me exactly what you need from me to resolve each. Do not scaffold until I confirm. Honor the hard rule: no order-placement code anywhere, ever.

**Phase 1–3 (scaffold + branded shell + embedded Pi):**
> Implement Roadmap phases 1–3 from `OVERWATCH_SPEC.md`: Node+TS project with `bin: overwatch`, the figlet/gradient splash, secure first-run credential setup using an OS keychain (keytar or @napi-rs/keyring), and an embedded Pi SDK interactive loop via `createAgentSession`. Hardcode the §9 Master System Prompt. Sandbox all file/bash ops to `~/.overwatch/`. Show me the run before moving on.

**Phase 4 (Groww MCP bridge):**
> Implement the Groww MCP bridge extension (§4.1) as a lazy MCP client to https://mcp.groww.in/mcp using @modelcontextprotocol/sdk, authenticating with my read-only token from the keychain. Introspect the live server's tool list, map each tool to a Pi customTool with a typebox schema, and print the mapped tools. Build nothing for REST yet — that's gap-driven only.

**Phase 5–6 (skills + auto-loader):**
> Create the five skill files from §5 in `~/.overwatch/skills/`, encoding my doctrine exactly as written (risk-gate ordering, the 3:1 order-book gate, ATR sizing formula, framework separation). Then implement the `transformContext` auto-loader (§9) that routes a prompt to the right skill + tools before the LLM turn.

**Phase 7 (alerting + daemon):**
> Implement `webhook_alert` and the daemon engine (§6): given monitor conditions, write `<TICKER>_monitor.json` and a detached Node daemon that polls Groww during NSE hours only (skip weekends/holidays), dedups alerts (fire-once + cooldown), jitters between tickers, and pauses with a webhook notice on 401. Spawn via pm2/nohup and report the PID.

**Phase 8–9 (sessions + harden):**
> Wire tree sessions (resume/continue/fork) to `~/.overwatch/sessions/`. Then work the §14 edge cases and run end-to-end tests of Flows A–E from §12. Finally, grep the entire codebase to prove no order-placement capability exists, and show me the result.

---

*End of specification — Overwatch V1.0.0*
