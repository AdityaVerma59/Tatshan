// Preview and print for files held on the shop's device.
// PDFs, images and plain text preview and print right in the browser.
// Other formats (Word, Excel, PowerPoint…) can't be rendered by a browser without
// extra libraries, so they're handed to the device's own app instead.
import { h, icon, toast } from './ui.js';
import { extOf, fmtSize, saveBlob } from './util.js';

const IMAGE_EXT = /^(png|jpe?g|gif|webp|bmp|svg|avif)$/;
const TEXT_EXT = /^(txt|csv|tsv|log|md|json|xml|html?)$/;

export function kindOf(file) {
  const ext = extOf(file.name);
  const type = (file.type || '').toLowerCase();
  if (type === 'application/pdf' || ext === 'pdf') return 'pdf';
  if ((type.startsWith('image/') && !/tiff|heic|heif/.test(type)) || IMAGE_EXT.test(ext)) return 'image';
  if (type.startsWith('text/') || TEXT_EXT.test(ext)) return 'text';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  return 'other';
}
export const canPrintInBrowser = (file) => ['pdf', 'image', 'text'].includes(kindOf(file));

// ───────────── preview ─────────────
export function openPreview(entry, start = 0) {
  let idx = start;
  let url = null;
  const files = entry.files;

  const title = h('div', { class: 'pv-title' });
  const counter = h('span', { class: 'pv-count' });
  const body = h('div', { class: 'pv-body' });
  const prev = h('button', { class: 'icon-btn', 'aria-label': 'Previous file', onClick: () => go(-1) }, icon('prev'));
  const next = h('button', { class: 'icon-btn', 'aria-label': 'Next file', onClick: () => go(1) }, icon('next'));
  const closeBtn = h('button', { class: 'icon-btn', 'aria-label': 'Close preview', onClick: close }, icon('x'));
  const overlay = h('div', { class: 'viewer', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'File preview' },
    h('div', { class: 'pv-bar' },
      h('div', { class: 'pv-name' }, title, counter),
      files.length > 1 && h('div', { class: 'pv-nav' }, prev, next),
      closeBtn),
    body);

  function onKey(e) {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowLeft') go(-1);
    else if (e.key === 'ArrowRight') go(1);
  }
  function close() {
    document.removeEventListener('keydown', onKey);
    if (url) URL.revokeObjectURL(url);
    overlay.remove();
    document.documentElement.classList.remove('lock');
  }
  function go(d) {
    if (files.length < 2) return;
    idx = (idx + d + files.length) % files.length;
    show();
  }
  async function show() {
    const f = files[idx];
    if (url) URL.revokeObjectURL(url);
    url = URL.createObjectURL(f.blob);
    title.textContent = f.name;
    counter.textContent = files.length > 1 ? `${idx + 1} of ${files.length}` : fmtSize(f.size);
    body.replaceChildren();
    const k = kindOf(f);
    if (k === 'pdf') {
      body.append(
        h('iframe', { class: 'pv-frame', src: url, title: f.name }),
        h('a', { class: 'pv-fallback', href: url, target: '_blank', rel: 'noopener' }, 'Not showing? Open in a new tab'));
    } else if (k === 'image') {
      body.append(h('img', { class: 'pv-img', src: url, alt: f.name }));
    } else if (k === 'text') {
      const text = await f.blob.slice(0, 300000).text();
      body.append(h('pre', { class: 'pv-text' }, text + (f.blob.size > 300000 ? '\n\n… (preview shortened)' : '')));
    } else if (k === 'video') {
      body.append(h('video', { class: 'pv-media', src: url, controls: true }));
    } else if (k === 'audio') {
      body.append(h('audio', { class: 'pv-media', src: url, controls: true }));
    } else {
      body.append(h('div', { class: 'pv-other' },
        h('div', { class: 'pv-other-icon' }, icon('file', 36)),
        h('p', { class: 'pv-other-name' }, f.name),
        h('p', { class: 'muted' }, `${(extOf(f.name) || 'This').toUpperCase()} files can't be previewed in the browser.`),
        h('p', { class: 'muted' }, 'Tap Print on the message to open it in your own app (Word, Excel, PowerPoint…), then print from there.'),
        h('button', { class: 'btn secondary', onClick: () => saveBlob(f.blob, f.name) }, icon('download', 18), h('span', {}, 'Save a copy'))));
    }
  }

  document.body.append(overlay);
  document.documentElement.classList.add('lock');
  document.addEventListener('keydown', onKey);
  show();
}

// ───────────── print ─────────────
const FRAME_CSS = '@page{margin:10mm}html,body{margin:0;background:#fff}img{display:block;max-width:100%;max-height:275mm;margin:0 auto;object-fit:contain}pre{white-space:pre-wrap;word-break:break-word;font:12px/1.5 ui-monospace,Menlo,Consolas,monospace;color:#000}';

function printOne(file, kind) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file.blob);
    const frame = document.createElement('iframe');
    frame.className = 'print-frame';
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      setTimeout(() => { frame.remove(); URL.revokeObjectURL(url); }, 1500);
      resolve();
    };
    const fire = () => {
      try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch { window.open(url, '_blank', 'noopener'); }
      finish();
    };

    if (kind === 'pdf') {
      let fired = false;
      const once = () => { if (!fired) { fired = true; fire(); } };
      frame.onload = () => setTimeout(once, 800); // give the PDF viewer a moment to draw
      setTimeout(once, 5000); // some browsers never report load for PDFs; don't block the queue
      frame.src = url;
    } else if (kind === 'image') {
      frame.srcdoc = `<!doctype html><meta charset="utf-8"><style>${FRAME_CSS}</style><img src="${url}">`;
      frame.onload = () => {
        const im = frame.contentDocument.querySelector('img');
        if (im.complete) fire(); else { im.onload = fire; im.onerror = finish; }
      };
    } else {
      frame.srcdoc = `<!doctype html><meta charset="utf-8"><style>${FRAME_CSS}</style><pre id="t"></pre>`;
      frame.onload = async () => {
        frame.contentDocument.getElementById('t').textContent = await file.blob.text();
        fire();
      };
    }
    document.body.append(frame);
    setTimeout(finish, 120000); // never hang forever
  });
}

export async function printEntry(entry) {
  for (const f of entry.files) {
    const kind = kindOf(f);
    if (kind === 'pdf' || kind === 'image' || kind === 'text') {
      await printOne(f, kind);
    } else {
      saveBlob(f.blob, f.name);
      toast(`“${f.name}” can't be printed from the browser. It was saved, so open it in its app and print from there.`);
    }
  }
}
