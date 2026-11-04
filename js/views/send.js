import { h, icon, button, pigeonImg, openSheet, toast } from '../ui.js';
import { SETTINGS } from '../config.js';
import { normalizeCode, isValidCode, codeFromScan, fmtSize, extLabel } from '../util.js';

const MAX_BYTES = SETTINGS.MAX_FILE_MB * 1024 * 1024;

// ───────────── step 1: find who you're sending to ─────────────
export function enterCode(root, { go }) {
  document.title = 'Send files · Tatshan';
  const input = h('input', {
    class: 'input code-input', type: 'text', inputmode: 'text', autocomplete: 'off', autocapitalize: 'characters',
    spellcheck: 'false', maxlength: '9', placeholder: 'e.g. 7KQ 3XM', 'aria-label': 'Receiver code', id: 'code',
  });
  const error = h('p', { class: 'error', role: 'alert' });

  const submit = () => {
    const code = normalizeCode(input.value);
    if (!isValidCode(code)) { error.textContent = 'That doesn’t look right. Codes are 6 to 8 letters and numbers.'; input.focus(); return; }
    go(`#/send/${code}`);
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  input.addEventListener('input', () => { error.textContent = ''; });

  const canScan = 'BarcodeDetector' in window && navigator.mediaDevices && navigator.mediaDevices.getUserMedia;

  root.replaceChildren(
    h('a', { class: 'back', href: '#/' }, icon('back', 18), 'Back'),
    h('h1', { class: 'page-title' }, 'Send files'),
    h('p', { class: 'lead small' }, 'Who are you sending to?'),
    h('div', { class: 'card stack' },
      canScan && button('Scan their QR code', { kind: 'primary', ic: 'camera', cls: 'block', onClick: () => scanner(go) }),
      canScan && h('div', { class: 'or' }, h('span', {}, 'or')),
      h('label', { class: 'label', for: 'code' }, 'Type the code shown on their screen'),
      h('div', { class: 'row-gap' }, input, button('Continue', { kind: canScan ? 'secondary' : 'primary', onClick: submit })),
      error,
      !canScan && h('p', { class: 'hint' }, 'Tip: open your phone’s camera app and point it at their QR code. It brings you straight here.')),
    h('p', { class: 'hint center' }, 'Your files go only to the person who owns that code.'));
  setTimeout(() => input.focus(), 50);
  return () => {};
}

function scanner(go) {
  const video = h('video', { class: 'scan-video', playsinline: true, muted: true, autoplay: true });
  const msg = h('p', { class: 'hint center' }, 'Point your camera at the QR code.');
  let stream; let alive = true;
  const sheet = openSheet({
    title: 'Scan QR code',
    body: h('div', { class: 'scan' }, h('div', { class: 'scan-frame' }, video, h('span', { class: 'scan-corners' })), msg),
    onClose: () => { alive = false; if (stream) stream.getTracks().forEach((t) => t.stop()); },
  });
  (async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      video.srcObject = stream;
      await video.play();
      const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      const tick = async () => {
        if (!alive) return;
        try {
          const found = await detector.detect(video);
          for (const f of found) {
            const code = codeFromScan(f.rawValue);
            if (code) { sheet.close(); go(`#/send/${code}`); return; }
          }
        } catch { /* frame not ready */ }
        setTimeout(tick, 200);
      };
      tick();
    } catch {
      msg.textContent = 'Camera isn’t available. You can type the code instead.';
    }
  })();
}

