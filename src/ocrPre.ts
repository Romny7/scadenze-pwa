// Pretrattamento immagini per l'OCR delle date: funzioni pure su array di byte (nessun DOM),
// quindi testabili in Node. Le "ricette" sono state tarate su foto reali di etichette.

export const toGray = (rgba: Uint8ClampedArray, n: number): Uint8Array => {
  const g = new Uint8Array(n);
  for (let i = 0; i < n; i++) g[i] = (rgba[4 * i] * 77 + rgba[4 * i + 1] * 150 + rgba[4 * i + 2] * 29) >> 8;
  return g;
};

function integral(g: Uint8Array, w: number, h: number): Float64Array {
  const I = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) { row += g[y * w + x]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row; }
  }
  return I;
}
const boxMean = (I: Float64Array, w: number, h: number, x: number, y: number, r: number) => {
  const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1), y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1), W = w + 1;
  return (I[y1 * W + x1] - I[y0 * W + x1] - I[y1 * W + x0] + I[y0 * W + x0]) / ((x1 - x0) * (y1 - y0));
};

export function blur(g: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return g;
  const I = integral(g, w, h), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = boxMean(I, w, h, x, y, r);
  return out;
}

// Testo scuro su fondo chiaro -> nero; soglia adattiva locale (regge ombre e luce non uniforme).
export function adaptiveDark(g: Uint8Array, w: number, h: number, win: number, T: number): Uint8Array {
  const I = integral(g, w, h), out = new Uint8Array(w * h), r = win >> 1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = g[y * w + x] < boxMean(I, w, h, x, y, r) - T ? 0 : 255;
  return out;
}

// Normalizza il contrasto sui percentili 2-98.
export function stretch(g: Uint8Array): Uint8Array {
  const hist = new Uint32Array(256);
  for (const v of g) hist[v]++;
  const n = g.length;
  let lo = 0, hi = 255, acc = 0;
  for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc > n * 0.02) { lo = i; break; } }
  acc = 0;
  for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc > n * 0.02) { hi = i; break; } }
  const out = new Uint8Array(n), s = 255 / Math.max(1, hi - lo);
  for (let i = 0; i < n; i++) out[i] = Math.max(0, Math.min(255, (g[i] - lo) * s));
  return out;
}

// Appiattisce l'illuminazione e amplifica il contrasto locale: sfondo -> bianco, testo debole -> scuro.
export function flat(g: Uint8Array, w: number, h: number, win: number, gain: number): Uint8Array {
  const I = integral(g, w, h), out = new Uint8Array(w * h), r = win >> 1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = 255 + (g[y * w + x] - boxMean(I, w, h, x, y, r)) * gain;
    out[y * w + x] = v < 0 ? 0 : v > 255 ? 255 : v;
  }
  return out;
}

// Bordo bianco: Tesseract lavora meglio con i margini.
export function pad(g: Uint8Array, w: number, h: number, p: number) {
  const nw = w + 2 * p, nh = h + 2 * p, out = new Uint8Array(nw * nh).fill(255);
  for (let y = 0; y < h; y++) out.set(g.subarray(y * w, y * w + w), (y + p) * nw + p);
  return { g: out, w: nw, h: nh };
}

export type Recipe = { name: string; width: number; psm?: '6' | '11'; prep: (g: Uint8Array, w: number, h: number) => Uint8Array };

const invert = (g: Uint8Array) => g.map((v) => 255 - v);
const dotsPrep = (g: Uint8Array, w: number, h: number) => adaptiveDark(blur(g, w, h, 2), w, h, Math.max(15, (h / 6) | 0), 8);

// Ognuna copre casi diversi (verificato su foto reali: nessuna da sola le legge tutte, insieme si').
export const RECIPES: Recipe[] = [
  { name: 'flat', width: 600, prep: (g, w, h) => flat(blur(g, w, h, 1), w, h, Math.max(25, (h / 3) | 0), 6) },      // grigio sbiadito, carta stropicciata, cartone
  { name: 'gray', width: 600, prep: (g) => stretch(g) },                                                               // etichette pulite, chiaro su scuro inciso
  { name: 'dots', width: 400, prep: dotsPrep },                                                                          // stampa a punti, inkjet a righe
  { name: 'dots6', width: 400, psm: '6', prep: dotsPrep },                                                              // idem in modalita' blocco di testo (sfondi retinati, es. yogurt)
  { name: 'inv', width: 600, prep: (g) => stretch(invert(g)) },                                                          // bianco su nero (bottiglie)
];
