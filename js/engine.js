// Trading-Analyse nach den Vorgaben in PROMPT.md: Richtung, Levels, CRV, Positionsgröße, Haltedauer,
// Sentiment-Filter und Ausführungsschutz (Anti-Frontrunning, Anti-Stop-Hunting).
// Reine Funktionen ohne Netz und DOM, damit alles testbar ist.

import { kennzahlen, pivots, zonen } from './indikatoren.js';
import { krumm, magnete, streu, zufallsquelle } from './schutz.js';
import { stufe } from './sentiment.js';

export const REGELN = {
  minCrv: 2.0,
  minCrvErsteTranche: 1.5, // falls nur die oberste Tranche ausgeführt wird
  maxAbstandEinstiegAtr: 1.5, // so weit darf die Unterstützung unter dem Kurs liegen
  vorDerMasseAtr: 0.12, // Einstieg so weit über der Kaufzone der Masse
  trancheAbstandAtr: 0.25,
  jagdTiefeAtr: 0.25, // so tief stechen Stop-Hunts typischerweise unter eine Marke
  stopPufferAtr: 0.35, // zusätzlicher Abstand hinter der Jagdzone
  stopPufferGierAtr: 0.2, // engerer Stop bei extremer Gier
  zielVorWiderstandAtr: 0.12,
  zielAbschlagGier: 0.15,
  maxZielAtr: 3.2, // weiter läuft ein Swing-Trade in 3–10 Tagen selten
  minHaltedauer: 3,
  maxHaltedauer: 10,
  limitGueltigTage: 2,
  gapEventAtr: 1.5,
  tranchen: { 1: [1], 2: [0.5, 0.5], 3: [0.4, 0.35, 0.25] },
};

export const STANDARD_EINSTELLUNGEN = {
  kapital: 10000,
  kapitalWaehrung: 'EUR',
  risikoPct: 1,
  tranchen: 3,
  nurLong: false,
  gebuehr: 0, // pro Order, in Kapitalwährung
  maxPositionPct: 100,
  fx: 1, // Kapitalwährung je Einheit der Kurswährung
  salt: 'standard',
};

const de = (x, stellen = 2) => (x == null ? '–'
  : x.toLocaleString('de-DE', { minimumFractionDigits: stellen, maximumFractionDigits: stellen }));
export const datumDe = (iso) => (iso ? iso.split('-').reverse().join('.') : '–');

function spiegeln(kerzen) {
  return kerzen.map((k) => ({
    ...k, eroeffnung: -k.eroeffnung, hoch: -k.tief, tief: -k.hoch, schluss: -k.schluss,
  }));
}

export function handelstagePlus(datum, tage) {
  const d = new Date(datum + 'T12:00:00Z');
  let n = 0;
  while (n < tage) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) n++;
  }
  return d.toISOString().slice(0, 10);
}

// ---------- Filter vor der Planung ----------

function hypeGruende(k, ko, richtung, sentiment, markt) {
  const g = [];
  const long = richtung === 'LONG';
  if (ko.rsi14 > 75) g.push(`RSI(14) ${de(k.rsi14, 0)} ${long ? '> 75' : '< 25'}`);
  if (ko.abstand_sma20_atr > 3) g.push(`${de(Math.abs(k.abstand_sma20_atr), 1)} ATR ${long ? 'über' : 'unter'} der 20-Tage-Linie`);
  if (ko.bewegung5_atr > 4) g.push(`${de(Math.abs(k.bewegung5_atr), 1)} ATR Bewegung in 5 Tagen`);
  if (ko.vol_faktor > 3 && ko.bewegung5_atr > 0) g.push(`Volumen ${de(ko.vol_faktor, 1)}× Durchschnitt`);
  const news = sentiment.news;
  if (news && news.artikelSchnitt > 0 && news.artikel24h >= 3 * news.artikelSchnitt
      && (long ? news.score >= 0.35 : news.score <= -0.35)) {
    g.push(`News-${long ? 'Hype' : 'Panik'}: ${news.artikel24h} Artikel in 24 h (sonst ${de(news.artikelSchnitt, 1)}/Tag)`);
  }
  if (long && markt === 'Extreme Gier') g.push('Gesamtmarkt in extremer Gier');
  return g;
}

