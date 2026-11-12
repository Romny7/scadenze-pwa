// Decide quando una data letta dall'OCR e' abbastanza affidabile. Funzione pura (testabile in Node).
export type Cand = { year: number; month: number; day: number; precision: number; confidence: number };
export type Hit = { c: Cand; recipe: string };   // recipe = famiglia di pretrattamento (errori correlati dentro la stessa)

const dayKey = (c: Cand) => `${c.year}-${c.month}-${c.day}`;
const monthKey = (c: Cand) => `${c.year}-${c.month}`;

// Regole (la velocita' conta: ogni tentativo costa ~0.4 s):
//  - giorno completo: 2 letture uguali; mese/anno: 3, e si aspetta se c'e' un giorno compatibile in arrivo.
//  - giorno == mese (07/07): sospetto (spesso e' un "07/2027" letto male): servono 3 letture, e se il
//    mese/anno ha almeno altrettante letture vince il mese/anno.
//  Non si pretende l'accordo fra ricette diverse: e' troppo lento (di solito ne legge una sola).
export function decide(recent: (Hit | null)[], attempts: number): Cand | null {
  const days = new Map<string, Hit[]>(), months = new Map<string, Hit[]>();
  for (const h of recent) {
    if (!h) continue;
    const m = h.c.precision === 0 ? days : months;
    const k = h.c.precision === 0 ? dayKey(h.c) : monthKey(h.c);
    m.set(k, [...(m.get(k) ?? []), h]);
  }
  void attempts;   // parametro mantenuto per compatibilita' con il chiamante
  const enough = (v: Hit[], need: number) => v.length >= need;

  const dayWinner = [...days.values()].filter((v) => {
    const c = v[0].c, suspicious = c.day === c.month;
    if (!enough(v, suspicious ? 3 : 2)) return false;
    const sameMonth = months.get(monthKey(c));
    return !(suspicious && sameMonth && sameMonth.length >= v.length);
  }).sort((a, b) => b.length - a.length)[0];
  if (dayWinner) return dayWinner[0].c;

  for (const v of months.values()) {
    if (!enough(v, 3)) continue;
    const c = v[0].c;
    const dayPending = [...days.values()].some((d) => d[0].c.year === c.year && d[0].c.month === c.month && d[0].c.day !== d[0].c.month);
    if (!dayPending) return c;
  }
  return null;
}
