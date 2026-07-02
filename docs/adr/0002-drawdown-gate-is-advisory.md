# The daily-drawdown gate is advisory in V1

The risk doctrine includes a "daily account drawdown < 2%" gate, but V1 implements
it as an **advisory confirmation** — the agent asks the operator to confirm they
are within their daily drawdown limit before endorsing an entry — rather than
computing it from data.

## Why

Overwatch places no trades (D1), so it can only *observe* account state through the
Groww MCP. No holdings/positions tool is wired today (the code calls only
`get_quotes_and_depth` and `fetch_historical_candle_data`), and whether the Groww
MCP exposes a today's-P&L field is an unconfirmed `[CONFIRM]`. Enforcing the gate
from data would require either a confirmed day-P&L field or a stateful day-open
equity tracker — new subsystems. Making the gate advisory keeps V1 honest about
what it can actually see instead of asserting a check it cannot perform.

## Consequences

- Upgrade path: once the Groww holdings/positions tool and its P&L fields are
  confirmed, the gate can become live and stateless (read P&L at gate time ÷ a
  user-set `account_capital`). If the MCP only returns current value, a day-open
  baseline tracker is the fallback.
