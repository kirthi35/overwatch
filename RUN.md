# Running the Overwatch web app (dev)

Three processes: **server** (agent API), **worker** (monitor poller), **web** (React SPA).

## Dev mode (single operator) — reads `.env`, no manual setup

The repo `.env` already holds everything (Groww token, Anthropic key, `OLLAMA_API_KEY`,
`OVERWATCH_LLM=glm`, plus the appended `OVERWATCH_FIREBASE_KEY`, `OVERWATCH_SECRET_KEY`,
and `OVERWATCH_DEV_CREDS_FROM_ENV=1`). The server + worker load `.env` on startup — **no
`export`s needed** — and with the dev flag set, a logged-in user's creds come straight from
`.env`, so **no browser onboarding** either.

```bash
npm install
npm run build -w @overwatch/core
npm run build -w @overwatch/server
npm run build -w @overwatch/worker

# three terminals (no env exports needed):
npm start -w @overwatch/server    # http://localhost:8787  (GET /health)
npm start -w @overwatch/worker    # monitor poller (NSE hours)
npm run dev   -w @overwatch/web    # http://localhost:5173
```

Then open http://localhost:5173 → **sign in** (Google / email) → you land straight in
**Chat** (GLM-5.2, since `OVERWATCH_LLM=glm`). Ask “Is the Groww feed live?” or
“Analyse Paras Defence”, or arm a monitor.

> `.env` holds real secrets and is gitignored — never commit it. `OVERWATCH_SECRET_KEY`
> must stay STABLE (it decrypts any *onboarded* creds; the dev-fallback path doesn't need it).
> The Firebase **web** config in `packages/web/src/firebase.ts` is public and fine to commit.

## Production (multi-tenant BYOK)

Unset `OVERWATCH_DEV_CREDS_FROM_ENV`. Each user signs in and onboards their **own** Groww
token + LLM key via the UI form → stored encrypted per-user. Provide
`OVERWATCH_FIREBASE_KEY` + a stable `OVERWATCH_SECRET_KEY` via a real secret store, not `.env`.

## Notes

- **LLM credit**: the agent needs a funded Anthropic key (or an Ollama Cloud key for GLM).
  A zero-balance key returns an error in-chat.
- **Firestore rules** are deployed via `npm run deploy-rules -w @overwatch/server`.
- **Skills viewer** data: `npm run seed-skills -w @overwatch/server` (already run).
- Built so far: chat (streaming), monitors fire → alerts → surfaced in the originating
  conversation. Monitors/Alerts/Settings tabs are the next slice (Phase 6 remainder).
