import { createWorker, PSM, type Worker } from 'tesseract.js';
import { RECIPES, pad, toGray } from './ocrPre';

export type DateHit = { year: number; month: number; day: number; precision: number; kind: number; confidence: number };
type Cand = DateHit & { begin: number; end: number };

// File serviti dal nostro sito (copiati in public/ocr da scripts/copy-ocr.mjs): niente CDN, funziona offline.
const base = new URL('ocr/', document.baseURI).href;
const ASSETS = ['worker.min.js', 'tesseract-core-simd-lstm.wasm.js', 'lang/ita.traineddata.gz'].map((f) => base + f);

let workerP: Promise<Worker> | undefined;
const getWorker = () => (workerP ??= (async () => {
  const w = await createWorker('ita', 1, {
    workerPath: base + 'worker.min.js',
    corePath: base + 'tesseract-core-simd-lstm.wasm.js',
    langPath: base + 'lang',
    gzip: true,
    workerBlobURL: false,
  });
  await w.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });   // testo sparso: etichette con date isolate
  return w;
})());
export function dispose() { const p = workerP; workerP = undefined; p?.then((w) => w.terminate()).catch(() => {}); }
document.addEventListener('visibilitychange', () => { if (document.hidden) dispose(); });  // libera memoria in background

// Scarica i file in cache (via service worker) senza avviare il motore.
export const warm = () => Promise.all(ASSETS.map((u) => fetch(u).catch(() => {})));

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const key = (c: Cand) => `${c.year}-${c.month}-${c.day}-${c.precision}`;

// Legge la data dentro il rettangolo `guide`. Prova a turno le ricette di pretrattamento e accetta
// una data solo se compare in 2 tentativi diversi fra gli ultimi 6 (consenso).
export async function scanDate(
  video: HTMLVideoElement, guide: HTMLElement, signal: AbortSignal,
  parse: (text: string) => Promise<Cand[]>, onStatus: (s: string) => void,
): Promise<DateHit> {
  onStatus('Carico il motore di lettura…');
  const worker = await getWorker();
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false,
  });
  try {
    try { await stream.getVideoTracks()[0].applyConstraints({ advanced: [{ focusMode: 'continuous' } as any] }); } catch { /* best effort */ }
    video.muted = true; video.srcObject = stream; await video.play();
    const src = document.createElement('canvas'), dst = document.createElement('canvas');
    const sctx = src.getContext('2d', { willReadFrequently: true })!, dctx = dst.getContext('2d')!;
    const recent: (Cand | null)[] = [];
    let n = 0;
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

      const recipe = RECIPES[n++ % RECIPES.length];
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

      const { data } = await worker.recognize(dst);
      const hit = (await parse(data.text)).find((c) => c.confidence >= 0.5) ?? null;
      recent.push(hit); if (recent.length > 6) recent.shift();
      if (hit) {
        const same = recent.filter((c) => c && key(c) === key(hit)) as Cand[];
        if (same.length >= 2) {
          const kind = [...same].reverse().find((c) => c.kind !== 0)?.kind ?? 0;   // preferisce il tipo dedotto dall'etichetta
          return { year: hit.year, month: hit.month, day: hit.day, precision: hit.precision, kind, confidence: hit.confidence };
        }
        onStatus(`Rilevata ${String(hit.day).padStart(2, '0')}/${String(hit.month).padStart(2, '0')}/${hit.year}: tieni fermo…`);
      } else onStatus(`Inquadra la data dentro il rettangolo (tentativo ${n})`);
    }
    throw new DOMException('Annullato', 'AbortError');
  } finally {
    stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  }
}
