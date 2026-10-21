"""Holt den CNN Fear & Greed Index (Aktien) und den Crypto Fear & Greed Index und schreibt sentiment.json.

Läuft in der GitHub Action, weil beide Quellen aus dem Browser nicht direkt abrufbar sind (CORS).
Nur Python-Standardbibliothek. Fällt eine Quelle aus, bleibt ihr Eintrag leer; die Website rechnet dann
einen Ersatzwert aus SPY-Kursen.
"""

import json
import sys
import urllib.request
from datetime import datetime, timezone

BROWSER = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
                         "Chrome/126.0 Safari/537.36", "Accept": "application/json", "Referer": "https://edition.cnn.com/"}


def http_json(url):
    req = urllib.request.Request(url, headers=BROWSER)
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))


def cnn():
    d = http_json("https://production.dataviz.cnn.io/index/fearandgreed/graphdata")["fear_and_greed"]
    zeit = d.get("timestamp")
    if isinstance(zeit, (int, float)):
        zeit = datetime.fromtimestamp(zeit / 1000, timezone.utc).isoformat()
    return {"wert": round(float(d["score"])), "rating": d.get("rating"), "zeit": zeit,
            "vortag": round(float(d["previous_close"])) if d.get("previous_close") is not None else None,
            "quelle": "CNN Fear & Greed Index"}


def krypto():
    d = http_json("https://api.alternative.me/fng/?limit=1")["data"][0]
    return {"wert": int(d["value"]), "rating": d.get("value_classification"),
            "zeit": datetime.fromtimestamp(int(d["timestamp"]), timezone.utc).isoformat(),
            "quelle": "Crypto Fear & Greed (alternative.me)"}


def main(ziel):
    ergebnis = {"erstellt": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    for name, holen in (("aktien", cnn), ("krypto", krypto)):
        try:
            ergebnis[name] = holen()
            print(f"{name}: {ergebnis[name]['wert']} ({ergebnis[name]['rating']})")
        except Exception as e:  # eine kaputte Quelle soll die andere nicht stoppen
            ergebnis[name] = None
            print(f"{name}: Fehler {e}")
    with open(ziel, "w", encoding="utf-8") as f:
        json.dump(ergebnis, f, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "sentiment.json")