// ---------- Level-Planung (long-orientiert; Shorts kommen gespiegelt herein) ----------

function planen(o, k, { regeln, zufall, gier, antizyklisch, anteile, real }) {
  const A = k.atr, P = k.kurs, n = o.length;
  const long = real(1) === 1;
  const f = (x) => de(real(x));
  const w = long
    ? { unter: 'unter', hoch: 'Hoch', widerstand: 'Widerstandszone' }
    : { unter: 'über', hoch: 'Tief', widerstand: 'Unterstützungszone' };
  const { tiefs, hochs } = pivots(o, 3);
  const zs = zonen([...tiefs, ...hochs].filter((p) => p.index >= n - 160), 0.35 * A, n);
  const solide = (z) => z.beruehrungen >= 2 || z.letzter >= n - 40 || z.art === 'linie';

  // 1. Unterstützung, an der die Masse kauft
  const unter = zs.filter((z) => z.preis < P).map((z) => ({ ...z, art: 'zone', name: `Zone ${f(z.preis)}` }));
  if (!antizyklisch) {
    for (const [name, wert] of [['20-Tage-Linie', k.sma20], ['50-Tage-Linie', k.sma50]]) {
      if (wert && wert < P) unter.push({ preis: wert, min: wert, max: wert, beruehrungen: 1, letzter: n - 1, art: 'linie', name: `${name} ${f(wert)}` });
    }
  }
  const kandidaten = unter
    .filter((z) => (antizyklisch ? z.beruehrungen >= 2 || z.min <= k.tief52 + A : solide(z)))
    .sort((a, b) => b.preis - a.preis);
  const S = kandidaten.find((z) => P - z.preis <= regeln.maxAbstandEinstiegAtr * A);
  if (!S) {
    const naechste = kandidaten[0];
    return {
      ok: false,
      grund: naechste
        ? `Kein Einstieg in Reichweite: nächste solide Marke ${f(naechste.preis)} liegt ${de(((P - naechste.preis) / A), 1)} ATR ${w.unter} dem Kurs – auf Rücksetzer warten.`
        : `Keine solide Marke ${w.unter} dem Kurs für einen Einstieg erkennbar.`,
      beobachten: naechste ? naechste.preis : null,
    };
  }

  // 2. Letztes markantes Tief unter der Einstiegszone (inkl. eines frischen Stop-Hunts der letzten 3 Kerzen)
  let L = S.min;
  for (const z of zs) if (z.max < S.min && z.max >= S.min - 0.5 * A) L = Math.min(L, z.min);
  const juengstesTief = Math.min(...o.slice(-3).map((x) => x.tief));
  const sweep = juengstesTief < L - 0.1 * A && P > S.min;
  if (juengstesTief < L) L = juengstesTief;

  // Wo kauft die Masse? An der Zone und an runden Zahlen knapp darüber.
  const kaufMagnete = magnete(S.min - 0.3 * A, Math.min(S.max + 0.5 * A, P), A, P);
  const massenKauf = Math.max(S.max, ...kaufMagnete.map((m) => m.preis));
  const kaufRund = kaufMagnete.map((m) => m.preis);

  // Wo liegen ihre Stops? Knapp unter dem Tief und unter runden Zahlen in der Nähe.
  const stopMagnete = magnete(L - 0.6 * A, L, A, P).map((m) => m.preis);
  const jagdBoden = Math.min(L, ...stopMagnete);
  const puffer = gier ? regeln.stopPufferGierAtr : regeln.stopPufferAtr;
  let stop = jagdBoden - (regeln.jagdTiefeAtr + puffer * streu(zufall)) * A;
  for (let i = 0; i < 3; i++) { // nicht knapp unter der nächsten runden Zahl landen
    const m = magnete(stop - 0.05 * A, stop + 0.3 * A, A, P)[0];
    if (!m) break;
    stop = m.preis - (0.3 + 0.1 * zufall()) * A;
  }
  stop = krumm(stop, -1, { stop: true, maxVerschiebung: 0.05 * A, zufall });

  // 3. Einstieg knapp VOR der Masse (darüber), gestaffelt; die unterste Tranche fängt einen Stop-Hunt ab
  const vorMasse = (preis) => {
    let p = preis;
    const m = magnete(p - 0.02 * A, p + 0.1 * A, A, P).at(-1);
    if (m) p = m.preis + 0.06 * A * streu(zufall);
    return Math.min(p, P);
  };
  const t2 = vorMasse(massenKauf + regeln.vorDerMasseAtr * A * streu(zufall));
  const t1 = vorMasse(t2 + regeln.trancheAbstandAtr * A * streu(zufall));
  const t3 = jagdBoden - 0.12 * A * streu(zufall); // mitten in der Zone, in die Stop-Hunts stechen
  const preise = { 1: [t2], 2: [t1, t2], 3: [t1, t2, t3] }[anteile.length];
  let tranchen = preise.map((preis, i) => ({ preis: krumm(preis, 1, { zufall }), anteil: anteile[i] }));
  tranchen[tranchen.length - 1].rolle = anteile.length === 3 ? 'Jagdzone' : 'vor der Masse';
  if (anteile.length === 3) {
    tranchen[0].rolle = 'hohe Ausführungschance';
    tranchen[1].rolle = 'vor der Masse';
  } else if (anteile.length === 2) tranchen[0].rolle = 'hohe Ausführungschance';
  // zusammenfallende Tranchen (Kurs schon in der Zone) bzw. Jagd-Tranche zu nah am Stop zusammenlegen
  tranchen = tranchen.reduce((acc, t) => {
    const gleich = acc.find((x) => Math.abs(x.preis - t.preis) < 0.03 * A);
    const zuNah = t.rolle === 'Jagdzone' && t.preis - stop < 0.2 * A;
    if (gleich) gleich.anteil += t.anteil;
    else if (zuNah) acc[acc.length - 1].anteil += t.anteil;
    else acc.push({ ...t });
    return acc;
  }, []);
  const schnitt = tranchen.reduce((s, t) => s + t.preis * t.anteil, 0);

  // 4. Kursziel knapp VOR dem nächsten soliden Widerstand bzw. der runden Zahl davor
  const t1Preis = tranchen[0].preis;
  const ueber = zs.filter((z) => z.min > t1Preis + 0.5 * A && solide(z)).map((z) => ({ min: z.min, name: `${w.widerstand} ${f(z.preis)}` }));
  for (const [name, wert] of [[`20-Tage-${w.hoch}`, k.hoch20], [`52-Wochen-${w.hoch}`, k.hoch52], ['20-Tage-Linie', k.sma20], ['50-Tage-Linie', k.sma50], ['200-Tage-Linie', k.sma200]]) {
    if (wert && wert > t1Preis + 0.5 * A) ueber.push({ min: wert, name: `${name} ${f(wert)}` });
  }
  ueber.sort((a, b) => a.min - b.min);
  const W = ueber[0];
  let ziel, zielBasis;
  if (W) {
    ziel = W.min - regeln.zielVorWiderstandAtr * A * streu(zufall);
    zielBasis = `vor ${W.name}`;
    const m = magnete(ziel - 0.05 * A, ziel + 0.35 * A, A, P)[0];
    if (m) {
      ziel = m.preis - 0.1 * A * streu(zufall);
      zielBasis += `, ${w.unter} der runden Zahl ${f(m.preis)}`;
    }
  } else {
    ziel = schnitt + 2.5 * (schnitt - stop);
    zielBasis = 'ATR-Projektion (kein Widerstand in Reichweite)';
  }
  if (ziel > schnitt + regeln.maxZielAtr * A) {
    ziel = schnitt + regeln.maxZielAtr * A;
    zielBasis += `, gekappt auf ${regeln.maxZielAtr} ATR (Haltedauer)`;
  }
  const zielOhneGier = ziel;
  if (gier) ziel = schnitt + (ziel - schnitt) * (1 - regeln.zielAbschlagGier);
  ziel = krumm(ziel, -1, { zufall });

  const crv = (ziel - schnitt) / (schnitt - stop);
  const crvT1 = (ziel - t1Preis) / (t1Preis - stop);
  const m = (ziel - schnitt) / A;
  return {
    ok: true,
    sweep,
    S, L, massenKauf, kaufRund, jagdBoden, stopMagnete,
    widerstand: W || null,
    tranchen, schnitt, stop, ziel, zielOhneGier, zielBasis,
    crv, crvT1,
    tage: Math.min(regeln.maxHaltedauer, Math.max(regeln.minHaltedauer, Math.ceil(m * m))),
    zonen: zs,
  };
}

