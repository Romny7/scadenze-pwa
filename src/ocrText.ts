// Normalizza il testo OCR prima del parser: corregge gli errori tipici dentro i token che sembrano date.
const DATE_LIKE = /[0-9OoIil|Ss]{1,4}(?:[/.,\-][0-9OoIil|Ss]{1,4}){1,2}/g;

export function normalizeOcr(text: string, year: number): string {
  // 1) lettere scambiate per cifre ("i2/2026" -> "12/2026") e virgole al posto dei punti ("29,11,2026")
  let t = text.replace(DATE_LIKE, (m) =>
    /[0-9]/.test(m) ? m.replace(/[Oo]/g, '0').replace(/[Iil|]/g, '1').replace(/[Ss]/g, '5').replace(/,/g, '.') : m);
  // 2) separatori persi: 8 cifre isolate "29112026" -> "29.11.2026" (solo se giorno/mese/anno sono plausibili)
  t = t.replace(/(?<![0-9A-Za-z])(\d{2})(\d{2})(\d{4})(?![0-9A-Za-z])/g, (m, d: string, mo: string, y: string) => {
    const dd = +d, mm = +mo, yy = +y;
    return dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12 && yy >= year - 1 && yy <= year + 15 ? `${d}.${mo}.${y}` : m;
  });
  // 3) un solo separatore perso: "29.112026" -> "29.11.2026", "2911.2026" -> "29.11.2026"
  const plausible = (mm: number, yy: number) => mm >= 1 && mm <= 12 && yy >= year - 1 && yy <= year + 15;
  t = t.replace(/(?<![0-9])(\d{1,2})[./,\-](\d{2})(\d{4})(?![0-9])/g, (m, d: string, mo: string, y: string) => (plausible(+mo, +y) ? `${d}.${mo}.${y}` : m));
  t = t.replace(/(?<![0-9])(\d{2})(\d{2})[./,\-](\d{4})(?![0-9])/g, (m, d: string, mo: string, y: string) => (+d >= 1 && +d <= 31 && plausible(+mo, +y) ? `${d}.${mo}.${y}` : m));
  return t;
}
