const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const logEl = $('log');
const log = (m: string) => { logEl.textContent += `${new Date().toLocaleTimeString()} ${m}\n`; };
window.addEventListener('error', (e) => log(`ERRORE: ${e.message}`));
window.addEventListener('unhandledrejection', (e) => log(`PROMISE: ${String(e.reason)}`));

const badges = new Map<string, HTMLSpanElement>();
function badge(key: string, text: string, ok?: boolean) {
  let el = badges.get(key);
  if (!el) { el = document.createElement('span'); badges.set(key, el); $('badges').append(el); }
  el.textContent = text;
  el.className = ok === undefined ? '' : ok ? 'ok' : 'ko';
}
const standalone = (navigator as any).standalone === true || matchMedia('(display-mode: standalone)').matches;
badge('mode', standalone ? 'Home: sì' : 'Home: no', standalone);
badge('net', navigator.onLine ? 'online' : 'offline', navigator.onLine);
addEventListener('online', () => badge('net', 'online', true));
addEventListener('offline', () => badge('net', 'offline', false));
badge('wasm', 'WASM: carico…');
badge('sw', 'SW: …');

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js')
    .then(() => navigator.serviceWorker.ready).then(() => badge('sw', 'SW: attivo', true))
    .catch((e) => { badge('sw', 'SW: errore', false); log(`SW: ${e}`); });
} else badge('sw', 'SW: non supportato', false);

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
let seq = 0;
worker.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'ready') { badge('wasm', 'WASM: pronto', true); log('core WASM caricato'); return; }
  if (m.type === 'error') { badge('wasm', 'WASM: errore', false); log(`WASM: ${m.error}`); return; }
  $('out').textContent = m.ok
    ? (m.candidates.length ? JSON.stringify(m.candidates, null, 2) : '(nessuna data trovata)') + `\n[${m.ms.toFixed(1)} ms]`
    : `Errore: ${m.error}`;
};
$('go').addEventListener('click', () => {
  const n = new Date();
  worker.postMessage({ id: ++seq, text: ($('text') as HTMLTextAreaElement).value, today: [n.getFullYear(), n.getMonth() + 1, n.getDate()] });
});
log(`UA: ${navigator.userAgent}`);
