#!/usr/bin/env python3
"""公式配信の performers-data.js からアプリ用JSONを生成する。

入力: tools/raw/performers-data.js (window.JSF_PERFORMANCES=[...];window.JSF_PERFORMANCES_UPDATED_AT="...")
出力: data/venues.json, data/performances.json, data/walktimes.json
"""
import json
import math
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "tools" / "raw" / "performers-data.js"
OUT = ROOT / "data"

# mapUrl が短縮リンクの会場は座標をここで補完（リダイレクト先URLから取得済み）
MANUAL_COORDS = {
    "S-21": (38.257142, 140.859786),
    "S-22": (38.256639, 140.859111),
    "S-31": (38.260538, 140.872247),
    "S-42": (38.261595, 140.877850),
    "S-44": (38.260619, 140.879784),
    "S-46": (38.2629852, 140.8810199),
    "S-48": (38.257347, 140.881752),
    "S-49": (38.2510053, 140.8815449),
    "S-50": (38.2542748, 140.8745644),
}

DATE_MAP = {"9/12(土)": "2026-09-12", "9/13(日)": "2026-09-13"}

WALK_SPEED_M_PER_MIN = 80   # 徒歩速度の目安
DETOUR_FACTOR = 1.3          # 直線距離→道のり補正係数


def haversine_m(lat1, lng1, lat2, lng2):
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def clean_name(name: str):
    """会場名から改行・重複空白・「(土)のみ」注記を除去し、開催日制限を抽出する。"""
    days = ["2026-09-12", "2026-09-13"]
    m = re.search(r"[（(]([土日])[)）]のみ", name)
    if m:
        days = ["2026-09-12"] if m.group(1) == "土" else ["2026-09-13"]
        name = re.sub(r"[（(][土日][)）]のみ", "", name)
    name = re.sub(r"\s+", " ", name.replace("　", " ")).strip()
    return name, days


def main():
    text = RAW.read_text(encoding="utf-8")
    m = re.match(r"window\.JSF_PERFORMANCES=(.*?);window\.JSF_PERFORMANCES_UPDATED_AT=\"([^\"]+)\";?\s*$", text, re.S)
    if not m:
        raise SystemExit("performers-data.js の形式が想定と異なります")
    raw = json.loads(m.group(1))
    updated_at = m.group(2)

    venues = {}
    performances = []
    for item in raw:
        vid = item["venueId"]
        if vid not in venues:
            name, days = clean_name(item["venue"])
            cm = re.search(r"query=([0-9.]+),([0-9.]+)", item["mapUrl"])
            if cm:
                lat, lng = float(cm.group(1)), float(cm.group(2))
            elif vid in MANUAL_COORDS:
                lat, lng = MANUAL_COORDS[vid]
            else:
                raise SystemExit(f"{vid} の座標が取得できません")
            venues[vid] = {
                "id": vid,
                "stageNo": int(vid.split("-")[1]),
                "name": name,
                "lat": lat,
                "lng": lng,
                "days": days,
            }
        date = DATE_MAP.get(item["date"])
        if date is None:
            raise SystemExit(f"未知の日付: {item['date']}")
        tm = re.match(r"^(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$", item["time"])
        if tm is None:
            raise SystemExit(f"未知の時間形式: {item['time']}")
        performances.append({
            "id": item["performerId"],
            "name": item["name"].strip(),
            "kana": item["nameKana"].strip(),
            "venueId": vid,
            "date": date,
            "start": tm.group(1),
            "end": tm.group(2),
            "order": item["order"],
            "genre": item["genre"].strip(),
            "region": item["activityRegion"].strip(),
            "intro": item["introduction"].strip(),
            "awardEntry": item["awardEntry"].strip(),
            "isU25": item["isU25"],
        })

    venue_list = sorted(venues.values(), key=lambda v: v["stageNo"])
    ids = [v["id"] for v in venue_list]

    # 全会場ペアの徒歩時間（分）: 直線距離×補正係数を徒歩速度で割って切り上げ
    matrix = []
    for a in venue_list:
        row = []
        for b in venue_list:
            if a["id"] == b["id"]:
                row.append(0)
            else:
                d = haversine_m(a["lat"], a["lng"], b["lat"], b["lng"]) * DETOUR_FACTOR
                row.append(max(1, math.ceil(d / WALK_SPEED_M_PER_MIN)))
        matrix.append(row)

    OUT.mkdir(exist_ok=True)
    (OUT / "venues.json").write_text(
        json.dumps({"updatedAt": updated_at, "venues": venue_list}, ensure_ascii=False, indent=1),
        encoding="utf-8")
    (OUT / "performances.json").write_text(
        json.dumps({"updatedAt": updated_at, "performances": performances}, ensure_ascii=False, indent=1),
        encoding="utf-8")
    (OUT / "walktimes.json").write_text(
        json.dumps({"ids": ids, "minutes": matrix,
                    "speedMPerMin": WALK_SPEED_M_PER_MIN, "detourFactor": DETOUR_FACTOR},
                   ensure_ascii=False),
        encoding="utf-8")

    print(f"venues: {len(venue_list)}, performances: {len(performances)}, updatedAt: {updated_at}")


if __name__ == "__main__":
    main()
