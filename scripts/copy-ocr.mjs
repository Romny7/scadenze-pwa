// Copia in public/ocr i file di Tesseract (worker, core WASM, modello italiano) cosi' l'app li serve da se'.
import { cpSync, mkdirSync } from 'node:fs';
mkdirSync('public/ocr/lang', { recursive: true });
cpSync('node_modules/tesseract.js/dist/worker.min.js', 'public/ocr/worker.min.js');
cpSync('node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'public/ocr/tesseract-core-simd-lstm.wasm.js');
cpSync('node_modules/@tesseract.js-data/ita/4.0.0_best_int/ita.traineddata.gz', 'public/ocr/lang/ita.traineddata.gz');
console.log('OCR assets copiati in public/ocr');
