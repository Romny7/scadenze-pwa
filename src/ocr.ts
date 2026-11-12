import { createWorker, PSM, type Worker } from 'tesseract.js';
import { RECIPES, pad, toGray } from './ocrPre';
import { normalizeOcr } from './ocrText';

export type DateHit = { year: number; month: number; day: number; precision: number; confidence: number };
type Cand = DateHit & { begin: number; end: number };

// File serviti dal nostro sito (copiati in public/ocr da scripts/copy-ocr.mjs): niente CDN, funziona offline.
const base = new URL('ocr/', document.baseURI).href;
const ASSETS = ['worker.min.js', 'tesseract-core-simd-lstm.wasm.js', 'lang/ita.traineddata.gz'].map((f) => base + f);

let workerP: Promise<Worker> | undefined;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
const getWorker = () => (workerP ??= (async () => {
  const w = await createWorker('ita', 1, {
    workerPath: base + 'worker.min.js',
    corePath: base + 'tesseract-core-simd-lstm.wasm.js',
    langPath: base + 'lang',
    gzip: true,
    workerBlobURL: false,
  });
  await w.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });   // testo sparso: date isolate fra altro testo
  return w;
})().catch((e) => { workerP = undefined; throw e; }));   // una creazione fallita non resta in cache
export function dispose() {
  clearTimeout(idleTimer);
  const p = workerP; workerP = undefined;
  p?.then((w) => w.terminate()).catch(() => {});
}
document.addEventListener('visibilitychange', () => { if (document.hidden) dispose(); });   // libera memoria in background

// Scarica i file in cache (via service worker) senza avviare il motore.
export const warm = () => Promise.all(ASSETS.map((u) => fetch(u).catch(() => {})));

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const dayKey = (c: Cand) => `${c.year}-${c.month}-${c.day}`;

// Consenso: un giorno completo vale con 2 letture uguali; mese/anno ne richiede 3 e aspetta se in
// giro c'e' un giorno compatibile (evita di fermarsi su "MM/AAAA" quando la data e' "GG/MM/AAAA").
function decide(recent: (Cand | null)[]): Cand | null {
  const hits = recent.filter((c): c is Cand => !!c);
  const days = new Map<string, Cand[]>(), months = new Map<string, Cand[]>();
  for (const c of hits) {
    const m = c.precision === 0 ? days : months;
    const k = c.precision === 0 ? dayKey(c) : `${c.year}-${c.month}`;
    m.set(k, [...(m.get(k) ?? []), c]);
  }
  const bestDay = [...days.values()].filter((v) => v.length >= 2).sort((a, b) => b.length - a.length)[0];
  if (bestDay) return bestDay[0];
  for (const v of months.values()) {
    if (v.length < 3) continue;
    const dayPending = [...days.values()].some((d) => d[0].year === v[0].year && d[0].month === v[0].month);
    if (!dayPending) return v[0];
  }
  return null;
}

// Legge la data dentro il rettangolo `guide`. Alterna le ricette di pretrattamento (e ripete piu' spesso
// quella che ha gia' dato un risultato), poi decide per consenso.
export async function scanDate(
  video: HTMLVideoElement, guide: HTMLElement, signal: AbortSignal,
  parse: (text: string) => Promise<Cand[]>, onStatus: (s: string) => void,
): Promise<DateHit> {
  clearTimeout(idleTimer);
  onStatus('Carico il motore di lettura…');
  let worker = await getWorker();
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false,
  });
  try {
    try { await stream.getVideoTracks()[0].applyConstraints({ advanced: [{ focusMode: 'continuous' } as any] }); } catch { /* best effort */ }
    video.muted = true; video.srcObject = stream; await video.play();
    const src = document.createElement('canvas'), dst = document.createElement('canvas');
    const sctx = src.getContext('2d', { willReadFrequently: true })!, dctx = dst.getContext('2d')!;
    const recent: (Cand | null)[] = [];
    let n = 0, cycle = 0, lucky = -1;

    // Se il motore si blocca (memoria, app in background) lo ricrea e riprova una volta.
    let curPsm = '11';   // modalita' impostata alla creazione del motore (testo sparso)
    const recognize = async (img: HTMLCanvasElement, psm: string) => {
      const run = async (w: Worker) => {
        if (curPsm !== psm) { await w.setParameters({ tessedit_pageseg_mode: psm as any }); curPsm = psm; }
        return Promise.race([
          w.recognize(img),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout OCR')), 8000)),
        ]);
      };
      try { return await run(worker); }
      catch (e) {
        if (signal.aborted) throw e;
        onStatus('Riavvio il motore di lettura…');
        dispose(); worker = await getWorker(); curPsm = '11';
        return await run(worker);
      }
    };

    onStatus('Inquadra la data dentro il rettangolo');
    while (!signal.aborted) {
      await nextFrame();
      const vw = video.videoWidth, vh = video.videoHeight;
      if (video.readyState < 2 || !vw) continue;
      const v = video.getBoundingClientRect(), g = guide.getBoundingClientRect();
      const scale = Math.max(v.width / vw, v.height / vh);   // object-fit: cover
      const offX = (vw - v.width / scale) / 2, offY = (vh - v.height / scale) / 2;
      const sx = Math.max(0, offX + (g.left - v.left) / scale), sy = Math.max(0, offY + (g.top - v.top) / scale);
      const sw = Math.min(vw - sx, g.width / scale), sh = Math.min(vh - sy, g.height / scale);
      if (sw < 16 || sh < 16) continue;

      const ri = lucky >= 0 && n % 2 === 1 ? lucky : cycle++ % RECIPES.length;
      n++;
      const recipe = RECIPES[ri];
      const w = recipe.width, h = Math.round((sh * w) / sw);
      src.width = w; src.height = h;
      sctx.imageSmoothingQuality = 'high';
      sctx.drawImage(video, sx, sy, sw, sh, 0, 0, w, h);
      const gray = recipe.prep(toGray(sctx.getImageData(0, 0, w, h).data, w * h), w, h);
      const p = pad(gray, w, h, 24);
      dst.width = p.w; dst.height = p.h;
      const img = dctx.createImageData(p.w, p.h);
      for (let i = 0; i < p.g.length; i++) { const v8 = p.g[i]; img.data[4 * i] = img.data[4 * i + 1] = img.data[4 * i + 2] = v8; img.data[4 * i + 3] = 255; }
      dctx.putImageData(img, 0, 0);

      const { data } = await recognize(dst, recipe.psm ?? '11');
      if (signal.aborted) break;
      const hit = (await parse(normalizeOcr(data.text, new Date().getFullYear()))).find((c) => c.confidence >= 0.5) ?? null;
      if (hit) lucky = ri;
      recent.push(hit); if (recent.length > 8) recent.shift();
      const done = decide(recent);
      if (done) return { year: done.year, month: done.month, day: done.day, precision: done.precision, confidence: done.confidence };
      onStatus(hit
        ? `Rilevata ${hit.precision === 1 ? '' : String(hit.day).padStart(2, '0') + '/'}${String(hit.month).padStart(2, '0')}/${hit.year}: tieni fermo…`
        : `Inquadra la data dentro il rettangolo (tentativo ${n})`);
    }
    throw new DOMException('Annullato', 'AbortError');
  } finally {
    stream.getTracks().forEach((t) => t.stop());
    if (video.srcObject === stream) video.srcObject = null;   // non spegnere l'anteprima di una scansione piu' recente
    clearTimeout(idleTimer);
    idleTimer = setTimeout(dispose, 20_000);                   // libera il motore dopo 20 s di inattivita'
  }
}
