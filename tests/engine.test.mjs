import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { analysiere, positionsgroesse } from '../js/engine.js';
import { alsText } from '../js/format.js';
import { atr, rsi, sma } from '../js/indikatoren.js';
import { krumm, magnete, zufallsquelle } from '../js/schutz.js';
import { marktProxy, newsAuswerten, stufe } from '../js/sentiment.js';
import { aufwaertsRuecksetzer, hype, kerzenAus, spiegelSchluesse } from './szenarien.js';

const isrg = JSON.parse(readFileSync(new URL('../demo/isrg.json', import.meta.url)));
const neutral = { markt: { wert: 50, quelle: 'Test' } };
const setupKerzen = () => kerzenAus(aufwaertsRuecksetzer(100).slice(0, 207));
const lauf = (extra = {}) => analysiere({
  symbol: 'TEST', kerzen: setupKerzen(), heute: '2026-10-21', sentiment: neutral,
  einstellungen: { salt: 'nutzer-a', kapital: 10000, risikoPct: 1 }, ...extra,
});
const vielfachVon5Cent = (p) => Math.round(Math.abs(p) * 100) % 5 === 0;

// Alle Setups über mehrere Tage und Nutzer: die Eigenschaften müssen für jeden Versatz gelten
function alleSetups(schluesse) {
  const setups = [];
  for (let ende = 195; ende <= 225; ende++) {
    for (const salt of ['a', 'b', 'c', 'd', 'e', 'f']) {
      const r = analysiere({
        symbol: 'TEST', kerzen: kerzenAus(schluesse.slice(0, ende)), heute: '2026-10-21', sentiment: neutral,
        einstellungen: { salt, kapital: 10000, risikoPct: 1 },
      });
      if (r.status === 'setup') setups.push(r);
    }
  }
  return setups;
}
const longSetups = alleSetups(aufwaertsRuecksetzer(100));
const shortSetups = alleSetups(spiegelSchluesse(aufwaertsRuecksetzer(100), 150));

test('Indikatoren', () => {
  assert.equal(sma([1, 2, 3, 4], 2), 3.5);
  assert.equal(rsi([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], 14), 100);
  const k = kerzenAus([10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10], 2);
  assert.equal(atr(k), 2);
});

test('runde Zahlen: Stufen passend zur Volatilität', () => {
  // ISRG ~418 $, ATR ~12: 10er-Stufen sind zu dicht, 400 und 450 zählen
  assert.deepEqual(magnete(380, 460, 12).map((m) => m.preis), [400, 450]);
  // 100-€-Aktie mit ATR 2: 5er-Stufen zählen, egal ob der Kurs bei 98 oder 101 steht
  assert.deepEqual(magnete(85, 112, 2, 98.5).map((m) => m.preis), [85, 90, 95, 100, 105, 110]);
  assert.deepEqual(magnete(85, 112, 2, 101).map((m) => m.preis), [85, 90, 95, 100, 105, 110]);
  assert.equal(magnete(395, 405, 12, 418)[0].gewicht, 2);
  // gespiegelte Kurse (Shorts) funktionieren genauso
  assert.deepEqual(magnete(-460, -380, 12).map((m) => m.preis), [-450, -400]);
});

test('krumme Preise', () => {
  assert.equal(krumm(100, 1), 100.01);
  assert.equal(krumm(99.95, -1), 99.94);
  // Stop nicht in x,90–x,99 (dort liegen die Stops der Masse)
  const s = krumm(97.96, -1, { stop: true, zufall: () => 0 });
  assert.ok(s <= 97.87, `Stop ${s}`);
  // gespiegelt: Short-Stop knapp über 418 → weiter nach oben
  assert.ok(-krumm(-418.05, -1, { stop: true, zufall: () => 0 }) >= 418.13);
  for (let x = 10; x < 11; x += 0.01) assert.ok(!vielfachVon5Cent(krumm(x, 1)));
});

test('Zufall je Nutzer ist reproduzierbar, aber verschieden', () => {
  const a1 = zufallsquelle('a|X|2026-10-20'), a2 = zufallsquelle('a|X|2026-10-20'), b = zufallsquelle('b|X|2026-10-20');
  const x = a1();
  assert.equal(x, a2());
  assert.notEqual(x, b());
});

