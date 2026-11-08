import type { Entry } from './db';

type Res = { status: number; days: number };
const STATUS = ['Ok', 'In scadenza', 'Scade oggi', 'Oltre il TMC', 'Scaduto'];
const MESI = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
const GIORNI = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];

const now = new Date();
let cur = { y: now.getFullYear(), m: now.getMonth() }; // m: 0-11
let sel = 0; // giorno selezionato del mese visualizzato (0 = nessuno)

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

export function drawCalendar(root: HTMLElement, items: Entry[], results: Res[]) {
  const redraw = () => drawCalendar(root, items, results);
  const move = (delta: number) => { const d = new Date(cur.y, cur.m + delta, 1); cur = { y: d.getFullYear(), m: d.getMonth() }; sel = 0; redraw(); };

  const head = el('div', 'calhead');
  const prev = el('button', '', '‹'); prev.onclick = () => move(-1);
  const next = el('button', '', '›'); next.onclick = () => move(1);
  head.append(prev, el('b', '', `${MESI[cur.m]} ${cur.y}`), next);

  // indici degli elementi per giorno del mese visualizzato
  const byDay = new Map<number, number[]>();
  items.forEach((it, i) => {
    if (it.y === cur.y && it.m - 1 === cur.m) byDay.set(it.d, [...(byDay.get(it.d) ?? []), i]);
  });

  const grid = el('div', 'grid');
  GIORNI.forEach((g) => grid.append(el('small', 'wd', g)));
  const offset = (new Date(cur.y, cur.m, 1).getDay() + 6) % 7; // settimana da lunedi'
  for (let k = 0; k < offset; k++) grid.append(el('span'));
  const dim = new Date(cur.y, cur.m + 1, 0).getDate();
  for (let d = 1; d <= dim; d++) {
    const idx = byDay.get(d) ?? [];
    const cell = el('button', 'day');
    if (cur.y === now.getFullYear() && cur.m === now.getMonth() && d === now.getDate()) cell.classList.add('today');
    if (d === sel) cell.classList.add('sel');
    cell.append(el('div', '', String(d)));
    const dots = el('div');
    idx.slice(0, 3).forEach((i) => dots.append(el('span', `dot s${results[i].status}`)));
    if (idx.length > 3) dots.append(el('small', '', `+${idx.length - 3}`));
    cell.append(dots);
    cell.onclick = () => { sel = d === sel ? 0 : d; redraw(); };
    grid.append(cell);
  }

  const detail = el('div', 'detail');
  if (sel) {
    detail.append(el('b', '', `${sel} ${MESI[cur.m]} ${cur.y}`));
    const idx = byDay.get(sel) ?? [];
    if (!idx.length) detail.append(el('div', '', 'Nessuna scadenza.'));
    idx.forEach((i) => {
      const it = items[i];
      detail.append(el('div', '', `${it.name}${it.precision === 1 ? ' (fine mese)' : ''} — ${STATUS[results[i].status]}`));
    });
  }
  root.replaceChildren(head, grid, detail);
}
