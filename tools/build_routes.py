#!/usr/bin/env python3
"""全会場ペアの徒歩ルート（ポリライン・距離・所要時間）を
FOSSGIS OSRM（無料・APIキー不要の徒歩ルーティング）から取得し data/routes.json に保存する。
あわせて data/walktimes.json の直線距離ベースの概算を、実測の所要時間で置き換える。

再実行しても取得済みのペアはスキップされる（Ctrl+Cで中断しても再開可能）。
50会場・1225ペア分の問い合わせを行うため、完走には数分〜十数分かかる。
"""
import json
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VENUES_FILE = ROOT / "data" / "venues.json"
ROUTES_FILE = ROOT / "data" / "routes.json"
WALKTIMES_FILE = ROOT / "data" / "walktimes.json"

OSRM_BASE = "https://routing.openstreetmap.de/routed-foot/route/v1/foot"
USER_AGENT = "JSF-Navi-2026-batch-route-build/1.0 (one-time build script)"
DELAY_SEC = 0.3  # サーバーに負荷をかけすぎないための間隔
RETRY = 2


def fetch_route(lat1, lng1, lat2, lng2):
    # Xcode付属Python(3.9)のurllibは同梱の古いSSLライブラリのせいでこのサーバーとTLSハンドシェイクできないため、
    # OS標準のTLSスタックを使うcurlをサブプロセスで呼び出す
    url = f"{OSRM_BASE}/{lng1},{lat1};{lng2},{lat2}?overview=full&geometries=polyline"
    last_err = None
    for _ in range(RETRY + 1):
        try:
            proc = subprocess.run(
                ["curl", "-sS", "--fail", "--max-time", "15", "-A", USER_AGENT, url],
                capture_output=True, text=True, check=True)
            data = json.loads(proc.stdout)
            if data.get("code") != "Ok" or not data.get("routes"):
                raise RuntimeError(f"OSRM error: {data.get('code')}")
            r = data["routes"][0]
            return {
                "distM": round(r["distance"]),
                "durMin": max(1, round(r["duration"] / 60)),
                "poly": r["geometry"],
            }
        except subprocess.CalledProcessError as e:
            last_err = RuntimeError(f"curl failed (code {e.returncode}): {e.stderr.strip()}")
            time.sleep(1)
        except Exception as e:  # noqa: BLE001
            last_err = e
            time.sleep(1)
    raise last_err


def main():
    venues = sorted(json.loads(VENUES_FILE.read_text(encoding="utf-8"))["venues"], key=lambda v: v["id"])

    routes = {}
    if ROUTES_FILE.exists():
        routes = json.loads(ROUTES_FILE.read_text(encoding="utf-8")).get("routes", {})

    pairs = [
        (f"{a['id']}|{b['id']}", a, b)
        for i, a in enumerate(venues)
        for b in venues[i + 1:]
        if f"{a['id']}|{b['id']}" not in routes
    ]
    total = len(pairs)
    print(f"取得対象: {total}ペア（既に{len(routes)}ペア取得済み）")

    def save():
        ROUTES_FILE.write_text(
            json.dumps({
                "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "profile": "foot (FOSSGIS OSRM)",
                "routes": routes,
            }, ensure_ascii=False, indent=1),
            encoding="utf-8")

    ok, fail = 0, 0
    try:
        for n, (key, a, b) in enumerate(pairs, 1):
            try:
                routes[key] = fetch_route(a["lat"], a["lng"], b["lat"], b["lng"])
                ok += 1
            except Exception as e:  # noqa: BLE001
                print(f"  ! {key} 失敗: {e}")
                fail += 1
            if n % 20 == 0 or n == total:
                save()
                print(f"  {n}/{total} 完了（成功{ok} 失敗{fail}）")
            time.sleep(DELAY_SEC)
    finally:
        save()

    if fail:
        print(f"{fail}ペアが取得できませんでした。もう一度このスクリプトを実行すると失敗分だけ再取得します。")

    # walktimes.json の直線距離ベースの概算を、実測の所要時間で上書きする
    wt = json.loads(WALKTIMES_FILE.read_text(encoding="utf-8"))
    ids = wt["ids"]
    idx = {vid: i for i, vid in enumerate(ids)}
    updated = 0
    for key, r in routes.items():
        a, b = key.split("|")
        if a in idx and b in idx:
            wt["minutes"][idx[a]][idx[b]] = r["durMin"]
            wt["minutes"][idx[b]][idx[a]] = r["durMin"]
            updated += 1
    wt["source"] = "FOSSGIS OSRM foot routing（実測ベース。未取得ペアのみ直線距離概算）"
    WALKTIMES_FILE.write_text(json.dumps(wt, ensure_ascii=False), encoding="utf-8")
    print(f"walktimes.json を実測の所要時間で更新しました（{updated}ペア）")


if __name__ == "__main__":
    main()
