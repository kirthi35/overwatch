# The mature doctrine assumes web search (a V2 capability)

The authored `valuation-cycle-analyzer` skill calls `web_search` (step 5, the
recovery gate — confirming the live theme/catalyst), and the
`stock-thesis-validator` and `macro-to-india-mapper` stages need current news to do
their job. idea.md §2 explicitly **defers web search to V2**. The doctrine has
therefore moved ahead of the shipped tool surface.

## Why record it

A reader will see analytical skills invoke `web_search` and assume the tool exists.
It does not — there is no web-search tool registered in the codebase today. This is
a real gap between the authored doctrine and V1's capabilities, not an oversight in
the skills.

## Consequences

- Open decision (flagged to the operator): either pull web search forward into
  scope (add an Exa/Brave/Tavily custom tool, per idea.md V2 notes), or have the
  operator supply the macro/news read manually and keep those stages dependent on
  human input until V2.
- Until resolved, the affected stubs (`macro-to-india-mapper`,
  `stock-thesis-validator`) and `valuation-cycle-analyzer` step 5 must degrade
  gracefully: state that the "why intact?" check is unverified rather than fabricate
  a news read.
