// Admin dashboard (#/admin). Not linked from anywhere. Only an account with a document at
// admins/<uid> can open it, and the security rules enforce that, not this page.
import { h, icon, button, spinner, toast, openSheet } from '../ui.js';
import { authPanel } from '../auth-ui.js';
import { createAdminApi } from '../admin-api.js';
import { SETTINGS } from '../config.js';
import { dayKey, addDays, fmtSize, relative, dateStr, timeStr, extLabel } from '../util.js';

const NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  kids.forEach((k) => el.append(k));
  return el;
};
const num = (n) => Number(n || 0).toLocaleString('en-IN');
const shortDay = (k) => new Date(`${k}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });

// ───────────── tiny SVG bar chart (no library) ─────────────
function barChart(days, series, { format = num, height = 190 } = {}) {
  const W = 640; const padL = 44; const padR = 8; const padT = 10; const padB = 26;
  const plotW = W - padL - padR; const plotH = height - padT - padB;
  const totals = days.map((d) => series.reduce((n, s) => n + (d[s.key] || 0), 0));
  const max = Math.max(1, ...totals);
  const nice = (() => { const p = 10 ** Math.floor(Math.log10(max)); const m = max / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; })();
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${height}`, class: 'chart', role: 'img' });
  for (let i = 0; i <= 4; i++) {
    const y = padT + plotH - (plotH * i) / 4;
    svg.append(svgEl('line', { x1: padL, x2: W - padR, y1: y, y2: y, class: 'grid' }));
    const t = svgEl('text', { x: padL - 6, y: y + 4, class: 'axis', 'text-anchor': 'end' });
    t.textContent = format((nice * i) / 4);
    svg.append(t);
  }
  const slot = plotW / days.length; const bw = Math.max(2, Math.min(28, slot * 0.7));
  days.forEach((d, i) => {
    const x = padL + slot * i + (slot - bw) / 2;
    let y = padT + plotH;
    const g = svgEl('g', {});
    series.forEach((s, si) => {
      const v = d[s.key] || 0; const bh = (v / nice) * plotH;
      if (!bh) return;
      y -= bh;
      g.append(svgEl('rect', { x, y, width: bw, height: bh, rx: 2, class: `bar s${si}` }));
    });
    const tip = svgEl('title', {});
    tip.textContent = `${shortDay(d.day)} · ${series.map((s) => `${s.label}: ${format(d[s.key] || 0)}`).join(' · ')}`;
    g.append(svgEl('rect', { x: padL + slot * i, y: padT, width: slot, height: plotH, class: 'hit' }), tip);
    svg.append(g);
    const every = Math.ceil(days.length / 8);
    if (i % every === 0 || i === days.length - 1) {
      const t = svgEl('text', { x: x + bw / 2, y: height - 8, class: 'axis', 'text-anchor': 'middle' });
      t.textContent = shortDay(d.day);
      svg.append(t);
    }
  });
  return svg;
}

function legend(series) {
  return h('div', { class: 'legend' }, series.map((s, i) => h('span', { class: 'lg' }, h('i', { class: `sw s${i}` }), s.label)));
}
const chartCard = (title, sub, days, series, opts) => h('section', { class: 'card chart-card' },
  h('div', { class: 'chart-head' }, h('div', {}, h('h3', { class: 'card-title' }, title), sub && h('p', { class: 'hint tight' }, sub)), series.length > 1 && legend(series)),
  h('div', { class: 'chart-scroll' }, barChart(days, series, opts)));

const kpi = (label, value, sub) => h('div', { class: 'kpi' }, h('span', { class: 'kpi-label' }, label), h('strong', { class: 'kpi-value' }, value), sub && h('span', { class: 'kpi-sub' }, sub));

