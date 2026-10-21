// Ausführungsschutz gegen Frontrunning und Stop-Hunting.
//
// Idee: Orders der Masse sammeln sich an runden Zahlen und an offensichtlichen Chartmarken
// (Osler 2003: Gewinnziele genau auf runden Zahlen, Stops knapp dahinter). Wer dort handelt,
// wird vorgekauft bzw. ausgestoppt. Deshalb liegen eigene Orders leicht VOR der Masse (Einstieg, Ziel)
// oder deutlich HINTER ihr (Stop), auf krummen Preisen und je Nutzer leicht versetzt.
//
// Alle Funktionen rechnen "long-orientiert": oben = Gewinnrichtung. Für Shorts spiegelt die Engine
// die Kurse (Vorzeichen umdrehen), deshalb funktionieren sie auch mit negativen Werten.

// Stufen runder Zahlen (1-5-Reihe: …, 1, 5, 10, 50, 100, …). Zu dichte Stufen wirken nicht als Magnet:
// sie müssen mindestens eine ATR und 2,5 % des Kurses auseinanderliegen (bei 418 $ also 50/100, bei 100 € 5/10/50/100).
export function rundeStufen(preis, atr = 0) {
  const p = Math.abs(preis);
  const min = Math.max(atr, p / 40);
  const stufen = [];
  for (let e = Math.floor(Math.log10(p)) - 4; e <= Math.ceil(Math.log10(p)); e++) {
    for (const f of [1, 5]) {
      const stufe = f * 10 ** e;
      if (stufe >= min && stufe <= 2 * p) stufen.push(stufe);
    }
  }
  return stufen;
}

// Runde Zahlen zwischen von und bis; gewicht = wie viele Stufen dort zusammenfallen (400 zählt doppelt: 50er und 100er)
export function magnete(von, bis, atr, referenz = (von + bis) / 2) {
  const treffer = new Map();
  for (const stufe of rundeStufen(referenz, atr)) {
    for (let k = Math.ceil(von / stufe - 1e-9); k * stufe <= bis + 1e-9; k++) {
      const preis = runde(k * stufe, 1e-6);
      treffer.set(preis, { preis, gewicht: (treffer.get(preis)?.gewicht || 0) + 1 });
    }
  }
  return [...treffer.values()].sort((a, b) => a.preis - b.preis);
}

export function tickGroesse(preis) {
  return Math.abs(preis) < 1 ? 0.0001 : 0.01;
}

function runde(x, tick) {
  return Math.round(x / tick) * tick;
}

// Krummer Preis: kein Vielfaches von 5 Ticks (also nicht x,x0 oder x,x5). Stops zusätzlich nicht in den
// letzten 10 Cent vor einer ganzen Zahl, wo Stops der Masse liegen. richtung +1 = nach oben verschieben.
export function krumm(preis, richtung, { stop = false, maxVerschiebung = Infinity, zufall = Math.random } = {}) {
  const tick = tickGroesse(preis);
  let p = runde(preis, tick);
  if (stop && tick === 0.01) {
    const bruch = p - Math.floor(p);
    // in Stop-Richtung (nach unten) über die Cluster-Zone x,90–x,99 hinaus
    if (richtung < 0 && bruch >= 0.895) {
      const neu = Math.floor(p) + 0.87 - Math.floor(zufall() * 4) * 0.01;
      if (p - neu <= maxVerschiebung) p = neu;
    }
  }
  for (let i = 0; i < 5 && Math.round(p / tick) % 5 === 0; i++) p += richtung * tick;
  return Number(p.toFixed(tick === 0.01 ? 2 : 4));
}

// Deterministischer Zufall je Nutzer, Wert und Tag: jeder Nutzer bekommt eigene Level,
// dieselbe Person sieht beim Neuladen aber dieselben.
export function zufallsquelle(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  let a = h >>> 0;
  return function mulberry32() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Faktor um 1 herum (±streuung), damit Abstände je Nutzer variieren
export function streu(zufall, streuung = 0.25) {
  return 1 - streuung + 2 * streuung * zufall();
}
