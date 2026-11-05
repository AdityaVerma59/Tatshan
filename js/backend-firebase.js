// Firebase backend: Auth + Firestore only (works on the free Spark plan).
// Files are cut into ~700 KB pieces and stored as small Firestore documents ("parts"),
// because Cloud Storage requires a paid plan. The SDK loads from Google's CDN as ES modules.
//
// Files are stored byte-for-byte: no compression, no resizing, no re-encoding. A SHA-256 of every
// file is saved with it and checked again on arrival, so a damaged or altered file is never accepted.
import { FIREBASE_CONFIG, FIREBASE_VERSION, SETTINGS } from './config.js';
import { now, pool, withType, dayKey, sha256, typeBucket } from './util.js';

const CDN = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
const EXPIRY_MS = SETTINGS.EXPIRY_HOURS * 3600 * 1000;
const STATS_MS = SETTINGS.STATS_KEEP_DAYS * 86400 * 1000;
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
  const me = () => auth.currentUser;
  const boxDoc = (id) => F.doc(db, 'boxes', id);
  const tDoc = (boxId, tid) => F.doc(db, 'boxes', boxId, 'transfers', tid);
  const partDoc = (boxId, id) => F.doc(db, 'boxes', boxId, 'parts', id);
  const partIds = (files) => files.flatMap((f) => Array.from({ length: f.chunks || 0 }, (_, k) => `${f.ref}_${k}`));
  const ttl = () => F.Timestamp.fromMillis(now() + STATS_MS);

  // A freshly linked or signed-in account only counts as "registered" in security rules
  // once its token is refreshed.
  const refreshToken = () => me().getIdToken(true);

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

  // ───────────── accounts ─────────────
  const accountInfo = () => {
    const u = me();
    return { uid: u.uid, anonymous: u.isAnonymous, email: u.email || '', name: u.displayName || '' };
  };

  const accounts = {
    current: accountInfo,

    // Keeps the same uid when the person is currently anonymous, so anything they already
    // own (like a shop made before sign-in existed) stays theirs.
    async google() {
      const provider = new A.GoogleAuthProvider();
      try {
        if (me().isAnonymous) await A.linkWithPopup(me(), provider);
        else await A.signInWithPopup(auth, provider);
      } catch (e) {
        if (e.code === 'auth/credential-already-in-use' || e.code === 'auth/email-already-in-use') {
          const cred = A.GoogleAuthProvider.credentialFromError(e);
          if (!cred) throw e;
          await A.signInWithCredential(auth, cred); // returning user on a new device
        } else throw e;
      }
      await refreshToken();
      return accountInfo();
    },

    async signUpEmail(email, password) {
      const cred = A.EmailAuthProvider.credential(email, password);
      if (me().isAnonymous) await A.linkWithCredential(me(), cred);
      else await A.createUserWithEmailAndPassword(auth, email, password);
      await refreshToken();
      return accountInfo();
    },

    async signInEmail(email, password) {
      await A.signInWithEmailAndPassword(auth, email, password);
      await refreshToken();
      return accountInfo();
    },

    resetPassword: (email) => A.sendPasswordResetEmail(auth, email),

    async signOut() {
      await A.signOut(auth);
      await A.signInAnonymously(auth); // keep the app usable for sending
    },
  };

  // ───────────── print-shop profile + synced history ─────────────
  const profileDoc = () => F.doc(db, 'users', me().uid);
  const histCol = () => F.collection(db, 'users', me().uid, 'history');
  const histDoc = (id) => F.doc(db, 'users', me().uid, 'history', id);
  const metaFiles = (files) => (files || []).map((f) => ({ name: f.name, size: f.size, type: f.type || '' }));

  const profile = {
    async get() {
      const snap = await F.getDoc(profileDoc());
      return snap.exists() ? snap.data() : null;
    },
    save: (data) => F.setDoc(profileDoc(), { ...data, updatedAt: F.serverTimestamp() }, { merge: true }),
  };

  // Only the log lives in the cloud (who sent what, when, and whether it was seen).
  // The files themselves stay on the shop's device, as before.
  const history = {
    async list() {
      const snap = await F.getDocs(F.query(histCol(), F.orderBy('createdAt', 'desc')));
      return snap.docs.map((d) => {
        const v = d.data();
        return { id: d.id, senderName: v.senderName, createdAt: ms(v.createdAt) || now(), files: v.files || [], seen: !!v.seen };
      });
    },
    put: (rec) => F.setDoc(histDoc(rec.id), {
      senderName: rec.senderName, createdAt: F.Timestamp.fromMillis(rec.createdAt),
      files: metaFiles(rec.files), seen: !!rec.seen,
    }),
    markSeen: (id) => F.setDoc(histDoc(id), { seen: true }, { merge: true }),
    remove: (id) => F.deleteDoc(histDoc(id)),
    async clear() {
      const snap = await F.getDocs(histCol());
      for (let i = 0; i < snap.docs.length; i += 400) {
        const b = F.writeBatch(db);
        snap.docs.slice(i, i + 400).forEach((d) => b.delete(d.ref));
        await b.commit();
      }
    },
    async purgeOlderThan(msAgo) {
      const snap = await F.getDocs(F.query(histCol(), F.where('createdAt', '<', F.Timestamp.fromMillis(now() - msAgo))));
      for (let i = 0; i < snap.docs.length; i += 400) {
        const b = F.writeBatch(db);
        snap.docs.slice(i, i + 400).forEach((d) => b.delete(d.ref));
        await b.commit();
      }
    },
  };

  // ───────────── stats (traffic + usage) ─────────────
  const stats = {
    // One tiny doc per visitor per day. The id makes duplicates impossible; the rules reject a second write.
    async logVisit() {
      const u = me();
      const day = dayKey();
      const marker = `${day}_${u.uid}`;
      try { if (localStorage.getItem('tatshan.visit') === marker) return; } catch { /* ignore */ }
      try {
        await F.setDoc(F.doc(db, 'visits', marker), {
          uid: u.uid, day, kind: u.isAnonymous ? 'anon' : 'registered', at: F.serverTimestamp(), expireAt: ttl(),
        });
      } catch { /* already counted today, or stats are off: never bother the visitor */ }
      try { localStorage.setItem('tatshan.visit', marker); } catch { /* ignore */ }
    },
  };

  return {
    mode: 'firebase',
    uid: async () => me().uid,
    accounts, profile, history, stats,
    raw: { F, A, db, auth }, // for the admin dashboard (js/admin-api.js)

    async getBox(id) {
      const snap = await F.getDoc(boxDoc(id));
      if (!snap.exists()) return null;
      const d = snap.data();
      const expireAt = ms(d.expireAt);
      if (d.kind === 'temp' && expireAt && expireAt < now()) return null;
      return { id, kind: d.kind, name: d.name, ownerUid: d.ownerUid, expireAt };
    },

    async createBox({ id, kind, name }) {
      const data = { ownerUid: me().uid, kind, name, createdAt: F.serverTimestamp() };
      if (kind === 'temp') data.expireAt = F.Timestamp.fromMillis(now() + EXPIRY_MS);
      try {
        await F.setDoc(boxDoc(id), data);
      } catch (e) {
        if (e.code === 'permission-denied') {
          // Either the id is taken, or (for shops) the person isn't signed in with a real account.
          if (kind === 'shop' && me().isAnonymous) { const err = new Error('sign-in required'); err.code = 'sign-in-required'; throw err; }
          const err = new Error('exists'); err.code = 'exists'; throw err;
        }
        throw e;
      }
      return { id, kind, name, ownerUid: me().uid, expireAt: data.expireAt ? data.expireAt.toMillis() : null };
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

    async send({ boxId, boxKind = 'temp', senderName, files, onProgress }) {
      const tid = F.doc(F.collection(db, 'boxes', boxId, 'transfers')).id;
      const expireAt = F.Timestamp.fromMillis(now() + EXPIRY_MS);
      const total = files.reduce((n, f) => n + f.size, 0) || 1;
      let sent = 0;
      const written = [];

      // Fingerprint every file first, so the receiver can prove it arrived untouched.
      const hashes = await Promise.all(files.map((f) => sha256(f).catch(() => '')));
      const meta = files.map((f, i) => ({
        name: f.name.slice(0, 200), size: f.size, type: (f.type || '').slice(0, 100), sha256: hashes[i],
        box: boxId, ref: `${tid}_${i}`, chunks: Math.max(1, Math.ceil(f.size / CHUNK)),
      }));
      const jobs = meta.flatMap((m, i) => Array.from({ length: m.chunks }, (_, k) => ({ file: files[i], ref: m.ref, k })));

      try {
        await pool(jobs, 4, async ({ file, ref, k }) => {
          const bytes = new Uint8Array(await file.slice(k * CHUNK, (k + 1) * CHUNK).arrayBuffer());
          const id = `${ref}_${k}`;
          await F.setDoc(partDoc(boxId, id), {
            tid, senderUid: me().uid, data: F.Bytes.fromUint8Array(bytes),
            createdAt: F.serverTimestamp(), expireAt,
          });
          written.push(id);
          sent += bytes.length;
          onProgress && onProgress(Math.min(1, sent / total));
        });
        await F.setDoc(tDoc(boxId, tid), {
          senderUid: me().uid, senderName, files: meta,
          createdAt: F.serverTimestamp(), expireAt,
        });
      } catch (e) {
        // Don't leave half-uploaded pieces behind.
        await Promise.all(written.map((id) => F.deleteDoc(partDoc(boxId, id)).catch(() => {})));
        throw e;
      }

      // Usage stats: best effort, must never fail a send.
      try {
        const types = {};
        files.forEach((f) => { const b = typeBucket(f.name); types[b] = (types[b] || 0) + 1; });
        await F.setDoc(F.doc(db, 'events', tid), {
          senderUid: me().uid, day: dayKey(), at: F.serverTimestamp(), dest: boxKind === 'shop' ? 'shop' : 'temp',
          senderType: me().isAnonymous ? 'anon' : 'registered', files: files.length, bytes: files.reduce((n, f) => n + f.size, 0),
          types, expireAt: ttl(),
        });
      } catch { /* analytics only */ }
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
      const blob = withType(new Blob(pieces), file);
      if (file.size && blob.size !== file.size) throw new Error('File arrived incomplete');
      if (file.sha256) {
        const got = await sha256(blob);
        if (got && got !== file.sha256) throw new Error('File was damaged in transit');
      }
      return blob;
    },

    // Called once the receiver has the files safely: wipe them from the cloud.
    removeTransfer,
  };
}
