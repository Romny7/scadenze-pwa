import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';

// Il .wasm viene servito dal nostro stesso sito (e quindi messo in cache dal service worker),
// non dalla CDN di default: cosi' lo scanner funziona anche offline.
prepareZXingModule({
  overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) },
  fireImmediately: true,
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Apre la fotocamera posteriore e ritorna le cifre del primo barcode letto 2 volte di fila.
// Lancia DOMException 'AbortError' se annullato; altri errori = permesso negato / nessuna camera.
export async function scan(video: HTMLVideoElement, signal: AbortSignal): Promise<string> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
    audio: false,
  });
  try {
    video.muted = true;
    video.srcObject = stream;
    await video.play();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    let last = '';
    while (!signal.aborted) {
      await sleep(120);
      if (video.readyState < 2 || !video.videoWidth) continue;
      const w = 640;
      const h = Math.round((video.videoHeight * w) / video.videoWidth);
      canvas.width = w;
      canvas.height = h;
      ctx.drawImage(video, 0, 0, w, h);
      const res = await readBarcodes(ctx.getImageData(0, 0, w, h), {
        formats: ['EAN-13', 'EAN-8', 'UPC-A', 'UPC-E'],
        tryHarder: true,
        maxNumberOfSymbols: 1,
      });
      const text = res[0]?.text ?? '';
      if (text && text === last) return text;   // consenso su 2 frame consecutivi
      last = text;
    }
    throw new DOMException('Annullato', 'AbortError');
  } finally {
    stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  }
}
