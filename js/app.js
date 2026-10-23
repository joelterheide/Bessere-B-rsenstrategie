import { analysiere, datumDe, STANDARD_EINSTELLUNGEN } from './engine.js';
import { alsText, zahl } from './format.js';
import { zeichneChart } from './chart.js';
import { claudePrompt } from './prompt.js';
import {
  DatenFehler, intradayAus, intradaykerzen, marktSentiment, newsSentiment, symbolLesen, tageskerzen, wechselkurs,
} from './daten.js';

const $ = (id) => document.getElementById(id);
const SPEICHER = 'einstellungen';

// ---------- Einstellungen ----------

function neuerSalt() {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

function ladeEinstellungen() {
  let gespeichert = {};
  try { gespeichert = JSON.parse(localStorage.getItem(SPEICHER)) || {}; } catch { /* leer */ }
  const e = { ...STANDARD_EINSTELLUNGEN, tdKey: '', avKey: '', creditsMinute: 8, watchlist: '', ansicht: 'tag', ...gespeichert };
  if (!e.salt || e.salt === 'standard') e.salt = neuerSalt();
  return e;
}

let einst = ladeEinstellungen();

function speichern() {
  try { localStorage.setItem(SPEICHER, JSON.stringify(einst)); } catch { /* privates Fenster */ }
}

function formularFuellen() {
  const f = $('formular');
  for (const el of f.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') el.checked = !!einst[el.name];
    else el.value = einst[el.name] ?? '';
  }
  $('wl').value = einst.watchlist || '';
}

$('formular').addEventListener('change', (ev) => {
  const el = ev.target;
  if (!el.name) return;
  einst[el.name] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value.trim();
  if (el.name === 'risikoPct') einst.risikoPct = Math.min(2, Math.max(0.1, einst.risikoPct || 1));
  speichern();
  if (letzte) neuAnalysieren();
});
$('salt-neu').addEventListener('click', () => {
  einst.salt = neuerSalt();
  speichern();
  formularFuellen();
  if (letzte) neuAnalysieren();
});
$('wl').addEventListener('change', () => { einst.watchlist = $('wl').value; speichern(); });

// ---------- Analyse ----------

let letzte = null; // { sym, kerzen, waehrung, markt, news, fx, heute, demo, intraday }
let timer = null;

function meldung(text, fehler = false) {
  $('meldung').textContent = text;
  $('meldung').classList.toggle('fehler', fehler);
}

function heuteIn(zeitzone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zeitzone || 'Europe/Berlin' }).format(new Date());
}

async function datenHolen(sym) {
  if (!einst.tdKey) throw new DatenFehler('Bitte zuerst den Twelve-Data-API-Key in den Einstellungen eintragen (oder „Demo“ nutzen).');
  const { kerzen, waehrung, zeitzone } = await tageskerzen(sym, einst.tdKey);
  const [markt, news, fx] = await Promise.all([
    marktSentiment(sym.art, einst.tdKey).catch(() => null),
    newsSentiment(sym, einst.avKey).catch(() => null),
    wechselkurs(waehrung, einst.kapitalWaehrung, einst.tdKey).catch(() => null),
  ]);
  return { sym, kerzen, waehrung, markt, news, fx, heute: heuteIn(zeitzone) };
}

function rechnen(d) {
  const hinweise = [];
  if (d.fx == null) hinweise.push(`Wechselkurs ${d.waehrung}/${einst.kapitalWaehrung} nicht verfügbar – Positionsgröße ohne Umrechnung.`);
  const r = analysiere({
    symbol: d.sym.anzeige, kerzen: d.kerzen, waehrung: d.waehrung, heute: d.heute,
    sentiment: { markt: d.markt, news: d.news },
    einstellungen: { ...einst, fx: d.fx ?? 1 },
  });
  r.hinweise.push(...hinweise);
  return r;
}

async function starten(eingabe) {
  const sym = symbolLesen(eingabe);
  const knopf = document.querySelector('#suche button[type=submit]');
  knopf.disabled = true;
  $('ergebnis').classList.add('laedt');
  meldung(`Lade ${sym.anzeige} …`);
  try {
    letzte = await datenHolen(sym);
    zeigen(letzte);
    meldung(`Stand ${new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr`);
    planeAktualisierung();
  } catch (e) {
    meldung(e instanceof DatenFehler ? e.message : `Fehler: ${e.message}`, true);
  } finally {
    knopf.disabled = false;
    $('ergebnis').classList.remove('laedt');
  }
}

