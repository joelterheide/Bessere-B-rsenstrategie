# Bessere Börsenstrategie

Website für konservative Trading-Empfehlungen nach festen Regeln: CRV ab 1 : 2, höchstens 1–2 % Risiko pro Trade, Time-Stop und Sentiment-Filter. Dazu kommt ein **Ausführungsschutz gegen Frontrunning und Stop-Hunting**, damit nicht alle Nutzer ihre Orders auf denselben Cent legen.

- Regeln für die Analyse: [`PROMPT.md`](PROMPT.md) (die Vorgaben plus Abschnitt 6 „Ausführungsschutz“)
- Warum und wie die Levels verschoben werden: [`STRATEGIE.md`](STRATEGIE.md)

## Was die Seite macht

Symbol eingeben (`ISRG`, `SAP.DE`, `SAP:XETR`, `BTC/USD`; die Yahoo-Endungen aus dem planspiel-bot funktionieren auch). Die Seite lädt 300 Tageskerzen von Twelve Data und gibt die Antwort immer im selben Format aus:

1. **Markt-Setup & Richtung**: LONG/SHORT aus Trend (50-/200-Tage-Linie), Unterstützung/Widerstand (Swing-Zonen), RSI, ATR
2. **Schlüssel-Levels**: Einstieg als Limit (gestaffelt 40/35/25 %), Kursziel vor dem nächsten Widerstand, Stop hinter dem letzten markanten Tief
3. **Risiko-Management**: exaktes CRV (mindestens 1 : 2, auch nach allen Verschiebungen) und Stückzahl aus 1–2 % Risiko, mit Umrechnung in Euro
4. **Zeithorizont**: 3–10 Handelstage je nach Zielabstand, mit Time-Stop-Datum; Limit-Order nur 2 Tage gültig
5. **Marktpsychologie**: Fear & Greed, RSI, News. Bei extremer Gier: Kursziel-Abstand −15 % und engerer Stop. Bei extremer Angst: nur antizyklische Longs an Böden, keine Shorts. FOMO/Hype → Warnung, kein Setup
6. **Ausführungsschutz**: wo die Masse kauft und ihre Stops hat, und wie weit deine Orders davon entfernt liegen

Gibt der Markt kein sauberes Setup her, sagt die Seite das direkt: kein Trend, überkauft, Event-Tag (z. B. Quartalszahlen), CRV zu klein. Wenn möglich nennt sie eine Marke zum Beobachten.

Außerdem: Chart mit den eigenen Levels und den Zonen der Masse, umschaltbar zwischen Tageskerzen und den 5-Minuten-Kerzen des letzten Handelstags (Uhrzeit in Berliner Zeit, mit Vortagesschluss; dort sieht man Stop-Hunts an runden Zahlen direkt), Watchlist-Scan (hält das Credit-Limit ein), automatische Aktualisierung jede Minute, „Prompt für Claude kopieren“ (Vorgaben + Daten + Engine-Vorschlag zum Gegenprüfen) und eine Demo mit echten Kursen ohne API-Key.

## Einrichtung

1. **GitHub Pages einschalten:** Settings → Pages → *Build and deployment* → Source: **GitHub Actions**. Danach baut der Workflow „Website“ die Seite bei jedem Push und alle 30 Minuten neu, jeweils mit frischem Fear & Greed Index. Adresse: `https://joelterheide.github.io/Bessere-B-rsenstrategie/`
2. **API-Key eintragen:** Auf der Seite unter *Einstellungen* den Twelve-Data-Key eintragen (derselbe wie `TWELVEDATA_API_KEY` im planspiel-bot). Er wird nur im eigenen Browser gespeichert (localStorage), nie im Repository.
3. Optional: Alpha-Vantage-Key für News-Stimmung (gratis 25 Abfragen/Tag), Kapital, Risiko %, Gebühr pro Order, „Nur Long“ für das Planspiel.

Lokal starten: `python3 -m http.server 8000`, dann http://localhost:8000 öffnen. Tests: `npm test` (Node 22, keine Pakete nötig).

## Datenquellen und Abo

