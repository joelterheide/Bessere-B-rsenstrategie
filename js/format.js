// Antwort im festen Format aus PROMPT.md (Abschnitte 1–5, plus 6: Ausführungsschutz)

import { datumDe } from './engine.js';

export const zahl = (x, stellen = 2) => (x == null || Number.isNaN(x) ? '–'
  : x.toLocaleString('de-DE', { minimumFractionDigits: stellen, maximumFractionDigits: stellen }));

const prozent = (anteil) => `${Math.round(anteil * 100)} %`;

export function alsText(r, einstellungen = {}) {
  const kw = einstellungen.kapitalWaehrung || 'EUR';
  const z = [];
  z.push(`${r.symbol} · Stand ${datumDe(r.zeit)} · Kurs ${zahl(r.kurs)} ${r.waehrung || ''}`.trim());
  z.push('');
  z.push('1. MARKT-SETUP & RICHTUNG:');
  if (r.status === 'setup') {
    z.push(`- Richtung: ${r.richtung} – ${r.setupTyp}.`);
    for (const b of r.begruendung) z.push(`  ${b}`);
  } else {
    z.push(`- Richtung: ${r.status === 'warnung' ? 'KEIN SETUP – WARNUNG' : 'KEIN SAUBERES SETUP'}${r.richtungsBias ? ` (Bias ${r.richtungsBias})` : ''}`);
    for (const g of r.gruende) z.push(`  ${g}`);
    if (r.beobachten) z.push(`  Beobachten: ${zahl(r.beobachten)} – dort neu analysieren.`);
  }
  for (const h of r.hinweise || []) z.push(`  Hinweis: ${h}`);

  z.push('');
  z.push('2. SCHLÜSSEL-LEVELS (Exakte Werte):');
  if (r.status === 'setup') {
    const staffel = r.tranchen.map((t) => `${zahl(t.preis)} (${prozent(t.anteil)})`).join(' / ');
    z.push(`- Einstieg (Limit-Order): ${staffel}${r.tranchen.length > 1 ? ` · Ø ${zahl(r.schnitt)}` : ''}`);
    z.push(`- Kursziel (Take Profit): ${zahl(r.ziel)} – ${r.zielBasis}`);
    z.push(`- Absicherung (Stop Loss): ${zahl(r.stop)} – ${r.stopBasis}`);
  } else {
    z.push('- Keine Order.');
  }

  z.push('');
  z.push('3. RISIKO-MANAGEMENT (CRV):');
  if (r.status === 'setup') {
    const chance = Math.abs(r.ziel - r.schnitt), risiko = Math.abs(r.schnitt - r.stop);
    z.push(`- Risk-Reward-Ratio (CRV): 1 : ${zahl(r.crv)} (Chance ${zahl(chance)} / Risiko ${zahl(risiko)} je Stück`
      + `${r.tranchen.length > 1 ? `; nur Tranche 1 ausgeführt: 1 : ${zahl(r.crvT1)}` : ''})`);
    const p = r.position;
    const verteilung = r.tranchen.length > 1 ? ` (${p.jeTranche.join(' / ')})` : '';
    z.push(`- Positionsgröße: ${zahl(einstellungen.risikoPct ?? 1, 1)} % Risiko von ${zahl(einstellungen.kapital ?? 0, 0)} ${kw} = ${zahl(p.budget)} ${kw} `
      + `→ ${p.stueck} Stück${verteilung}, Positionswert ≈ ${zahl(p.positionswert, 0)} ${kw}, max. Verlust ${zahl(p.maxVerlust)} ${kw}`
      + `${p.gebuehren ? ` inkl. ${zahl(p.gebuehren)} ${kw} Gebühren` : ''}.`);
  } else {
    z.push('- Kein Trade, kein Risiko.');
  }

  z.push('');
  z.push('4. ZEITHORIZONT (Haltedauer):');
  if (r.status === 'setup') {
    const h = r.haltedauer;
    z.push(`- Maximale Haltedauer: ${h.tage} Handelstage${h.timeStop ? ` (Time-Stop am ${datumDe(h.timeStop)})` : ''}. `
      + 'Ziel bis dahin nicht erreicht → Trade manuell schließen.');
    if (h.limitGueltigBis) z.push(`- Limit-Order gültig bis ${datumDe(h.limitGueltigBis)}, danach löschen.`);
  } else {
    z.push('- Entfällt.');
  }

  z.push('');
  z.push('5. MARKTPSYCHOLOGIE & SENTIMENT-FILTER:');
  for (const s of r.sentiment?.zeilen || []) z.push(`- ${s}`);
  const anp = r.sentiment?.anpassungen || [];
  z.push(anp.length ? `- Anpassung: ${anp.join(' ')}` : '- Anpassung: keine (kein Extrem-Sentiment).');

  if (r.status === 'setup') {
    z.push('');
    z.push('6. AUSFÜHRUNGSSCHUTZ (Anti-Frontrunning & Anti-Stop-Hunting):');
    for (const s of r.schutz) z.push(`- ${s}`);
  }
  return z.join('\n');
}
