import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';

// Il .wasm viene servito dal nostro sito (cache del service worker): funziona anche offline.
prepareZXingModule({
  overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) },
  fireImmediately: true,
});

const MAX_W = 1100; // larghezza massima del ritaglio decodificato (px)
const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

// Legge il barcode dentro il rettangolo `guide`, ritagliato dal video a risoluzione piena.
// La geometria e' ricalcolata a ogni frame: ruotare il telefono non rompe il mapping.
// Ritorna le cifre del primo barcode valido; lancia 'AbortError' se annullato.
export async function scan(video: HTMLVideoElement, guide: HTMLElement, signal: AbortSignal): Promise<string> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    audio: false,
  });
  try {
    // Autofocus continuo, se il browser lo consente (best effort, ignorato altrimenti).
    try { await stream.getVideoTracks()[0].applyConstraints({ advanced: [{ focusMode: 'continuous' } as any] }); } catch { /* non supportato */ }
    video.muted = true;
    video.srcObject = stream;
    await video.play();

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    let last = '';
    while (!signal.aborted) {
      await nextFrame();
      const vw = video.videoWidth, vh = video.videoHeight;
      if (video.readyState < 2 || !vw) continue;

      // Rettangolo guida (coordinate schermo) -> coordinate sorgente, con object-fit: cover.
      const v = video.getBoundingClientRect(), g = guide.getBoundingClientRect();
      const scale = Math.max(v.width / vw, v.height / vh);
      const offX = (vw - v.width / scale) / 2, offY = (vh - v.height / scale) / 2;
      const sx = Math.max(0, offX + (g.left - v.left) / scale);
      const sy = Math.max(0, offY + (g.top - v.top) / scale);
      const sw = Math.min(vw - sx, g.width / scale), sh = Math.min(vh - sy, g.height / scale);
      if (sw < 16 || sh < 16) continue;

      const k = Math.min(1, MAX_W / sw);
      canvas.width = Math.round(sw * k);
      canvas.height = Math.round(sh * k);
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      const res = await readBarcodes(ctx.getImageData(0, 0, canvas.width, canvas.height), {
        formats: ['EAN-13', 'EAN-8', 'UPC-A', 'UPC-E'],
        tryHarder: true,
        tryRotate: true,     // codici verticali (es. bottiglie)
        tryInvert: false,    // i codici alimentari non sono quasi mai invertiti: dimezza il tempo
        maxNumberOfSymbols: 1,
      });
      const text = res[0]?.text ?? '';
      if (!text) { last = ''; continue; }
      // EAN-13/UPC-A hanno checksum robusto: 1 lettura basta. I formati corti ne chiedono 2.
      if (text.length >= 12 || text === last) return text;
      last = text;
    }
    throw new DOMException('Annullato', 'AbortError');
  } finally {
    stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  }
}