// ---------- Positionsgröße ----------

export function positionsgroesse(tranchen, stop, ziel, e) {
  const budget = (e.kapital * e.risikoPct) / 100;
  const fx = e.fx || 1;
  const gebuehren = (e.gebuehr || 0) * (tranchen.length + 1);
  const proStueck = tranchen.reduce((s, t) => s + t.anteil * Math.abs(t.preis - stop), 0) * fx;
  const schnittPreis = tranchen.reduce((s, t) => s + t.anteil * t.preis, 0) * fx;
  let n = Math.max(0, Math.floor((budget - gebuehren) / proStueck));
  n = Math.min(n, Math.floor((e.kapital * (e.maxPositionPct ?? 100)) / 100 / schnittPreis));
  const verteilen = (gesamt) => {
    const st = tranchen.map((t) => Math.floor(gesamt * t.anteil));
    st[0] += gesamt - st.reduce((a, b) => a + b, 0);
    return st;
  };
  let stueck = verteilen(n);
  const verlust = (st) => st.reduce((s, x, i) => s + x * Math.abs(tranchen[i].preis - stop), 0) * fx + gebuehren;
  while (n > 0 && verlust(stueck) > budget) stueck = verteilen(--n);
  const wert = stueck.reduce((s, x, i) => s + x * tranchen[i].preis, 0) * fx;
  const gewinn = stueck.reduce((s, x, i) => s + x * Math.abs(ziel - tranchen[i].preis), 0) * fx - gebuehren;
  return {
    budget, stueck: n, jeTranche: stueck, positionswert: wert,
    maxVerlust: n ? verlust(stueck) : 0, gewinnZiel: n ? gewinn : 0, gebuehren,
    crvNetto: n ? gewinn / verlust(stueck) : null,
  };
}

