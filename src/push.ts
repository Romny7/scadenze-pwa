import { PUSH_URL, VAPID_PUBLIC_KEY } from './config';

export type Alert = { at: number; title: string; body: string };

const fromB64u = (s: string) => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '='));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};
// Su iPhone PushManager esiste solo se l'app e' stata aggiunta alla schermata Home.
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export async function currentSub() {
  return (await (await navigator.serviceWorker.ready).pushManager.getSubscription()) ?? undefined;
}
// Da chiamare SOLO da un tocco dell'utente (requisito di iOS per il permesso).
export async function enablePush(): Promise<PushSubscription> {
  if (await Notification.requestPermission() !== 'granted') throw new Error('Permesso notifiche non concesso');
  const reg = await navigator.serviceWorker.ready;
  return (await reg.pushManager.getSubscription()) ??
    reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64u(VAPID_PUBLIC_KEY) });
}
async function post(path: string, body: object) {
  const r = await fetch(PUSH_URL + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const text = await r.text();
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status} ${text}`);
  return text;
}
export const syncAlerts = (sub: PushSubscription, alerts: Alert[]) => post('/sync', { subscription: sub.toJSON(), alerts });
export const sendTest = (sub: PushSubscription) => post('/test', { subscription: sub.toJSON() });
