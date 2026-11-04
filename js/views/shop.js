import { h, icon, button, pigeonImg, svgFromString, openSheet, toast, spinner, logo } from '../ui.js';
import { qrSvg } from '../qr.js';
import { history } from '../store.js';
import { openPreview, printEntry } from '../print.js';
import { SETTINGS } from '../config.js';
import {
  randomCode, groupCode, sendUrl, dateStr, timeStr, extLabel, initials, hueFor, saveBlob, sleep,
} from '../util.js';

const KEY = 'tatshan.shop';
const readShop = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };

export default async function shop(root, ctx) {
  document.title = 'Print shop · Tatshan';
  if (!readShop()) return setup(root, ctx);

  root.replaceChildren(h('div', { class: 'center pad' }, spinner()));
  const saved = readShop();
  let box = null; let uid = null;
  try { [box, uid] = await Promise.all([ctx.backend.getBox(saved.id), ctx.backend.uid()]); } catch (e) { console.error(e); }
  if (!box) return lost(root, ctx, 'We couldn’t reach your shop. Check your connection and refresh.', false);
  if (box.ownerUid !== uid) return lost(root, ctx, 'This browser no longer has access to that shop (its sign-in data was cleared).', true);
  return dashboard(root, ctx, box);
}

// ───────────── first-time setup ─────────────
function setup(root, { backend, rerender }) {
  const input = h('input', { class: 'input', id: 'shop-name', type: 'text', maxlength: '40', placeholder: 'e.g. Sharma Xerox & Prints', autocomplete: 'organization' });
  const error = h('p', { class: 'error', role: 'alert' });
  const create = button('Create my shop QR', {
    kind: 'primary', cls: 'block', onClick: async () => {
      const name = input.value.trim();
      if (!name) { error.textContent = 'Enter your shop name first.'; input.focus(); return; }
      create.disabled = true;
      try {
        let box = null;
        for (let i = 0; i < 6 && !box; i++) {
          try { box = await backend.createBox({ id: randomCode(8), kind: 'shop', name }); } catch (e) { if (e.code !== 'exists') throw e; }
        }
        if (!box) throw new Error('no id');
        localStorage.setItem(KEY, JSON.stringify({ id: box.id, name }));
        rerender();
      } catch (e) {
        console.error(e);
        error.textContent = 'Couldn’t create your shop. Check your connection and try again.';
        create.disabled = false;
      }
    },
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') create.click(); });
  root.replaceChildren(
    h('a', { class: 'back', href: '#/' }, icon('back', 18), 'Back'),
    h('h1', { class: 'page-title' }, 'Set up your print shop'),
    h('p', { class: 'lead small' }, 'One QR code for your counter. Customers scan it, send files, and you see them appear instantly. No WhatsApp needed.'),
    h('div', { class: 'card stack' },
      h('label', { class: 'label', for: 'shop-name' }, 'Shop name'),
      input, error, create,
      h('ul', { class: 'bullets' },
        h('li', {}, 'Every file shows the sender’s name, file name, date and time.'),
        h('li', {}, 'Files are copied to this device the moment they arrive, then deleted from the cloud.'),
        h('li', {}, `History stays on this device for ${SETTINGS.HISTORY_KEEP_HOURS} hours.`),
        h('li', {}, 'Use the same browser each day, and keep this page open while you work.'))));
  setTimeout(() => input.focus(), 50);
  return () => {};
}

function lost(root, { rerender }, message, canReset) {
  root.replaceChildren(
    h('a', { class: 'back', href: '#/' }, icon('back', 18), 'Back'),
    h('div', { class: 'card notice' },
      h('h1', { class: 'page-title small' }, 'Can’t open your shop'),
      h('p', { class: 'muted' }, message),
      canReset
        ? button('Set up a new shop', { kind: 'primary', onClick: () => { localStorage.removeItem(KEY); rerender(); } })
        : button('Try again', { kind: 'primary', onClick: rerender })));
  return () => {};
}

// ───────────── QR sheet, poster, PNG ─────────────
function qrWrap(code, margin = 2) {
  const wrap = h('div', { class: 'qr-wrap' });
  wrap.append(svgFromString(qrSvg(sendUrl(code), { margin })));
  return wrap;
}

function printPoster(box) {
  const poster = h('div', { id: 'poster' },
    logo('logo--lg'),
    h('h1', { class: 'poster-name' }, box.name),
    h('p', { class: 'poster-cta' }, 'Scan to send your files'),
    qrWrap(box.id, 1),
    h('p', { class: 'poster-code' }, `or open ${location.host} → Send, and enter ${groupCode(box.id)}`),
    h('p', { class: 'poster-foot' }, 'No WhatsApp. No sign-up. Files are deleted once downloaded.'));
  document.body.append(poster);
  document.body.classList.add('printing-poster');
  const done = () => { poster.remove(); document.body.classList.remove('printing-poster'); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  window.print();
}

async function savePng(box) {
  const size = 1024;
  const svg = qrSvg(sendUrl(box.id), { margin: 3 }).replace('<svg ', `<svg width="${size}" height="${size}" `);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const c = canvas.getContext('2d');
    c.imageSmoothingEnabled = false;
    c.drawImage(img, 0, 0, size, size);
    canvas.toBlob((b) => saveBlob(b, `tatshan-${box.id}-qr.png`), 'image/png');
  } finally { URL.revokeObjectURL(url); }
}

function showQr(box) {
  openSheet({
    title: box.name,
    subtitle: 'Customers scan this to send you files',
    body: h('div', { class: 'qr-sheet' },
      qrWrap(box.id),
      h('div', { class: 'code' }, groupCode(box.id)),
      h('p', { class: 'hint center' }, 'Works with any phone camera. No app, no sign-up.'),
      h('div', { class: 'row-gap center' },
        button('Print poster', { kind: 'primary', ic: 'print', onClick: () => printPoster(box) }),
        button('Save image', { ic: 'download', onClick: () => savePng(box) }))),
  });
}

// ───────────── dashboard ─────────────
async function dashboard(root, { backend, rerender }, box) {
  let first = true;
  const rows = new Map(); // id -> element
  const remote = new Map(); // id -> transfer object (needed to retry a failed pickup)
  const seen = new Set();
  const queue = [];
  let working = false;
  let dead = false;

  const dot = h('span', { class: 'dot' });
  const statusText = h('span', {}, 'Connecting…');
  const status = h('span', { class: 'status' }, dot, statusText);
  const setStatus = (kind) => {
    status.dataset.state = kind;
    statusText.textContent = { live: 'Live · receiving files', connecting: 'Connecting…', offline: 'Offline · reconnecting…' }[kind];
  };
  setStatus('connecting');

  const listEl = h('div', { class: 'msg-list' });
  const empty = h('div', { class: 'empty' },
    pigeonImg('empty-pigeon'),
    h('p', { class: 'empty-title' }, 'No files yet'),
    h('p', { class: 'muted' }, 'Put your QR code at the counter. Files show up here the second a customer sends them.'));
  const countEl = h('span', { class: 'muted' });
  const clearBtn = button('Clear', { kind: 'ghost', ic: 'trash', onClick: confirmClear });

  root.replaceChildren(
    h('div', { class: 'shop-head' },
      h('div', {},
        h('p', { class: 'eyebrow' }, 'Print shop'),
        h('h1', { class: 'page-title tight' }, box.name),
        status),
      button('Show QR code', { kind: 'primary', ic: 'qr', onClick: () => showQr(box) })),
    h('div', { class: 'section-row' },
      h('h2', { class: 'section-title' }, 'History ', countEl),
      clearBtn),
    listEl, empty);

  // ---- list rendering (newest on top; new items slide in and push the rest down) ----
  function buildRow(e) {
    const refs = {
      avatar: h('span', { class: 'avatar' }),
      name: h('b', { class: 'msg-name' }),
      chip: h('span', { class: 'chip' }),
      file: h('span', { class: 'msg-file' }),
      more: h('span', { class: 'more' }),
      state: h('span', { class: 'msg-state' }),
      date: h('span', { class: 'msg-date' }),
      time: h('span', { class: 'msg-clock' }),
    };
    const btn = h('button', { class: 'msg', type: 'button', onClick: () => openActions(row._entry) },
      refs.avatar,
      h('span', { class: 'msg-main' },
        h('span', { class: 'msg-top' }, refs.name, refs.chip),
        h('span', { class: 'msg-line' }, refs.file, refs.more),
        refs.state),
      h('span', { class: 'msg-time' }, refs.date, refs.time));
    const row = h('div', { class: 'row' }, h('div', { class: 'row-inner' }, btn));
    row._refs = refs;
    return row;
  }
  function updateRow(row, e) {
    const r = row._refs;
    row._entry = e;
    r.avatar.textContent = initials(e.senderName);
    r.avatar.style.setProperty('--h', hueFor(e.senderName));
    r.name.textContent = e.senderName;
    r.chip.textContent = extLabel(e.files[0].name);
    r.file.textContent = e.files[0].name;
    r.more.textContent = e.files.length > 1 ? `+ ${e.files.length - 1} more` : '';
    r.date.textContent = dateStr(e.createdAt);
    r.time.textContent = timeStr(e.createdAt);
    r.state.replaceChildren();
    r.state.className = `msg-state ${e.status}`;
    if (e.status === 'receiving') r.state.append(spinner(), 'Receiving…');
    if (e.status === 'error') r.state.append('Couldn’t receive · tap to retry');
  }
  function renderList(entries) {
    const ids = new Set(entries.map((e) => e.id));
    for (const [id, el] of rows) if (!ids.has(id)) { el.remove(); rows.delete(id); }
    entries.forEach((e, i) => {
      let el = rows.get(e.id);
      if (!el) { el = buildRow(e); rows.set(e.id, el); if (!first) el.classList.add('enter'); }
      updateRow(el, e);
      const at = listEl.children[i];
      if (at !== el) listEl.insertBefore(el, at || null);
    });
    empty.hidden = entries.length > 0;
    clearBtn.hidden = entries.length === 0;
    countEl.textContent = entries.length ? `· ${entries.length}` : '';
    first = false;
  }
  const reload = async () => { if (!dead) renderList(await history.all()); };

  // ---- tapping a message: only Preview and Print ----
  function openActions(e) {
    if (!e) return;
    if (e.status === 'receiving') { toast('Still receiving this one…'); return; }
    const firstName = e.files[0].name;
    const more = e.files.length > 1 ? ` + ${e.files.length - 1} more` : '';
    const sheet = openSheet({
      title: e.senderName,
      subtitle: `${dateStr(e.createdAt)} · ${timeStr(e.createdAt)}`,
      body: e.status === 'error'
        ? h('div', { class: 'actions-sheet' },
          h('p', { class: 'muted' }, 'This file didn’t come through. It’s still waiting for you, so try again.'),
          button('Retry', { kind: 'primary', cls: 'block', onClick: () => { sheet.close(); retry(e.id); } }))
        : h('div', { class: 'actions-sheet' },
          h('p', { class: 'actions-file' }, h('span', { class: 'chip' }, extLabel(e.files[0].name)), `${firstName}${more}`),
          h('div', { class: 'action-pair' },
            button('Preview', { kind: 'secondary', ic: 'eye', onClick: () => { sheet.close(); openPreview(e); } }),
            button('Print', { kind: 'primary', ic: 'print', onClick: () => { sheet.close(); printEntry(e).catch((err) => { console.error(err); toast('Couldn’t print that file.', { kind: 'error' }); }); } }))),
    });
  }

  function confirmClear() {
    const sheet = openSheet({
      title: 'Clear history?',
      body: h('div', { class: 'actions-sheet' },
        h('p', { class: 'muted' }, 'This removes every file from this device. Customers’ files can’t be recovered afterwards.'),
        h('div', { class: 'action-pair' },
          button('Cancel', { onClick: () => sheet.close() }),
          button('Clear all', { kind: 'danger', ic: 'trash', onClick: async () => { sheet.close(); await history.clear(); await reload(); } }))),
    });
  }

  // ---- pulling files in, then wiping them from the cloud ----
  async function receiveOne(t, attempt = 0) {
    const meta = { id: t.id, senderName: t.senderName, createdAt: t.createdAt };
    try {
      const existing = await history.get(t.id);
      if (existing && existing.status === 'ready') { await backend.removeTransfer(box.id, t).catch(() => {}); return; }
      await history.put({ ...meta, status: 'receiving', files: t.files.map((f) => ({ name: f.name, size: f.size, type: f.type })) });
      await reload();
      const files = [];
      for (const f of t.files) files.push({ name: f.name, size: f.size, type: f.type, blob: await backend.fetchFile(f) });
      await history.put({ ...meta, status: 'ready', files });
      await reload();
      await backend.removeTransfer(box.id, t); // only after it is safely stored on this device
      remote.delete(t.id);
    } catch (e) {
      console.error(e);
      if (attempt < 2) { await sleep(3000 * (attempt + 1)); return receiveOne(t, attempt + 1); }
      await history.put({ ...meta, status: 'error', files: t.files.map((f) => ({ name: f.name, size: f.size, type: f.type })) });
      await reload();
    }
  }
  async function pump() {
    if (working) return;
    working = true;
    try { while (queue.length && !dead) await receiveOne(queue.shift()); } finally { working = false; }
  }
  function retry(id) {
    const t = remote.get(id);
    if (!t) { toast('That one has expired.', { kind: 'error' }); history.remove(id).then(reload); return; }
    queue.push(t); pump();
  }

  const unwatch = backend.watchTransfers(box.id, (list) => {
    setStatus(navigator.onLine ? 'live' : 'offline');
    for (const t of list) {
      remote.set(t.id, t);
      if (!seen.has(t.id)) { seen.add(t.id); queue.push(t); }
    }
    pump();
  }, () => setStatus('offline'));

  const onOnline = () => setStatus('live');
  const onOffline = () => setStatus('offline');
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);

  const purge = async () => { await history.purgeOlderThan(SETTINGS.HISTORY_KEEP_HOURS * 3600 * 1000); await reload(); };
  await purge();
  const purgeTimer = setInterval(purge, 10 * 60 * 1000);

  return () => {
    dead = true;
    unwatch();
    clearInterval(purgeTimer);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
  };
}
