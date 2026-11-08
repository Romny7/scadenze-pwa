export type Entry = {
  id?: number; name: string; gtin: string;       // gtin: GTIN-14 normalizzato, '' se manuale
  y: number; m: number; d: number;               // data effettiva (fine mese se precision=1)
  precision: 0 | 1; kind: 0 | 1 | 2;             // kind: 0 ignoto, 1 entro, 2 TMC
};
export type CachedProduct = { gtin: string; name: string; ts: number };

const open = () => new Promise<IDBDatabase>((res, rej) => {
  const r = indexedDB.open('scadenze', 2);
  r.onupgradeneeded = () => {
    const db = r.result;
    if (!db.objectStoreNames.contains('entries')) db.createObjectStore('entries', { keyPath: 'id', autoIncrement: true });
    if (!db.objectStoreNames.contains('products')) db.createObjectStore('products', { keyPath: 'gtin' });
  };
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
let dbp: Promise<IDBDatabase> | undefined;
const store = async (name: string, mode: IDBTransactionMode) => (await (dbp ??= open())).transaction(name, mode).objectStore(name);
const wrap = <T>(r: IDBRequest<T>) => new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const getAll = async (): Promise<Entry[]> => wrap((await store('entries', 'readonly')).getAll());
export const add = async (e: Entry) => wrap((await store('entries', 'readwrite')).add(e));
export const remove = async (id: number) => wrap((await store('entries', 'readwrite')).delete(id));
export const getProduct = async (gtin: string): Promise<CachedProduct | undefined> => wrap((await store('products', 'readonly')).get(gtin));
export const putProduct = async (p: CachedProduct) => wrap((await store('products', 'readwrite')).put(p));
