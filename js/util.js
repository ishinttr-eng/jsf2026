// 汎用ユーティリティ（時間・文字列・距離）

export const DAYS = ["2026-09-12", "2026-09-13"];
export const DAY_LABELS = { "2026-09-12": "9/12(土)", "2026-09-13": "9/13(日)" };

export function toMin(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function fmtMin(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

// 検索用正規化: NFKC → 小文字 → カタカナをひらがなへ
export function normalize(s) {
  return (s || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60))
    .replace(/\s+/g, "");
}

export function haversineM(lat1, lng1, lat2, lng2) {
  const r = 6371000, rad = Math.PI / 180;
  const dp = (lat2 - lat1) * rad, dl = (lng2 - lng1) * rad;
  const a = Math.sin(dp / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dl / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}

// 直線距離から徒歩分数を概算（道のり補正1.3、徒歩80m/分）
export function walkMinFromCoords(lat1, lng1, lat2, lng2) {
  const d = haversineM(lat1, lng1, lat2, lng2) * 1.3;
  return Math.max(1, Math.ceil(d / 80));
}

// Googleマップの徒歩ナビへ引き渡すURL（APIキー不要）
export function gmapsWalkUrl(destLat, destLng, originLat, originLng) {
  const base = "https://www.google.com/maps/dir/?api=1&travelmode=walking" +
    `&destination=${destLat},${destLng}`;
  return originLat != null ? `${base}&origin=${originLat},${originLng}` : base;
}

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (v != null) node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null) continue;
    node.append(c.nodeType ? c : document.createTextNode(c));
  }
  return node;
}
