// Kerzenchart (SVG) mit eigenen Levels und den Zonen, an denen die Masse handelt.
// Kerzen bleiben grau, damit die Levels die Hauptrolle spielen.

import { magnete } from './schutz.js';
import { zahl } from './format.js';

const NS = 'http://www.w3.org/2000/svg';

function el(name, attrs = {}, eltern) {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (eltern) eltern.appendChild(e);
  return e;
}

function text(eltern, x, y, inhalt, attrs = {}) {
  const t = el('text', { x, y, ...attrs }, eltern);
  t.textContent = inhalt;
  return t;
}

export function zeichneChart(container, tooltip, r, kerzen) {
  container.replaceChildren();
  // in echter Pixelbreite zeichnen, damit die Schrift auf dem Handy nicht mitschrumpft
  const B = Math.max(300, Math.round(container.clientWidth || 760));
  const H = Math.round(Math.min(400, Math.max(280, B * 0.5)));
  const sicht = kerzen.slice(B < 560 ? -60 : -90);
  const A = r.kennzahlen?.atr || 0;
  const e = r.ebenen;
  const linien = [];
  if (r.status === 'setup' || r.verworfen) {
    r.tranchen.forEach((t, i) => linien.push({ preis: t.preis, art: 'einstieg', label: r.tranchen.length > 1 ? `Einstieg ${i + 1}` : 'Einstieg' }));
    linien.push({ preis: r.ziel, art: 'ziel', label: 'Kursziel' });
    linien.push({ preis: r.stop, art: 'stop', label: 'Stop' });
  }
  if (r.beobachten) linien.push({ preis: r.beobachten, art: 'beobachten', label: 'Beobachten' });

  const baender = [];
  if (e) {
    const unten = (a, b) => [Math.min(a, b), Math.max(a, b)];
    const [k1, k2] = unten(e.unterstuetzung, e.massenKauf);
    baender.push({ von: k1 - 0.04 * A, bis: k2 + 0.04 * A, label: r.richtung === 'SHORT' ? 'Masse verkauft' : 'Masse kauft' });
    const jagd = r.richtung === 'SHORT' ? e.jagdBoden + 0.25 * A : e.jagdBoden - 0.25 * A;
    const [s1, s2] = unten(jagd, e.tief);
    baender.push({ von: s1, bis: s2, label: 'Stops der Masse (Jagdzone)' });
  }

  const werte = [...sicht.flatMap((k) => [k.hoch, k.tief]), ...linien.map((l) => l.preis), ...baender.flatMap((b) => [b.von, b.bis])];
  let min = Math.min(...werte), max = Math.max(...werte);
  const rand = (max - min) * 0.06;
  min -= rand;
  max += rand;

  const links = 8, rechts = B < 560 ? 120 : 128, oben = 18, unten = 26;
  const breite = B - links - rechts, hoehe = H - oben - unten;
  const x = (i) => links + (i + 0.5) * (breite / sicht.length);
  const y = (p) => oben + (1 - (p - min) / (max - min)) * hoehe;

  const svg = el('svg', { viewBox: `0 0 ${B} ${H}`, class: 'chart', role: 'img', 'aria-label': `Kurschart ${r.symbol} mit Levels` }, container);

  // Beschriftungen der eigenen Levels rechts; überlappende rücken auseinander und bekommen Führungslinien
  const marken = linien.map((l) => ({ ...l, y: y(l.preis) })).sort((a, b) => a.y - b.y);
  let letztes = -Infinity;
  for (const m of marken) {
    m.ly = Math.max(m.y, letztes + 15);
    letztes = m.ly;
  }

  // Raster: wenige runde Preise; Achsenbeschriftung entfällt, wo eine Level-Beschriftung steht
  const schritt = schoenerSchritt((max - min) / 5);
  for (let p = Math.ceil(min / schritt) * schritt; p <= max; p += schritt) {
    el('line', { x1: links, x2: links + breite, y1: y(p), y2: y(p), class: 'raster' }, svg);
    if (marken.some((m) => Math.abs(m.ly - y(p)) < 14)) continue;
    text(svg, B - 4, y(p) + 4, zahl(p, schritt < 1 ? 2 : 0), { class: 'achse', 'text-anchor': 'end' });
  }
  // Monatsbeschriftung
  let monat = '';
  sicht.forEach((k, i) => {
    const m = k.datum.slice(0, 7);
    if (m !== monat) {
      monat = m;
      if (i > 2) text(svg, x(i), H - 8, new Date(k.datum + 'T12:00:00Z').toLocaleDateString('de-DE', { month: 'short' }), { class: 'achse', 'text-anchor': 'middle' });
    }
  });

  // Zonen der Masse (Beschriftung kommt zuletzt, damit keine Linie darüber läuft)
  baender.sort((a, b) => b.bis - a.bis);
  for (const b of baender) {
    el('rect', { x: links, width: breite, y: y(b.bis), height: Math.max(2, y(b.von) - y(b.bis)), class: 'band' }, svg);
  }
  // runde Zahlen im Bild
  if (A) {
    for (const m of magnete(min, max, A, r.kurs)) {
      el('line', { x1: links, x2: links + breite, y1: y(m.preis), y2: y(m.preis), class: 'rund' }, svg);
    }
  }

  // Kerzen
  const kb = Math.max(2, Math.min(8, (breite / sicht.length) * 0.6));
  sicht.forEach((k, i) => {
    el('line', { x1: x(i), x2: x(i), y1: y(k.hoch), y2: y(k.tief), class: 'docht' }, svg);
    const steigt = k.schluss >= k.eroeffnung;
    el('rect', {
      x: x(i) - kb / 2, width: kb, y: y(Math.max(k.eroeffnung, k.schluss)),
      height: Math.max(1, Math.abs(y(k.eroeffnung) - y(k.schluss))), class: steigt ? 'kerze steigt' : 'kerze faellt',
    }, svg);
  });

  for (const m of marken) {
    el('line', { x1: links, x2: links + breite, y1: m.y, y2: m.y, class: `level ${m.art}` }, svg);
    el('line', { x1: links + breite, x2: links + breite + 8, y1: m.y, y2: m.ly, class: 'fuehrung' }, svg);
    text(svg, links + breite + 11, m.ly + 4, `${m.label} ${zahl(m.preis)}`, { class: 'levellabel' });
  }
  // obere Zone darüber beschriften, untere darunter
  baender.forEach((b, i) => text(svg, links + 4, i === 0 ? y(b.bis) - 5 : y(b.von) + 13, b.label, { class: 'bandlabel' }));

  // Fadenkreuz + Tooltip
  const kreuz = el('line', { y1: oben, y2: oben + hoehe, class: 'kreuz', visibility: 'hidden' }, svg);
  const flaeche = el('rect', { x: links, y: oben, width: breite, height: hoehe, fill: 'transparent', tabindex: 0 }, svg);
  const zeigen = (i) => {
    const k = sicht[i];
    kreuz.setAttribute('x1', x(i));
    kreuz.setAttribute('x2', x(i));
    kreuz.setAttribute('visibility', 'visible');
    tooltip.replaceChildren();
    const kopf = document.createElement('div');
    kopf.className = 'tt-kopf';
    kopf.textContent = new Date(k.datum + 'T12:00:00Z').toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
    tooltip.appendChild(kopf);
    for (const [name, wert] of [['Schluss', k.schluss], ['Hoch', k.hoch], ['Tief', k.tief], ['Eröffnung', k.eroeffnung]]) {
      const z = document.createElement('div');
      const w = document.createElement('strong');
      w.textContent = zahl(wert);
      z.append(w, ` ${name}`);
      tooltip.appendChild(z);
    }
    const rahmen = container.getBoundingClientRect();
    const px = (x(i) / B) * rahmen.width;
    tooltip.style.left = `${Math.min(px + 12, rahmen.width - 150)}px`;
    tooltip.style.top = '12px';
    tooltip.hidden = false;
  };
  const verbergen = () => { kreuz.setAttribute('visibility', 'hidden'); tooltip.hidden = true; };
  let aktiv = sicht.length - 1;
  flaeche.addEventListener('pointermove', (ev) => {
    const r2 = svg.getBoundingClientRect();
    const sx = ((ev.clientX - r2.left) / r2.width) * B;
    aktiv = Math.max(0, Math.min(sicht.length - 1, Math.round((sx - links) / (breite / sicht.length) - 0.5)));
    zeigen(aktiv);
  });
  flaeche.addEventListener('pointerleave', verbergen);
  flaeche.addEventListener('focus', () => zeigen(aktiv));
  flaeche.addEventListener('blur', verbergen);
  flaeche.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowLeft') zeigen((aktiv = Math.max(0, aktiv - 1)));
    if (ev.key === 'ArrowRight') zeigen((aktiv = Math.min(sicht.length - 1, aktiv + 1)));
  });
}

function schoenerSchritt(roh) {
  const basis = 10 ** Math.floor(Math.log10(roh));
  for (const f of [1, 2, 2.5, 5, 10]) if (f * basis >= roh) return f * basis;
  return 10 * basis;
}
