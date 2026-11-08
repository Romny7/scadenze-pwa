import createExpiryCore from './wasm/expiry_core.js';

const corePromise = createExpiryCore();
corePromise.then(() => postMessage({ type: 'ready' }), (e: unknown) => postMessage({ type: 'error', error: String(e) }));

self.onmessage = async (e: MessageEvent<{ id: number; text: string; today: [number, number, number] }>) => {
  const { id, text, today } = e.data;
  try {
    const core = await corePromise;
    const t0 = performance.now();
    const vec = core.parseDates(text, today[0], today[1], today[2]);
    const candidates = [];
    for (let i = 0; i < vec.size(); i++) {
      const c = vec.get(i);
      candidates.push({ ...c, kind: c.kind.value });
    }
    vec.delete(); // la memoria WASM non e' gestita dal GC
    postMessage({ id, ok: true, candidates, ms: performance.now() - t0 });
  } catch (err) {
    postMessage({ id, ok: false, error: String(err) });
  }
};