function neuAnalysieren() {
  if (letzte) zeigen(letzte);
}

const DEMOS = {
  'trv-setup': { datei: 'demo/trv.json', bis: '2026-08-04' },
  'trv-heute': { datei: 'demo/trv.json' },
  'isrg-heute': { datei: 'demo/isrg.json' },
};

async function demo(name) {
  const fall = DEMOS[name];
  if (!fall) return;
  const d = await (await fetch(fall.datei)).json();
  const kerzen = fall.bis ? d.kerzen.filter((k) => k.datum <= fall.bis) : d.kerzen;
  const tag = kerzen.at(-1).datum;
  clearTimeout(timer);
  letzte = {
    sym: { symbol: d.symbol, anzeige: d.symbol, art: 'aktie' }, kerzen, waehrung: d.waehrung,
    markt: null, news: null, fx: einst.kapitalWaehrung === 'EUR' ? 1 / 1.16 : 1, heute: tag, demo: d.quelle,
    intraday: d.intraday?.[tag] ? intradayAus(d.intraday[tag], d.zeitzone) : [],
  };
  $('symbol').value = d.symbol;
  zeigen(letzte);
  meldung(`Demo mit echten Kursen: ${d.quelle}. Fear & Greed liegt für diesen Tag nicht vor, EUR/USD fest 1,16.`);
}

function planeAktualisierung() {
  clearTimeout(timer);
  const min = Number($('intervall').value);
  if (!min || !letzte || letzte.demo) return;
  timer = setTimeout(() => starten(letzte.sym.anzeige), min * 60e3);
}

$('suche').addEventListener('submit', (ev) => {
  ev.preventDefault();
  starten($('symbol').value);
});
$('demo').addEventListener('change', (ev) => demo(ev.target.value).catch((e) => meldung(`Demo nicht ladbar: ${e.message}`, true)));
$('intervall').addEventListener('change', planeAktualisierung);

// ---------- Darstellung ----------

function kachel(name, wert, zusatz = '') {
  const k = document.createElement('div');
  k.className = 'kachel';
  const n = document.createElement('div');
  n.className = 'name';
  n.textContent = name;
  const w = document.createElement('div');
  w.className = 'wert';
  w.textContent = wert;
  k.append(n, w);
  if (zusatz) {
    const z = document.createElement('div');
    z.className = 'zusatz';
    z.textContent = zusatz;
    k.append(z);
  }
  return k;
}

const STATUS = {
  setup: '✓ Setup',
  warnung: '⚠ Warnung: kein Setup',
  kein_setup: '– Kein sauberes Setup',
};

function zeigen(d) {
  const r = rechnen(d);
  const kw = einst.kapitalWaehrung;
  $('ergebnis').hidden = false;
  $('titel').textContent = `${r.symbol} · ${zahl(r.kurs)} ${r.waehrung}`;
  $('unterzeile').textContent = `Tageskerze vom ${datumDe(r.zeit)}${d.demo ? ' · Demo-Daten' : ''}`;
  $('status').textContent = STATUS[r.status];
  $('status').className = `status ${r.status}`;

  const kacheln = $('kacheln');
  kacheln.replaceChildren();
  if (r.status === 'setup') {
    kacheln.append(
      kachel('Richtung', r.richtung, r.setupTyp),
      kachel('CRV', `1 : ${zahl(r.crv)}`, r.tranchen.length > 1 ? `nur Tranche 1: 1 : ${zahl(r.crvT1)}` : ''),
      kachel('Stückzahl', String(r.position.stueck), `Risiko ${zahl(r.position.maxVerlust, 0)} ${kw}`),
      kachel('Haltedauer', `${r.haltedauer.tage} Tage`, r.haltedauer.timeStop ? `Time-Stop ${datumDe(r.haltedauer.timeStop)}` : ''),
    );
  } else {
    kacheln.append(
      kachel('Status', r.status === 'warnung' ? 'Warnung' : 'Abwarten', r.richtungsBias ? `Bias ${r.richtungsBias}` : ''),
      kachel('RSI (14)', zahl(r.kennzahlen?.rsi14, 0)),
      kachel('Fear & Greed', r.markt ? String(r.markt.wert) : '–', r.markt?.stufe || 'nicht verfügbar'),
    );
    if (r.beobachten) kacheln.append(kachel('Beobachten', zahl(r.beobachten), 'nächste solide Marke'));
  }

  chartDaten = { d, r };
  chartZeichnen();
  abschnitte(alsText(r, einst));
  $('kopieren').onclick = () => kopieren(alsText(r, einst), 'Analyse kopiert.');
  $('prompt').onclick = async () => kopieren(await claudePrompt(r, d.kerzen), 'Prompt kopiert – in Claude einfügen.');
}

