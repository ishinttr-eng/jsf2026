// データ読み込み・お気に入り・現在地などの状態管理

import { toMin, walkMinFromCoords, decodePolyline, DAYS } from "./util.js";

const FAV_KEY = "jsf.favorites";

export const store = {
  venues: [],            // [{id, stageNo, name, lat, lng, days}]
  venueById: new Map(),
  performances: [],      // [{id, name, kana, venueId, date, start, end, ...}]
  walk: null,            // {ids, minutes}
  walkIndex: new Map(),  // venueId -> matrix index
  routes: null,          // {routes: {"S-01|S-02": {distM, durMin, poly}}} 事前計算済みルート（未取得時はnull）
  routeCache: new Map(), // "S-01|S-02" -> デコード済み{distM, durMin, coords}
  tieup: [],             // [{id:"T1", name, sponsor, lat, lng, approx}] タイアップステージ（出演情報なし）
  updatedAt: "",         // 公式データ自体の最終更新時刻（JSF_PERFORMANCES_UPDATED_AT）
  checkedAt: "",         // うちのシステムが直近にチェックした時刻（差分の有無に関わらず定期更新）
  changes: [],           // [{checkedAt, sourceUpdatedAt, items:[...]}] 出演者変更の検出履歴（新しい順）
  favorites: new Set(JSON.parse(localStorage.getItem(FAV_KEY) || "[]")),
  location: null,        // {lat, lng} 現在地（実GPSまたはシミュレーション）
  locationSimulated: false, // locationがシミュレーション（会場選択）によるものか
  locationLabel: "",     // シミュレーション時の表示ラベル（会場名など）
  simNow: null,          // {date, min} 時刻シミュレーション（null=実時刻）
  // 開催日の時間別天気予報（未取得・失敗時はnull）
  // { hourly: {"2026-09-12T11": {code, temp, pop}, ...} }
  weather: null,
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

  // ルートデータはまだ生成されていない可能性があるため、失敗しても他機能を止めない
  try {
    store.routes = await fetch("data/routes.json").then((r) => (r.ok ? r.json() : null));
  } catch {
    store.routes = null;
  }

  try {
    const t = await fetch("data/tieup.json").then((r) => (r.ok ? r.json() : null));
    store.tieup = t?.stages || [];
  } catch {
    store.tieup = [];
  }

  // 自動更新ワークフローがまだ一度も走っていない環境では存在しないので、その場合は公式データの更新時刻で代用
  try {
    const c = await fetch("data/checked.json").then((r) => (r.ok ? r.json() : null));
    store.checkedAt = c?.checkedAt || store.updatedAt;
  } catch {
    store.checkedAt = store.updatedAt;
  }

  try {
    const c = await fetch("data/changes.json").then((r) => (r.ok ? r.json() : null));
    store.changes = (c?.history || []).slice().reverse(); // 新しい順
  } catch {
    store.changes = [];
  }
}

// 会場間の事前計算済みルート（ポリライン・距離・所要時間）。データ未生成ならnull
export function getRoute(venueIdA, venueIdB) {
  if (!store.routes || venueIdA === venueIdB) return null;
  const key = venueIdA < venueIdB ? `${venueIdA}|${venueIdB}` : `${venueIdB}|${venueIdA}`;
  if (store.routeCache.has(key)) return store.routeCache.get(key);
  const raw = store.routes.routes[key];
  if (!raw) return null;
  const decoded = decodePolyline(raw.poly);
  const coords = venueIdA < venueIdB ? decoded : decoded.slice().reverse();
  const result = { distM: raw.distM, durMin: raw.durMin, coords };
  store.routeCache.set(key, result);
  return result;
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

function saveFavorites() {
  localStorage.setItem(FAV_KEY, JSON.stringify([...store.favorites]));
}

export function toggleFavorite(perfId) {
  if (store.favorites.has(perfId)) store.favorites.delete(perfId);
  else store.favorites.add(perfId);
  saveFavorites();
}

// 現在のお気に入り（perfKey文字列の配列）をエクスポート用にそのまま返す
export function exportFavorites() {
  return [...store.favorites];
}

// 共有リンク・ファイルから読み込んだキー配列を取り込む。mode: "merge"（追加）| "replace"（置き換え）
export function importFavorites(keys, mode) {
  if (mode === "replace") store.favorites = new Set(keys);
  else for (const k of keys) store.favorites.add(k);
  saveFavorites();
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
        store.locationSimulated = false;
        store.locationLabel = "";
        resolve(store.location);
      },
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  });
}

// 現在地を会場の座標でシミュレーション（実GPSを取得できない環境での動作確認用）
export function simulateLocation(lat, lng, label) {
  store.location = { lat, lng };
  store.locationSimulated = true;
  store.locationLabel = label || "";
}

export function clearLocation() {
  store.location = null;
  store.locationSimulated = false;
  store.locationLabel = "";
}

// 会場エリアの中心付近（勾当台公園〜定禅寺通）の代表地点。全会場が徒歩圏内に収まり
// 気象モデルの解像度でも差が出ないため、会場ごとではなくこの1地点だけで取得する
const WEATHER_LAT = 38.2646, WEATHER_LNG = 140.8694;

// 開催日（DAYS）の時間別天気予報をOpen-Meteo（APIキー不要）から取得し、
// 演目ごとの開始時間帯の天気表示に使う。失敗しても他機能を止めない
export async function loadWeather() {
  try {
    const url = "https://api.open-meteo.com/v1/forecast"
      + `?latitude=${WEATHER_LAT}&longitude=${WEATHER_LNG}&timezone=Asia%2FTokyo`
      + "&hourly=weather_code,temperature_2m,precipitation_probability"
      + `&start_date=${DAYS[0]}&end_date=${DAYS[DAYS.length - 1]}`;
    const res = await fetch(url);
    if (!res.ok) return;
    const d = await res.json();

    const hourly = {};
    (d?.hourly?.time || []).forEach((t, i) => {
      hourly[t.slice(0, 13)] = { // "2026-09-12T11:00" → "2026-09-12T11"
        code: d.hourly.weather_code[i],
        temp: d.hourly.temperature_2m[i],
        pop: d.hourly.precipitation_probability[i],
      };
    });

    store.weather = { hourly };
  } catch {
    // 天気予報は補助情報なので、取得失敗時は非表示のままにする
  }
}

// 指定の日付・開始分（0時からの経過分）の時間帯の天気。未取得・対象時刻が範囲外ならnull
export function weatherAt(date, startMin) {
  if (!store.weather) return null;
  const hour = String(Math.floor(startMin / 60)).padStart(2, "0");
  return store.weather.hourly[`${date}T${hour}`] || null;
}
