# Overwatch

Local-first terminal AI trading assistant for the NSE. It analyzes, monitors, and
alerts on Indian equities under the user's own trading doctrine. It is a **scout and
analyst, not a shooter** — it never places orders; the user executes every trade
manually in Groww.

## Language

### Frameworks

**Raid** (Momentum Raid):
The short-term momentum / breakout trade framework. Thesis `framework` id is
`momentum-raid`. Fast, indicator-driven, held intraday to a few days.
_Avoid_: swing trade, scalp, play.

**Campaign** (Valuation Campaign):
The fundamentals-driven, longer-horizon accumulation framework. In the mature
doctrine this is realized by the **`valuation-cycle-analyzer`** skill (capacity
read), not a monolithic `valuation-campaign.md`. Scaled in over tranches on
valuation, not price momentum.
_Avoid_: investment, value play, position trade.

> A Raid and a Campaign are **never blended** — different gates, zones, and
> indicator weights. This separation is doctrine, not style.

### The doctrine pipeline (mature model)

The operator's real doctrine is a **staged intelligence pipeline**, each stage a
skill that consumes the previous stage's output — not the flat skill set of
idea.md §5. Order:

1. **macro-to-india-mapper** — what theme is in play.
2. **theme-to-stock-scout** — which stock within the theme.
3. **stock-thesis-validator** — is the story actually true.
4. **valuation-cycle-analyzer** — how HIGH / how FAST / how LONG (capacity).
5. **swing-horizon-sizer** — is the bet worth it over the horizon, and how big.
6. **entry-exit-gate** — WHEN to pull the trigger (reversal candle + order-book
   gate + GTT stop).

Then live position management. The pipeline **supersedes** the idea.md §5 names:
`valuation-campaign`→`valuation-cycle-analyzer`, `position-sizing`→
`swing-horizon-sizer`, `risk-gate`→`entry-exit-gate`. `momentum-raid` has no
direct successor (entry timing folds into `entry-exit-gate`).

### Capacity & cycle (valuation vocabulary)

**Operator**:
The human running Overwatch. The canonical term in doctrine skills (they say
"operator," not "user").
_Avoid_: user, trader (in skill text).

**Capacity** (headroom):
How high a stock *could* go = multiple-ceiling × earnings growth. A scenario
under stated assumptions, explicitly **never a prediction or target**.
_Avoid_: target, forecast, price prediction.

**Driver** (the "why"):
The structural theme/catalyst a thesis rests on. A run continues and a crash
recovers only while the driver is **intact**; if it breaks, treat any drop as a
trend-break.
_Avoid_: catalyst (reserve for a single event), reason.

**Break-trigger**:
A specific event that would kill the driver (order cancellation, budget cut,
execution miss, sector de-rate). Watched, not assumed away.
_Avoid_: risk, red flag.

**Velocity**:
How fast a stock actually moves (% over 1W/1M/3M/6M/1Y + ATR/day). Bounds the
realistic horizon move — a 2%/month name won't do 10% next month.
_Avoid_: speed, momentum (momentum is a framework).

**Extension**:
Where price sits in its move: basing / mid-run / extended. Extended → haircut the
expected move (mean-reversion risk).
_Avoid_: overbought (that's an RSI read).

**No-bet**:
The `swing-horizon-sizer` verdict when a realistic horizon move can't clear the
reward-to-risk threshold. A frequent, valid output — distinct from a failed gate.
_Avoid_: pass, skip, reject.

**Conviction**:
A High/Medium/Low grade that nudges the risk budget **within preset bounds** —
it never overrides the stop math or a failed gate.
_Avoid_: confidence, certainty.

### Analysis & entry

**Thesis**:
A per-symbol trade plan (framework, entry zones, triggers, ATR stop, R:R,
invalidation level) serialized to `~/.overwatch/theses/<sym>.json`. The unit the
agent reasons about and a monitor watches.
_Avoid_: setup, plan, idea, call.

**Risk Gate**:
The mandatory, ordered sequence of stand-down checks run before ANY entry
recommendation. Six enforced gates (thesis-align, daily-close trend, order-book
3:1, closed reversal candle, no-chase, ATR-stop+R:R) plus one advisory (daily
drawdown). Fail any gate → stand down. In the mature pipeline this is the
**`entry-exit-gate`** skill (the WHEN stage).
_Avoid_: filter, screen, checklist.

**Gate**:
A single pass/fail check within a sequence. Failing one is terminal for the
recommendation.
_Avoid_: rule, condition, criterion.

**Stand down**:
The doctrine verb for "do not enter — cash is a valid position." What the agent
does when a gate fails or a thesis is invalidated.
_Avoid_: reject, pass, skip, abort (reserve _abort_ for the order-book 3:1 gate).

**Invalidation**:
The price/level (daily close) at which a thesis is dead and the position is stood
down. Distinct from a stop: invalidation kills the *thesis*, a stop caps the *loss*.
_Avoid_: exit, breakdown.

### Account & sizing

**Account capital**:
User-declared total trading capital. The denominator for risk-% and the daily
drawdown gate. Stable, user-set — not the fluctuating live holdings value.
_Avoid_: balance, equity, portfolio value.

**Risk budget**:
The rupee amount risked on a single trade — the numerator for position sizing.
Either named directly by the user or derived as `account_capital × risk%`.
_Avoid_: risk amount, exposure.

### Monitoring

**Monitor**:
A persisted watch on a symbol that evaluates gates on a schedule and emits alerts.
Has two delivery modes (in-session, daemon) but one gate logic.
_Avoid_: alert, tracker, job.

**Arm**:
To create/activate a monitor by writing its JSON file (`~/.overwatch/monitors/` for
in-session, a spawned daemon for unattended). Picked up on the next tick — no
restart.
_Avoid_: start, register, schedule.

**Fire**:
A monitor emitting its terminal alert when a gate is met — one-shot, then it stops.
_Avoid_: trigger, hit, ping.

**In-session watcher**:
The in-process timer (`src/monitor-watch.ts`) that polls armed monitors while the
CLI is open. The lightweight default.
_Avoid_: monitor (that's the watched thing), poller.

**Daemon**:
A standalone Node process (`runtime/daemons/`) that keeps monitoring after the CLI
closes. Opt-in, for unattended / overnight watching.
_Avoid_: background job, service, cron.

**Blind**:
A monitor that cannot reach Groww data for N consecutive cycles. It escalates a
warning rather than going silently dead — the core anti-pattern Overwatch guards
against.
_Avoid_: down, stalled, offline.

**Watchdog**:
The escalating WARNING→CRITICAL logic that surfaces blindness and re-pings until
the feed recovers.
_Avoid_: healthcheck, monitor.

**Alert-bridge**:
The in-session component (`src/alert-bridge.ts`) that tails `alerts.log` + state
files and wakes the chat agent to surface a fire mid-session.
_Avoid_: notifier, hook.

**Sink**:
A delivery target for an alert: `alerts.log` (always) and the Telegram bot
(optional). Every alert producer funnels through the same sinks.
_Avoid_: channel, output, destination.
