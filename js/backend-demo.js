// Demo backend: same interface as the Firebase one, but everything lives in this
// browser (IndexedDB + BroadcastChannel). Open two tabs to try Tatshan with no setup.
// Used automatically until you put real Firebase keys in js/config.js.
import { SETTINGS } from './config.js';
import { pool, sleep, withType } from './util.js';

const EXPIRY_MS = SETTINGS.EXPIRY_HOURS * 3600 * 1000;
const channel = 'BroadcastChannel' in window ? new BroadcastChannel('tatshan-demo') : null;
const listeners = new Set();
const ping = () => { listeners.forEach((fn) => fn()); channel && channel.postMessage('change'); };
if (channel) channel.onmessage = () => listeners.forEach((fn) => fn());

let dbPromise;
function db() {
  dbPromise ||= new Promise((resolve, reject) => {
    const req = indexedDB.open('tatshan-demo', 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('boxes', { keyPath: 'id' });
      req.result.createObjectStore('transfers', { keyPath: 'id' }).createIndex('boxId', 'boxId');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}
async function run(store, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(store, mode);
    const out = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(out && 'result' in out ? out.result : undefined);
    tx.onerror = () => reject(tx.error);
  });
}
const getAll = (store) => run(store, 'readonly', (s) => s.getAll());
const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => b.toString(16).padStart(2, '0')).join('');

export async function createDemoBackend() {
  let uid = localStorage.getItem('tatshan.demo.uid');
  if (!uid) { uid = randomId(); localStorage.setItem('tatshan.demo.uid', uid); }

  // Demo accounts: no passwords checked, just enough to try the sign-in screens. The "account"
  // is a stable id derived from the email, so it survives clearing nothing but behaves like one.
  const ACC = 'tatshan.demo.account';
  const readAcc = () => { try { return JSON.parse(localStorage.getItem(ACC) || 'null'); } catch { return null; } };
  const accId = (email) => `acc_${Array.from(new TextEncoder().encode(email.toLowerCase()), (b) => b.toString(16)).join('').slice(0, 20)}`;
  const signInAs = (email, name = '') => { localStorage.setItem(ACC, JSON.stringify({ email, name })); uid = accId(email); return accounts.current(); };
  { const a = readAcc(); if (a) uid = accId(a.email); }

  const accounts = {
    current: () => { const a = readAcc(); return { uid, anonymous: !a, email: a ? a.email : '', name: a ? a.name : '' }; },
    async google() { const email = prompt('Demo mode: pretend Google account email', 'you@example.com'); if (!email) throw Object.assign(new Error('closed'), { code: 'auth/popup-closed-by-user' }); return signInAs(email.trim(), email.split('@')[0]); },
    async signUpEmail(email) { return signInAs(email); },
    async signInEmail(email) { return signInAs(email); },
    async resetPassword() {},
    async signOut() { localStorage.removeItem(ACC); uid = localStorage.getItem('tatshan.demo.uid'); },
  };
  const PROFILE = () => `tatshan.demo.profile.${uid}`;
  const profile = {
    get: async () => { try { return JSON.parse(localStorage.getItem(PROFILE()) || 'null'); } catch { return null; } },
    save: async (data) => { localStorage.setItem(PROFILE(), JSON.stringify({ ...(await profile.get()), ...data })); },
  };
  // In demo mode history is local only, so the "cloud log" is empty.
  const history = { list: async () => [], put: async () => {}, markSeen: async () => {}, remove: async () => {}, clear: async () => {}, purgeOlderThan: async () => {} };
  const stats = { logVisit: async () => {} };

  const api = {
    mode: 'demo',
    uid: async () => uid,
    accounts, profile, history, stats,

    async getBox(id) {
      const [box] = (await run('boxes', 'readonly', (s) => s.getAll())).filter((b) => b.id === id);
      if (!box) return null;
      if (box.kind === 'temp' && box.expireAt < Date.now()) return null;
      return box;
    },

    async createBox({ id, kind, name }) {
      if (kind === 'shop' && !readAcc()) { const e = new Error('sign-in required'); e.code = 'sign-in-required'; throw e; }
      if (await api.getBox(id)) { const e = new Error('exists'); e.code = 'exists'; throw e; }
      const box = { id, kind, name, ownerUid: uid, createdAt: Date.now(), expireAt: kind === 'temp' ? Date.now() + EXPIRY_MS : null };
      await run('boxes', 'readwrite', (s) => s.put(box));
      return box;
    },

    async closeBox(id) { await run('boxes', 'readwrite', (s) => s.delete(id)); ping(); },

    watchTransfers(boxId, onList) {
      let alive = true;
      const refresh = async () => {
        const rows = (await getAll('transfers')).filter((t) => t.boxId === boxId && t.createdAt > Date.now() - EXPIRY_MS);
        if (!alive) return;
        rows.sort((a, b) => b.createdAt - a.createdAt);
        onList(rows.map((t) => ({ id: t.id, senderName: t.senderName, createdAt: t.createdAt, files: t.files.map(({ blob, ...f }) => f) })));
      };
      listeners.add(refresh); refresh();
      return () => { alive = false; listeners.delete(refresh); };
    },

    watchDelivery(boxId, tid, onDelivered) {
      let seen = false; let fired = false; let alive = true;
      const check = async () => {
        const rows = await getAll('transfers');
        if (!alive) return;
        if (rows.some((t) => t.id === tid)) seen = true;
        else if (seen && !fired) { fired = true; onDelivered(); }
      };
      listeners.add(check); check();
      return () => { alive = false; listeners.delete(check); };
    },

    async send({ boxId, senderName, files, onProgress }) {
      const tid = randomId();
      const total = files.reduce((n, f) => n + f.size, 0) || 1;
      let done = 0;
      const stored = new Array(files.length);
      await pool(files, 3, async (file, i) => {
        for (let step = 1; step <= 4; step++) { await sleep(60); onProgress && onProgress((done + (file.size * step) / 4) / total); }
        done += file.size;
        stored[i] = { name: file.name, size: file.size, type: file.type || '', path: `${tid}:${i}`, blob: file };
      });
      await run('transfers', 'readwrite', (s) => s.put({ id: tid, boxId, senderUid: uid, senderName, files: stored, createdAt: Date.now() }));
      ping();
      return tid;
    },

    async fetchFile(file) {
      const [tid, i] = file.path.split(':');
      const row = (await getAll('transfers')).find((t) => t.id === tid);
      if (!row) throw new Error('File is no longer available');
      await sleep(150);
      return withType(row.files[Number(i)].blob, file);
    },

    async removeTransfer(boxId, transfer) {
      await run('transfers', 'readwrite', (s) => s.delete(transfer.id));
      ping();
    },
  };
  return api;
}
