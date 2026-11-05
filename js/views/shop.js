import { h, icon, button, pigeonImg, svgFromString, openSheet, toast, spinner, logo } from '../ui.js';
import { qrSvg } from '../qr.js';
import { history } from '../store.js';
import { openPreview, printEntry, printFile, canPrintInBrowser } from '../print.js';
import { authPanel } from '../auth-ui.js';
import { SETTINGS } from '../config.js';
import {
  randomCode, groupCode, sendUrl, dateStr, timeStr, extLabel, initials, hueFor, saveBlob, sleep, fmtSize,
} from '../util.js';

const KEY = 'tatshan.shop'; // only a hint on this device. The real link between a person and their shop lives in their account.
const readShop = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };
const rememberShop = (box) => { try { localStorage.setItem(KEY, JSON.stringify({ id: box.id, name: box.name })); } catch { /* ignore */ } };

export default async function shop(root, ctx) {
  document.title = 'Print shop · Tatshan';
  const { backend } = ctx;
  root.replaceChildren(h('div', { class: 'center pad' }, spinner()));

  let acct; let profile = null; let uid;
  try {
    acct = backend.accounts.current();
    uid = await backend.uid();
    if (!acct.anonymous) profile = await backend.profile.get();
  } catch (e) { console.error(e); return lost(root, ctx, 'We couldn’t reach your shop. Check your connection and refresh.', false); }

  // 1. A signed-in owner: the account says which shop is theirs, on any device.
  if (!acct.anonymous && profile && profile.shopId) {
    let box = null;
    try { box = await backend.getBox(profile.shopId); } catch (e) { console.error(e); }
    if (!box) return lost(root, ctx, 'We couldn’t load your shop. Check your connection and refresh.', false);
    if (box.ownerUid !== uid) return lost(root, ctx, 'This account doesn’t own that shop any more.', false);
    rememberShop(box);
    return dashboard(root, ctx, box, acct);
  }

  // 2. A shop made before sign-in existed: it belongs to this browser. Keep it working,
  //    and ask the owner to sign in so it survives a cleared cache or a new phone.
  const legacy = readShop();
  if (legacy) {
    let box = null;
    try { box = await backend.getBox(legacy.id); } catch (e) { console.error(e); }
    if (box && box.ownerUid === uid) {
      if (!acct.anonymous) { try { await backend.profile.save({ shopId: box.id, name: box.name }); } catch (e) { console.error(e); } } // already signed in: adopt it
      return dashboard(root, ctx, box, acct);
    }
  }

  // 3. First time: signing in comes first. This is the only place Tatshan asks anyone to sign in.
  if (acct.anonymous) return gate(root, ctx);
  return setup(root, ctx);
}

// ───────────── sign-in gate (first time only) ─────────────
function gate(root, { backend, rerender }) {
  root.replaceChildren(
    h('a', { class: 'back', href: '#/' }, icon('back', 18), 'Back'),
    h('h1', { class: 'page-title' }, 'Set up your print shop'),
    h('p', { class: 'lead small' }, 'Sign in once so your shop, its QR code and its history stay yours, even if you switch phones or clear your browser.'),
    h('div', { class: 'card' }, authPanel(backend, { onDone: () => rerender() })),
    h('p', { class: 'hint center' }, 'Only print shops sign in. Customers who just want to send a file never need to.'));
  return () => {};
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
        await backend.profile.save({ shopId: box.id, name }); // ties the shop to the account, not the browser
        rememberShop(box);
        rerender();
      } catch (e) {
        console.error(e);
        error.textContent = e.code === 'sign-in-required' ? 'Please sign in first.' : 'Couldn’t create your shop. Check your connection and try again.';
        create.disabled = false;
      }
    },
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') create.click(); });
  const acct = backend.accounts.current();
  root.replaceChildren(
    h('a', { class: 'back', href: '#/' }, icon('back', 18), 'Back'),
    h('h1', { class: 'page-title' }, 'Name your print shop'),
    h('p', { class: 'lead small' }, `Signed in as ${acct.email || acct.name || 'your account'}. One QR code for your counter: customers scan it, send files, and you see them appear instantly.`),
    h('div', { class: 'card stack' },
      h('label', { class: 'label', for: 'shop-name' }, 'Shop name'),
      input, error, create,
      h('ul', { class: 'bullets' },
        h('li', {}, 'Every file shows the sender’s name, file name, date and time.'),
        h('li', {}, 'Files are copied to this device the moment they arrive, then deleted from the cloud.'),
        h('li', {}, `The history log stays with your account for ${SETTINGS.HISTORY_KEEP_HOURS} hours. Sign in on any device to see it.`),
        h('li', {}, 'Keep this page open while you work.'))));
  setTimeout(() => input.focus(), 50);
  return () => {};
}

