import { readFileSync } from 'fs';
import { initializeApp, cert, getApps, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getAuth, type Auth } from 'firebase-admin/auth';

// Firebase Admin SDK init for the server + worker.
//
// The service-account key is a full-project admin credential and MUST NOT live in
// the repo. It is referenced by ABSOLUTE PATH via env:
//   OVERWATCH_FIREBASE_KEY=/abs/path/to/serviceAccount.json
// (or the standard GOOGLE_APPLICATION_CREDENTIALS). Never logged, never committed.

let app: App | undefined;

function keyPath(): string {
  const p = process.env.OVERWATCH_FIREBASE_KEY || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!p) {
    throw new Error(
      'Firebase service account not configured. Set OVERWATCH_FIREBASE_KEY to the absolute ' +
        'path of the admin service-account JSON (or GOOGLE_APPLICATION_CREDENTIALS).',
    );
  }
  return p;
}

export function initFirebase(): App {
  if (app) return app;
  const existing = getApps();
  if (existing.length) {
    app = existing[0];
    return app;
  }
  const serviceAccount = JSON.parse(readFileSync(keyPath(), 'utf8'));
  app = initializeApp({ credential: cert(serviceAccount) });
  return app;
}

let db: Firestore | undefined;
export function getDb(): Firestore {
  if (!db) {
    db = getFirestore(initFirebase());
    // Ignore undefined object properties so optional fields (e.g. an unset
    // monitor gate) don't have to be stripped before every write.
    db.settings({ ignoreUndefinedProperties: true });
  }
  return db;
}

let auth: Auth | undefined;
export function getAuthAdmin(): Auth {
  if (!auth) auth = getAuth(initFirebase());
  return auth;
}

/** Verify a Firebase ID token from a client; returns the uid. Throws if invalid. */
export async function verifyIdToken(idToken: string): Promise<string> {
  const decoded = await getAuthAdmin().verifyIdToken(idToken);
  return decoded.uid;
}
