import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  type User,
} from 'firebase/auth';

// Public Firebase web client config (safe to embed — protected by Auth + Firestore
// rules, not a secret). Fetched from the Firebase Management API for overwatch-3a83a.
const firebaseConfig = {
  apiKey: 'AIzaSyBYa2rHYL8FB_QNZMmN4lstI61jeNIgEiE',
  authDomain: 'overwatch-3a83a.firebaseapp.com',
  projectId: 'overwatch-3a83a',
  storageBucket: 'overwatch-3a83a.firebasestorage.app',
  messagingSenderId: '856687141434',
  appId: '1:856687141434:web:cf9d69238d853414718b03',
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

export function onAuthChange(cb: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, cb);
}

export function signInGoogle(): Promise<unknown> {
  return signInWithPopup(auth, new GoogleAuthProvider());
}

export function signInEmail(email: string, password: string): Promise<unknown> {
  return signInWithEmailAndPassword(auth, email, password);
}

export function registerEmail(email: string, password: string): Promise<unknown> {
  return createUserWithEmailAndPassword(auth, email, password);
}

export function signOutUser(): Promise<void> {
  return signOut(auth);
}

/** Current user's Firebase ID token (auto-refreshed by the SDK), or null if signed out. */
export async function idToken(): Promise<string | null> {
  const u = auth.currentUser;
  return u ? u.getIdToken() : null;
}
