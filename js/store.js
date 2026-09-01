// データ読み込み・お気に入り・現在地などの状態管理

import { toMin, walkMinFromCoords } from "./util.js";

const FAV_KEY = "jsf.favorites";

export const store = {
  venues: [],            // [{id, stageNo, name, lat, lng, days}]
  venueById: new Map(),
  performances: [],      // [{id, name, kana, venueId, date, start, end, ...}]
  walk: null,            // {ids, minutes}
  walkIndex: new Map(),  // venueId -> matrix index
  updatedAt: "",
  favorites: new Set(JSON.parse(localStorage.getItem(FAV_KEY) || "[]")),
  location: null,        // {lat, lng} 現在地（取得済みのとき）
  simNow: null,          // {date, min} 時刻シミュレーション（null=実時刻）
};

export async function loadData() {
  const [v, p, w] = await Promise.all([
    fetch("data/venues.json").then((r) => r.json()),
    fetch("data/performances.json").then((r) => r.json()),
    fetch("data/walktimes.json").then((r) => r.json()),
  ]);
  store.venues = v.venues;
  store.updatedAt = p.updatedAt;
  store.performances = p.performances
    .map((x) => ({ ...x, startMin: toMin(x.start), endMin: toMin(x.end) }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.startMin - b.startMin);
  store.walk = w;
  store.venueById = new Map(store.venues.map((x) => [x.id, x]));
  store.walkIndex = new Map(w.ids.map((id, i) => [id, i]));
}

// 会場間の徒歩分数（事前計算マトリクスから）
export function walkBetween(venueIdA, venueIdB) {
  if (venueIdA === venueIdB) return 0;
  const a = store.walkIndex.get(venueIdA), b = store.walkIndex.get(venueIdB);
  return a == null || b == null ? null : store.walk.minutes[a][b];
}

// 現在地から会場までの徒歩分数（現在地未取得ならnull）
export function walkFromHere(venueId) {
  if (!store.location) return null;
  const v = store.venueById.get(venueId);
  return v ? walkMinFromCoords(store.location.lat, store.location.lng, v.lat, v.lng) : null;
}

export function toggleFavorite(perfId) {
  if (store.favorites.has(perfId)) store.favorites.delete(perfId);
  else store.favorites.add(perfId);
  localStorage.setItem(FAV_KEY, JSON.stringify([...store.favorites]));
}

// 現在時刻（シミュレーション考慮）: {date: "2026-09-12"|null, min}
export function nowInfo() {
  if (store.simNow) return { ...store.simNow, simulated: true };
  const d = new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { date, min: d.getHours() * 60 + d.getMinutes(), simulated: false };
}

export function requestLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("位置情報が利用できません"));
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        store.location = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        resolve(store.location);
      },
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  });
}
