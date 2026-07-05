# Overwatch — Deployment Guide

How to deploy the Overwatch multi-tenant web app from scratch, and how to ship updates.
Pairs with [`knowledgebase.md`](./knowledgebase.md) Part B (architecture) and
[`RUN.md`](./RUN.md) (local dev).

**Two deployables:**
1. **Backend** — `@overwatch/server` (Fastify API, :8787) + `@overwatch/worker` (monitor
   poller). Runs on a long-lived Linux box behind an **Apache** HTTPS reverse proxy.
2. **Frontend** — `@overwatch/web` (Vite React SPA). A static bundle deployed to **Netlify**.

```
Browser ──HTTPS──▶ Netlify (over-watch.in)          static SPA
   │  Firebase Auth (ID token on every backend call)
   └──HTTPS──▶ api.over-watch.in ──Apache──▶ 127.0.0.1:8787  (server, pm2)
                                                    │
Firestore ◀── server + worker (Admin SDK) ──────────┘  worker (pm2) polls Groww per-user
```

---

## Current production values (this deployment)

| Thing | Value |
|---|---|
| Backend box | `151.185.47.45` (Ubuntu 24.04, root) |
| Code dir on box | `/opt/overwatch` |
| API domain | `https://api.over-watch.in` → box |
| Frontend | `https://over-watch.in` + `www` → Netlify |
| Firebase project | `overwatch-3a83a` |
| SSH key (local) | `~/.ssh/overwatch_ed25519` |

Replace these with your own when deploying a fresh environment.

---

## Prerequisites

- A Linux box (Ubuntu 22.04/24.04), root or sudo, a public IP, ports 22/80/443 open.
- A domain you control. Plan the split: **frontend = apex** (`over-watch.in` + `www`,
  on Netlify), **backend = subdomain** (`api.over-watch.in`, on the box).
- A **Firebase project** with **Authentication** (Google/email) and **Firestore** enabled.
- A **Firebase Admin service-account JSON** (Project settings → Service accounts →
  Generate new private key). This is full-project admin — treat it as a secret.
- The app's secrets: a Groww **read-only** token, an LLM key (Anthropic and/or an
  Ollama-Cloud/GLM key), and a random 32-byte master key for encrypting per-user secrets.
- A Netlify account.
- Node 22 + git locally (to build the frontend and push code).

---

## Part 1 — Backend on the box

### 1.1 DNS