test('Long-Setups: Format, CRV, Reihenfolge der Level, Risiko', () => {
  assert.ok(longSetups.length >= 10, `nur ${longSetups.length} Setups`);
  for (const r of longSetups) {
    assert.equal(r.richtung, 'LONG');
    assert.ok(r.crv >= 2, `CRV ${r.crv}`);
    assert.ok(r.tranchen.length === 1 || r.crvT1 >= 1.5);
    assert.ok(r.stop < Math.min(...r.tranchen.map((t) => t.preis)));
    assert.ok(Math.max(...r.tranchen.map((t) => t.preis)) < r.ziel);
    assert.ok(r.position.maxVerlust <= r.position.budget + 1e-9);
    assert.ok(r.haltedauer.tage >= 3 && r.haltedauer.tage <= 10);
    for (const p of [r.stop, r.ziel, ...r.tranchen.map((t) => t.preis)]) assert.ok(!vielfachVon5Cent(p), `${p} ist rund`);
  }
  const txt = alsText(longSetups[0], { kapital: 10000, risikoPct: 1 });
  for (const kopf of ['1. MARKT-SETUP & RICHTUNG', '2. SCHLÜSSEL-LEVELS', '3. RISIKO-MANAGEMENT (CRV)', '4. ZEITHORIZONT',
    '5. MARKTPSYCHOLOGIE & SENTIMENT-FILTER', '6. AUSFÜHRUNGSSCHUTZ']) assert.ok(txt.includes(kopf), kopf);
});

test('Anti-Frontrunning: Einstieg über der Kaufzone der Masse, nie knapp unter einer runden Zahl', () => {
  for (const r of longSetups) {
    const A = r.kennzahlen.atr;
    const vorMasse = r.tranchen.find((t) => t.rolle === 'vor der Masse');
    if (vorMasse) assert.ok(vorMasse.preis > r.ebenen.massenKauf || vorMasse.preis >= r.kurs, `${vorMasse.preis} nicht über der Masse`);
    for (const t of r.tranchen.filter((x) => x.rolle !== 'Jagdzone')) {
      for (const m of magnete(t.preis - A, t.preis + A, A, r.kurs)) {
        assert.ok(!(t.preis < m.preis && m.preis - t.preis < 0.1 * A && t.preis < r.kurs), `${t.preis} knapp unter ${m.preis}`);
      }
    }
  }
});

test('Anti-Stop-Hunting: Stop deutlich hinter Tief und runden Zahlen', () => {
  for (const r of [...longSetups, ...shortSetups]) {
    const A = r.kennzahlen.atr;
    const s = r.richtung === 'LONG' ? 1 : -1; // gespiegelt rechnen
    assert.ok(s * (r.ebenen.tief - r.stop) >= 0.5 * A, `Stop ${r.stop} zu nah am Tief ${r.ebenen.tief}`);
    for (const m of magnete(r.stop - A, r.stop + A, A, r.kurs)) {
      const abstand = s * (m.preis - r.stop);
      assert.ok(!(abstand > 0 && abstand < 0.25 * A), `Stop ${r.stop} knapp hinter ${m.preis}`);
    }
  }
});

test('Versatz je Nutzer: andere Level, gleiche Person stabil', () => {
  const a = lauf({ einstellungen: { salt: 'nutzer-a' } });
  const a2 = lauf({ einstellungen: { salt: 'nutzer-a' } });
  const b = lauf({ einstellungen: { salt: 'nutzer-b' } });
  assert.deepEqual(a.tranchen, a2.tranchen);
  assert.notDeepEqual([a.stop, ...a.tranchen.map((t) => t.preis)], [b.stop, ...b.tranchen.map((t) => t.preis)]);
});

