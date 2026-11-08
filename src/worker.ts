import createExpiryCore from './wasm/expiry_core.js';

const corePromise = createExpiryCore();
corePromise.then(() => postMessage({ type: 'ready' }), (e: unknown) => postMessage({ type: 'error', error: String(e) }));

self.onmessage = async (e: MessageEvent<any>) => {
  const m = e.data;
  try {
    const core = await corePromise;
    const [ty, tm, td] = m.today;
    if (m.type === 'parse') {
      const t0 = performance.now();
      const vec = core.parseDates(m.text, ty, tm, td);
      const candidates = [];
      for (let i = 0; i < vec.size(); i++) candidates.push({ ...vec.get(i), kind: vec.get(i).kind.value });
      vec.delete(); // la memoria WASM non e' gestita dal GC
      postMessage({ id: m.id, ok: true, candidates, ms: performance.now() - t0 });
    } else if (m.type === 'gtin') {
      postMessage({ id: m.id, ok: true, gtin14: core.normalizeGtin14(m.gtin) });
    } else if (m.type === 'status') {
      const K = [core.ExpiryKind.Unknown, core.ExpiryKind.UseBy, core.ExpiryKind.BestBefore];
      const results = m.items.map((it: any) => ({
        status: core.expiryStatus(K[it.kind], it.y, it.m, it.d, ty, tm, td).value,
        days: core.daysRemaining(it.y, it.m, it.d, ty, tm, td),
      }));
      postMessage({ id: m.id, ok: true, results });
    }
  } catch (err) {
    postMessage({ id: m.id, ok: false, error: String(err) });
  }
};