function lost(root, { backend, rerender }, message, canReset) {
  root.replaceChildren(
    h('a', { class: 'back', href: '#/' }, icon('back', 18), 'Back'),
    h('div', { class: 'card notice' },
      h('h1', { class: 'page-title small' }, 'Can’t open your shop'),
      h('p', { class: 'muted' }, message),
      h('div', { class: 'row-gap' },
        button('Try again', { kind: 'primary', onClick: rerender }),
        !backend.accounts.current().anonymous && button('Sign out', { kind: 'ghost', ic: 'logout', onClick: async () => { await backend.accounts.signOut(); rerender(); } }))));
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
async function dashboard(root, { backend, rerender }, box, acct) {
  const signedIn = !acct.anonymous;
  let first = true;
  const rows = new Map(); // id -> element
  const remote = new Map(); // id -> transfer object (needed to retry a failed pickup)
  const seenIds = new Set();
  const queue = [];
  let working = false;
  let dead = false;
  let entries = [];

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

  // Shops from before sign-in existed keep working, with a standing reminder to secure them.
  const secure = !signedIn && h('div', { class: 'card secure-banner' },
    h('span', { class: 'bubble xs' }, icon('shield', 16)),
    h('div', { class: 'secure-text' },
      h('strong', {}, 'Sign in to protect your shop'),
      h('span', { class: 'muted' }, ' Right now it only lives in this browser. If you clear it or switch phones, you’d lose the shop and its QR.')),
    button('Sign in', { kind: 'primary', onClick: () => openSheet({ title: 'Sign in to keep your shop', body: h('div', { class: 'sheet-pad' }, authPanel(backend, { onDone: async () => {
      try { await backend.profile.save({ shopId: box.id, name: box.name }); } catch (e) { console.error(e); }
      location.reload();
    } })) }) }));

  const account = signedIn && h('div', { class: 'acct' },
    h('span', { class: 'muted' }, acct.email || acct.name || 'Signed in'),
    button('Sign out', { kind: 'ghost', ic: 'logout', onClick: async () => { await backend.accounts.signOut(); location.hash = '#/'; location.reload(); } }));

  root.replaceChildren(...[
    secure,
    h('div', { class: 'shop-head' },
      h('div', {},
        h('p', { class: 'eyebrow' }, 'Print shop'),
        h('h1', { class: 'page-title tight' }, box.name),
        status),
      button('Show QR code', { kind: 'primary', ic: 'qr', onClick: () => showQr(box) })),
    account,
    h('div', { class: 'section-row' },
      h('h2', { class: 'section-title' }, 'History ', countEl),
      clearBtn),
    listEl, empty].filter(Boolean));

  const updateTitle = () => {
    const n = entries.filter((e) => !e.seen && e.status !== 'error').length;
    document.title = `${n ? `(${n}) ` : ''}Print shop · Tatshan`;
  };

  // ---- seen / unseen (shared with the cloud log, so it follows the account to other devices) ----
  async function markSeen(e) {
    if (!e || e.seen) return;
    e.seen = true;
    try { await history.markSeen(e.id); } catch (err) { console.error(err); }
    if (signedIn) backend.history.markSeen(e.id).catch(() => {});
    await reload();
  }

  // ---- list rendering (newest on top; new items slide in and push the rest down) ----
  function buildRow() {
    const refs = {
      avatar: h('span', { class: 'avatar' }),
      name: h('b', { class: 'msg-name' }),
      chip: h('span', { class: 'chip' }),
      file: h('span', { class: 'msg-file' }),
      more: h('span', { class: 'more' }),
      state: h('span', { class: 'msg-state' }),
      date: h('span', { class: 'msg-date' }),
      time: h('span', { class: 'msg-clock' }),
      unread: h('span', { class: 'unread-dot', role: 'img', 'aria-label': 'Not seen yet' }),
    };
    const btn = h('button', { class: 'msg', type: 'button', onClick: () => openActions(row._entry) },
      refs.unread,
      refs.avatar,
      h('span', { class: 'msg-main' },
        h('span', { class: 'msg-top' }, refs.name, refs.chip),
        h('span', { class: 'msg-line' }, refs.file, refs.more),
        refs.state),
      h('span', { class: 'msg-time' }, refs.date, refs.time));
    const row = h('div', { class: 'row' }, h('div', { class: 'row-inner' }, btn));
    row._refs = refs; row._btn = btn;
    return row;
  }
  function updateRow(row, e) {
    const r = row._refs;
    row._entry = e;
    const unseen = !e.seen && e.status !== 'receiving';
    row._btn.classList.toggle('unseen', unseen);
    r.unread.hidden = !unseen;
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
    if (e.status === 'remote') r.state.append('Received on another device');
  }
  function renderList(list) {
    entries = list;
    const ids = new Set(list.map((e) => e.id));
    for (const [id, el] of rows) if (!ids.has(id)) { el.remove(); rows.delete(id); }
    list.forEach((e, i) => {
      let el = rows.get(e.id);
      if (!el) { el = buildRow(); rows.set(e.id, el); if (!first) el.classList.add('enter'); }
      updateRow(el, e);
      const at = listEl.children[i];
      if (at !== el) listEl.insertBefore(el, at || null);
    });
    empty.hidden = list.length > 0;
    clearBtn.hidden = list.length === 0;
    countEl.textContent = list.length ? `· ${list.length}` : '';
    first = false;
    updateTitle();
  }
  const reload = async () => { if (!dead) renderList(await history.all()); };

  // ---- tapping a message: every file gets its own Preview and Print ----
  function openActions(e) {
    if (!e) return;
    if (e.status === 'receiving') { toast('Still receiving this one…'); return; }
    markSeen(e);
    const total = e.files.length;

    if (e.status === 'error' || e.status === 'remote') {
      const sheet = openSheet({
        title: e.senderName, subtitle: `${dateStr(e.createdAt)} · ${timeStr(e.createdAt)}`,
        body: h('div', { class: 'actions-sheet' },
          e.status === 'error'
            ? [h('p', { class: 'muted' }, 'This file didn’t come through. It’s still waiting for you, so try again.'),
              button('Retry', { kind: 'primary', cls: 'block', onClick: () => { sheet.close(); retry(e.id); } })]
            : [h('p', { class: 'muted' }, 'These files were picked up on another device signed in to this shop, so they can’t be opened here. The log is shared; the files stay on the device that received them.'),
              h('ul', { class: 'file-list' }, e.files.map((f) => h('li', { class: 'file-item' }, h('span', { class: 'chip' }, extLabel(f.name)), h('span', { class: 'file-name' }, f.name), h('span', { class: 'muted nowrap' }, fmtSize(f.size)))))]),
      });
      return;
    }

    const sheet = openSheet({
      title: e.senderName,
      subtitle: `${dateStr(e.createdAt)} · ${timeStr(e.createdAt)} · ${total === 1 ? '1 file' : `${total} files`}`,
      body: h('div', { class: 'actions-sheet' },
        h('ul', { class: 'file-list file-actions' }, e.files.map((f, i) => h('li', { class: 'file-item file-row' },
          h('span', { class: 'chip' }, extLabel(f.name)),
          h('span', { class: 'file-name' }, f.name, h('span', { class: 'muted file-size' }, fmtSize(f.size))),
          h('div', { class: 'file-btns' },
            h('button', { class: 'btn secondary slim', type: 'button', onClick: () => { sheet.close(); openPreview(e, i); } }, icon('eye', 16), h('span', {}, 'Preview')),
            h('button', { class: 'btn primary slim', type: 'button', onClick: () => { sheet.close(); printFile(f).catch(failPrint); } }, icon('print', 16), h('span', {}, 'Print')))))),
        total > 1 && h('div', { class: 'action-pair all' },
          button(`Preview all ${total}`, { kind: 'secondary', ic: 'eye', onClick: () => { sheet.close(); openPreview(e, 0); } }),
          button(`Print all ${total}`, { kind: 'primary', ic: 'print', onClick: () => { sheet.close(); printEntry(e, (i, n, f) => toast(`Printing ${i + 1} of ${n}: ${f.name}`)).catch(failPrint); } })),
        total > 1 && e.files.some((f) => !canPrintInBrowser(f)) && h('p', { class: 'hint' }, 'Word, Excel and PowerPoint files are saved instead, so you can print them from their own app.')),
    });
  }
  const failPrint = (err) => { console.error(err); toast('Couldn’t print that file.', { kind: 'error' }); };

  function confirmClear() {
    const sheet = openSheet({
      title: 'Clear history?',
      body: h('div', { class: 'actions-sheet' },
        h('p', { class: 'muted' }, 'This removes every file from this device and clears the log. Customers’ files can’t be recovered afterwards.'),
        h('div', { class: 'action-pair' },
          button('Cancel', { onClick: () => sheet.close() }),
          button('Clear all', { kind: 'danger', ic: 'trash', onClick: async () => {
            sheet.close();
            await history.clear();
            if (signedIn) backend.history.clear().catch(() => {});
            await reload();
          } }))),
    });
  }

  // ---- pulling files in, then wiping them from the cloud ----
  async function receiveOne(t, attempt = 0) {
    const meta = { id: t.id, senderName: t.senderName, createdAt: t.createdAt };
    const light = t.files.map((f) => ({ name: f.name, size: f.size, type: f.type }));
    try {
      const existing = await history.get(t.id);
      if (existing && existing.status === 'ready') { await backend.removeTransfer(box.id, t).catch(() => {}); return; }
      await history.put({ ...meta, status: 'receiving', seen: false, files: light });
      await reload();
      const files = [];
      for (const f of t.files) files.push({ name: f.name, size: f.size, type: f.type, blob: await backend.fetchFile(f) }); // verified byte-for-byte
      await history.put({ ...meta, status: 'ready', seen: false, files });
      await reload();
      if (signedIn) backend.history.put({ ...meta, files: light, seen: false }).catch(() => {}); // log to the account
      await backend.removeTransfer(box.id, t); // only after it is safely stored on this device
      remote.delete(t.id);
    } catch (e) {
      console.error(e);
      if (attempt < 2) { await sleep(3000 * (attempt + 1)); return receiveOne(t, attempt + 1); }
      await history.put({ ...meta, status: 'error', seen: false, files: light });
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

  // ---- bring this device in line with the account's log (history from other devices, seen flags) ----
  async function syncWithAccount() {
    if (!signedIn) return;
    try {
      const [cloud, local] = await Promise.all([backend.history.list(), history.all()]);
      const localById = new Map(local.map((r) => [r.id, r]));
      for (const c of cloud) {
        const l = localById.get(c.id);
        if (!l) await history.put({ id: c.id, senderName: c.senderName, createdAt: c.createdAt, status: 'remote', seen: c.seen, files: c.files });
        else if (c.seen && !l.seen) await history.put({ ...l, seen: true });
      }
      const cloudIds = new Set(cloud.map((c) => c.id));
      for (const l of local) {
        if (l.status === 'ready' && !cloudIds.has(l.id)) backend.history.put(l).catch(() => {}); // older entries from before the log existed
        else if (l.status === 'ready' && l.seen && !cloud.find((c) => c.id === l.id).seen) backend.history.markSeen(l.id).catch(() => {});
      }
    } catch (e) { console.warn('Account log unavailable', e); }
  }

  const unwatch = backend.watchTransfers(box.id, (list) => {
    setStatus(navigator.onLine ? 'live' : 'offline');
    for (const t of list) {
      remote.set(t.id, t);
      if (!seenIds.has(t.id)) { seenIds.add(t.id); queue.push(t); }
    }
    pump();
  }, () => setStatus('offline'));

  const onOnline = () => setStatus('live');
  const onOffline = () => setStatus('offline');
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);

  const purge = async () => {
    const keep = SETTINGS.HISTORY_KEEP_HOURS * 3600 * 1000;
    await history.purgeOlderThan(keep);
    if (signedIn) backend.history.purgeOlderThan(keep).catch(() => {});
    await reload();
  };
  await syncWithAccount();
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
