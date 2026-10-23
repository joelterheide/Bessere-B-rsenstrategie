# Ausführungsschutz: Frontrunning und Stop-Hunting umgehen

## Das Problem in einem Satz

Wenn viele Leute dieselbe Analyse bekommen, liegen ihre Orders auf denselben Cent: Kauflimits auf 100,00 €, Stops auf 98,00 €, Ziele auf 110,00 €. Diese Cluster sind für andere sichtbar oder zumindest leicht zu erraten. Wer sie kennt, kauft knapp davor (Frontrunning) oder drückt den Kurs kurz darunter (Stop-Hunting).

Das ist gut belegt: In den Orderbüchern einer Großbank lagen Gewinnziele gehäuft genau auf runden Zahlen und Stops knapp dahinter (Osler 2003, *Currency Orders and Exchange Rate Dynamics*, Journal of Finance; NY Fed Staff Report 150). An runden Zahlen drehen Kurse deshalb oft, und knapp dahinter beschleunigen sie, weil dort die Stops ausgelöst werden.

## Die Lösung: nicht dort handeln, wo die Masse handelt

Die Engine (`js/engine.js`, `js/schutz.js`) rechnet erst die naheliegenden Levels aus, also die, die jeder Analyst nennen würde. Dann verschiebt sie jedes Level weg von der Masse.

| Level | Masse | Bessere Strategie | Warum |
|---|---|---|---|
| **Einstieg** (Long) | genau auf Unterstützung / 100,00 | **0,1–0,2 ATR darüber**, z. B. 100,37 | Bei fallendem Kurs wirst du vor der Masse und vor den Frontrunnern (100,05) ausgeführt |
| **Einstieg gestaffelt** | eine Order | **3 Tranchen 40/35/25 %**: hohe Ausführungschance · knapp vor der Masse · in der Jagdzone | Selbst wenn der Kurs die Zone nie erreicht, bist du mit Tranche 1 dabei. Wird gejagt, kauft Tranche 3 billig |
| **Stop** (Long) | knapp unter Tief / unter 98,00 | **≥ 0,5 ATR hinter dem Cluster**, nie auf x,90–x,99 | Stop-Hunts stechen typischerweise 0,1–0,3 ATR unter die Marke und drehen dann |
| **Positionsgröße** | fest | **aus dem Stop-Abstand gerechnet** (1–2 % Risiko) | Der weitere Stop kostet nicht mehr Geld, nur weniger Stück |
| **Kursziel** | genau auf Widerstand / 110,00 | **knapp darunter** und unter der runden Zahl davor | Dort nimmt die Masse Gewinne mit; wer vorher verkauft, wird sicher ausgeführt |
| **Preise allgemein** | 100,00 / 98,50 | **krumm**: kein Vielfaches von 5 Cent | Runde Preise sind der Fingerabdruck einer Community |
| **Versatz je Nutzer** | alle gleich | **persönlicher Zufalls-Schlüssel** verschiebt jedes Level um einige Hundertstel ATR | Nutzer der App bilden selbst keinen neuen Cluster |

Short-Trades laufen gespiegelt: Einstieg knapp unter dem Widerstand, Stop über dem Hoch und den runden Zahlen darüber.

### Zusätzliche Regeln

- **Limit nur 2 Handelstage gültig.** Wurde nicht ausgeführt, ist das Setup weg. Hinterherkaufen verschlechtert das CRV, genau das wollen Frontrunner.
- **Stop erst nach 15 Minuten scharf.** Eröffnungs-Spikes (Xetra 9:00, USA 15:30) lösen die meisten Stops aus. Bis dahin genügt ein Kursalarm.
- **Event-Tage aussetzen.** Bei einem Gap über 1,5 ATR (z. B. Quartalszahlen) sind alle Levels von gestern Makulatur, also erst den Tagesschluss abwarten. Beispiel: ISRG am 21.10.2026 eröffnete nach Zahlen bei 402,50 $ (−8 %), stach in den ersten fünf Minuten auf 398,99 $ unter die runde 400 und schloss bei 428,05 $. Wer den Stop knapp unter 400 hatte, war raus; im 5-Minuten-Chart der Demo ist das gut zu sehen.
- **Abgefischtes Tief = Einstiegssignal.** Sticht der Kurs unter eine Marke und schließt wieder darüber, sind die schwachen Hände raus. Die Engine erkennt das als „Stop-Hunt-Umkehr“.
- **Reclaim-Regel.** Ausgestoppt, und der Kurs schließt binnen 2 Tagen wieder über der Unterstützung? Dann einmal mit halber Größe neu einsteigen.

### Was das kostet

Weiter entfernte Stops und Ziele vor dem Widerstand verringern das CRV. Deshalb prüft die Engine **nach** allen Verschiebungen:

- CRV ≥ 1 : 2 auf den Durchschnittseinstieg,
- CRV ≥ 1 : 1,5, falls nur Tranche 1 ausgeführt wird,
- bei eingetragenen Gebühren auch das CRV nach Gebühren.

Hält ein Setup das nicht aus, gibt es keinen Trade. Das ist Absicht („nicht zu gierig“).

## Ehrliche Einordnung

- **Planspiel Börse:** Die Orders dort sind simuliert und erreichen den echten Markt nicht. Niemand kann *deine* Planspiel-Stops jagen. Die Cluster echter Marktteilnehmer an runden Zahlen und offensichtlichen Marken gibt es trotzdem, und gegen sie wirken die Regeln genauso.
- **Echtes Geld:** Stop-Orders von Privatanlegern liegen meist beim Broker bzw. als nicht sichtbare Stop-Order an der Börse (Xetra zeigt Stops nicht im Orderbuch). Gejagt wird deshalb nicht deine einzelne Order, sondern die *erwartbare* Masse. Der wirksamste Schutz ist darum, nicht dort zu stehen, wo man erwartbar steht.
- Keine Regel macht einen schlechten Trade gut. Sie verhindern nur, dass ein guter Trade an der Ausführung scheitert.
