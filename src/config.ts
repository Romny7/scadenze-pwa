// Da compilare dopo il deploy del Worker (vedi istruzioni).
export const PUSH_URL = 'https://scadenze-push.romeo-luvisotto.workers.dev';
export const VAPID_PUBLIC_KEY = 'BFNbwqQ7T0LGwMQF3HyiJb8I0oyAYH4jG3bgLR1Pdy4CBG-DF3B0MpLfFsFx92q3zYv24gkHk49yexNWYiIWV1A';
export const pushConfigured = () => !PUSH_URL.includes('TUO-SUBDOMAIN') && !VAPID_PUBLIC_KEY.startsWith('INCOLLA');
