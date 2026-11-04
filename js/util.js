// Small helpers shared by the whole app. No dependencies.

// ---- clock (server-time offset, so a wrong phone clock can't break expiry checks) ----
let offset = 0;
export const now = () => Date.now() + offset;
export async function syncClock() {
  try {
    const res = await fetch(location.href.split('#')[0], { method: 'HEAD', cache: 'no-store' });
    const d = Date.parse(res.headers.get('date') || '');
    if (!Number.isNaN(d)) offset = d - Date.now();
  } catch { /* offline or file:// — fall back to local time */ }
}

// ---- codes ----
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L: easy to read out loud
export function randomCode(len) {
  let out = '';
  while (out.length < len) {
    const buf = crypto.getRandomValues(new Uint8Array(len * 2));
    for (const b of buf) {
      if (b < 248 && out.length < len) out += ALPHABET[b % ALPHABET.length];
    }
  }
  return out;
}
export const normalizeCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export const isValidCode = (s) => /^[A-Z2-9]{6,8}$/.test(s) && [...s].every((c) => ALPHABET.includes(c));
export function groupCode(c) {
  const mid = Math.ceil(c.length / 2);
  return `${c.slice(0, mid)} ${c.slice(mid)}`;
}
export function sendUrl(code) {
  return `${location.origin}${location.pathname}#/send/${code}`;
}
// Pull a code out of whatever a scanner returned (full URL or raw code).
export function codeFromScan(text) {
  const m = String(text).match(/#\/send\/([A-Za-z0-9]+)/);
  const code = normalizeCode(m ? m[1] : text);
  return isValidCode(code) ? code : null;
}

// ---- formatting ----
const DATE = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const TIME = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
export const dateStr = (ms) => DATE.format(ms);
export const timeStr = (ms) => TIME.format(ms).toUpperCase();
export function relative(ms) {
  const s = Math.max(0, Math.round((now() - ms) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const hr = Math.round(m / 60);
  if (hr < 24) return `${hr} h ago`;
  const d = Math.round(hr / 24);
  return `${d} day${d > 1 ? 's' : ''} ago`;
}
export function fmtSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(n < 10485760 ? 1 : 0)} MB`;
}
export function fmtDuration(ms) {
  const mins = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(mins / 60);
  return h ? `${h}h ${String(mins % 60).padStart(2, '0')}m` : `${mins}m`;
}
export const extOf = (name) => (String(name).includes('.') ? String(name).split('.').pop().toLowerCase() : '');
export const extLabel = (name) => (extOf(name) || 'file').slice(0, 5).toUpperCase();
export function initials(name) {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}
export function hueFor(name) {
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}
export const safeName = (name) => String(name).replace(/[^\w.\-]+/g, '_').slice(-80) || 'file';

// ---- files ----
const MIME = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif',
  txt: 'text/plain', csv: 'text/csv', md: 'text/plain', json: 'application/json',
  mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav',
};
export function withType(blob, file) {
  const type = blob.type && blob.type !== 'application/octet-stream' ? blob.type : (file.type || MIME[extOf(file.name)] || blob.type || '');
  return type === blob.type ? blob : new Blob([blob], { type });
}
export function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.rel = 'noopener';
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function pool(items, limit, worker) {
  let next = 0;
  const run = async () => { while (next < items.length) { const i = next++; await worker(items[i], i); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
}
