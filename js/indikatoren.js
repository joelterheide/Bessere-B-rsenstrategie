// Indikatoren auf Kerzen (älteste zuerst): {datum, eroeffnung, hoch, tief, schluss, volumen}

export function sma(werte, n) {
  if (werte.length < n) return null;
  let s = 0;
  for (let i = werte.length - n; i < werte.length; i++) s += werte[i];
  return s / n;
}

export function ema(werte, n) {
  if (werte.length < n) return null;
  const k = 2 / (n + 1);
  let e = sma(werte.slice(0, n), n);
  for (let i = n; i < werte.length; i++) e = werte[i] * k + e * (1 - k);
  return e;
}

// RSI mit Wilder-Glättung (wie im planspiel-bot)
export function rsi(werte, n = 14) {
  if (werte.length <= n) return null;
  let g = 0, v = 0;
  for (let i = 1; i <= n; i++) {
    const d = werte[i] - werte[i - 1];
    g += Math.max(d, 0);
    v += Math.max(-d, 0);
  }
  g /= n;
  v /= n;
  for (let i = n + 1; i < werte.length; i++) {
    const d = werte[i] - werte[i - 1];
    g = (g * (n - 1) + Math.max(d, 0)) / n;
    v = (v * (n - 1) + Math.max(-d, 0)) / n;
  }
  if (v === 0) return 100;
  return 100 - 100 / (1 + g / v);
}

// Durchschnittliche True Range der letzten n Kerzen
export function atr(kerzen, n = 14) {
  if (kerzen.length <= n) return null;
  let s = 0;
  for (let i = kerzen.length - n; i < kerzen.length; i++) {
    const a = kerzen[i - 1], b = kerzen[i];
    s += Math.max(b.hoch - b.tief, Math.abs(b.hoch - a.schluss), Math.abs(b.tief - a.schluss));
  }
  return s / n;
}

// Swing-Tiefs und -Hochs: Extrem gegenüber je `breite` Kerzen links und rechts
export function pivots(kerzen, breite = 3) {
  const tiefs = [], hochs = [];
  for (let i = breite; i < kerzen.length - breite; i++) {
    let tief = true, hoch = true;
    for (let j = i - breite; j <= i + breite && (tief || hoch); j++) {
      if (j === i) continue;
      if (kerzen[j].tief <= kerzen[i].tief) tief = false;
      if (kerzen[j].hoch >= kerzen[i].hoch) hoch = false;
    }
    if (tief) tiefs.push({ preis: kerzen[i].tief, index: i, art: 'tief' });
    if (hoch) hochs.push({ preis: kerzen[i].hoch, index: i, art: 'hoch' });
  }
  return { tiefs, hochs };
}

// Fasst nahe Swing-Punkte zu Zonen zusammen. Alte Widerstände werden zu Unterstützungen und umgekehrt,
// deshalb kommen Hochs und Tiefs in einen Topf.
export function zonen(punkte, toleranz, anzahlKerzen) {
  const sortiert = [...punkte].sort((a, b) => a.preis - b.preis);
  const liste = [];
  for (const p of sortiert) {
    const z = liste[liste.length - 1];
    if (z && p.preis - z.preis <= toleranz) {
      z.punkte.push(p);
      z.preis = z.punkte.reduce((s, q) => s + q.preis, 0) / z.punkte.length;
      z.min = Math.min(z.min, p.preis);
      z.max = Math.max(z.max, p.preis);
      z.letzter = Math.max(z.letzter, p.index);
    } else {
      liste.push({ preis: p.preis, min: p.preis, max: p.preis, letzter: p.index, punkte: [p] });
    }
  }
  for (const z of liste) {
    z.beruehrungen = z.punkte.length;
    // jüngere Zonen zählen mehr
    z.staerke = z.beruehrungen + z.letzter / anzahlKerzen;
    delete z.punkte;
  }
  return liste;
}

export function kennzahlen(kerzen) {
  const s = kerzen.map((k) => k.schluss);
  const n = kerzen.length;
  const kurs = s[n - 1];
  const a = atr(kerzen);
  const vol20 = n > 21 ? kerzen.slice(-21, -1).reduce((x, k) => x + (k.volumen || 0), 0) / 20 : null;
  const letzte = kerzen[n - 1], vortag = kerzen[n - 2];
  return {
    kurs,
    atr: a,
    sma20: sma(s, 20),
    sma50: sma(s, 50),
    sma50_vor10: sma(s.slice(0, -10), 50),
    sma100: sma(s, 100),
    sma200: sma(s, 200),
    ema20: ema(s, 20),
    rsi14: rsi(s, 14),
    rsi2: rsi(s.slice(-30), 2),
    hoch20: Math.max(...kerzen.slice(-21, -1).map((k) => k.hoch)),
    tief20: Math.min(...kerzen.slice(-21, -1).map((k) => k.tief)),
    hoch52: Math.max(...kerzen.slice(-252).map((k) => k.hoch)),
    tief52: Math.min(...kerzen.slice(-252).map((k) => k.tief)),
    perf5: n > 5 ? (kurs / s[n - 6] - 1) * 100 : null,
    perf20: n > 20 ? (kurs / s[n - 21] - 1) * 100 : null,
    bewegung5_atr: n > 5 && a ? (kurs - s[n - 6]) / a : null,
    abstand_sma20_atr: a && sma(s, 20) ? (kurs - sma(s, 20)) / a : null,
    vol_faktor: vol20 ? (letzte.volumen || 0) / vol20 : null,
    gap_atr: a && vortag ? (letzte.eroeffnung - vortag.schluss) / a : null,
  };
}