// ---------- Chart: Tageskerzen oder 5-Minuten-Kerzen des letzten Handelstags ----------

let chartDaten = null; // { d, r } der aktuellen Anzeige

function leer(text) {
  const p = document.createElement('p');
  p.className = 'chartleer';
  p.textContent = text;
  $('chart').replaceChildren(p);
}

async function chartZeichnen() {
  if (!chartDaten) return;
  const { d, r } = chartDaten;
  const heute = einst.ansicht === 'heute';
  for (const b of document.querySelectorAll('.umschalter button')) b.setAttribute('aria-pressed', String(b.dataset.ansicht === einst.ansicht));
  $('key-vortag').hidden = !heute;
  $('tooltip').hidden = true;
  if (!heute) {
    zeichneChart($('chart'), $('tooltip'), r, d.kerzen);
    $('chartnotiz').textContent = '';
    kurstabelle(d.kerzen, false);
    return;
  }
  // 5-Minuten-Kerzen erst laden, wenn jemand die Ansicht öffnet (1 Credit)
  if (d.intraday === undefined) {
    leer('Lade 5-Minuten-Kerzen …');
    d.intradayLaden ??= intradaykerzen(d.sym, einst.tdKey).catch((e) => e.message);
    d.intraday = await d.intradayLaden;
    // inzwischen kann ein anderer Wert oder die Tagesansicht gewählt sein: mit dem aktuellen Stand neu zeichnen
    if (chartDaten?.d === d && einst.ansicht === 'heute') chartZeichnen();
    return;
  }
  if (typeof d.intraday === 'string' || !d.intraday.length) {
    leer(typeof d.intraday === 'string' ? `Keine 5-Minuten-Kerzen: ${d.intraday}` : 'Für diesen Tag liegen keine 5-Minuten-Kerzen vor.');
    $('chartnotiz').textContent = '';
    kurstabelle([], true);
    return;
  }
  const tag = d.intraday.at(-1).datum;
  const vortag = d.kerzen.filter((k) => k.datum < tag).at(-1)?.schluss ?? null;
  zeichneChart($('chart'), $('tooltip'), r, d.intraday, { intraday: true, vortag });
  $('chartnotiz').textContent = `${tag === d.heute ? 'Heute' : 'Letzter Handelstag'}, ${datumDe(tag)} · `
    + `${d.intraday[0].zeit}–${d.intraday.at(-1).zeit} Uhr (Berliner Zeit) · Levels aus der Tagesanalyse`;
  kurstabelle(d.intraday, true);
}

for (const b of document.querySelectorAll('.umschalter button')) {
  b.addEventListener('click', () => {
    einst.ansicht = b.dataset.ansicht;
    speichern();
    chartZeichnen();
  });
}

// Chart bei Größenänderung (Handy drehen, Fenster) neu zeichnen
new ResizeObserver(() => {
  if (chartDaten && !(einst.ansicht === 'heute' && chartDaten.d.intraday === undefined)) chartZeichnen();
}).observe($('chart'));

function abschnitte(text) {
  const ziel = $('abschnitte');
  ziel.replaceChildren();
  let karte = null, liste = null;
  for (const zeile of text.split('\n').slice(2)) {
    if (/^\d\. /.test(zeile)) {
      karte = document.createElement('section');
      karte.className = 'abschnitt';
      const h = document.createElement('h3');
      h.textContent = zeile.replace(/:$/, '');
      liste = document.createElement('ul');
      karte.append(h, liste);
      ziel.append(karte);
    } else if (zeile.trim() && liste) {
      const li = document.createElement('li');
      li.textContent = zeile.replace(/^- /, '').trim();
      if (zeile.startsWith('  ')) li.className = 'unter';
      liste.append(li);
    }
  }
}

