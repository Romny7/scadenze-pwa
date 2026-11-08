import { add, getAll, remove } from './db';
import { drawCalendar } from './calendar';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const logEl = $('log');
const log = (m: string) => { logEl.textContent += `${new Date().toLocaleTimeString()} ${m}\n`; };
addEventListener('error', (e) => log(`ERRORE: ${e.message}`));
addEventListener('unhandledrejection', (e) => log(`PROMISE: ${String(e.reason)}`));

const badges = new Map<string, HTMLSpanElement>();
function badge(key: string, text: string, ok?: boolean) {
  let el = badges.get(key);
  if (!el) { el = document.createElement('span'); badges.set(key, el); $('badges').append(el); }
  el.textContent = text;
  el.className = ok === undefined ? '' : ok ? 'ok' : 'ko';
}
const standalone = (navigator as any).standalone === true || matchMedia('(display-mode: standalone)').matches;
badge('mode', standalone ? 'Home: sì' : 'Home: no', standalone);
badge('wasm', 'WASM: carico…');
badge('sw', 'SW: …');
navigator.storage?.persist?.().then((p) => badge('store', p ? 'Dati: protetti' : 'Dati: non protetti', p)).catch(() => {});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').then(() => navigator.serviceWorker.ready)
    .then(() => badge('sw', 'SW: attivo', true)).catch((e) => { badge('sw', 'SW: errore', false); log(`SW: ${e}`); });
}

// ---- RPC verso il worker ----
const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
const pending = new Map<number, (m: any) => void>();
let seq = 0;
worker.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'ready') { badge('wasm', 'WASM: pronto', true); return; }
  if (m.type === 'error') { badge('wasm', 'WASM: errore', false); log(`WASM: ${m.error}`); return; }
  pending.get(m.id)?.(m); pending.delete(m.id);
};
const today = () => { const n = new Date(); return [n.getFullYear(), n.getMonth() + 1, n.getDate()]; };
const call = (msg: object) => new Promise<any>((res) => { const id = ++seq; pending.set(id, res); worker.postMessage({ ...msg, id, today: today() }); });

// ---- lista ----
const STATUS = ['Ok', 'In scadenza', 'Scade oggi', 'Oltre il TMC', 'Scaduto'];
const KIND = ['', 'entro', 'TMC'];
const pad = (n: number) => String(n).padStart(2, '0');

async function render() {
  const items = (await getAll()).sort((a, b) => a.y - b.y || a.m - b.m || a.d - b.d);
  const list = $('list');
  list.replaceChildren();
  const results = items.length ? (await call({ type: 'status', items })).results : [];
  drawCalendar($('cal'), items, results);
  if (!items.length) { list.textContent = 'Nessun prodotto.'; return; }
  items.forEach((it, i) => {
    const r = results[i];
    const li = document.createElement('li');
    const info = document.createElement('div');
    const title = document.createElement('b');
    title.textContent = it.name;                       // textContent: niente injection
    const when = it.precision === 1 ? `${pad(it.m)}/${it.y} (fine mese)` : `${pad(it.d)}/${pad(it.m)}/${it.y}`;
    const sub = document.createElement('div');
    sub.textContent = `${when}${it.kind ? ' · ' + KIND[it.kind] : ''} · ${r.days >= 0 ? `tra ${r.days} g` : `${-r.days} g fa`}`;
    info.append(title, sub);
    const tag = document.createElement('span');
    tag.textContent = STATUS[r.status];
    tag.className = 's' + r.status;
    const del = document.createElement('button');
    del.textContent = '✕';
    del.onclick = async () => { await remove(it.id!); render(); };
    li.append(info, tag, del);
    list.append(li);
  });
}

// ---- form ----
const f = {
  name: $<HTMLInputElement>('name'), gtin: $<HTMLInputElement>('gtin'), date: $<HTMLInputElement>('date'),
  month: $<HTMLInputElement>('monthOnly'), kind: $<HTMLSelectElement>('kind'), err: $('err'),
};
$('f').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  f.err.textContent = '';
  let gtin = '';
  if (f.gtin.value.trim()) {
    gtin = (await call({ type: 'gtin', gtin: f.gtin.value.trim() })).gtin14;
    if (!gtin) { f.err.textContent = 'Codice a barre non valido (controlla le cifre).'; return; }
  }
  const [y, m, d0] = f.date.value.split('-').map(Number);
  const monthOnly = f.month.checked;
  const d = monthOnly ? new Date(y, m, 0).getDate() : d0;   // ultimo giorno del mese
  await add({ name: f.name.value.trim(), gtin, y, m, d, precision: monthOnly ? 1 : 0, kind: Number(f.kind.value) as 0 | 1 | 2 });
  (ev.target as HTMLFormElement).reset();
  render();
});

// ---- strumento OCR/parser (debug) che precompila il form ----
$('go').addEventListener('click', async () => {
  const m = await call({ type: 'parse', text: ($('text') as HTMLTextAreaElement).value });
  $('out').textContent = m.ok ? (m.candidates.length ? JSON.stringify(m.candidates, null, 2) : '(nessuna data trovata)') + `\n[${m.ms.toFixed(1)} ms]` : `Errore: ${m.error}`;
  const c = m.ok && m.candidates[0];
  if (c) {
    f.date.value = `${c.year}-${pad(c.month)}-${pad(c.day)}`;
    f.month.checked = c.precision === 1;
    f.kind.value = String(c.kind);
  }
});

// ---- tab Lista / Calendario ----
const show = (cal: boolean) => { $('vList').hidden = cal; $('vCal').hidden = !cal; };
$('tList').onclick = () => show(false);
$('tCal').onclick = () => show(true);

render().catch((e) => log(`DB: ${e}`));
