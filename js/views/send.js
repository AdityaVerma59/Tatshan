import { h, icon, button, pigeonImg, openSheet, toast, spinner } from '../ui.js';
import { openPreview } from '../print.js';
import { authPanel } from '../auth-ui.js';
import { SETTINGS } from '../config.js';
import { normalizeCode, isValidCode, codeFromScan, fmtSize, extLabel, groupCode, sendUrl } from '../util.js';
import { qrSvg } from '../qr.js';
import { svgFromString } from '../ui.js';

const MAX_BYTES = SETTINGS.MAX_FILE_MB * 1024 * 1024;

// ───────────── step 2: show QR + code entry after files are picked ─────────────
function showTarget(files, name, backend, go, root) {
  root.replaceChildren(h('div', { class: 'center pad' }, spinner()));

  const canScan = 'BarcodeDetector' in window && navigator.mediaDevices && navigator.mediaDevices.getUserMedia;

  const codeInput = h('input', {
    class: 'input code-input', type: 'text', inputmode: 'text', autocomplete: 'off',
    autocapitalize: 'characters', spellcheck: 'false', maxlength: '9',
    placeholder: 'e.g. 7KQ 3XM', 'aria-label': 'Receiver code',
  });
  const codeError = h('p', { class: 'error', role: 'alert' });

  const submitCode = () => {
    const code = normalizeCode(codeInput.value);
    if (!isValidCode(code)) { codeError.textContent = 'That doesn't look right. Codes are 6 to 8 letters and numbers.'; codeInput.focus(); return; }
    doSend(code, files, name, backend, go, root);
  };
  codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitCode(); });
  codeInput.addEventListener('input', () => { codeError.textContent = ''; });

  root.replaceChildren(
    h('a', { class: 'back', href: '#/send', onClick: (e) => { e.preventDefault(); go('#/send'); } }, icon('back', 18), 'Back'),
    h('h1', { class: 'page-title' }, 'Who are you sending to?'),
    h('p', { class: 'lead small' }, `${files.length} file${files.length > 1 ? 's' : ''} ready. Now scan or enter the receiver's code.`),
    h('div', { class: 'card stack' },
      canScan && button('Scan their QR code', { kind: 'primary', ic: 'camera', cls: 'block', onClick: () => scanner((code) => doSend(code, files, name, backend, go, root)) }),
      canScan && h('div', { class: 'or' }, h('span', {}, 'or')),
      h('label', { class: 'label' }, 'Type the code shown on their screen'),
      h('div', { class: 'row-gap' }, codeInput, button('Send now', { kind: canScan ? 'secondary' : 'primary', onClick: submitCode })),
      codeError,
      !canScan && h('p', { class: 'hint' }, 'Tip: open your phone's camera app and point it at their QR code.')),
    h('p', { class: 'hint center' }, 'Your files go only to the person who owns that code.'));

  setTimeout(() => codeInput.focus(), 50);
}

export function enterCodeView(root, ctx) {
  const { backend, go } = ctx;
  document.title = 'Send files · Tatshan';

  let files = [];
  const nameInput = h('input', { class: 'input', id: 'sender-name', type: 'text', maxlength: '40', autocomplete: 'name', placeholder: 'e.g. Aditi Sharma' });
  try { nameInput.value = localStorage.getItem('tatshan.name') || ''; } catch { /* private mode */ }

  const picker = h('input', { type: 'file', multiple: true, hidden: true });
  const fileList = h('ul', { class: 'file-list' });
  const summary = h('p', { class: 'hint' });
  const fileError = h('p', { class: 'error', role: 'alert' });
  const continueBtn = button('Continue — choose who to send to', { kind: 'primary', ic: 'arrow', cls: 'block', disabled: true,
    onClick: () => {
      const name = nameInput.value.trim();
      if (!name) { fileError.textContent = 'Enter your name first.'; nameInput.focus(); return; }
      if (!files.length) return;
      try { localStorage.setItem('tatshan.name', name); } catch { /* ignore */ }
      showTarget(files, name, backend, go, root);
    } });

  const drop = h('label', { class: 'drop' },
    h('span', { class: 'bubble' }, icon('plus', 22)),
    h('span', { class: 'drop-title' }, 'Choose files'),
    h('span', { class: 'muted' }, `or drop them here · up to ${SETTINGS.MAX_FILES_PER_SEND} files, ${SETTINGS.MAX_FILE_MB} MB each`),
    picker);

  const authSection = h('div', { class: 'auth-optional' });

  function renderAuthSection() {
    if (!backend.accounts) return;
    const current = backend.accounts.current();
    if (current && !current.anonymous) {
      authSection.replaceChildren(
        h('div', { class: 'signed-in-row' },
          h('span', { class: 'muted small' }, icon('user', 14), ` Sending as ${current.email || current.name || 'you'}`),
          h('button', { class: 'linkish small', type: 'button', onClick: async () => { await backend.accounts.signOut(); renderAuthSection(); } }, 'Sign out')));
    } else {
      const panel = h('div', { hidden: true });
      const toggleBtn = h('button', { class: 'linkish small', type: 'button', onClick: () => {
        panel.hidden = !panel.hidden;
        toggleBtn.textContent = panel.hidden ? 'Sign in (optional)' : 'Hide';
      } }, 'Sign in (optional)');
      panel.append(authPanel(backend, {
        intro: 'Signing in is optional. Your name appears next to your files either way.',
        onDone: () => renderAuthSection(),
      }));
      authSection.replaceChildren(
        h('div', { class: 'auth-optional-wrap' },
          h('p', { class: 'hint tight' }, icon('user', 14), ' ', toggleBtn),
          panel));
    }
  }
  renderAuthSection();

  function refreshFiles() {
    fileList.replaceChildren(...files.map((f, i) => h('li', { class: 'file-item' },
      h('span', { class: 'chip' }, extLabel(f.name)),
      h('span', { class: 'file-name' }, f.name),
      h('span', { class: 'muted nowrap' }, fmtSize(f.size)),
      h('button', { class: 'icon-btn small', type: 'button', title: 'Preview', onClick: () => openPreview({ files: files.map((x) => ({ name: x.name, size: x.size, type: x.type, blob: x })) }, i) }, icon('eye', 18)),
      h('button', { class: 'icon-btn small', type: 'button', 'aria-label': `Remove ${f.name}`, onClick: () => { files.splice(i, 1); refreshFiles(); } }, icon('x', 16)))));
    const total = files.reduce((n, f) => n + f.size, 0);
    summary.textContent = files.length ? `${files.length} file${files.length > 1 ? 's' : ''} · ${fmtSize(total)}` : '';
    continueBtn.disabled = !files.length || !nameInput.value.trim();
  }

  function addFiles(incoming) {
    fileError.textContent = '';
    const problems = [];
    for (const f of incoming) {
      if (files.length >= SETTINGS.MAX_FILES_PER_SEND) { problems.push(`Only ${SETTINGS.MAX_FILES_PER_SEND} files at a time.`); break; }
      if (f.size === 0) { problems.push(`"${f.name}" is empty.`); continue; }
      if (f.size > MAX_BYTES) { problems.push(`"${f.name}" is over ${SETTINGS.MAX_FILE_MB} MB.`); continue; }
      files.push(f);
    }
    fileError.textContent = [...new Set(problems)].join(' ');
    refreshFiles();
  }

  picker.addEventListener('change', () => { addFiles([...picker.files]); picker.value = ''; });
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => addFiles([...e.dataTransfer.files]));
  nameInput.addEventListener('input', refreshFiles);

  root.replaceChildren(
    h('a', { class: 'back', href: '#/' }, icon('back', 18), 'Back'),
    h('h1', { class: 'page-title' }, 'Send files'),
    h('div', { class: 'card stack' },
      h('label', { class: 'label', for: 'sender-name' }, 'Your name'),
      nameInput,
      h('p', { class: 'hint tight' }, 'The receiver sees this next to your files.'),
      drop, fileList, summary, fileError,
      continueBtn),
    authSection);

  refreshFiles();
  return () => {};
}

