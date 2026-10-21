// Datenquellen: Twelve Data (Kurse, wie im planspiel-bot), Fear & Greed (sentiment.json aus der GitHub Action,
// sonst Ersatzwert aus SPY), Alpha Vantage (News-Stimmung, optional).

import { marktProxy, newsAuswerten, stufe } from './sentiment.js';

const TWELVE = 'https://api.twelvedata.com';

// Yahoo-Endungen aus der Watchlist des Bots → Twelve-Data-Börsen (MIC)
const ENDUNGEN = { DE: 'XETR', F: 'XFRA', PA: 'XPAR', VI: 'XWBO', AS: 'XAMS', MI: 'XMIL', L: 'XLON', SW: 'XSWX', MC: 'XMAD' };
const KRYPTO = new Set(['BTC', 'ETH', 'SOL', 'XRP', 'ADA', 'DOGE', 'BNB', 'DOT', 'AVAX', 'LTC', 'LINK', 'MATIC', 'TRX']);

export function symbolLesen(eingabe) {
  const s = eingabe.trim().toUpperCase();
  let m = s.match(/^([A-Z0-9]+)\.([A-Z]{1,2})$/);
  if (m && ENDUNGEN[m[2]]) return { symbol: m[1], mic: ENDUNGEN[m[2]], anzeige: s, art: 'aktie' };
  m = s.match(/^([A-Z0-9.]+):([A-Z]{4})$/);
  if (m) return { symbol: m[1], mic: m[2], anzeige: s, art: 'aktie' };
  m = s.match(/^([A-Z0-9]+)\/([A-Z]+)$/);
  if (m) return { symbol: s, anzeige: s, art: KRYPTO.has(m[1]) ? 'krypto' : 'devise' };
  return { symbol: s, anzeige: s, art: 'aktie' };
}

// ---------- Cache (localStorage, kann fehlen) ----------

function cacheLesen(schluessel, maxAlterMs) {
  try {
    const e = JSON.parse(localStorage.getItem('cache:' + schluessel));
    if (e && Date.now() - e.zeit < maxAlterMs) return e.wert;
  } catch { /* privates Fenster o. Ä. */ }
  return undefined;
}

function cacheSchreiben(schluessel, wert) {
  try { localStorage.setItem('cache:' + schluessel, JSON.stringify({ zeit: Date.now(), wert })); } catch { /* egal */ }
}

// ---------- Twelve Data ----------

export class DatenFehler extends Error {}

async function twelve(pfad, params, key) {
  const url = `${TWELVE}/${pfad}?${new URLSearchParams({ ...params, apikey: key })}`;
  let antwort;
  try {
    antwort = await fetch(url);
  } catch (e) {
    throw new DatenFehler(`Twelve Data nicht erreichbar (${e.message}).`);
  }
  const d = await antwort.json();
  if (d.status === 'error' || (d.code && d.code >= 400)) {
    const text = d.message || `Fehler ${d.code}`;
    if (d.code === 429) throw new DatenFehler(`Twelve-Data-Limit erreicht: ${text}`);
    throw new DatenFehler(text);
  }
  return d;
}

export async function tageskerzen(sym, key, anzahl = 300) {
  const d = await twelve('time_series', {
    symbol: sym.symbol, interval: '1day', outputsize: anzahl, ...(sym.mic && { mic_code: sym.mic }),
  }, key);
  const kerzen = d.values.map((w) => ({
    datum: w.datetime.slice(0, 10),
    eroeffnung: +w.open, hoch: +w.high, tief: +w.low, schluss: +w.close, volumen: +(w.volume || 0),
  })).reverse();
  // Krypto/Devisen haben kein meta.currency: Kurswährung ist die Quote-Währung (BTC/USD → USD)
  const waehrung = d.meta?.currency || (sym.symbol.includes('/') ? sym.symbol.split('/')[1] : '');
  return { kerzen, waehrung, boerse: d.meta?.exchange || '', zeitzone: d.meta?.exchange_timezone };
}

// Umrechnung: Kapitalwährung je Einheit der Kurswährung (z. B. USD → EUR)
export async function wechselkurs(von, nach, key) {
  if (!von || von === nach) return 1;
  let faktor = 1;
  if (von === 'GBp' || von === 'GBX') { von = 'GBP'; faktor = 0.01; }
  const schluessel = `fx:${von}/${nach}`;
  let kurs = cacheLesen(schluessel, 3600e3);
  if (kurs === undefined) {
    kurs = +(await twelve('exchange_rate', { symbol: `${von}/${nach}` }, key)).rate;
    cacheSchreiben(schluessel, kurs);
  }
  return kurs * faktor;
}

// ---------- Sentiment ----------

// Von der GitHub Action alle 30 Minuten geschrieben (CNN Fear & Greed, Crypto Fear & Greed)
async function sentimentDatei() {
  try {
    const r = await fetch('sentiment.json', { cache: 'no-store' });
    if (r.ok) return await r.json();
  } catch { /* lokal ohne Datei */ }
  return null;
}

export async function marktSentiment(art, key) {
  const datei = await sentimentDatei();
  const frisch = (x, stunden) => x && x.wert != null && Date.now() - Date.parse(x.zeit) < stunden * 3600e3;
  if (art === 'krypto') {
    if (frisch(datei?.krypto, 36)) return { ...datei.krypto, stufe: stufe(datei.krypto.wert) };
    try {
      const d = (await (await fetch('https://api.alternative.me/fng/?limit=1')).json()).data[0];
      return { wert: +d.value, stufe: stufe(+d.value), quelle: 'Crypto Fear & Greed (alternative.me)', zeit: new Date(d.timestamp * 1000).toISOString() };
    } catch { /* weiter mit null */ }
    return null;
  }
  if (frisch(datei?.aktien, 72)) return { ...datei.aktien, stufe: stufe(datei.aktien.wert) };
  // Ersatz: aus SPY-Kursen selbst berechnen (1 Twelve-Data-Credit, 30 Minuten gecacht)
  let proxy = cacheLesen('proxy:SPY', 1800e3);
  if (proxy === undefined && key) {
    const { kerzen } = await tageskerzen({ symbol: 'SPY' }, key, 260);
    proxy = marktProxy(kerzen);
    if (proxy) proxy.zeit = new Date().toISOString();
    cacheSchreiben('proxy:SPY', proxy);
  }
  return proxy || null;
}

export async function newsSentiment(sym, avKey) {
  if (!avKey || sym.art !== 'aktie') return null;
  const schluessel = `news:${sym.symbol}`;
  let antwort = cacheLesen(schluessel, 3600e3);
  if (antwort === undefined) {
    const url = `https://www.alphavantage.co/query?${new URLSearchParams({
      function: 'NEWS_SENTIMENT', tickers: sym.symbol, limit: 200, apikey: avKey,
    })}`;
    try {
      antwort = await (await fetch(url)).json();
    } catch {
      return null;
    }
    if (!antwort.feed) return null; // Limit erreicht o. Ä.
    cacheSchreiben(schluessel, antwort);
  }
  return newsAuswerten(antwort, sym.symbol);
}
