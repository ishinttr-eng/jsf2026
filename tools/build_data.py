#!/usr/bin/env python3
"""公式配信の performers-data.js からアプリ用JSONを生成する。

入力: tools/raw/performers-data.js (window.JSF_PERFORMANCES=[...];window.JSF_PERFORMANCES_UPDATED_AT="...")
出力: data/venues.json, data/performances.json, data/walktimes.json
"""
import json
import math
import re
from datetime import datetime, timezone
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

# 出演者変更の比較対象フィールド（kana・intro・awardEntry・order等はノイズになるため対象外）
COMPARE_FIELDS = ["name", "venueId", "start", "end", "genre"]
FIELD_LABEL = {"name": "出演者名", "venueId": "会場", "start": "開始時刻", "end": "終了時刻", "genre": "ジャンル"}
CHANGES_HISTORY_LIMIT = 20


def load_old_performances(out_dir):
    """上書きする前の performances.json を読み、id+date をキーにした辞書にする"""
    p = out_dir / "performances.json"
    if not p.exists():
        return {}
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    return {f"{x['id']}__{x['date']}": x for x in data.get("performances", [])}


def diff_performances(old_map, new_list, venue_name_by_id):
    """新旧のperformancesを比較し、出演者の交代・追加・削除・変更を検出する"""
    new_map = {f"{x['id']}__{x['date']}": x for x in new_list}
    added_keys = set(new_map) - set(old_map)
    removed_keys = set(old_map) - set(new_map)
    common_keys = set(new_map) & set(old_map)

    def venue_name(vid):
        return venue_name_by_id.get(vid, vid)

    items = []
    for k in common_keys:
        old, new = old_map[k], new_map[k]
        for f in COMPARE_FIELDS:
            if old.get(f) != new.get(f):
                items.append({
                    "kind": "modified", "date": new["date"], "venueId": new["venueId"],
                    "venueName": venue_name(new["venueId"]), "name": new["name"],
                    "field": f, "fieldLabel": FIELD_LABEL[f],
                    "old": old.get(f), "new": new.get(f),
                })

    # 同じ枠（会場・日付・開始時刻）での追加＋削除は「出演者交代」としてまとめる
    def slot(x):
        return (x["venueId"], x["date"], x["start"])

    added_by_slot, removed_by_slot = {}, {}
    for k in added_keys:
        added_by_slot.setdefault(slot(new_map[k]), []).append(k)
    for k in removed_keys:
        removed_by_slot.setdefault(slot(old_map[k]), []).append(k)

    swapped_added, swapped_removed = set(), set()
    for s, add_ks in added_by_slot.items():
        for a_k, r_k in zip(add_ks, removed_by_slot.get(s, [])):
            new, old = new_map[a_k], old_map[r_k]
            items.append({
                "kind": "swap", "date": new["date"], "venueId": new["venueId"],
                "venueName": venue_name(new["venueId"]), "start": new["start"], "end": new["end"],
                "oldName": old["name"], "newName": new["name"],
            })
            swapped_added.add(a_k)
            swapped_removed.add(r_k)

    for k in added_keys - swapped_added:
        x = new_map[k]
        items.append({
            "kind": "added", "date": x["date"], "venueId": x["venueId"],
            "venueName": venue_name(x["venueId"]), "name": x["name"],
            "start": x["start"], "end": x["end"],
        })
    for k in removed_keys - swapped_removed:
        x = old_map[k]
        items.append({
            "kind": "removed", "date": x["date"], "venueId": x["venueId"],
            "venueName": venue_name(x["venueId"]), "name": x["name"],
            "start": x["start"], "end": x["end"],
        })

    items.sort(key=lambda it: (it["date"], it.get("start") or ""))
    return items


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

    old_map = load_old_performances(OUT)  # 上書きする前に旧データを読んでおく

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
    venue_name_by_id = {v["id"]: v["name"] for v in venue_list}

    diff_items = diff_performances(old_map, performances, venue_name_by_id)

    OUT.mkdir(exist_ok=True)
    (OUT / "venues.json").write_text(
        json.dumps({"updatedAt": updated_at, "venues": venue_list}, ensure_ascii=False, indent=1),
        encoding="utf-8")
    (OUT / "performances.json").write_text(
        json.dumps({"updatedAt": updated_at, "performances": performances}, ensure_ascii=False, indent=1),
        encoding="utf-8")

    # walktimes.json は tools/build_routes.py が実測（OSRM）の所要時間で上書き済みのことがあるため、
    # 既にそちらのソースが入っている場合は再生成せず保持する（出演者データ更新のたびに
    # 直線距離の概算へ後退してしまうのを防ぐ）
    walktimes_path = OUT / "walktimes.json"
    existing_source = ""
    if walktimes_path.exists():
        try:
            existing_source = json.loads(walktimes_path.read_text(encoding="utf-8")).get("source", "")
        except json.JSONDecodeError:
            pass
    if "OSRM" in existing_source:
        print("walktimes.json は実測ルート由来のため再生成をスキップしました")
    else:
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
        walktimes_path.write_text(
            json.dumps({"ids": ids, "minutes": matrix,
                        "speedMPerMin": WALK_SPEED_M_PER_MIN, "detourFactor": DETOUR_FACTOR},
                       ensure_ascii=False),
            encoding="utf-8")

    # 「うちのシステムが直近にいつ確認したか」はSWのVERSIONとは独立して更新したいので別ファイルに分ける。
    # ここに書けば、データに実質差分が無い定期チェックでもこの時刻だけは必ず進む
    checked_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    (OUT / "checked.json").write_text(
        json.dumps({"checkedAt": checked_at}, ensure_ascii=False), encoding="utf-8")

    # 出演者の交代・追加・削除・変更を検出したときだけ履歴に追記する（差分なしのチェックは記録しない）
    changes_path = OUT / "changes.json"
    history = []
    if changes_path.exists():
        try:
            history = json.loads(changes_path.read_text(encoding="utf-8")).get("history", [])
        except json.JSONDecodeError:
            history = []
    if diff_items:
        history.append({"checkedAt": checked_at, "sourceUpdatedAt": updated_at, "items": diff_items})
        history = history[-CHANGES_HISTORY_LIMIT:]
    changes_path.write_text(json.dumps({"history": history}, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"venues: {len(venue_list)}, performances: {len(performances)}, updatedAt: {updated_at}, "
          f"checkedAt: {checked_at}, changes: {len(diff_items)}")


if __name__ == "__main__":
    main()