// ───────────── step 2: pick files and send ─────────────
export async function compose(root, { backend, params, go }) {
  const boxId = normalizeCode(params[0]);
  document.title = 'Send files · Tatshan';
  root.replaceChildren(h('div', { class: 'center pad' }, h('span', { class: 'spinner' })));

  let box;
  try { box = await backend.getBox(boxId); } catch { box = null; }
  if (!box) {
    root.replaceChildren(
      h('a', { class: 'back', href: '#/send' }, icon('back', 18), 'Back'),
      h('div', { class: 'card notice' },
        h('h1', { class: 'page-title small' }, 'We couldn’t find that code'),
        h('p', { class: 'muted' }, 'It may have been typed wrong, or the receiver’s inbox has expired. Ask them to show a fresh QR code.'),
        button('Try another code', { kind: 'primary', onClick: () => go('#/send') })));
    return () => {};
  }

  const receiverName = box.kind === 'shop' ? box.name : 'a Tatshan inbox';
  let files = [];
  let unwatch = null;
  let sending = false;

  const nameInput = h('input', { class: 'input', id: 'sender-name', type: 'text', maxlength: '40', autocomplete: 'name', placeholder: 'e.g. Aditi Sharma' });
  try { nameInput.value = localStorage.getItem('tatshan.name') || ''; } catch { /* private mode */ }

  const picker = h('input', { type: 'file', multiple: true, hidden: true });
  const list = h('ul', { class: 'file-list' });
  const summary = h('p', { class: 'hint' });
  const error = h('p', { class: 'error', role: 'alert' });
  const sendBtn = button('Send', { kind: 'primary', ic: 'send', cls: 'block', disabled: true, onClick: () => doSend() });
  const drop = h('label', { class: 'drop' },
    h('span', { class: 'bubble' }, icon('plus', 22)),
    h('span', { class: 'drop-title' }, 'Choose files'),
    h('span', { class: 'muted' }, `or drop them here · up to ${SETTINGS.MAX_FILES_PER_SEND} files, ${SETTINGS.MAX_FILE_MB} MB each`),
    picker);

  const card = h('div', { class: 'card stack' });
  const body = h('div', {});
  root.replaceChildren(
    h('a', { class: 'back', href: '#/send' }, icon('back', 18), 'Back'),
    h('h1', { class: 'page-title' }, 'Send files'),
    h('p', { class: 'to-line' }, h('span', { class: 'bubble xs' }, icon(box.kind === 'shop' ? 'store' : 'user', 16)), 'Sending to ', h('strong', {}, receiverName)),
    body);

  function refresh() {
    list.replaceChildren(...files.map((f, i) => h('li', { class: 'file-item' },
      h('span', { class: 'chip' }, extLabel(f.name)),
      h('span', { class: 'file-name' }, f.name),
      h('span', { class: 'muted nowrap' }, fmtSize(f.size)),
      h('button', { class: 'icon-btn small', 'aria-label': `Remove ${f.name}`, onClick: () => { files.splice(i, 1); refresh(); } }, icon('x', 16)))));
    const total = files.reduce((n, f) => n + f.size, 0);
    summary.textContent = files.length ? `${files.length} file${files.length > 1 ? 's' : ''} · ${fmtSize(total)}` : '';
    sendBtn.disabled = !files.length || !nameInput.value.trim() || sending;
  }

  function addFiles(incoming) {
    error.textContent = '';
    const problems = [];
    for (const f of incoming) {
      if (files.length >= SETTINGS.MAX_FILES_PER_SEND) { problems.push(`Only ${SETTINGS.MAX_FILES_PER_SEND} files at a time.`); break; }
      if (f.size === 0) { problems.push(`“${f.name}” is empty.`); continue; }
      if (f.size > MAX_BYTES) { problems.push(`“${f.name}” is over ${SETTINGS.MAX_FILE_MB} MB.`); continue; }
      files.push(f);
    }
    error.textContent = [...new Set(problems)].join(' ');
    refresh();
  }

  picker.addEventListener('change', () => { addFiles([...picker.files]); picker.value = ''; });
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => addFiles([...e.dataTransfer.files]));
  nameInput.addEventListener('input', refresh);

  function showForm() {
    sending = false;
    files = [];
    card.replaceChildren(
      h('label', { class: 'label', for: 'sender-name' }, 'Your name'),
      nameInput,
      h('p', { class: 'hint' }, box.kind === 'shop' ? 'The shop sees this next to your files.' : 'The receiver sees this next to your files.'),
      drop, list, summary, error, sendBtn,
      box.kind === 'shop' && h('p', { class: 'hint' }, 'Tip: PDFs and images print exactly as you see them. Word and PowerPoint files open in the shop’s own apps.'));
    body.replaceChildren(card);
    refresh();
  }

  async function doSend() {
    if (sending) return;
    const name = nameInput.value.trim();
    if (!name || !files.length) return;
    sending = true;
    try { localStorage.setItem('tatshan.name', name); } catch { /* ignore */ }
    const bar = h('div', { class: 'bar-fill' });
    const pct = h('span', {}, '0%');
    card.replaceChildren(
      h('div', { class: 'progress-block' },
        h('p', { class: 'progress-title' }, 'Sending…'),
        h('div', { class: 'bar' }, bar),
        h('p', { class: 'muted' }, pct, ` · ${files.length} file${files.length > 1 ? 's' : ''}`)));
    try {
      const tid = await backend.send({
        boxId, senderName: name, files,
        onProgress: (p) => { const v = Math.round(p * 100); bar.style.width = `${v}%`; pct.textContent = `${v}%`; },
      });
      showSent(tid, files.length);
    } catch (e) {
      console.error(e);
      sending = false;
      showForm();
      error.textContent = 'Couldn’t send. Check your connection and try again.';
    }
  }

  function showSent(tid, count) {
    const pigeon = pigeonImg('sent-pigeon');
    const title = h('h2', { class: 'sent-title' }, 'On its way…');
    const text = h('p', { class: 'muted' }, `Waiting for ${receiverName === 'a Tatshan inbox' ? 'the receiver' : receiverName} to pick up your ${count === 1 ? 'file' : `${count} files`}.`);
    const note = h('p', { class: 'hint' }, `If it isn’t picked up, it disappears on its own after ${SETTINGS.EXPIRY_HOURS} hours.`);
    const again = button('Send more files', { kind: 'secondary', onClick: () => { if (unwatch) unwatch(); showForm(); } });
    const done = h('div', { class: 'sent-actions' });
    card.replaceChildren(h('div', { class: 'sent center' }, pigeon, title, text, note, done));
    if (unwatch) unwatch();
    unwatch = backend.watchDelivery(boxId, tid, () => {
      pigeon.classList.add('fly-away');
      title.textContent = 'Delivered';
      title.prepend(h('span', { class: 'tick' }, icon('check', 20)));
      text.textContent = 'They have it now, and it’s already deleted from Tatshan.';
      note.remove();
      done.append(again);
      toast('Delivered');
    });
  }

  showForm();
  return () => { if (unwatch) unwatch(); };
}
