import { h, icon, button, pigeonImg, svgFromString, toast, spinner } from '../ui.js';
import { qrSvg } from '../qr.js';
import {
  randomCode, groupCode, sendUrl, now, fmtDuration, fmtSize, extLabel, initials, hueFor, dateStr, timeStr, saveBlob, sleep,
} from '../util.js';
import { openPreview } from '../print.js';
import { SETTINGS } from '../config.js';

const KEY = 'tatshan.inbox';
const SEEN_KEY = 'tatshan.seen';

// Which messages the receiver has already looked at (previewed or downloaded). Stored on this device only.
const readSeen = () => { try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); } catch { return new Set(); } };
const writeSeen = (set) => { try { localStorage.setItem(SEEN_KEY, JSON.stringify([...set].slice(-200))); } catch { /* ignore */ } };

// Re-use this browser's open inbox if it's still alive, otherwise open a fresh one.
async function openInbox(backend) {
  const uid = await backend.uid();
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved) {
      const box = await backend.getBox(saved.id);
      if (box && box.ownerUid === uid) return box;
    }
  } catch { /* fall through to a new inbox */ }
  for (let i = 0; i < 6; i++) {
    const id = randomCode(6);
    try {
      const box = await backend.createBox({ id, kind: 'temp', name: 'Inbox' });
      try { localStorage.setItem(KEY, JSON.stringify({ id })); } catch { /* ignore */ }
      return box;
    } catch (e) { if (e.code !== 'exists') throw e; }
  }
  throw new Error('Could not open an inbox');
}

