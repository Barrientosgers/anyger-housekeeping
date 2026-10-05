import type { Lang } from './types.js';

// A small, deterministic detector for short notes in Spanish or English. It decides whether a note
// needs translating at all, so the free allowance is not spent on text already in the reader's
// language. It is intentionally conservative: when unsure it says "unknown" and nothing happens.
const ES = new Set(
  `el la los las de del que y en un una es por con para no se su al lo como mas pero sus le ya o
   este si porque esta entre cuando muy sin sobre tambien me hasta hay donde quien desde todo nos
   estan estar tengo tiene tienen perro perros gato gatos casa puerta llave favor gracias hola
   buenos dias tardes limpieza entrar atras timbre cocina bano banos cuarto cuartos ventanas piso
   pisos por favor dos tres antes despues manana semana mes cada necesito necesitamos quiero
   queremos aqui alli abajo arriba lunes martes miercoles jueves viernes sabado domingo`
    .split(/\s+/)
    .filter(Boolean),
);
const EN = new Set(
  `the and of to a in is that it for you with on as are was this be at have not or from by but
   they we your please thank thanks hello cleaning ring bell two three have back enter front under
   mat gate code call before after morning afternoon dog dogs cat cats house door key kitchen
   bathroom bathrooms bedroom bedrooms windows floor floors every each need needs want here there
   upstairs downstairs monday tuesday wednesday thursday friday saturday sunday our my me us
   will would could should can do does did has had been being their them what when where which`
    .split(/\s+/)
    .filter(Boolean),
);

const strip = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

export function detectLanguage(text: string): Lang | 'unknown' {
  const lower = text.toLowerCase();
  let es = /[ñ¿¡]/.test(lower) ? 2 : 0;
  let en = 0;
  for (const word of strip(lower).match(/[a-z]+/g) ?? []) {
    if (ES.has(word)) es++;
    if (EN.has(word)) en++;
  }
  if (es === en) return 'unknown';
  const [winner, top, other] = es > en ? (['es', es, en] as const) : (['en', en, es] as const);
  return top >= 2 && top - other >= 1 ? winner : 'unknown';
}
