import { useEffect, useState } from 'react';
import { collection, doc, deleteDoc, getDocs, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../firebase';

export type Row<T> = T & { id: string };

// Realtime collection subscription. `path` is a stable string (e.g. `users/${uid}/monitors`);
// pass null to skip. Optional single-field order.
export function useCollection<T = Record<string, unknown>>(
  path: string | null,
  orderByField?: string,
  dir: 'asc' | 'desc' = 'asc',
): Row<T>[] {
  const [rows, setRows] = useState<Row<T>[]>([]);
  useEffect(() => {
    if (!path) return;
    const base = collection(db, path);
    const q = orderByField ? query(base, orderBy(orderByField, dir)) : base;
    return onSnapshot(
      q,
      (snap) => setRows(snap.docs.map((d) => ({ id: d.id, ...(d.data() as T) }))),
      (e) => console.error('[snapshot]', path, e.message),
    );
  }, [path, orderByField, dir]);
  return rows;
}

export async function deleteMonitorDoc(uid: string, monitorId: string): Promise<void> {
  await deleteDoc(doc(db, `users/${uid}/monitors/${monitorId}`));
}

export async function fetchTheses(uid: string): Promise<Array<Record<string, unknown> & { id: string }>> {
  const snap = await getDocs(collection(db, `users/${uid}/theses`));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