// ---------- Hauptfunktion ----------

export function analysiere({ symbol, kerzen, waehrung = '', sentiment = {}, einstellungen = {}, heute = null, regeln = REGELN }) {
  const e = { ...STANDARD_EINSTELLUNGEN, ...einstellungen };
  e.risikoPct = Math.min(2, Math.max(0.1, e.risikoPct)); // Vorgabe: höchstens 2 % Risiko
  const ergebnis = { symbol, waehrung, zeit: kerzen.at(-1)?.datum, status: 'kein_setup', gruende: [], begruendung: [], hinweise: [] };
  if (kerzen.length < 60) {
    ergebnis.gruende.push(`Zu wenig Kursdaten (${kerzen.length} Tage, mindestens 60 nötig).`);
    return ergebnis;
  }

  const k = kennzahlen(kerzen);
  const markt = sentiment.markt ? { ...sentiment.markt, stufe: stufe(sentiment.markt.wert) } : null;
  const mStufe = markt?.stufe;
  const lang = k.sma200 ?? k.sma100;
  const langName = k.sma200 != null ? '200-Tage-Linie' : '100-Tage-Linie';
  Object.assign(ergebnis, { kurs: k.kurs, kennzahlen: k, markt });
  ergebnis.sentiment = sentimentBlock(k, markt, sentiment.news);

  const aufwaerts = k.kurs > k.sma50 && k.sma50 > lang && k.sma50 > k.sma50_vor10;
  const abwaerts = k.kurs < k.sma50 && k.sma50 < lang && k.sma50 < k.sma50_vor10;
  const trendText = `Kurs ${de(k.kurs)}, 50-Tage-Linie ${de(k.sma50)} (${k.sma50 > k.sma50_vor10 ? 'steigend' : 'fallend'}), ${langName} ${de(lang)}`;

  // Event-Tag: großes Gap in der laufenden Kerze → Levels sind noch nicht belastbar
  const laufend = heute && kerzen.at(-1).datum === heute;
  if (laufend && Math.abs(k.gap_atr) >= regeln.gapEventAtr) {
    ergebnis.gruende.push(`Event-Tag: Eröffnung mit Gap von ${de(k.gap_atr, 1)} ATR (z. B. Zahlen/News). `
      + 'Bis zum Tagesschluss sind Unterstützungen und Widerstände nicht belastbar – erst den Schlusskurs abwarten.');
    return ergebnis;
  }

  let richtung = null, antizyklisch = false;
  if (aufwaerts) richtung = 'LONG';
  else if (abwaerts) richtung = 'SHORT';
  if (mStufe === 'Extreme Angst') {
    if (richtung === 'SHORT') {
      ergebnis.hinweise.push(`Abwärtstrend (${trendText}), aber kein Short in extremer Angst: Gefahr von Short-Squeeze und Gegenbewegung.`);
      richtung = null;
    }
    if (!richtung) {
      richtung = 'LONG';
      antizyklisch = true;
    }
  }
  if (!richtung) {
    ergebnis.gruende.push(`Kein klarer Trend (${trendText}). In der Seitwärtsphase gibt es kein sauberes Setup.`);
    return ergebnis;
  }
  if (richtung === 'SHORT' && e.nurLong) {
    ergebnis.gruende.push(`Short-Bias (${trendText}), aber nur Long-Trades erlaubt (z. B. Planspiel Börse). Kein Kauf in einen Abwärtstrend.`);
    return ergebnis;
  }

  const o = richtung === 'LONG' ? kerzen : spiegeln(kerzen);
  const ko = richtung === 'LONG' ? k : kennzahlen(o);
  const real = (x) => (x == null ? null : richtung === 'LONG' ? x : -x);

  const hype = hypeGruende(k, ko, richtung, sentiment, mStufe);
  if (hype.length >= 2) {
    ergebnis.status = 'warnung';
    ergebnis.gruende.push(`WARNUNG: ${richtung === 'LONG' ? 'FOMO/Hype' : 'Panik-Ausverkauf'} – das Asset ist psychologisch überhitzt (${hype.join('; ')}). Setup verweigert.`);
    return ergebnis;
  }

  if (antizyklisch) {
    const umkehr = (kerzen.at(-1).schluss > kerzen.at(-1).eroeffnung
      && kerzen.at(-1).schluss >= kerzen.at(-1).tief + 0.5 * (kerzen.at(-1).hoch - kerzen.at(-1).tief)) || k.rsi2 < 10;
    if (!(k.rsi14 < 35 && umkehr)) {
      ergebnis.gruende.push(`Extreme Angst (${markt.wert}), aber noch kein charttechnischer Boden: RSI(14) ${de(k.rsi14, 0)}`
        + `${k.rsi14 < 35 ? '' : ' (nicht überverkauft)'}, ${umkehr ? 'Umkehrkerze vorhanden' : 'keine Umkehrkerze'}.`);
      return ergebnis;
    }
  }

  const gier = mStufe === 'Extreme Gier';
  const zufall = zufallsquelle(`${e.salt}|${symbol}|${ergebnis.zeit}`);
  const anteile = regeln.tranchen[e.tranchen] || regeln.tranchen[3];
  const p = planen(o, ko, { regeln, zufall, gier, antizyklisch, anteile, real });
  if (!antizyklisch && ko.rsi14 > 70) {
    const zone = p.ok ? real(p.S.preis) : real(p.beobachten);
    ergebnis.gruende.push(`Trend intakt, aber RSI(14) ${de(k.rsi14, 0)} – ${richtung === 'LONG' ? 'überkauft' : 'überverkauft'}. Nicht hinterherlaufen, auf Rücksetzer warten`
      + `${zone != null ? ` (Kaufzone um ${de(zone)}${p.ok && p.S.art === 'linie' ? `, ${p.S.name.replace(/ [\d.,]+$/, '')}` : ''})` : ''}.`.replace('Kaufzone', richtung === 'LONG' ? 'Kaufzone' : 'Verkaufszone'));
    ergebnis.beobachten = zone;
    ergebnis.richtungsBias = richtung;
    return ergebnis;
  }
  if (!p.ok) {
    ergebnis.gruende.push(p.grund);
    ergebnis.beobachten = real(p.beobachten);
    ergebnis.richtungsBias = richtung;
    return ergebnis;
  }

  const tranchen = p.tranchen.map((t) => ({ ...t, preis: real(t.preis) }));
  const stop = real(p.stop), ziel = real(p.ziel), schnitt = real(p.schnitt);
  const pos = positionsgroesse(tranchen, stop, ziel, e);
  tranchen.forEach((t, i) => { t.stueck = pos.jeTranche[i]; });

  Object.assign(ergebnis, {
    richtung,
    setupTyp: antizyklisch ? 'Antizyklischer Boden-Kauf (extreme Angst)'
      : p.sweep ? `Stop-Hunt-Umkehr: ${richtung === 'LONG' ? 'Tief unter' : 'Hoch über'} ${de(real(p.S.min))} abgefischt und zurückerobert`
        : richtung === 'LONG' ? 'Rücksetzer im Aufwärtstrend' : 'Erholung im Abwärtstrend (Short)',
    tranchen, schnitt, stop, ziel,
    zielBasis: p.zielBasis,
    stopBasis: `${richtung === 'LONG' ? 'unter' : 'über'} dem markanten ${richtung === 'LONG' ? 'Tief' : 'Hoch'} ${de(real(p.L))} und der Stop-Jagdzone`,
    crv: p.crv, crvT1: p.crvT1, position: pos,
    haltedauer: {
      tage: p.tage,
      timeStop: heute ? handelstagePlus(heute, p.tage) : null,
      limitGueltigBis: heute ? handelstagePlus(heute, regeln.limitGueltigTage) : null,
    },
    ebenen: {
      unterstuetzung: real(p.S.preis), unterstuetzungName: p.S.name, tief: real(p.L),
      massenKauf: real(p.massenKauf), kaufRund: p.kaufRund.map(real),
      jagdBoden: real(p.jagdBoden), stopRund: p.stopMagnete.map(real),
      widerstand: p.widerstand ? real(p.widerstand.min) : null,
      zielOhneGier: real(p.zielOhneGier),
      zonen: p.zonen.map((z) => ({ preis: real(z.preis), min: real(richtung === 'LONG' ? z.min : z.max), max: real(richtung === 'LONG' ? z.max : z.min), beruehrungen: z.beruehrungen })),
    },
  });

  ergebnis.begruendung = begruendung(k, richtung, antizyklisch, p, trendText, real);
  if (gier) {
    ergebnis.sentiment.anpassungen.push(`Extreme Gier: Abstand zum Kursziel −${regeln.zielAbschlagGier * 100} % `
      + `(${de(real(p.zielOhneGier))} → ${de(ziel)}), Stop-Puffer ${regeln.jagdTiefeAtr + regeln.stopPufferGierAtr} statt ${regeln.jagdTiefeAtr + regeln.stopPufferAtr} ATR.`);
  }

  // Mindest-CRV prüfen: lieber kein Trade als ein gieriger
  const fehler = [];
  if (p.crv < regeln.minCrv) fehler.push(`CRV 1 : ${de(p.crv, 2)} liegt unter 1 : ${regeln.minCrv}`);
  if (tranchen.length > 1 && p.crvT1 < regeln.minCrvErsteTranche) {
    fehler.push(`wird nur die erste Tranche ausgeführt, wäre das CRV 1 : ${de(p.crvT1, 2)} (< 1 : ${regeln.minCrvErsteTranche})`);
  }
  if (e.gebuehr > 0 && pos.crvNetto != null && pos.crvNetto < regeln.minCrv) {
    fehler.push(`nach Gebühren (${de(pos.gebuehren, 0)} ${e.kapitalWaehrung}) nur CRV 1 : ${de(pos.crvNetto, 2)}`);
  }
  if (fehler.length) {
    ergebnis.gruende.push(`${ergebnis.setupTyp} erkannt, aber ${fehler.join('; ')}. Kein sauberes Setup.`);
    ergebnis.verworfen = true;
    return ergebnis;
  }
  if (pos.stueck < 1) ergebnis.hinweise.push('Mit diesem Kapital und Risiko ist nicht einmal 1 Stück möglich.');
  ergebnis.status = 'setup';
  ergebnis.schutz = schutzBlock(ergebnis, p, richtung, real, regeln);
  return ergebnis;
}

