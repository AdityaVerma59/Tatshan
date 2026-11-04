// Firebase backend: Anonymous Auth + Firestore only (works on the free Spark plan).
// Files are cut into ~700 KB pieces and stored as small Firestore documents ("parts"),
// because Cloud Storage requires a paid plan. The SDK loads from Google's CDN as ES modules.
import { FIREBASE_CONFIG, FIREBASE_VERSION, SETTINGS } from './config.js';
import { now, pool, withType } from './util.js';

const CDN = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
const EXPIRY_MS = SETTINGS.EXPIRY_HOURS * 3600 * 1000;
const CHUNK = 700 * 1000; // bytes per Firestore document (limit is 1 MiB)

export async function createFirebaseBackend() {
  const [{ initializeApp }, A, F] = await Promise.all([
    import(`${CDN}/firebase-app.js`),
    import(`${CDN}/firebase-auth.js`),
    import(`${CDN}/firebase-firestore.js`),
  ]);

  const app = initializeApp(FIREBASE_CONFIG);
  const auth = A.getAuth(app);
  const db = F.getFirestore(app);

  await auth.authStateReady();
  if (!auth.currentUser) await A.signInAnonymously(auth);

  const ms = (ts) => (ts && ts.toMillis ? ts.toMillis() : null);
  const boxDoc = (id) => F.doc(db, 'boxes', id);
  const tDoc = (boxId, tid) => F.doc(db, 'boxes', boxId, 'transfers', tid);
  const partDoc = (boxId, id) => F.doc(db, 'boxes', boxId, 'parts', id);
  const partIds = (files) => files.flatMap((f) => Array.from({ length: f.chunks || 0 }, (_, k) => `${f.ref}_${k}`));

  // Owner-side: delete every piece of a transfer, then the transfer record itself.
  async function removeTransfer(boxId, transfer) {
    const ids = partIds(transfer.files || []);
    for (let i = 0; i < ids.length; i += 400) {
      const batch = F.writeBatch(db);
      ids.slice(i, i + 400).forEach((id) => batch.delete(partDoc(boxId, id)));
      await batch.commit();
    }
    await F.deleteDoc(tDoc(boxId, transfer.id));
  }

  return {
    mode: 'firebase',
    uid: async () => auth.currentUser.uid,

    async getBox(id) {
      const snap = await F.getDoc(boxDoc(id));
      if (!snap.exists()) return null;
      const d = snap.data();
      const expireAt = ms(d.expireAt);
      if (d.kind === 'temp' && expireAt && expireAt < now()) return null;
      return { id, kind: d.kind, name: d.name, ownerUid: d.ownerUid, expireAt };
    },

    async createBox({ id, kind, name }) {
      const data = { ownerUid: auth.currentUser.uid, kind, name, createdAt: F.serverTimestamp() };
      if (kind === 'temp') data.expireAt = F.Timestamp.fromMillis(now() + EXPIRY_MS);
      try {
        await F.setDoc(boxDoc(id), data);
      } catch (e) {
        if (e.code === 'permission-denied') { const err = new Error('exists'); err.code = 'exists'; throw err; }
        throw e;
      }
      return { id, kind, name, ownerUid: auth.currentUser.uid, expireAt: data.expireAt ? data.expireAt.toMillis() : null };
    },

    async closeBox(id) {
      try { await F.deleteDoc(boxDoc(id)); } catch { /* already gone */ }
    },

    // Live list of everything waiting in a box, newest first.
    watchTransfers(boxId, onList, onError) {
      const q = F.query(F.collection(db, 'boxes', boxId, 'transfers'), F.orderBy('createdAt', 'desc'));
      return F.onSnapshot(q, (snap) => {
        const list = [];
        snap.forEach((d) => {
          const v = d.data();
          const createdAt = ms(v.createdAt) ?? now();
          if (createdAt < now() - EXPIRY_MS) { removeTransfer(boxId, { id: d.id, files: v.files || [] }).catch(() => {}); return; } // expired: tidy up
          list.push({ id: d.id, senderName: v.senderName, createdAt, files: v.files || [] });
        });
        onList(list);
      }, (err) => onError && onError(err));
    },

    // Sender side: fires once when the receiver has downloaded (and so deleted) the message.
    watchDelivery(boxId, tid, onDelivered) {
      let seen = false; let fired = false;
      const fire = () => { if (!fired) { fired = true; onDelivered(); } };
      return F.onSnapshot(tDoc(boxId, tid), (snap) => {
        if (snap.exists()) seen = true; else if (seen) fire();
      }, (err) => { if (err.code === 'permission-denied') fire(); });
    },

    async send({ boxId, senderName, files, onProgress }) {
      const tid = F.doc(F.collection(db, 'boxes', boxId, 'transfers')).id;
      const expireAt = F.Timestamp.fromMillis(now() + EXPIRY_MS);
      const total = files.reduce((n, f) => n + f.size, 0) || 1;
      let sent = 0;
      const written = [];

      const meta = files.map((f, i) => ({
        name: f.name.slice(0, 200), size: f.size, type: (f.type || '').slice(0, 100),
        box: boxId, ref: `${tid}_${i}`, chunks: Math.max(1, Math.ceil(f.size / CHUNK)),
      }));
      const jobs = meta.flatMap((m, i) => Array.from({ length: m.chunks }, (_, k) => ({ file: files[i], ref: m.ref, k })));

      try {
        await pool(jobs, 4, async ({ file, ref, k }) => {
          const bytes = new Uint8Array(await file.slice(k * CHUNK, (k + 1) * CHUNK).arrayBuffer());
          const id = `${ref}_${k}`;
          await F.setDoc(partDoc(boxId, id), {
            tid, senderUid: auth.currentUser.uid, data: F.Bytes.fromUint8Array(bytes),
            createdAt: F.serverTimestamp(), expireAt,
          });
          written.push(id);
          sent += bytes.length;
          onProgress && onProgress(Math.min(1, sent / total));
        });
        await F.setDoc(tDoc(boxId, tid), {
          senderUid: auth.currentUser.uid, senderName, files: meta,
          createdAt: F.serverTimestamp(), expireAt,
        });
      } catch (e) {
        // Don't leave half-uploaded pieces behind.
        await Promise.all(written.map((id) => F.deleteDoc(partDoc(boxId, id)).catch(() => {})));
        throw e;
      }
      return tid;
    },

    async fetchFile(file) {
      const ids = Array.from({ length: file.chunks }, (_, k) => `${file.ref}_${k}`);
      const pieces = new Array(ids.length);
      await pool(ids, 4, async (id, i) => {
        const snap = await F.getDoc(partDoc(file.box, id));
        if (!snap.exists()) throw new Error('File is no longer available');
        pieces[i] = snap.data().data.toUint8Array();
      });
      return withType(new Blob(pieces), file);
    },

    // Called once the receiver has the files safely: wipe them from the cloud.
    removeTransfer,
  };
}
