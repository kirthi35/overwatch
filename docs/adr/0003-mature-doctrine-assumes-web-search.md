# The mature doctrine assumes web search (a V2 capability)

**Status:** Resolved (2026-07-05) — deferred; operator-supplied. No web-search tool is
wired and none is planned near-term (no API keys). See Resolution.

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

## Resolution (2026-07-05)

**Deferred — no web-search tool; operator-supplied.** The operator chose NOT to add a
search API (no API keys) and NOT to browser-scrape search engines (Chromium RAM cost on
the one box + anti-bot/CAPTCHA; even `pi-agent-browser-native` recommends a search API
over scraping Google). So `web_search` stays unwired.

Applied across the doctrine: every skill that referenced `web_search`
(`macro-to-india-mapper`, `stock-thesis-validator`, `theme-to-stock-scout`,
`valuation-cycle-analyzer` step 5) now degrades gracefully — it marks `web_search` PENDING
and requires the OPERATOR to supply the news/macro read, and must state the "why intact?"
check is UNVERIFIED rather than fabricate one (Standing Order 8). The timeless cause→effect
doctrine (e.g. the macro→sector transmission map) may still be applied by reasoning; only
live events/prices need a tool.

If web search is picked up later, the clean fit is an in-house `web_search` custom tool in
`@overwatch/core` (registered via `registerCustomTools`, so it loads in the multi-tenant
server — which uses a clean `agentDir` + explicit `extensionFactories` and does NOT load
`pi install`ed packages), backed by Exa/Brave, BYOK per user. The skills already use the
name `web_search`, so wiring is drop-in.