function begruendung(k, richtung, antizyklisch, p, trendText, real) {
  const b = [];
  if (antizyklisch) {
    b.push(`Gesamtmarkt in extremer Angst, Kurs an einem charttechnischen Boden (${p.S.name}, ${p.S.beruehrungen}× getestet).`);
    b.push(`RSI(14) ${de(k.rsi14, 0)} überverkauft, Umkehrkerze/RSI(2) ${de(k.rsi2, 0)}.`);
  } else {
    b.push(`${richtung === 'LONG' ? 'Aufwärtstrend' : 'Abwärtstrend'}: ${trendText}.`);
    b.push(`${richtung === 'LONG' ? 'Unterstützung' : 'Widerstand'}: ${p.S.art === 'linie' ? p.S.name : `Zone ${de(real(p.S.preis))} (${p.S.beruehrungen}× getestet)`}, `
      + `Kurs ${de((Math.abs(k.kurs - real(p.S.preis)) / k.atr), 1)} ATR entfernt.`);
    b.push(`RSI(14) ${de(k.rsi14, 0)}, ATR(14) ${de(k.atr)} (${de(((k.atr / k.kurs) * 100), 1)} %).`);
  }
  if (p.sweep) b.push(`Frischer Stop-Hunt: Die letzten Kerzen haben die Marke unterschritten und sind zurückgekehrt – die schwachen Hände sind raus.`);
  return b;
}