| Quelle | Wofür | Kosten |
|---|---|---|
| Twelve Data (REST, wie der Bot; auch als MCP in Claude) | Kurse (Tages- und 5-Minuten-Kerzen), Wechselkurse, SPY-Ersatzwert | Basic gratis: 8 Credits/Minute, 800/Tag, nur US-Werte in Echtzeit |
| CNN Fear & Greed | Marktstimmung Aktien | gratis, über die GitHub Action (`tools/sentiment.py`) |
| alternative.me | Marktstimmung Krypto | gratis |
| Alpha Vantage | News-Stimmung je Aktie | gratis 25/Tag |

**Empfehlung für minütliche Daten: Twelve Data „Grow“** (ab 29 $/Monat). Gleicher Key, gleiche API und gleicher MCP wie bisher, also keine Umbauten. Grow hat kein Tageslimit, je nach Stufe 55–377 Credits pro Minute und Echtzeit für US-Aktien. Außerdem schaltet Grow die Xetra-Werte frei (im Gratis-Plan liefert z. B. `SAP:XETR` nur „available starting with the Grow plan“). Damit kann die Seite die ganze Watchlist jede Minute aktualisieren. Wer europäische Kurse in Echtzeit und WebSocket-Streaming braucht: **Pro** (ab 99 $/Monat); vorher beim Support klären, ob Xetra in Echtzeit enthalten ist.
Verbrauch der Seite: 1 Credit pro Analyse, +1, wenn die 5-Minuten-Ansicht offen ist (sie lädt erst beim Öffnen), dazu stündlich der Wechselkurs und halbstündlich der SPY-Ersatzwert. Bei Aktualisierung jede Minute sind das 1–2 Credits pro Minute.
Wichtig im Gratis-Plan: Bot und Website teilen sich die 8 Credits pro Minute. Läuft der Bot gerade, meldet die Seite „Limit erreicht“.

Nur US-Werte, kostenlos in Echtzeit: Alpaca Market Data (IEX-Feed gratis, alle US-Börsen 99 $/Monat). Das ist nicht eingebaut; die Datenschicht (`js/daten.js`) ist aber so geschnitten, dass sich eine zweite Quelle ergänzen lässt.

## Aufbau

| Datei | Inhalt |
|---|---|
| `js/engine.js` | Analyse: Trend, Setup, Levels, CRV, Positionsgröße, Haltedauer, Sentiment-Filter |
| `js/schutz.js` | Ausführungsschutz: runde Zahlen, krumme Preise, persönlicher Versatz |
| `js/indikatoren.js` | SMA, EMA, RSI, ATR, Swing-Punkte, Zonen |
| `js/sentiment.js` | Fear-&-Greed-Stufen, SPY-Ersatzwert, News-Auswertung |
| `js/daten.js` | Twelve Data, Alpha Vantage, sentiment.json, Cache |
| `js/format.js` | Ausgabe im festen 6-Punkte-Format |
| `js/chart.js`, `js/app.js`, `index.html`, `css/` | Oberfläche |
| `tools/sentiment.py` | holt CNN- und Krypto-Fear-&-Greed (läuft in der Action) |
| `tests/` | Tests: Format, CRV, Risiko, Anti-Frontrunning, Anti-Stop-Hunting, Short-Spiegelung, Gier/Angst/FOMO, echter ISRG-Zahlentag |
| `demo/` | echte Tageskerzen (Twelve Data, 21.10.2026) für die Demo |

## Grenzen

- Keine Anlageberatung. Die Engine rechnet Regeln, sie kennt keine Nachrichten außer dem News-Score und keine Termine außer dem Gap-Filter.
- Die Regeln sind nicht durch einen Backtest belegt. Eine erste Rückrechnung auf zwei Werten (TRV, ISRG, März–Oktober 2026) ergab gemischte Ergebnisse. Vor echtem Geld gehört ein Backtest über viele Werte dazu.
- Der persönliche Versatz verschiebt Levels um Hundertstel ATR. Ein Setup knapp an der CRV-Grenze kann deshalb bei einem Nutzer gelten und beim anderen nicht.
- GitHub stoppt geplante Workflows in öffentlichen Repos nach 60 Tagen ohne Commit. Dann bleibt die Seite online, nur der Fear & Greed Index altert; die Seite rechnet dann den Ersatzwert aus SPY.