function scanner(onCode) {
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
            if (code) { sheet.close(); onCode(code); return; }
          }
        } catch { /* frame not ready */ }
        setTimeout(tick, 200);
      };
      tick();
    } catch {
      msg.textContent = 'Camera isn't available. You can type the code instead.';
    }
  })();
}

// ───────────── send to a known box (from code/scan OR direct URL #/send/CODE) ─────────────
async function doSend(boxId, files, senderName, backend, go, root) {
  root.replaceChildren(h('div', { class: 'center pad' }, spinner()));

  let box;
  try { box = await backend.getBox(normalizeCode(boxId)); } catch { box = null; }
  if (!box) {
    root.replaceChildren(
      h('a', { class: 'back', href: '#/send' }, icon('back', 18), 'Back'),
      h('div', { class: 'card notice' },
        h('h1', { class: 'page-title small' }, 'We couldn't find that code'),
        h('p', { class: 'muted' }, 'It may have been typed wrong, or the receiver's inbox has expired. Ask them to show a fresh QR code.'),
        button('Try another code', { kind: 'primary', onClick: () => go('#/send') })));
    return;
  }

  const receiverName = box.kind === 'shop' ? box.name : 'a Tatshan inbox';
  let unwatch = null;

  const bar = h('div', { class: 'bar-fill' });
  const pct = h('span', {}, '0%');
  const card = h('div', { class: 'card stack' });
  card.replaceChildren(
    h('div', { class: 'progress-block' },
      h('p', { class: 'progress-title' }, 'Sending…'),
      h('div', { class: 'bar' }, bar),
      h('p', { class: 'muted' }, pct, ` · ${files.length} file${files.length > 1 ? 's' : ''}`)));

  root.replaceChildren(
    h('h1', { class: 'page-title' }, 'Send files'),
    h('p', { class: 'to-line' }, h('span', { class: 'bubble xs' }, icon(box.kind === 'shop' ? 'store' : 'user', 16)), 'Sending to ', h('strong', {}, receiverName)),
    card);

  try {
    const sentFiles = files.slice();
    const tid = await backend.send({
      boxId: box.id, boxKind: box.kind, senderName: senderName, files,
      onProgress: (p) => { const v = Math.round(p * 100); bar.style.width = `${v}%`; pct.textContent = `${v}%`; },
    });
    showSent(card, tid, sentFiles, box, receiverName, backend, go, (u) => { unwatch = u; });
  } catch (e) {
    console.error(e);
    card.replaceChildren(
      h('p', { class: 'error' }, 'Couldn't send. Check your connection and try again.'),
      button('Go back', { kind: 'primary', onClick: () => go('#/send') }));
  }

  return () => { if (unwatch) unwatch(); };
}

function showSent(card, tid, sentFiles, box, receiverName, backend, go, setUnwatch) {
  const count = sentFiles.length;
  const pigeon = pigeonImg('sent-pigeon');
  const title = h('h2', { class: 'sent-title' }, 'On its way…');
  const text = h('p', { class: 'muted' }, `Waiting for ${receiverName === 'a Tatshan inbox' ? 'the receiver' : receiverName} to pick up your ${count === 1 ? 'file' : `${count} files`}.`);
  const note = h('p', { class: 'hint' }, `If it isn't picked up, it disappears on its own after ${SETTINGS.EXPIRY_HOURS} hours.`);
  const again = button('Send more files', { kind: 'secondary', onClick: () => go('#/send') });
  const done = h('div', { class: 'sent-actions' });
  const look = button(count === 1 ? 'Preview what I sent' : `Preview what I sent (${count})`, { kind: 'ghost', ic: 'eye',
    onClick: () => openPreview({ files: sentFiles.map((f) => ({ name: f.name, size: f.size, type: f.type, blob: f })) }) });
  card.replaceChildren(h('div', { class: 'sent center' }, pigeon, title, text, note, h('div', { class: 'row-gap center' }, look), done));

  const unwatch = backend.watchDelivery(box.id, tid, () => {
    pigeon.classList.add('fly-away');
    title.textContent = 'Delivered';
    title.prepend(h('span', { class: 'tick' }, icon('check', 20)));
    text.textContent = 'They have it now, and it's already deleted from Tatshan.';
    note.remove();
    done.append(again);
    toast('Delivered');
  });
  setUnwatch(unwatch);
}

// ───────────── compose: direct URL entry (#/send/CODE) ─────────────
// When someone arrives via a scanned QR (URL already has the code), show file picker
// and send directly without asking for a code again.
export async function compose(root, { backend, params, go }) {
  const boxId = normalizeCode(params[0]);
  document.title = 'Send files · Tatshan';
  root.replaceChildren(h('div', { class: 'center pad' }, spinner()));

  let box;
  try { box = await backend.getBox(boxId); } catch { box = null; }
  if (!box) {
    root.replaceChildren(
      h('a', { class: 'back', href: '#/send' }, icon('back', 18), 'Back'),
      h('div', { class: 'card notice' },
        h('h1', { class: 'page-title small' }, 'We couldn't find that code'),
        h('p', { class: 'muted' }, 'It may have been typed wrong, or the receiver's inbox has expired. Ask them to show a fresh QR code.'),
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
  const sendBtn = button('Send', { kind: 'primary', ic: 'send', cls: 'block', disabled: true, onClick: () => startSend() });
  const drop = h('label', { class: 'drop' },
    h('span', { class: 'bubble' }, icon('plus', 22)),
    h('span', { class: 'drop-title' }, 'Choose files'),
    h('span', { class: 'muted' }, `or drop them here · up to ${SETTINGS.MAX_FILES_PER_SEND} files, ${SETTINGS.MAX_FILE_MB} MB each`),
    picker);

  const card = h('div', { class: 'card stack' });
  const body = h('div', {});

  // Optional sign-in for direct URL senders too
  const authSection = h('div', { class: 'auth-optional' });
  function renderAuth() {
    if (!backend.accounts) return;
    const current = backend.accounts.current();
    if (current && !current.anonymous) {
      authSection.replaceChildren(
        h('div', { class: 'signed-in-row' },
          h('span', { class: 'muted small' }, icon('user', 14), ` Sending as ${current.email || current.name || 'you'}`),
          h('button', { class: 'linkish small', type: 'button', onClick: async () => { await backend.accounts.signOut(); renderAuth(); } }, 'Sign out')));
    } else {
      const panel = h('div', { hidden: true });
      const toggleBtn = h('button', { class: 'linkish small', type: 'button', onClick: () => {
        panel.hidden = !panel.hidden;
        toggleBtn.textContent = panel.hidden ? 'Sign in (optional)' : 'Hide';
      } }, 'Sign in (optional)');
      panel.append(authPanel(backend, { intro: 'Optional. Your name appears next to your files either way.', onDone: () => renderAuth() }));
      authSection.replaceChildren(h('div', { class: 'auth-optional-wrap' }, h('p', { class: 'hint tight' }, icon('user', 14), ' ', toggleBtn), panel));
    }
  }
  renderAuth();

  root.replaceChildren(
    h('a', { class: 'back', href: '#/send' }, icon('back', 18), 'Back'),
    h('h1', { class: 'page-title' }, 'Send files'),
    h('p', { class: 'to-line' }, h('span', { class: 'bubble xs' }, icon(box.kind === 'shop' ? 'store' : 'user', 16)), 'Sending to ', h('strong', {}, receiverName)),
    body, authSection);

  function refresh() {
    list.replaceChildren(...files.map((f, i) => h('li', { class: 'file-item' },
      h('span', { class: 'chip' }, extLabel(f.name)),
      h('span', { class: 'file-name' }, f.name),
      h('span', { class: 'muted nowrap' }, fmtSize(f.size)),
      h('button', { class: 'icon-btn small', type: 'button', title: 'Preview', onClick: () => openPreview({ files: files.map((x) => ({ name: x.name, size: x.size, type: x.type, blob: x })) }, i) }, icon('eye', 18)),
      h('button', { class: 'icon-btn small', type: 'button', 'aria-label': `Remove ${f.name}`, onClick: () => { files.splice(i, 1); refresh(); } }, icon('x', 16)))));
    const total = files.reduce((n, f) => n + f.size, 0);
    summary.textContent = files.length ? `${files.length} file${files.length > 1 ? 's' : ''} · ${fmtSize(total)}` : '';
    sendBtn.disabled = !files.length || !nameInput.value.trim() || sending;
  }

  function addFiles(incoming) {
    error.textContent = '';
    const problems = [];
    for (const f of incoming) {
      if (files.length >= SETTINGS.MAX_FILES_PER_SEND) { problems.push(`Only ${SETTINGS.MAX_FILES_PER_SEND} files at a time.`); break; }
      if (f.size === 0) { problems.push(`"${f.name}" is empty.`); continue; }
      if (f.size > MAX_BYTES) { problems.push(`"${f.name}" is over ${SETTINGS.MAX_FILE_MB} MB.`); continue; }
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
    sending = false; files = [];
    card.replaceChildren(...[
      h('label', { class: 'label', for: 'sender-name' }, 'Your name'),
      nameInput,
      h('p', { class: 'hint tight' }, box.kind === 'shop' ? 'The shop sees this next to your files.' : 'The receiver sees this next to your files.'),
      drop, list, summary, error, sendBtn,
      box.kind === 'shop' && h('p', { class: 'hint' }, 'Tip: PDFs and images print exactly as you see them. Word and PowerPoint files open in the shop\'s own apps.')
    ].filter(Boolean));
    body.replaceChildren(card);
    refresh();
  }

  async function startSend() {
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
      const sentFiles = files.slice();
      const tid = await backend.send({
        boxId, boxKind: box.kind, senderName: name, files,
        onProgress: (p) => { const v = Math.round(p * 100); bar.style.width = `${v}%`; pct.textContent = `${v}%`; },
      });
      showSent(card, tid, sentFiles, box, receiverName, backend, go, (u) => { unwatch = u; });
    } catch (e) {
      console.error(e);
      sending = false; showForm();
      error.textContent = 'Couldn't send. Check your connection and try again.';
    }
  }

  showForm();
  return () => { if (unwatch) unwatch(); };
}
