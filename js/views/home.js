import { h, icon, pigeonImg } from '../ui.js';
import { SETTINGS } from '../config.js';

function actionCard(href, ic, title, text) {
  return h('a', { class: 'card action-card', href },
    h('span', { class: 'bubble' }, icon(ic, 22)),
    h('span', { class: 'action-text' },
      h('span', { class: 'action-title' }, title),
      h('span', { class: 'muted' }, text)),
    h('span', { class: 'action-go' }, icon('arrow', 20)));
}

export default function home(root) {
  document.title = 'Tatshan · तत्क्षण — instant file transfer';
  root.replaceChildren(
    h('section', { class: 'hero' },
      pigeonImg('hero-pigeon'),
      h('div', { class: 'hero-copy' },
        h('p', { class: 'eyebrow', lang: 'hi' }, 'तुरंत भेजें, तुरंत पाएँ'),
        h('h1', {}, 'Send files to anyone, instantly.'),
        h('p', { class: 'lead' }, 'No phone numbers, no links, no sign-up. Scan a QR code and the file is already there.'))),
    h('div', { class: 'cards' },
      actionCard('#/send', 'send', 'Send files', 'Scan a QR code or type a short code.'),
      actionCard('#/receive', 'receive', 'Receive files', 'Show your QR code and get files instantly.')),
    h('a', { class: 'shop-banner', href: '#/shop' },
      h('span', { class: 'bubble soft' }, icon('print', 22)),
      h('span', { class: 'action-text' },
        h('span', { class: 'action-title' }, 'Run a print shop?'),
        h('span', { class: 'muted' }, 'Stop collecting files on WhatsApp. Put one QR on your counter and see every file arrive, with name and time.')),
      h('span', { class: 'action-go' }, icon('arrow', 20))),
    h('ul', { class: 'trust' },
      h('li', {}, icon('shield', 18), h('span', {}, 'Deleted the moment it’s downloaded')),
      h('li', {}, icon('clock', 18), h('span', {}, `Gone after ${SETTINGS.EXPIRY_HOURS} hours if nobody picks it up`)),
      h('li', {}, icon('user', 18), h('span', {}, 'No account, no phone number'))));
  return () => {};
}