Add an **A record** so the API subdomain resolves to the box, and confirm it before
requesting a TLS cert (Let's Encrypt validates over HTTP):

| Host | Type | Value |
|---|---|---|
| `api.over-watch.in` | A | `151.185.47.45` |

```bash
dig +short A api.over-watch.in @8.8.8.8   # must print the box IP
```

### 1.2 SSH access

Use a dedicated key. Add its public key to the box's `~/.ssh/authorized_keys`, then:

```bash
ssh -i ~/.ssh/overwatch_ed25519 root@151.185.47.45 'echo connected'
```

### 1.3 Install system dependencies

> **Node 22 is required** — not 20. The bundled `undici@8` (under `pi-coding-agent`) calls
> `worker_threads.markAsUncloneable`, added in Node 22.10. On Node 20 the server/worker
> crash with `TypeError: webidl.util.markAsUncloneable is not a function`.

```bash
ssh root@151.185.47.45 'bash -s' <<'EOF'
set -e
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq apache2 certbot python3-certbot-apache rsync ca-certificates curl gnupg
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y -qq nodejs
npm install -g pm2
node -v; pm2 -v; apache2 -v | head -1; certbot --version
EOF
```

### 1.4 Get the code onto the box

Either `git clone` the repo into `/opt/overwatch`, or (no GitHub auth needed) push the
working tree from your machine — excluding node_modules, dist, .git, and .env:

```bash
cd /path/to/overwatch
tar czf - --exclude='*/node_modules' --exclude='*/dist' --exclude='./.git' \
          --exclude='./.env' --exclude='.DS_Store' . \
  | ssh root@151.185.47.45 'mkdir -p /opt/overwatch && tar xzf - -C /opt/overwatch'
```

### 1.5 Provision secrets on the box

The server reads `OVERWATCH_FIREBASE_KEY` as an **absolute path** to the admin JSON.

```bash
# admin service-account JSON -> box, locked down
ssh root@151.185.47.45 'mkdir -p /opt/overwatch/secrets && chmod 700 /opt/overwatch/secrets'
scp /path/to/serviceAccount.json root@151.185.47.45:/opt/overwatch/secrets/serviceAccount.json
ssh root@151.185.47.45 'chmod 600 /opt/overwatch/secrets/serviceAccount.json'
```

Create `/opt/overwatch/.env` on the box (chmod 600). Never commit it.

```bash
# /opt/overwatch/.env
OVERWATCH_FIREBASE_KEY=/opt/overwatch/secrets/serviceAccount.json
OVERWATCH_SECRET_KEY=<random 32+ byte hex string>        # master key for per-user secrets
OVERWATCH_CORS_ORIGIN=https://over-watch.in,https://www.over-watch.in   # comma-separated allowlist
PORT=8787

# --- Dev single-operator mode (see WARNING below) ---
OVERWATCH_DEV_CREDS_FROM_ENV=1
groww_api_key=<groww read-only token>
ANTHROPIC_API_KEY=<anthropic key, optional>
OLLAMA_API_KEY=<ollama-cloud / GLM key, optional>
OVERWATCH_LLM=glm                                        # 'glm' or 'claude'
overwatch_glm_model=<glm model id>
```

```bash
ssh root@151.185.47.45 'chmod 600 /opt/overwatch/.env'
```

> ⚠ **`OVERWATCH_DEV_CREDS_FROM_ENV=1` = single-operator mode.** When a logged-in user has
> no stored credentials, the server falls back to these `.env` creds — so **every user
> shares this one Groww token + LLM key**. Fine for a personal/solo deployment. For true
> multi-tenant isolation, ship the BYOK key-entry UI (parked in v1) and set this to `0`.

### 1.6 Install deps + build backends

```bash
ssh root@151.185.47.45 'cd /opt/overwatch && npm install --no-audit --no-fund && npm run build:backends'
```

### 1.7 Run under pm2 (with boot persistence)

Create `/opt/overwatch/ecosystem.config.cjs`:

```js
module.exports = {
  apps: [
    { name: 'overwatch-server', script: 'packages/server/dist/main.js', cwd: '/opt/overwatch',
      env: { PORT: '8787', NODE_ENV: 'production' }, autorestart: true, max_restarts: 15, max_memory_restart: '900M' },
    { name: 'overwatch-worker', script: 'packages/worker/dist/main.js', cwd: '/opt/overwatch',
      env: { NODE_ENV: 'production' }, autorestart: true, max_restarts: 15, max_memory_restart: '500M' },
  ],
};
```

```bash
ssh root@151.185.47.45 'bash -s' <<'EOF'
cd /opt/overwatch
pm2 start ecosystem.config.cjs
sleep 4
pm2 ls
curl -sS http://127.0.0.1:8787/health          # -> {"ok":true,"warmSessions":0}
pm2 save
pm2 startup systemd -u root --hp /root          # enables boot-time resurrection
EOF
```

### 1.8 Firewall (seal the app port)

Only 22/80/443 are public; **8787 stays internal** (Apache reaches it via localhost).
Allow SSH *before* enabling ufw so you don't lock yourself out.

```bash
ssh root@151.185.47.45 'bash -s' <<'EOF'
ufw allow OpenSSH; ufw allow 80/tcp; ufw allow 443/tcp
ufw --force enable
ufw status verbose
EOF
```

### 1.9 Apache reverse proxy (SSE-safe)

The chat uses Server-Sent Events. Apache buffers by default, which breaks token streaming,
so the vhost disables buffering and flushes each chunk.

```bash
ssh root@151.185.47.45 'bash -s' <<'EOF'
a2enmod proxy proxy_http headers ssl rewrite
cat > /etc/apache2/sites-available/overwatch-api.conf <<'VHOST'
<VirtualHost *:80>
    ServerName api.over-watch.in
    ProxyPreserveHost On
    ProxyRequests Off
    ProxyTimeout 3600
    SetEnvIfNoCase Content-Type text/event-stream no-gzip=1 dont-vary=1
    ProxyPass        "/" "http://127.0.0.1:8787/" flushpackets=on
    ProxyPassReverse "/" "http://127.0.0.1:8787/"
    ErrorLog  ${APACHE_LOG_DIR}/overwatch-api-error.log
    CustomLog ${APACHE_LOG_DIR}/overwatch-api-access.log combined
</VirtualHost>
VHOST
a2ensite overwatch-api
apache2ctl configtest
systemctl reload apache2
# smoke test through the proxy (bypasses DNS via Host header):
curl -sS -H 'Host: api.over-watch.in' http://127.0.0.1/health
EOF
```

### 1.10 TLS (Let's Encrypt)

Requires §1.1 DNS to already resolve to the box.

```bash
ssh root@151.185.47.45 \
  'certbot --apache -d api.over-watch.in --non-interactive --agree-tos -m you@example.com --redirect'
```

This adds the `:443` vhost, sets an HTTP→HTTPS redirect, and schedules auto-renewal.

### 1.11 Verify the backend end-to-end

```bash
curl -s https://api.over-watch.in/health                       # {"ok":true,...}
curl -s -o /dev/null -w "%{http_code}\n" http://api.over-watch.in/health   # 301 (redirect)
```

CORS preflight from the frontend origin should be allowed:

```bash
curl -s -X OPTIONS https://api.over-watch.in/conversations \
  -H 'Origin: https://over-watch.in' -H 'Access-Control-Request-Method: POST' \
  -D - -o /dev/null | grep -i access-control-allow-origin
# -> access-control-allow-origin: https://over-watch.in
```

To test an authenticated route (`/models`) you need a real Firebase ID token; mint one on
the box with the Admin SDK (create custom token → exchange via the Identity Toolkit REST
API with the web API key → call `/models` with `Authorization: Bearer <idToken>`).

---

## Part 2 — Frontend on Netlify

The web package is standalone (no workspace deps). The Firebase **client** config in
`packages/web/src/firebase.ts` is public and safe to commit. The only build-time input is
`VITE_API_URL`, which is **inlined at build time** — it must be the HTTPS API domain, or the
bundle falls back to `http://localhost:8787` (the #1 cause of the "No LLM key found" error).

### Option A — drag-and-drop (build locally, upload the folder)

```bash
cd /path/to/overwatch
VITE_API_URL=https://api.over-watch.in npm run build -w @overwatch/web
# verify the URL is baked and there is no localhost fallback:
grep -o 'https://api.over-watch.in' packages/web/dist/assets/*.js | head -1
grep -c 'localhost:8787' packages/web/dist/assets/*.js        # -> 0
```

Drag `packages/web/dist` onto the Netlify drop zone. The `public/_redirects`
(`/* /index.html 200`) is copied into `dist` and gives SPA routing (no 404 on refresh).

### Option B — git-connected build

`netlify.toml` (committed) already sets base `packages/web`, publish `dist`, Node 22, the
SPA redirect, and bakes `VITE_API_URL`. Connect the repo in Netlify; override
`VITE_API_URL` in the Netlify UI if the API domain differs.

### 2.1 Frontend DNS + custom domain

In Netlify, add the custom domain `over-watch.in` (and `www`); Netlify shows the exact DNS
records to add at your registrar (typically apex `A → 75.2.60.5`, `www CNAME →
<site>.netlify.app`) and provisions its own TLS cert.

### 2.2 Firebase authorized domains (required)

Firebase console → **Authentication → Settings → Authorized domains** → add
`over-watch.in`, `www.over-watch.in`, and your `*.netlify.app` URL. Login is blocked from
any origin not listed here.

---

## Shipping updates

### Backend update

```bash
cd /path/to/overwatch
npm run build:backends                     # build core + server + worker locally
tar czf - packages/core/dist packages/server/dist packages/worker/dist \
  | ssh root@151.185.47.45 'tar xzf - -C /opt/overwatch'
ssh root@151.185.47.45 'pm2 restart overwatch-server overwatch-worker --update-env && sleep 3 && curl -s http://127.0.0.1:8787/health'
```

If dependencies changed (`package.json`), re-transfer the source and run
`npm install && npm run build:backends` on the box before restarting.

> After a Node major upgrade on the box, run `npm rebuild` in `/opt/overwatch` and
> `pm2 update` (refreshes the pm2 daemon under the new Node) before restarting apps.

### Frontend update

Rebuild with `VITE_API_URL` (Option A) and re-drag `packages/web/dist` to Netlify, or push
to the git-connected branch. **Hard-refresh (Cmd/Ctrl+Shift+R)** to clear the cached bundle.

---

## Operations

```bash
ssh root@151.185.47.45 'pm2 ls'                                  # process status
ssh root@151.185.47.45 'pm2 logs overwatch-server --lines 50'    # server logs
ssh root@151.185.47.45 'pm2 logs overwatch-worker --lines 50'    # worker logs
ssh root@151.185.47.45 'pm2 flush'                               # clear old logs
ssh root@151.185.47.45 'certbot renew --dry-run'                 # test cert renewal
ssh root@151.185.47.45 'systemctl reload apache2'                # after vhost edits
```

Secrets live only in `/opt/overwatch/.env` and `/opt/overwatch/secrets/serviceAccount.json`
(both `chmod 600`). They are never committed and never logged.

---

## Troubleshooting

| Symptom | Cause & fix |
|---|---|
| `TypeError: webidl.util.markAsUncloneable is not a function` (pm2 crash) | Box Node < 22. Install Node 22, `npm rebuild`, `pm2 update`, restart. |
| Frontend shows **"No LLM key found. Set ANTHROPIC_API_KEY…"** | Misleading — it fires on **any** `/models` failure. Almost always a stale bundle calling `localhost` (built without `VITE_API_URL`). Rebuild with `VITE_API_URL=https://api.over-watch.in`, redeploy, hard-refresh. Confirm the box is fine: `curl https://api.over-watch.in/health`. |
| SSE stream stalls / no token-by-token output | Apache buffering. Ensure the vhost has `flushpackets=on` + the `no-gzip` line for `text/event-stream`, then `systemctl reload apache2`. |
| CORS error in the browser | `OVERWATCH_CORS_ORIGIN` must list the exact frontend origin(s), comma-separated. Edit `/opt/overwatch/.env`, `pm2 restart overwatch-server --update-env`. |
| certbot fails | DNS for the API subdomain isn't pointing at the box yet, or port 80 is blocked. Fix DNS (§1.1) / ufw (§1.8), retry. |
| Login fails on the deployed site | Add the site's domain to Firebase → Auth → Authorized domains (§2.2). |
| `/health` ok but `/models` 401 | Expected without a valid Firebase ID token. The frontend attaches it automatically after login. |
| Server won't start, `Firebase service account not configured` | `OVERWATCH_FIREBASE_KEY` missing/wrong path, or the JSON isn't readable. Check the path + `chmod 600`. |