test('Short: gespiegelter Abwärtstrend, Level in umgekehrter Reihenfolge; nurLong verweigert', () => {
  assert.ok(shortSetups.length >= 10, `nur ${shortSetups.length} Setups`);
  for (const r of shortSetups) {
    assert.equal(r.richtung, 'SHORT');
    assert.ok(r.stop > Math.max(...r.tranchen.map((t) => t.preis)));
    assert.ok(Math.min(...r.tranchen.map((t) => t.preis)) > r.ziel);
    assert.ok(r.crv >= 2);
  }
  const s = spiegelSchluesse(aufwaertsRuecksetzer(100).slice(0, 207), 150);
  const nurLong = analysiere({ symbol: 'TEST', kerzen: kerzenAus(s), sentiment: neutral, einstellungen: { nurLong: true } });
  assert.equal(nurLong.status, 'kein_setup');
  assert.match(nurLong.gruende[0], /Short-Bias/);
});

test('Extreme Gier: Kursziel-Abstand −15 %, Stop enger', () => {
  const n = lauf();
  const g = lauf({ sentiment: { markt: { wert: 85, quelle: 'Test' } } });
  const abstandOhne = g.ebenen.zielOhneGier - g.schnitt;
  assert.ok(Math.abs((g.ziel - g.schnitt) - abstandOhne * 0.85) < 0.06, `${g.ziel} vs ${g.ebenen.zielOhneGier}`);
  assert.ok(g.schnitt - g.stop < n.schnitt - n.stop, 'Stop nicht enger');
  assert.match(g.sentiment.anpassungen.join(' '), /Extreme Gier/);
});

test('FOMO/Hype wird verweigert', () => {
  const r = analysiere({ symbol: 'HYPE', kerzen: kerzenAus(hype(100)), sentiment: neutral });
  assert.equal(r.status, 'warnung');
  assert.match(r.gruende[0], /FOMO/);
});

test('Extreme Angst: kein Short, Long nur an Boden mit Umkehr', () => {
  const s = spiegelSchluesse(aufwaertsRuecksetzer(100).slice(0, 207), 150);
  const r = analysiere({ symbol: 'TEST', kerzen: kerzenAus(s), sentiment: { markt: { wert: 12, quelle: 'Test' } } });
  assert.notEqual(r.richtung, 'SHORT');
  assert.ok(r.status !== 'setup' || r.setupTyp.startsWith('Antizyklisch'));
  assert.match(r.hinweise.join(' '), /kein Short in extremer Angst/);
});

test('ISRG am Zahlentag (21.10.2026): Event-Gap → kein Setup', () => {
  const r = analysiere({ symbol: 'ISRG', kerzen: isrg.kerzen, heute: '2026-10-21', sentiment: neutral });
  assert.equal(r.status, 'kein_setup');
  assert.match(r.gruende[0], /Event-Tag/);
});

test('Positionsgröße: Risiko bleibt in jedem Ausführungszustand im Budget', () => {
  const tranchen = [{ preis: 100.74, anteil: 0.4 }, { preis: 100.41, anteil: 0.35 }, { preis: 99.82, anteil: 0.25 }];
  const p = positionsgroesse(tranchen, 98.84, 103.93, { kapital: 25000, risikoPct: 2, gebuehr: 5, fx: 0.86, maxPositionPct: 100 });
  assert.ok(p.maxVerlust <= p.budget);
  assert.equal(p.jeTranche.reduce((a, b) => a + b, 0), p.stueck);
  const nurErste = p.jeTranche[0] * (100.74 - 98.84) * 0.86 + 2 * 5;
  assert.ok(nurErste <= p.budget);
});

test('Sentiment: Stufen, SPY-Ersatzwert, News', () => {
  assert.equal(stufe(10), 'Extreme Angst');
  assert.equal(stufe(50), 'Neutral');
  assert.equal(stufe(80), 'Extreme Gier');
  const proxy = marktProxy(kerzenAus(aufwaertsRuecksetzer(400)));
  assert.ok(proxy.wert >= 0 && proxy.wert <= 100);
  const news = newsAuswerten({
    feed: [
      { time_published: '20261021T100000', ticker_sentiment: [{ ticker: 'ISRG', ticker_sentiment_score: '0.4', relevance_score: '1' }] },
      { time_published: '20261015T100000', ticker_sentiment: [{ ticker: 'ISRG', ticker_sentiment_score: '0.2', relevance_score: '1' }] },
    ],
  }, 'ISRG', new Date(Date.UTC(2026, 9, 21, 14)));
  assert.equal(news.artikel24h, 1);
  assert.ok(Math.abs(news.score - 0.3) < 1e-9);
});
