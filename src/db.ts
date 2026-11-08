export type Entry = {
  id?: number; name: string; gtin: string;       // gtin: GTIN-14 normalizzato, '' se manuale
  y: number; m: number; d: number;               // data effettiva (fine mese se precision=1)
  precision: 0 | 1; kind: 0 | 1 | 2;             // kind: 0 ignoto, 1 entro, 2 TMC
};
const open = () => new Promise<IDBDatabase>((res, rej) => {
  const r = indexedDB.open('scadenze', 1);
  r.onupgradeneeded = () => { r.result.createObjectStore('entries', { keyPath: 'id', autoIncrement: true }); };
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
let dbp: Promise<IDBDatabase> | undefined;
const store = async (mode: IDBTransactionMode) => (await (dbp ??= open())).transaction('entries', mode).objectStore('entries');
const wrap = <T>(r: IDBRequest<T>) => new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
export const getAll = async (): Promise<Entry[]> => wrap((await store('readonly')).getAll());
export const add = async (e: Entry) => wrap((await store('readwrite')).add(e));
export const remove = async (id: number) => wrap((await store('readwrite')).delete(id));
