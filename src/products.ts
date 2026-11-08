import { getProduct, putProduct } from './db';

// Nome prodotto da GTIN: prima la cache locale (funziona offline), poi Open Food Facts.
// Ritorna null se non trovato o se si e' offline senza cache. Puo' lanciare su errori di rete.
export async function lookup(digits: string, gtin14: string): Promise<string | null> {
  const hit = await getProduct(gtin14);
  if (hit) return hit.name;
  if (!navigator.onLine) return null;
  const code = digits.length === 12 ? '0' + digits : digits;   // UPC-A e' un EAN-13 con 0 iniziale
  const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=product_name,brands`);
  if (!r.ok) return null;
  const j = await r.json();
  if (j.status !== 1) return null;
  const brand = String(j.product?.brands ?? '').split(',')[0].trim();
  const name = [brand, String(j.product?.product_name ?? '').trim()].filter(Boolean).join(' ');
  if (!name) return null;
  await putProduct({ gtin: gtin14, name, ts: Date.now() });
  return name;
}
