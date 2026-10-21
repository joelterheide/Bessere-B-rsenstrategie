// Sentiment: Fear-&-Greed-Stufen, Ersatzwert aus SPY-Kursen und News-Stimmung von Alpha Vantage

import { rsi, sma } from './indikatoren.js';

// Stufen wie beim CNN Fear & Greed Index
export function stufe(wert) {
  if (wert == null || Number.isNaN(wert)) return null;
  if (wert < 25) return 'Extreme Angst';
  if (wert < 45) return 'Angst';
  if (wert <= 55) return 'Neutral';
  if (wert <= 75) return 'Gier';
  return 'Extreme Gier';
}

function skala(x, null_bei, hundert_bei) {
  const t = (x - null_bei) / (hundert_bei - null_bei);
  return Math.max(0, Math.min(100, t * 100));
}

function volatilitaet(schluss, n) {
  const r = [];
  for (let i = schluss.length - n; i < schluss.length; i++) r.push(Math.log(schluss[i] / schluss[i - 1]));
  const m = r.reduce((a, b) => a + b, 0) / r.length;
  return Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1));
}

// Ersatz, wenn der CNN-Index nicht erreichbar ist: vier Teilwerte aus S&P-500-ETF-Kursen (SPY),
// angelehnt an die CNN-Methode (Momentum, Stärke, Volatilität, Abstand zum Hoch).
export function marktProxy(kerzen) {
  const s = kerzen.map((k) => k.schluss);
  if (s.length < 130) return null;
  const kurs = s[s.length - 1];
  const teile = {
    momentum: skala(kurs / sma(s, 125) - 1, -0.05, 0.05),
    staerke: skala(rsi(s, 14), 30, 70),
    volatilitaet: skala(volatilitaet(s, 20) / volatilitaet(s, Math.min(250, s.length - 1)), 1.6, 0.6),
    hochabstand: skala(kurs / Math.max(...kerzen.slice(-250).map((k) => k.hoch)) - 1, -0.1, 0),
  };
  const wert = Math.round(Object.values(teile).reduce((a, b) => a + b, 0) / 4);
  return { wert, stufe: stufe(wert), quelle: 'Ersatzwert aus SPY (Momentum, RSI, Volatilität, Abstand zum Hoch)', teile };
}

// Alpha-Vantage NEWS_SENTIMENT: mittlerer Ticker-Score der Artikel und "Buzz" (Artikel letzte 24 h gegen Tagesschnitt)
export function newsAuswerten(antwort, symbol, jetzt = new Date()) {
  const feed = antwort?.feed;
  if (!Array.isArray(feed) || feed.length === 0) return null;
  const sym = symbol.split(/[.:/]/)[0].toUpperCase();
  const scores = [], zeiten = [];
  for (const artikel of feed) {
    const t = (artikel.ticker_sentiment || []).find((x) => x.ticker?.toUpperCase() === sym);
    if (!t) continue;
    scores.push(Number(t.ticker_sentiment_score) * Number(t.relevance_score || 1));
    const z = artikel.time_published; // 20261021T143000
    zeiten.push(Date.UTC(+z.slice(0, 4), +z.slice(4, 6) - 1, +z.slice(6, 8), +z.slice(9, 11), +z.slice(11, 13)));
  }
  if (scores.length === 0) return null;
  const tag = 864e5;
  const letzte24 = zeiten.filter((t) => jetzt - t <= tag).length;
  const spanneTage = Math.max(1, (jetzt - Math.min(...zeiten)) / tag);
  const score = scores.reduce((a, b) => a + b, 0) / scores.length;
  return {
    score,
    artikel24h: letzte24,
    artikelSchnitt: scores.length / spanneTage,
    label: score >= 0.35 ? 'bullish' : score >= 0.15 ? 'leicht bullish' : score <= -0.35 ? 'bearish' : score <= -0.15 ? 'leicht bearish' : 'neutral',
    quelle: 'Alpha Vantage News Sentiment',
  };
}