export default async function receive(root, ctx) {
  const { backend } = ctx;
  document.title = 'Receive files · Tatshan';
  let cleanup = () => {};
  let dead = false;

  async function start() {
    root.replaceChildren(h('div', { class: 'center pad' }, spinner()));
    let box;
    try { box = await openInbox(backend); } catch (e) {
      console.error(e);
      root.replaceChildren(h('div', { class: 'card notice' },
        h('h1', { class: 'page-title small' }, 'Couldn’t open your inbox'),
        h('p', { class: 'muted' }, 'Check your connection and try again.'),
        button('Try again', { kind: 'primary', onClick: start })));
      return;
    }
    if (dead) return;

    let list = [];
    let known = null; // ids we've already shown; null until the first list arrives
    const busy = new Set();
    const seen = readSeen();
    const blobs = new Map(); // file ref -> blob, so previewing and then downloading fetches only once
    const incoming = h('div', { class: 'incoming-list' });
    const left = h('span', {});
    const qr = h('div', { class: 'qr-wrap' });
    qr.append(svgFromString(qrSvg(sendUrl(box.id), { margin: 2 })));

    const markSeen = (t) => {
      if (seen.has(t.id)) return;
      seen.add(t.id); writeSeen(seen); render(); updateTitle();
    };
    const unseenCount = () => list.filter((t) => !seen.has(t.id)).length;
    const updateTitle = () => { const n = unseenCount(); document.title = `${n ? `(${n}) ` : ''}Receive files · Tatshan`; };
    const loadBlob = async (f) => {
      if (!blobs.has(f.ref || f.name)) blobs.set(f.ref || f.name, await backend.fetchFile(f));
      return blobs.get(f.ref || f.name);
    };

    const newCode = async () => {
      cleanup();
      try { localStorage.removeItem(KEY); } catch { /* ignore */ }
      await backend.closeBox(box.id);
      start();
    };

    // The QR card folds away when files arrive, so the new files are the first thing on screen.
    const qrBody = h('div', { class: 'qr-card card' },
      qr,
      h('div', { class: 'code', 'aria-label': 'Your code' }, groupCode(box.id)),
      h('p', { class: 'muted center' }, 'Ask the sender to scan this with their phone camera, or open Tatshan and type the code.'),
      h('div', { class: 'qr-meta' },
        h('span', { class: 'meta-item' }, icon('clock', 16), left),
        button('New code', { kind: 'ghost', onClick: newCode })));
    const fold = h('div', { class: 'fold' }, h('div', { class: 'fold-inner' }, qrBody));
    const showQrBtn = h('button', { class: 'qr-toggle', type: 'button', hidden: true, onClick: () => setFolded(false) },
      icon('qr', 18), h('span', {}, 'Show my QR code'), icon('chevron', 16));
    const incomingTitle = h('h2', { class: 'section-title' }, 'Incoming');
    function setFolded(on, scroll = true) {
      fold.classList.toggle('folded', on);
      showQrBtn.hidden = !on;
      if (!on && scroll) fold.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    root.replaceChildren(
      h('a', { class: 'back', href: '#/' }, icon('back', 18), 'Back'),
      h('h1', { class: 'page-title' }, 'Receive files'),
      fold, showQrBtn,
      incomingTitle,
      incoming);

    const tick = () => {
      const remaining = (box.expireAt || now()) - now();
      if (remaining <= 0) {
        root.replaceChildren(h('div', { class: 'card notice' },
          h('h1', { class: 'page-title small' }, 'This inbox has expired'),
          h('p', { class: 'muted' }, 'Open a new one to keep receiving files.'),
          button('Open a new inbox', { kind: 'primary', onClick: newCode })));
        cleanup();
        return;
      }
      left.textContent = `Open for ${fmtDuration(remaining)}`;
    };
    tick();
    const timer = setInterval(tick, 30000);

    async function download(t) {
      busy.add(t.id); render();
      try {
        for (const f of t.files) {
          saveBlob(await loadBlob(f), f.name);
          await sleep(300);
        }
        markSeen(t);
        await backend.removeTransfer(box.id, t);
        toast('Saved to your device and deleted from Tatshan');
      } catch (e) {
        console.error(e);
        toast('Download failed. Please try again.', { kind: 'error' });
      } finally { busy.delete(t.id); render(); }
    }
    async function discard(t) {
      try { await backend.removeTransfer(box.id, t); } catch (e) { console.error(e); toast('Couldn’t delete that. Try again.', { kind: 'error' }); }
    }

    function render() {
      if (!list.length) {
        incoming.replaceChildren(h('div', { class: 'empty' },
          pigeonImg('empty-pigeon'),
          h('p', { class: 'empty-title' }, 'Waiting for files…'),
          h('p', { class: 'muted' }, 'They’ll appear here the moment someone sends them. Keep this page open.')));
        return;
      }
      incoming.replaceChildren(...list.map((t) => {
        const working = busy.has(t.id);
        const unseen = !seen.has(t.id);
        const entry = { files: t.files.map((f) => ({ name: f.name, size: f.size, type: f.type, load: () => loadBlob(f) })) };
        return h('article', { class: `card incoming${unseen ? ' unseen' : ''}`, 'data-id': t.id },
          h('div', { class: 'incoming-head' },
            h('span', { class: 'avatar', style: { '--h': hueFor(t.senderName) } }, initials(t.senderName), unseen && h('span', { class: 'unread-dot', role: 'img', 'aria-label': 'Not seen yet' })),
            h('div', { class: 'incoming-who' },
              h('strong', {}, t.senderName),
              h('span', { class: 'muted' }, ` sent ${t.files.length === 1 ? 'a file' : `${t.files.length} files`}`)),
            h('div', { class: 'stamp' }, h('span', {}, dateStr(t.createdAt)), h('span', {}, timeStr(t.createdAt)))),
          h('ul', { class: 'file-list' }, t.files.map((f, i) => h('li', { class: 'file-item' },
            h('span', { class: 'chip' }, extLabel(f.name)),
            h('span', { class: 'file-name' }, f.name),
            h('span', { class: 'muted nowrap' }, fmtSize(f.size)),
            h('button', { class: 'icon-btn small', type: 'button', 'aria-label': `Preview ${f.name}`, title: 'Preview', onClick: () => openPreview(entry, i, { onOpen: () => markSeen(t) }) }, icon('eye', 18))))),
          h('div', { class: 'row-gap' },
            h('button', { class: 'btn primary', disabled: working, onClick: () => download(t) },
              working ? spinner() : icon('download', 18), h('span', {}, working ? 'Downloading…' : `Download${t.files.length > 1 ? ' all' : ''}`)),
            !working && button('Delete', { kind: 'ghost', onClick: () => discard(t) })),
          h('p', { class: 'hint' }, 'Only download files from people you expect. It’s deleted from Tatshan the moment you do.'));
      }));
    }
    render();

    const unwatch = backend.watchTransfers(box.id, (l) => {
      const fresh = known ? l.filter((t) => !known.has(t.id)) : [];
      list = l;
      known = new Set(l.map((t) => t.id));
      render();
      updateTitle();
      if (fresh.length) {
        toast(`${fresh[0].senderName} sent ${fresh[0].files.length === 1 ? 'a file' : `${fresh[0].files.length} files`}`);
        setFolded(true);
        // Let the QR card finish folding, then bring the newest file into view.
        setTimeout(() => {
          const el = incoming.querySelector(`[data-id="${fresh[0].id}"]`) || incomingTitle;
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 380);
      } else if (!l.length && fold.classList.contains('folded')) {
        setFolded(false, false); // everything collected: show the QR again for the next sender
      } else if (!fold.classList.contains('folded') && l.length && !fold.dataset.autofolded) {
        fold.dataset.autofolded = '1'; setFolded(true); // reopened an inbox that already has files in it
      }
    }, (err) => console.warn(err));
    cleanup = () => { clearInterval(timer); unwatch(); };
  }

  await start();
  return () => { dead = true; cleanup(); };
}
