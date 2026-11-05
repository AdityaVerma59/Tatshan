// Sign-in / sign-up panel for print-shop owners (and the admin). Google or email + password.
// Normal senders never see this: they stay anonymous and are never asked to sign in.
import { h, button } from './ui.js';

const MESSAGES = {
  'auth/popup-closed-by-user': 'Sign-in was closed before it finished.',
  'auth/cancelled-popup-request': 'Sign-in was closed before it finished.',
  'auth/popup-blocked': 'Your browser blocked the sign-in window. Allow pop-ups for this site and try again.',
  'auth/operation-not-allowed': 'This sign-in method isn’t switched on yet. In the Firebase console, open Authentication → Sign-in method and enable it.',
  'auth/unauthorized-domain': 'This website’s address isn’t authorised. Add it under Authentication → Settings → Authorized domains.',
  'auth/invalid-email': 'That email address doesn’t look right.',
  'auth/missing-password': 'Enter your password.',
  'auth/weak-password': 'Choose a password with at least 6 characters.',
  'auth/email-already-in-use': 'There’s already an account with that email. Use “I have an account” instead.',
  'auth/invalid-credential': 'Email or password is wrong.',
  'auth/wrong-password': 'Email or password is wrong.',
  'auth/user-not-found': 'Email or password is wrong.',
  'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
  'auth/network-request-failed': 'No internet connection. Check your network and try again.',
};
export const authMessage = (e) => MESSAGES[e && e.code] || 'Couldn’t sign in. Please try again.';

// Renders the panel into a returned element. `onDone(account)` runs after a successful sign-in.
export function authPanel(backend, { onDone, intro } = {}) {
  const email = h('input', { class: 'input', id: 'auth-email', type: 'email', autocomplete: 'email', placeholder: 'you@example.com', 'aria-label': 'Email' });
  const pass = h('input', { class: 'input', id: 'auth-pass', type: 'password', autocomplete: 'current-password', placeholder: 'Password (6+ characters)', 'aria-label': 'Password' });
  const error = h('p', { class: 'error', role: 'alert' });
  const note = h('p', { class: 'hint' });
  let mode = 'in'; // 'in' = I have an account, 'up' = create one

  const run = async (fn, btn) => {
    error.textContent = ''; note.textContent = '';
    const all = root.querySelectorAll('button'); all.forEach((b) => { b.disabled = true; });
    try { onDone && onDone(await fn()); } catch (e) {
      console.error(e);
      error.textContent = authMessage(e);
      all.forEach((b) => { b.disabled = false; });
    }
  };

  const googleBtn = button('Continue with Google', { kind: 'secondary', cls: 'block', onClick: () => run(() => backend.accounts.google()) });
  const submit = button('Sign in', { kind: 'primary', cls: 'block', onClick: () => {
    const e = email.value.trim(); const p = pass.value;
    if (!e || !p) { error.textContent = 'Enter your email and password.'; return; }
    run(() => (mode === 'up' ? backend.accounts.signUpEmail(e, p) : backend.accounts.signInEmail(e, p)));
  } });
  const toggle = h('button', { class: 'linkish', type: 'button', onClick: () => setMode(mode === 'in' ? 'up' : 'in') });
  const forgot = h('button', { class: 'linkish', type: 'button', onClick: async () => {
    error.textContent = ''; note.textContent = '';
    if (!email.value.trim()) { error.textContent = 'Type your email above first.'; return; }
    try { await backend.accounts.resetPassword(email.value.trim()); note.textContent = 'If that email has an account, a reset link is on its way.'; } catch (e) { error.textContent = authMessage(e); }
  } }, 'Forgot password?');

  function setMode(m) {
    mode = m;
    submit.querySelector('span').textContent = m === 'up' ? 'Create account' : 'Sign in';
    toggle.textContent = m === 'up' ? 'I have an account' : 'New here? Create an account';
    pass.autocomplete = m === 'up' ? 'new-password' : 'current-password';
    forgot.hidden = m === 'up';
    error.textContent = '';
  }

  const root = h('div', { class: 'stack auth' },
    intro && h('p', { class: 'muted' }, intro),
    googleBtn,
    h('div', { class: 'or' }, h('span', {}, 'or use email')),
    h('label', { class: 'label', for: 'auth-email' }, 'Email'), email,
    h('label', { class: 'label', for: 'auth-pass' }, 'Password'), pass,
    submit, error, note,
    h('div', { class: 'auth-links' }, toggle, forgot));
  pass.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit.click(); });
  setMode('in');
  return root;
}
