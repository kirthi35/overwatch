# Running the Overwatch web app (dev)

Three processes: **server** (agent API), **worker** (monitor poller), **web** (React SPA).
Backend needs two secrets in the environment.

## 0. One-time setup

```bash
npm install

# Build the TS packages (web uses Vite, no prebuild needed for dev)
npm run build -w @overwatch/core
npm run build -w @overwatch/server
npm run build -w @overwatch/worker

# Generate a STABLE secrets master key ONCE and keep it (it decrypts stored creds —
# if it changes, previously-saved user keys can't be decrypted).
npm run gen-secret -w @overwatch/server   # prints a base64 key; save it
```

Set these env vars for the server + worker (e.g. in your shell profile or a process manager):

```bash
export OVERWATCH_FIREBASE_KEY=/absolute/path/to/overwatch-3a83a-firebase-adminsdk-*.json
export OVERWATCH_SECRET_KEY=<the base64 key from gen-secret>   # STABLE
# optional: PORT=8787  OVERWATCH_CORS_ORIGIN=http://localhost:5173  OVERWATCH_SESSIONS_ROOT=~/.overwatch-server/sessions
```

> The service-account JSON and OVERWATCH_SECRET_KEY are secrets — never commit them.
> The Firebase **web** config in `packages/web/src/firebase.ts` is public and fine to commit.

## 1. Start the backend

```bash
npm start -w @overwatch/server   # http://localhost:8787  (GET /health to check)
npm start -w @overwatch/worker   # monitor poller (ticks during NSE hours)
```

## 2. Start the web app

```bash
npm run dev -w @overwatch/web     # http://localhost:5173
# (set VITE_API_URL if the server isn't on http://localhost:8787)
```

## 3. Use it

1. Open http://localhost:5173 → sign in (Google or email/password).
2. Onboard your keys: **Groww read-only token** + **Anthropic API key** (must have credit).
3. Chat. Ask “Is the Groww feed live?” or “Analyse Paras Defence”, or arm a monitor.

## Notes

- **LLM credit**: the agent needs a funded Anthropic key (or an Ollama Cloud key for GLM).
  A zero-balance key returns an error in-chat.
- **Firestore rules** are deployed via `npm run deploy-rules -w @overwatch/server`.
- **Skills viewer** data: `npm run seed-skills -w @overwatch/server` (already run).
- Built so far: chat (streaming), monitors fire → alerts → surfaced in the originating
  conversation. Monitors/Alerts/Settings tabs are the next slice (Phase 6 remainder).
