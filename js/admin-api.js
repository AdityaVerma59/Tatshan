// Everything the admin dashboard reads or deletes. Works only on the Firebase backend, and only
// for a signed-in account that has a document at admins/<uid> (see README).
import { SETTINGS } from './config.js';
import { now, dayKey, dayStartMs, daysBetween } from './util.js';

export function createAdminApi({ F, db, auth }) {
  const uid = () => auth.currentUser.uid;
  const ms = (ts) => (ts && ts.toMillis ? ts.toMillis() : null);
  const count = async (q) => (await F.getCountFromServer(q)).data().count;
  const emptyDay = (day) => ({ day, anon: 0, registered: 0, transfers: 0, files: 0, bytes: 0, toShops: 0, toPeople: 0, types: {} });

  // ---- am I an admin? ----
  // The rules decide (an email list in firestore.rules). A harmless admin-only read tells us the answer.
  async function isAdmin() {
    if (auth.currentUser.isAnonymous) return false;
    try { await F.getDocs(F.query(F.collection(db, 'daily'), F.limit(1))); return true; } catch { return false; }
  }

  // ---- one day of stats, computed from the raw visit + event documents ----
  async function computeDay(day) {
    const visits = F.collection(db, 'visits');
    const [anon, registered, evSnap] = await Promise.all([
      count(F.query(visits, F.where('day', '==', day), F.where('kind', '==', 'anon'))),
      count(F.query(visits, F.where('day', '==', day), F.where('kind', '==', 'registered'))),
      F.getDocs(F.query(F.collection(db, 'events'), F.where('day', '==', day))),
    ]);
    const d = emptyDay(day);
    d.anon = anon; d.registered = registered;
    evSnap.forEach((doc) => {
      const e = doc.data();
      d.transfers += 1; d.files += e.files || 0; d.bytes += e.bytes || 0;
      if (e.dest === 'shop') d.toShops += 1; else d.toPeople += 1;
      for (const [k, n] of Object.entries(e.types || {})) d.types[k] = (d.types[k] || 0) + n;
    });
    return d;
  }

  // Finished days are computed once, saved as a single "daily" document, and never re-read from
  // the raw events again. Only today is computed live. This keeps the dashboard cheap on the free plan.
  async function loadRange(from, to, onProgress) {
    const days = daysBetween(from, to);
    const today = dayKey();
    const saved = new Map();
    const snap = await F.getDocs(F.query(F.collection(db, 'daily'), F.where('day', '>=', from), F.where('day', '<=', to)));
    snap.forEach((d) => saved.set(d.data().day, d.data()));

    const out = [];
    let done = 0;
    for (const day of days) {
      let row = saved.get(day);
      if (!row) {
        row = await computeDay(day);
        if (day < today) { try { await F.setDoc(F.doc(db, 'daily', day), { ...row, rolledAt: F.serverTimestamp() }); } catch { /* optional */ } }
      }
      out.push({ ...emptyDay(day), ...row });
      onProgress && onProgress(++done / days.length);
    }
    return out;
  }

  // ---- what is sitting in storage right now ----
  async function loadStored() {
    const snap = await F.getDocs(F.query(F.collectionGroup(db, 'transfers'), F.orderBy('createdAt', 'asc'), F.limit(1000)));
    return snap.docs.map((d) => {
      const v = d.data();
      const files = v.files || [];
      return {
        id: d.id, boxId: d.ref.parent.parent.id, senderName: v.senderName || '?', createdAt: ms(v.createdAt) || now(),
        files, bytes: files.reduce((n, f) => n + (f.size || 0), 0), pieces: files.reduce((n, f) => n + (f.chunks || 0), 0),
      };
    });
  }

  async function removeStored(item) {
    const ids = item.files.flatMap((f) => Array.from({ length: f.chunks || 0 }, (_, k) => `${f.ref}_${k}`));
    for (let i = 0; i < ids.length; i += 400) {
      const b = F.writeBatch(db);
      ids.slice(i, i + 400).forEach((id) => b.delete(F.doc(db, 'boxes', item.boxId, 'parts', id)));
      await b.commit();
    }
    await F.deleteDoc(F.doc(db, 'boxes', item.boxId, 'transfers', item.id));
  }

  // ---- pieces with no message: uploads that were abandoned half-way ----
  const staleCutoff = (hours) => F.Timestamp.fromMillis(now() - hours * 3600 * 1000);
  const countStalePieces = (hours = SETTINGS.STALE_HOURS) =>
    count(F.query(F.collectionGroup(db, 'parts'), F.where('createdAt', '<', staleCutoff(hours))));

  // Looks at the oldest pieces (a small batch, because each one is up to 700 KB to download),
  // and deletes those whose message no longer exists.
  async function purgeOrphans(hours = SETTINGS.STALE_HOURS, batch = 25) {
    const snap = await F.getDocs(F.query(F.collectionGroup(db, 'parts'), F.where('createdAt', '<', staleCutoff(hours)), F.orderBy('createdAt', 'asc'), F.limit(batch)));
    let checked = 0; let removed = 0;
    const known = new Map();
    for (const d of snap.docs) {
      checked += 1;
      const boxId = d.ref.parent.parent.id;
      const tid = d.data().tid;
      const key = `${boxId}/${tid}`;
      if (!known.has(key)) known.set(key, (await F.getDoc(F.doc(db, 'boxes', boxId, 'transfers', tid))).exists());
      if (!known.get(key)) { await F.deleteDoc(d.ref); removed += 1; }
    }
    return { checked, removed, more: snap.size === batch };
  }

  const countShops = () => count(F.query(F.collection(db, 'boxes'), F.where('kind', '==', 'shop')));

  return { isAdmin, loadRange, loadStored, removeStored, countStalePieces, purgeOrphans, countShops, dayStartMs };
}