// ───────────── the page ─────────────
export default async function admin(root, ctx) {
  const { backend } = ctx;
  document.title = 'Admin · Tatshan';
  root.replaceChildren(h('div', { class: 'center pad' }, spinner()));

  if (backend.mode !== 'firebase') {
    root.replaceChildren(h('a', { class: 'back', href: '#/' }, icon('back', 18), 'Back'),
      h('div', { class: 'card notice' }, h('h1', { class: 'page-title small' }, 'Admin needs Firebase'), h('p', { class: 'muted' }, 'Add your Firebase keys in js/config.js. The dashboard reads real usage data, which demo mode doesn’t have.')));
    return () => {};
  }

  const api = createAdminApi(backend.raw);
  const acct = backend.accounts.current();

  if (acct.anonymous) {
    root.replaceChildren(h('a', { class: 'back', href: '#/' }, icon('back', 18), 'Back'),
      h('h1', { class: 'page-title' }, 'Admin'),
      h('div', { class: 'card' }, authPanel(backend, { intro: 'Sign in with the admin Google account.', onDone: () => ctx.rerender() })));
    return () => {};
  }
  if (!(await api.isAdmin())) {
    root.replaceChildren(h('a', { class: 'back', href: '#/' }, icon('back', 18), 'Back'),
      h('div', { class: 'card notice' },
        h('h1', { class: 'page-title small' }, 'Not an admin'),
        h('p', { class: 'muted' }, `${acct.email || 'This account'} doesn’t have admin access.`),
        h('p', { class: 'hint' }, 'Admin access is limited to the Google account listed in firestore.rules. Sign in with Google using that email, and make sure the rules are deployed (see the README).'),
        h('div', { class: 'row-gap' },
          button('Check again', { kind: 'primary', onClick: ctx.rerender }),
          button('Sign out', { kind: 'ghost', ic: 'logout', onClick: async () => { await backend.accounts.signOut(); ctx.rerender(); } }))));
    return () => {};
  }

  // ---- layout ----
  let dead = false;
  let from = addDays(dayKey(), -13); let to = dayKey();
  const body = h('div', { class: 'admin-body' });
  const fromIn = h('input', { class: 'input slim', type: 'date', value: from, 'aria-label': 'From' });
  const toIn = h('input', { class: 'input slim', type: 'date', value: to, max: dayKey(), 'aria-label': 'To' });
  const presets = h('div', { class: 'presets' }, [7, 14, 30, 90].map((n) => h('button', { class: 'pill', type: 'button', 'data-n': n, onClick: () => { from = addDays(dayKey(), -(n - 1)); to = dayKey(); fromIn.value = from; toIn.value = to; load(); } }, `${n} days`)));
  const apply = () => { if (fromIn.value && toIn.value && fromIn.value <= toIn.value) { from = fromIn.value; to = toIn.value; load(); } else toast('Pick a valid date range.', { kind: 'error' }); };
  fromIn.addEventListener('change', apply); toIn.addEventListener('change', apply);

  root.replaceChildren(
    h('div', { class: 'shop-head' },
      h('div', {}, h('p', { class: 'eyebrow' }, 'Admin'), h('h1', { class: 'page-title tight' }, 'Tatshan dashboard'), h('span', { class: 'muted small' }, acct.email)),
      h('div', { class: 'row-gap' },
        button('Refresh', { ic: 'clock', onClick: () => load() }),
        button('Sign out', { kind: 'ghost', ic: 'logout', onClick: async () => { await backend.accounts.signOut(); location.hash = '#/'; location.reload(); } }))),
    h('div', { class: 'card range' }, presets, h('div', { class: 'range-dates' }, fromIn, h('span', { class: 'muted' }, 'to'), toIn)),
    body);

  // ---- data ----
  async function load() {
    const mine = load.n = (load.n || 0) + 1;
    [...presets.children].forEach((b) => b.classList.toggle('on', addDays(dayKey(), -(Number(b.dataset.n) - 1)) === from && to === dayKey()));
    const bar = h('div', { class: 'bar' }, h('div', { class: 'bar-fill' }));
    body.replaceChildren(h('div', { class: 'card center' }, h('p', { class: 'muted' }, 'Loading numbers…'), bar));
    let days; let stored; let shops; let stale;
    try {
      days = await api.loadRange(from, to, (p) => { bar.firstChild.style.width = `${Math.round(p * 100)}%`; });
      [stored, shops, stale] = await Promise.all([
        api.loadStored().catch((e) => ({ error: e })),
        api.countShops().catch(() => null),
        api.countStalePieces().catch(() => null),
      ]);
    } catch (e) {
      console.error(e);
      if (mine === load.n) body.replaceChildren(h('div', { class: 'card notice' }, h('h2', { class: 'section-title' }, 'Couldn’t load stats'), h('p', { class: 'muted' }, e.message || 'Unknown error')));
      return;
    }
    if (dead || mine !== load.n) return;
    paint(days, stored, shops, stale);
  }

  function paint(days, stored, shops, stalePieces) {
    const sum = (k) => days.reduce((n, d) => n + (d[k] || 0), 0);
    const types = {};
    days.forEach((d) => Object.entries(d.types || {}).forEach(([k, n]) => { types[k] = (types[k] || 0) + n; }));
    const typeRows = Object.entries(types).sort((a, b) => b[1] - a[1]);
    const typeMax = Math.max(1, ...typeRows.map(([, n]) => n));
    const mb = (b) => `${(b / 1048576).toFixed(b < 10485760 ? 1 : 0)}`;
    const view = days.map((d) => ({ ...d, mb: d.bytes / 1048576 }));
    const mbFmt = (v) => `${v < 10 ? v.toFixed(1) : Math.round(v)} MB`;

    const parts = [];

    parts.push(h('div', { class: 'kpis' },
      kpi('Anonymous visitors', num(sum('anon')), 'sum of daily unique'),
      kpi('Print shop visitors', num(sum('registered')), 'signed-in accounts'),
      kpi('Transfers', num(sum('transfers')), `${num(sum('toShops'))} to shops · ${num(sum('toPeople'))} person to person`),
      kpi('Files sent', num(sum('files'))),
      kpi('Data moved', `${mb(sum('bytes'))} MB`),
      kpi('Print shops', shops == null ? '–' : num(shops), 'created, all time')));

    parts.push(chartCard('Daily traffic', 'Unique visitors per day. A visitor counts once per day.', view,
      [{ key: 'anon', label: 'Anonymous' }, { key: 'registered', label: 'Print shops' }]));
    parts.push(chartCard('Transfers per day', 'Each send is one transfer, which can hold up to 10 files.', view,
      [{ key: 'toPeople', label: 'Person to person' }, { key: 'toShops', label: 'To print shops' }]));
    parts.push(chartCard('Storage used per day', 'Data uploaded that day (files are deleted once downloaded).', view,
      [{ key: 'mb', label: 'Uploaded' }], { format: mbFmt }));

    parts.push(h('section', { class: 'card' },
      h('h3', { class: 'card-title' }, 'File types sent'),
      typeRows.length
        ? h('div', { class: 'hbars' }, typeRows.map(([k, n]) => h('div', { class: 'hbar' },
          h('span', { class: 'hbar-label' }, k),
          h('span', { class: 'hbar-track' }, h('span', { class: 'hbar-fill', style: { width: `${Math.max(3, (n / typeMax) * 100)}%` } })),
          h('span', { class: 'hbar-n' }, `${num(n)} · ${Math.round((n / Math.max(1, sum('files'))) * 100)}%`))))
        : h('p', { class: 'muted' }, 'No files in this period.')));

    parts.push(storagePanel(stored, stalePieces));
    body.replaceChildren(...parts);
  }

  // ---- what's in storage now, and cleaning it out ----
  function storagePanel(stored, stalePieces) {
    if (stored.error) {
      const e = stored.error;
      const link = (String(e.message).match(/https:\/\/console\.firebase\.google\.com\S+/) || [])[0];
      return h('section', { class: 'card notice' },
        h('h3', { class: 'card-title' }, 'Stored files'),
        h('p', { class: 'muted' }, e.code === 'failed-precondition'
          ? 'Firestore needs a one-time index to list files across all inboxes.'
          : `Couldn’t list stored files: ${e.message}`),
        link && h('a', { class: 'btn primary', href: link, target: '_blank', rel: 'noopener' }, h('span', {}, 'Create the index (opens Firebase)')),
        link && h('p', { class: 'hint' }, 'It takes a minute or two to build. Then press Refresh.'));
    }
    const cutoff = Date.now() - SETTINGS.STALE_HOURS * 3600 * 1000;
    const stale = stored.filter((t) => t.createdAt < cutoff);
    const totalBytes = stored.reduce((n, t) => n + t.bytes, 0);
    const staleBytes = stale.reduce((n, t) => n + t.bytes, 0);
    const accounted = stale.reduce((n, t) => n + t.pieces, 0);
    const orphans = stalePieces == null ? null : Math.max(0, stalePieces - accounted);
    const picked = new Set();

    const del = h('button', { class: 'btn danger', type: 'button', disabled: true, onClick: () => confirmDelete(stale.filter((t) => picked.has(t.id))) }, icon('trash', 18), h('span', {}, 'Delete selected'));
    const delAll = h('button', { class: 'btn ghost', type: 'button', disabled: !stale.length, onClick: () => confirmDelete(stale) }, icon('trash', 18), h('span', {}, `Delete all ${stale.length}`));
    const sync = () => { del.disabled = !picked.size; del.querySelector('span').textContent = picked.size ? `Delete selected (${picked.size})` : 'Delete selected'; };

    const allBox = h('input', { type: 'checkbox', 'aria-label': 'Select all', onChange: (e) => { picked.clear(); if (e.target.checked) stale.forEach((t) => picked.add(t.id)); table.querySelectorAll('tbody input').forEach((c) => { c.checked = e.target.checked; }); sync(); } });
    const table = h('div', { class: 'tbl-scroll' }, h('table', { class: 'tbl' },
      h('thead', {}, h('tr', {}, h('th', {}, allBox), h('th', {}, 'Sender'), h('th', {}, 'Files'), h('th', {}, 'Size'), h('th', {}, 'Waiting'), h('th', {}, 'Inbox'))),
      h('tbody', {}, stale.map((t) => h('tr', {},
        h('td', {}, h('input', { type: 'checkbox', 'aria-label': `Select ${t.senderName}`, onChange: (e) => { if (e.target.checked) picked.add(t.id); else picked.delete(t.id); sync(); } })),
        h('td', {}, t.senderName),
        h('td', { class: 'files-cell' }, t.files.map((f) => h('div', {}, h('span', { class: 'chip' }, extLabel(f.name)), ' ', f.name))),
        h('td', { class: 'nowrap' }, fmtSize(t.bytes)),
        h('td', { class: 'nowrap', title: `${dateStr(t.createdAt)} ${timeStr(t.createdAt)}` }, relative(t.createdAt).replace(' ago', '')),
        h('td', { class: 'mono' }, t.boxId))))));

    async function confirmDelete(items) {
      if (!items.length) return;
      const bytes = items.reduce((n, t) => n + t.bytes, 0);
      const sheet = openSheet({
        title: `Delete ${items.length} transfer${items.length > 1 ? 's' : ''}?`,
        body: h('div', { class: 'actions-sheet' },
          h('p', { class: 'muted' }, `This permanently removes ${fmtSize(bytes)} of files that nobody downloaded, straight from Firestore. Their senders can’t get them back.`),
          h('div', { class: 'action-pair' },
            button('Cancel', { onClick: () => sheet.close() }),
            button('Delete', { kind: 'danger', ic: 'trash', onClick: async () => {
              sheet.close();
              let ok = 0;
              for (const t of items) {
                try { await api.removeStored(t); ok++; } catch (e) { console.error(e); }
              }
              toast(ok === items.length ? `Deleted ${ok}. Freed ${fmtSize(bytes)}.` : `Deleted ${ok} of ${items.length}. Some failed, try again.`, { kind: ok === items.length ? '' : 'error' });
              load();
            } }))),
      });
    }

    const orphanBtn = orphans ? h('button', { class: 'btn secondary', type: 'button', onClick: async (ev) => {
      const b = ev.currentTarget; b.disabled = true;
      let removed = 0; let checked = 0;
      try {
        for (let i = 0; i < 40; i++) {
          const r = await api.purgeOrphans();
          removed += r.removed; checked += r.checked;
          b.querySelector('span').textContent = `Cleaning… removed ${removed}`;
          if (!r.more || r.removed === 0) break; // nothing removable at the front of the queue: stop
        }
        toast(`Checked ${checked} pieces, removed ${removed} leftovers.`);
      } catch (e) { console.error(e); toast('Couldn’t finish cleaning. Try again.', { kind: 'error' }); }
      load();
    } }, icon('trash', 18), h('span', {}, 'Clean up leftovers')) : null;

    return h('section', { class: 'card' },
      h('h3', { class: 'card-title' }, 'Stored files'),
      h('div', { class: 'kpis small' },
        kpi('In storage now', fmtSize(totalBytes), `${num(stored.length)} transfer${stored.length === 1 ? '' : 's'}`),
        kpi(`Waiting over ${SETTINGS.STALE_HOURS} h`, num(stale.length), fmtSize(staleBytes)),
        kpi('Leftover pieces', orphans == null ? '–' : num(orphans), 'uploads that never finished')),
      h('div', { class: 'row-gap' }, del, delAll, orphanBtn),
      stale.length ? table : h('p', { class: 'muted ok-line' }, icon('check', 18), `Nothing has been waiting more than ${SETTINGS.STALE_HOURS} hours.`),
      stored.length >= 1000 && h('p', { class: 'hint' }, 'Showing the oldest 1,000 transfers.'));
  }

  await load();
  return () => { dead = true; };
}
