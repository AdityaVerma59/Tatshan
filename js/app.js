// Tatshan: tiny hash-router + boot. Everything else lives in js/views/.
import { isConfigured } from './config.js';
import { syncClock } from './util.js';
import { h, button } from './ui.js';
import home from './views/home.js';
import { enterCode, compose } from './views/send.js';
import receive from './views/receive.js';
import shop from './views/shop.js';
import admin from './views/admin.js';

const root = document.getElementById('app');
const routes = [
  [/^$/, home],
  [/^send$/, enterCode],
  [/^send\/([A-Za-z0-9]+)$/, compose],
  [/^receive$/, receive],
  [/^shop$/, shop],
  [/^admin$/, admin],
];

let backend = null;
let cleanup = null;
let token = 0;

const go = (hash) => { location.hash = hash; };

async function route() {
  const mine = ++token;
  if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
  const path = (location.hash || '#/').replace(/^#\/?/, '').replace(/\/$/, '');
  const hit = routes.find(([re]) => re.test(path)) || routes[0];
  const params = (path.match(hit[0]) || []).slice(1);
  root.classList.remove('view-in');
  void root.offsetWidth; // restart the fade-in
  root.classList.add('view-in');
  window.scrollTo(0, 0);
  try {
    const next = await hit[1](root, { backend, params, go, rerender: route });
    if (mine !== token) { if (next) next(); } else cleanup = next || null;
  } catch (e) {
    console.error(e);
    fatal(e);
  }
}

function explain(e) {
  const code = (e && e.code) || '';
  if (/operation-not-allowed|admin-restricted/.test(code)) return 'Anonymous sign-in is switched off. In the Firebase console go to Authentication → Sign-in method and enable “Anonymous”.';
  if (/api-key|invalid-api-key/.test(code)) return 'The Firebase API key in js/config.js isn’t valid. Copy the config again from Project settings.';
  if (/network/.test(code)) return 'No internet connection. Check your network and reload.';
  return 'Something went wrong while connecting. Check js/config.js and your internet connection, then reload.';
}
function fatal(e) {
  root.replaceChildren(h('div', { class: 'card notice' },
    h('h1', { class: 'page-title small' }, 'Tatshan can’t connect'),
    h('p', { class: 'muted' }, explain(e)),
    h('p', { class: 'hint' }, e && e.message ? `Details: ${e.message}` : ''),
    button('Reload', { kind: 'primary', onClick: () => location.reload() })));
}

async function boot() {
  try {
    backend = isConfigured()
      ? await (await import('./backend-firebase.js')).createFirebaseBackend()
      : await (await import('./backend-demo.js')).createDemoBackend();
  } catch (e) {
    console.error(e);
    fatal(e);
    return;
  }
  if (backend.mode === 'demo') document.getElementById('demo-banner').hidden = false;
  else syncClock();
  window.addEventListener('hashchange', route);
  route();
  // Count this visit for the admin's traffic numbers (once per person per day). Never for the admin page itself.
  if (backend.mode === 'firebase' && !/^#\/admin/.test(location.hash)) backend.stats.logVisit();
}

boot();
