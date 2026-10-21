// Künstliche Kursverläufe für die Tests (deterministisch)

function datumListe(n, ende = '2026-10-20') {
  const tage = [];
  const d = new Date(ende + 'T12:00:00Z');
  while (tage.length < n) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) tage.unshift(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return tage;
}

// Schlusskurse → Kerzen mit fester Spanne
export function kerzenAus(schluesse, spanne = 1.2, ende) {
  const tage = datumListe(schluesse.length, ende);
  return schluesse.map((c, i) => {
    const vor = i ? schluesse[i - 1] : c;
    return {
      datum: tage[i], eroeffnung: vor, schluss: c,
      hoch: Math.max(vor, c) + spanne / 2, tief: Math.min(vor, c) - spanne / 2, volumen: 1_000_000,
    };
  });
}

// Aufwärtstrend mit Wellen; am Ende Rücksetzer auf das letzte Wellentief
export function aufwaertsRuecksetzer(basis = 100) {
  const s = [];
  for (let i = 0; i < 230; i++) s.push(basis * (0.7 + 0.0015 * i) + basis * 0.04 * Math.sin(i / 5));
  return s;
}

export function spiegelSchluesse(s, achse) {
  return s.map((x) => 2 * achse - x);
}

// Steiler Anstieg der letzten Tage (Hype)
export function hype(basis = 100) {
  const s = aufwaertsRuecksetzer(basis).slice(0, 220);
  let x = s[s.length - 1];
  for (let i = 0; i < 10; i++) s.push((x *= 1.045));
  return s;
}
