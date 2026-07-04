import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import type { Firestore } from 'firebase-admin/firestore';
import { verifyIdToken } from './firebase.js';
import { SecretsStore, type UserCreds } from './secrets-store.js';
import { buildUserContext } from './user-context.js';
import { listAvailableModels } from './session-builder.js';
import type { SessionPool } from './pool.js';

export interface ServerDeps {
  db: Firestore;
  pool: SessionPool;
  /** Injectable for tests. Default: real Firebase ID-token verification. */
  verifyToken?: (idToken: string) => Promise<string>;
  corsOrigin?: string | string[] | boolean;
}

export async function createServer(deps: ServerDeps): Promise<FastifyInstance> {
  const verifyToken = deps.verifyToken ?? verifyIdToken;
  const app = Fastify({ logger: false, bodyLimit: 1_000_000 });

  await app.register(cors, {
    origin: deps.corsOrigin ?? true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type'],
  });

  // Resolve the uid from the Authorization: Bearer <Firebase ID token> header.
  // The SSE stream is consumed via fetch() on the client (not native EventSource),
  // so it can carry this header like every other route. Returns null after sending 401.
  async function auth(req: FastifyRequest, reply: FastifyReply): Promise<string | null> {
    const h = (req.headers['authorization'] as string) || '';
    const m = /^Bearer (.+)$/.exec(h);
    if (!m) {
      reply.code(401).send({ error: 'missing bearer token' });
      return null;
    }
    try {
      return await verifyToken(m[1]);
    } catch {
      reply.code(401).send({ error: 'invalid token' });
      return null;
    }
  }

  app.get('/health', async () => ({ ok: true, warmSessions: deps.pool.size }));

  // Onboard / rotate BYOK creds (encrypted at rest, never client-readable after).
  app.post('/secrets', async (req, reply) => {
    const uid = await auth(req, reply);
    if (!uid) return;
    const creds = (req.body || {}) as UserCreds;
    if (!creds.growwToken) {
      reply.code(400).send({ error: 'growwToken required' });
      return;
    }
    await new SecretsStore(deps.db, uid).put(creds);
    reply.send({ ok: true });
  });

  // Models this user can pick (auth-filtered by which keys they onboarded).
  app.get('/models', async (req, reply) => {
    const uid = await auth(req, reply);
    if (!uid) return;
    try {
      const u = await buildUserContext(deps.db, uid);
      reply.send({ models: listAvailableModels(u) });
    } catch (e: any) {
      reply.code(400).send({ error: e.message });
    }
  });

  // Create a conversation; returns its id.
  app.post('/conversations', async (req, reply) => {
    const uid = await auth(req, reply);
    if (!uid) return;
    const body = (req.body || {}) as { title?: string; model?: { provider: string; id: string } };
    const ref = deps.db.collection(`users/${uid}/conversations`).doc();
    const now = new Date().toISOString();
    await ref.set({ title: body.title || 'New chat', model: body.model ?? null, createdAt: now, updatedAt: now });
    reply.send({ cid: ref.id });
  });

  // Send a prompt; the turn's events flow out the SSE stream, completed messages persist.
  app.post('/conversations/:cid/prompt', async (req, reply) => {
    const uid = await auth(req, reply);
    if (!uid) return;
    const { cid } = req.params as { cid: string };
    const { text } = (req.body || {}) as { text?: string };
    if (!text) {
      reply.code(400).send({ error: 'text required' });
      return;
    }
    let entry;
    try {
      entry = await deps.pool.get(uid, cid);
    } catch (e: any) {
      reply.code(400).send({ error: e.message });
      return;
    }
    const streaming = entry.session.isStreaming;
    void entry.session.prompt(text, streaming ? { streamingBehavior: 'followUp' } : undefined).catch((e) => {
      // eslint-disable-next-line no-console
      console.error(`[prompt ${uid}:${cid}] ${e?.message ?? e}`);
    });
    reply.code(202).send({ ok: true });
  });

  app.post('/conversations/:cid/steer', async (req, reply) => {
    const uid = await auth(req, reply);
    if (!uid) return;
    const { cid } = req.params as { cid: string };
    const { text } = (req.body || {}) as { text?: string };
    if (!text) {
      reply.code(400).send({ error: 'text required' });
      return;
    }
    const entry = await deps.pool.get(uid, cid);
    await entry.session.steer(text);
    reply.send({ ok: true });
  });

  app.post('/conversations/:cid/abort', async (req, reply) => {
    const uid = await auth(req, reply);
    if (!uid) return;
    const { cid } = req.params as { cid: string };
    const entry = await deps.pool.get(uid, cid);
    await entry.session.abort();
    reply.send({ ok: true });
  });

  // Switch model mid-conversation; persists the choice on the conversation doc.
  app.post('/conversations/:cid/model', async (req, reply) => {
    const uid = await auth(req, reply);
    if (!uid) return;
    const { cid } = req.params as { cid: string };
    const { provider, id } = (req.body || {}) as { provider?: string; id?: string };
    if (!provider || !id) {
      reply.code(400).send({ error: 'provider and id required' });
      return;
    }
    const entry = await deps.pool.get(uid, cid);
    const model = entry.registry.find(provider, id);
    if (!model) {
      reply.code(400).send({ error: `model ${provider}/${id} not available` });
      return;
    }
    await entry.session.setModel(model);
    await deps.db.doc(`users/${uid}/conversations/${cid}`).set({ model: { provider, id }, updatedAt: new Date().toISOString() }, { merge: true });
    reply.send({ ok: true });
  });

  // SSE stream of AgentSessionEvents for a conversation (consumed via fetch on the client).
  app.get('/conversations/:cid/stream', async (req, reply) => {
    const uid = await auth(req, reply);
    if (!uid) return;
    const { cid } = req.params as { cid: string };
    let entry;
    try {
      entry = await deps.pool.get(uid, cid);
    } catch (e: any) {
      reply.code(400).send({ error: e.message });
      return;
    }
    // hijack() bypasses Fastify's response pipeline, so @fastify/cors never runs on
    // this raw SSE response — set CORS headers manually (reflect the request origin).
    const origin = (req.headers.origin as string) || '*';
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': origin,
      Vary: 'Origin',
    });
    raw.write(': connected\n\n');
    const sink = (evt: unknown) => {
      try {
        raw.write(`data: ${JSON.stringify(evt)}\n\n`);
      } catch {
        /* client gone */
      }
    };
    const remove = deps.pool.addSink(entry, sink);
    const hb = setInterval(() => {
      try {
        raw.write(': hb\n\n');
      } catch {
        /* ignore */
      }
    }, 25000);
    hb.unref?.();
    const cleanup = () => {
      clearInterval(hb);
      remove();
    };
    req.raw.on('close', cleanup);
    req.raw.on('error', cleanup);
  });

  return app;
}
