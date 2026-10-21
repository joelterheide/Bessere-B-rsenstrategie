// Prompt für Claude: Vorgaben aus PROMPT.md + die Kursdaten und die Rechnung der Engine als Grundlage

import { zahl } from './format.js';

export async function claudePrompt(r, kerzen) {
  let vorgaben = '';
  try {
    vorgaben = await (await fetch('PROMPT.md')).text();
  } catch { /* lokal ohne Server */ }
  const k = r.kennzahlen || {};
  const daten = {
    symbol: r.symbol,
    waehrung: r.waehrung,
    stand: r.zeit,
    kurs: r.kurs,
    kennzahlen: Object.fromEntries(Object.entries(k).map(([n, v]) => [n, typeof v === 'number' ? Math.round(v * 100) / 100 : v])),
    sentiment: { markt: r.markt, zeilen: r.sentiment?.zeilen },
    letzte_30_tageskerzen: kerzen.slice(-30).map((x) => [x.datum, x.eroeffnung, x.hoch, x.tief, x.schluss, x.volumen]),
    vorschlag_der_engine: r.status === 'setup' ? {
      richtung: r.richtung, setup: r.setupTyp,
      einstieg: r.tranchen.map((t) => ({ preis: t.preis, anteil: t.anteil, rolle: t.rolle })),
      ziel: r.ziel, stop: r.stop, crv: Math.round(r.crv * 100) / 100, haltedauer_tage: r.haltedauer.tage,
      ebenen_der_masse: r.ebenen,
    } : { status: r.status, gruende: r.gruende },
  };
  return `${vorgaben.trim()}

---
Daten (Kerzen: Datum, Eröffnung, Hoch, Tief, Schluss, Volumen). Prüfe den Vorschlag der Engine kritisch und antworte im Format oben.
Kurs aktuell: ${zahl(r.kurs)} ${r.waehrung}

\`\`\`json
${JSON.stringify(daten, null, 1)}
\`\`\``;
}