function sentimentBlock(k, markt, news) {
  const s = { zeilen: [], anpassungen: [] };
  s.zeilen.push(markt
    ? `Fear & Greed: ${markt.wert} (${markt.stufe}) – Quelle: ${markt.quelle}`
    : 'Fear & Greed: nicht verfügbar – Filter nur über RSI und News');
  s.zeilen.push(`RSI(14): ${de(k.rsi14, 0)}${k.rsi14 > 70 ? ' (überkauft)' : k.rsi14 < 30 ? ' (überverkauft)' : ''}`
    + ` · Abstand zur 20-Tage-Linie: ${de(k.abstand_sma20_atr, 1)} ATR`);
  s.zeilen.push(news
    ? `News/Social: ${news.label} (Score ${de(news.score, 2)}), ${news.artikel24h} Artikel in 24 h (Schnitt ${de(news.artikelSchnitt, 1)}/Tag)`
    : 'News/Social: keine Daten (optional mit Alpha-Vantage-Schlüssel)');
  if (markt?.stufe === 'Extreme Angst') s.anpassungen.push('Extreme Angst: nur antizyklische Long-Einstiege an charttechnischen Böden, keine Shorts.');
  return s;
}

function schutzBlock(erg, p, richtung, real, regeln) {
  const A = erg.kennzahlen.atr;
  const long = richtung === 'LONG';
  const t = erg.tranchen;
  const fmt = (x) => de(x);
  const zeilen = [];
  const runde = p.kaufRund.length ? ` und runde Zahl ${p.kaufRund.map((x) => fmt(real(x))).join('/')}` : '';
  const bis = Math.abs(p.massenKauf - p.S.preis) > 0.01 ? ` (bis ${fmt(real(p.massenKauf))})` : '';
  zeilen.push(`Frontrunning: Die Masse ${long ? 'kauft' : 'verkauft'} an ${p.S.name}${runde}${bis}. `
    + `Dein ${long ? 'Kauf' : 'Verkauf'}-Limit liegt ${de((Math.abs((t.find((x) => x.rolle === 'vor der Masse') ?? t[0]).preis - real(p.massenKauf)) / A), 2)} ATR davor – du wirst vor den Frontrunnern ausgeführt.`);
  const stopRund = p.stopMagnete.length ? ` und knapp ${long ? 'unter' : 'über'} ${p.stopMagnete.map((x) => fmt(real(x))).join('/')}` : '';
  zeilen.push(`Stop-Hunting: Stops der Masse liegen knapp ${long ? 'unter' : 'über'} ${fmt(real(p.L))}${stopRund}. `
    + `Dein Stop ${fmt(erg.stop)} liegt ${de((Math.abs(erg.stop - real(p.jagdBoden)) / A), 2)} ATR dahinter, außerhalb der typischen Jagdtiefe.`);
  if (t.length === 3) {
    zeilen.push(`Staffel: Tranche 3 (${fmt(t[2].preis)}) liegt bewusst in der Jagdzone – wird dort gejagt, `
      + `${long ? 'kaufst du die ausgestoppten Stücke billig' : 'verkaufst du den ausgestoppten Shorts teuer'}.`);
  }
  zeilen.push(`Kursziel ${fmt(erg.ziel)} liegt vor ${p.widerstand ? p.widerstand.name : 'der Zielzone'}, wo die Masse Gewinne mitnimmt – du ${long ? 'verkaufst' : 'deckst'} vor ihr${long ? '' : ' ein'}.`);
  zeilen.push('Krumme Preise (keine x,00/x,50, kein Vielfaches von 5 Cent) und ein persönlicher Versatz je Nutzer: Die Community legt ihre Orders nicht auf denselben Cent.');
  zeilen.push(`Limit-Order nur bis ${erg.haltedauer.limitGueltigBis ? datumDe(erg.haltedauer.limitGueltigBis) : `${regeln.limitGueltigTage} Handelstage`} gültig. Nicht ausgeführt = Setup verpasst, nicht hinterherlaufen.`);
  zeilen.push(`Reclaim-Regel: Wirst du ausgestoppt und schließt der Kurs innerhalb von 2 Tagen wieder ${long ? 'über' : 'unter'} ${fmt(real(p.S.min))}, `
    + 'einmal mit halber Größe neu einsteigen (gleicher Stop-Abstand).');
  zeilen.push('Stop-Order erst nach den ersten 15 Handelsminuten scharf schalten (Eröffnungs-Spikes), sonst Kursalarm statt Order.');
  return zeilen;
}