function kurstabelle(kerzen, intraday) {
  $('tabellentitel').textContent = intraday ? 'Kurstabelle (letzte 20 Fünf-Minuten-Kerzen)' : 'Kurstabelle (letzte 20 Tage)';
  const t = $('kurstabelle');
  t.replaceChildren();
  const kopf = t.insertRow();
  for (const n of [intraday ? 'Uhrzeit' : 'Datum', 'Eröffnung', 'Hoch', 'Tief', 'Schluss', 'Volumen']) {
    const th = document.createElement('th');
    th.textContent = n;
    kopf.append(th);
  }
  for (const k of kerzen.slice(-20).reverse()) {
    const z = t.insertRow();
    for (const w of [intraday ? k.zeit : datumDe(k.datum), zahl(k.eroeffnung), zahl(k.hoch), zahl(k.tief), zahl(k.schluss), k.volumen.toLocaleString('de-DE')]) {
      z.insertCell().textContent = w;
    }
  }
}

async function kopieren(text, ok) {
  try {
    await navigator.clipboard.writeText(text);
    meldung(ok);
  } catch {
    meldung('Kopieren nicht erlaubt – Text bitte manuell markieren.', true);
  }
}

// ---------- Watchlist ----------

const pause = (ms) => new Promise((res) => setTimeout(res, ms));

$('wl-start').addEventListener('click', async () => {
  const symbole = [...new Set($('wl').value.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean))];
  if (!symbole.length) return;
  if (!einst.tdKey) {
    $('wl-meldung').textContent = 'Twelve-Data-API-Key fehlt (Einstellungen).';
    return;
  }
  einst.watchlist = $('wl').value;
  speichern();
  const knopf = $('wl-start');
  knopf.disabled = true;
  const tabelle = $('wl-tabelle');
  tabelle.hidden = false;
  tabelle.replaceChildren();
  const kopf = tabelle.insertRow();
  for (const n of ['Symbol', 'Status', 'Richtung', 'Einstieg Ø', 'Ziel', 'Stop', 'CRV', 'Grund']) {
    const th = document.createElement('th');
    th.textContent = n;
    kopf.append(th);
  }
  const abstand = 60e3 / Math.max(1, einst.creditsMinute || 8);
  // Fear & Greed bzw. SPY-Ersatz einmal vorab laden, damit er nicht pro Wert Credits kostet
  await marktSentiment('aktie', einst.tdKey).catch(() => null);
  for (const [i, eingabe] of symbole.entries()) {
    $('wl-meldung').textContent = `Prüfe ${eingabe} (${i + 1}/${symbole.length}) …`;
    const z = tabelle.insertRow();
    try {
      const d = await datenHolen(symbolLesen(eingabe));
      const r = rechnen(d);
      const setup = r.status === 'setup';
      const werte = [r.symbol, STATUS[r.status], r.richtung || r.richtungsBias || '–',
        setup ? zahl(r.schnitt) : '–', setup ? zahl(r.ziel) : '–', setup ? zahl(r.stop) : '–',
        setup ? `1 : ${zahl(r.crv)}` : '–', setup ? r.setupTyp : (r.gruende[0] || '')];
      for (const w of werte) z.insertCell().textContent = w;
      z.lastChild.style.whiteSpace = 'normal';
      z.lastChild.style.textAlign = 'left';
      z.className = 'klickbar';
      z.tabIndex = 0;
      const oeffnen = () => {
        letzte = d;
        $('symbol').value = d.sym.anzeige;
        zeigen(d);
        $('ergebnis').scrollIntoView({ behavior: 'smooth' });
      };
      z.addEventListener('click', oeffnen);
      z.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') oeffnen(); });
    } catch (e) {
      z.insertCell().textContent = eingabe;
      const c = z.insertCell();
      c.colSpan = 7;
      c.textContent = e.message;
      c.className = 'fehler';
      c.style.textAlign = 'left';
    }
    if (i < symbole.length - 1) await pause(abstand);
  }
  $('wl-meldung').textContent = `Fertig: ${symbole.length} Werte geprüft. Zeile antippen für Details.`;
  knopf.disabled = false;
});

formularFuellen();
speichern();
