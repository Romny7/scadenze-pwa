import { add, getAll, remove, type Entry } from './db';
import { drawCalendar } from './calendar';
import { lookup } from './products';
import { pushConfigured } from './config';
import { currentSub, enablePush, pushSupported, sendTest, syncAlerts } from './push';

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
  syncPush(items).catch((e) => log(`SYNC: ${e}`));
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

// ---- notifiche push ----
// Un avviso al giorno alle 09:00 locali, con i prodotti raggruppati per "scade oggi / domani / tra N giorni".
async function buildAlerts(items: Entry[]) {
  if (!items.length) return [];
  const { alerts } = await call({ type: 'alerts', items });
  const byDate = new Map<string, { at: number; lines: Map<number, string[]> }>();
  for (const a of alerts) {
    const at = new Date(a.y, a.m - 1, a.d, 9, 0, 0).getTime();
    if (at <= Date.now()) continue;
    const key = `${a.y}-${a.m}-${a.d}`;
    const g = byDate.get(key) ?? { at, lines: new Map<number, string[]>() };
    g.lines.set(a.before, [...(g.lines.get(a.before) ?? []), items[a.idx].name]);
    byDate.set(key, g);
  }
  const label = (n: number) => (n === 0 ? 'Scade oggi' : n === 1 ? 'Scade domani' : `Scade tra ${n} giorni`);
  return [...byDate.values()].map((g) => ({
    at: g.at, title: 'Scadenze',
    body: [...g.lines].sort((x, y) => x[0] - y[0]).map(([n, names]) => `${label(n)}: ${names.join(', ')}`).join(' · '),
  }));
}
async function syncPush(items: Entry[], extra: { at: number; title: string; body: string }[] = []) {
  if (!pushSupported() || !pushConfigured()) return;
  const sub = await currentSub();
  if (sub) await syncAlerts(sub, [...(await buildAlerts(items)), ...extra]);
}
if (!pushSupported()) badge('push', 'Push: aggiungi l\'app alla Home', false);
else if (!pushConfigured()) badge('push', 'Push: server non configurato', false);
else currentSub().then((s) => badge('push', s ? 'Push: attive' : 'Push: spente', !!s));

$('pushBtn').onclick = async () => {
  try {
    if (!pushSupported()) throw new Error('Su iPhone serve l\'app aggiunta alla schermata Home');
    if (!pushConfigured()) throw new Error('Compila src/config.ts');
    await enablePush();
    badge('push', 'Push: attive', true);
    await syncPush(await getAll());
  } catch (e) { badge('push', 'Push: errore', false); log(`PUSH: ${e}`); $('out').textContent = `Push: ${e}`; }
};
$('pushTest').onclick = async () => {
  try { const sub = await currentSub(); if (!sub) throw new Error('Attiva prima le notifiche'); await sendTest(sub); log('prova inviata'); }
  catch (e) { log(`PUSH: ${e}`); $('out').textContent = `Push: ${e}`; }
};
$('pushSched').onclick = async () => {
  try {
    await syncPush(await getAll(), [{ at: Date.now() + 5 * 60_000, title: 'Test programmato', body: 'Se leggi questo, il cron funziona.' }]);
    log('test programmato tra 5 minuti');
  } catch (e) { log(`PUSH: ${e}`); }
};

// ---- scanner codice a barre ----
let scanAbort: AbortController | undefined;
const closeScan = () => { scanAbort?.abort(); $('scan').hidden = true; document.body.classList.remove('scanning'); };
$('scanCancel').onclick = closeScan;
$('scanBtn').onclick = async () => {
  f.err.textContent = '';
  $('scan').hidden = false;
  document.body.classList.add('scanning');
  $('scanMsg').textContent = 'Allinea il codice al rettangolo';
  scanAbort = new AbortController();
  try {
    const { scan } = await import('./scanner');
    const digits = await scan($('video') as HTMLVideoElement, $('guide'), scanAbort.signal);
    closeScan();
    const r = await call({ type: 'gtin', gtin: digits });
    if (!r.gtin14) { f.err.textContent = `Codice non valido: ${digits}`; return; }
    f.gtin.value = digits;
    try {
      const name = await lookup(digits, r.gtin14);
      if (!name) f.err.textContent = 'Prodotto non trovato: scrivi il nome a mano.';
      else if (!f.name.value.trim()) f.name.value = name;
    } catch (e) { log(`OFF: ${e}`); f.err.textContent = 'Ricerca prodotto non riuscita: scrivi il nome a mano.'; }
  } catch (e) {
    if ((e as DOMException).name === 'AbortError') return;
    $('scanMsg').textContent = `Fotocamera non disponibile: ${e}`;
    log(`SCAN: ${e}`);
  }
};
setTimeout(() => { import('./scanner').catch(() => {}); }, 3000);   // pre-carica il .wasm in cache

// ---- lettura data di scadenza (OCR) ----
$('ocrBtn').onclick = async () => {
  f.err.textContent = '';
  $('scan').hidden = false;
  document.body.classList.add('scanning');
  $('scanMsg').textContent = 'Carico il motore di lettura…';
  scanAbort = new AbortController();
  try {
    const { scanDate } = await import('./ocr');
    const r = await scanDate($('video') as HTMLVideoElement, $('guide'), scanAbort.signal,
      async (text) => (await call({ type: 'parse', text })).candidates ?? [], (m) => { $('scanMsg').textContent = m; });
    closeScan();
    f.date.value = `${r.year}-${pad(r.month)}-${pad(r.day)}`;
    f.month.checked = r.precision === 1;
    f.err.textContent = `Letto ${r.precision === 1 ? pad(r.month) + '/' + r.year : pad(r.day) + '/' + pad(r.month) + '/' + r.year}: controlla e salva.`;
  } catch (e) {
    if ((e as DOMException).name === 'AbortError') return;
    $('scanMsg').textContent = `Lettura non riuscita: ${e}`;
    log(`OCR: ${e}`);
  }
};
setTimeout(() => { import('./ocr').then((m) => m.warm()).catch(() => {}); }, 8000);   // pre-carica i file OCR in cache

// ---- tab Lista / Calendario ----
const show = (cal: boolean) => { $('vList').hidden = cal; $('vCal').hidden = !cal; };
$('tList').onclick = () => show(false);
$('tCal').onclick = () => show(true);

render().catch((e) => log(`DB: ${e}`));
