// JSF Navi 2026 - メインUI

import { DAYS, DAY_LABELS, fmtMin, normalize, perfKey, el, gmapsWalkUrl, haversineM } from "./util.js";
import { store, loadData, walkBetween, walkFromHere, getRoute, toggleFavorite, nowInfo, requestLocation } from "./store.js";

const main = document.getElementById("main");
let currentTab = "now";
let map = null, markers = new Map(), meMarker = null, routeLayer = null;
let ttState = { day: "", q: "", venue: "", genre: "" }; // day: "" は「すべての日程」
let myState = { day: DAYS[0] }; // マイタイムテーブルの日付絞り込み（すべては無し、常にどちらかの日）
let expandedVenues = new Set(); // 出演者タブで開いている会場の<details>を再描画後も維持するため
// detail: {kind:"venue", venueId, day, from} | {kind:"artist", perf} | null
let detail = null;
// activeRoute: {fromId, toId, fromLabel, toLabel} | {fromHere: true, toId, toLabel} | {myRoute: true} | null
let activeRoute = { myRoute: true }; // マップを開いたときのデフォルトはマイルートモード

// 会場詳細・マイタイムテーブルなどから、地図タブに切り替えてルートを表示する
function showRouteBetween(fromId, toId) {
  const from = store.venueById.get(fromId), to = store.venueById.get(toId);
  activeRoute = { fromId, toId, fromLabel: shortVenueName(from), toLabel: shortVenueName(to) };
  detail = null;
  currentTab = "map";
  render();
}

function showRouteFromHere(toId) {
  const to = store.venueById.get(toId);
  activeRoute = { fromHere: true, toId, toLabel: shortVenueName(to) };
  detail = null;
  currentTab = "map";
  render();
}

// 現在時刻（シミュレーション込み）をもとに、マイタイムテーブル上で「今から向かうべき次のお気に入り」を求める
function computeMyRouteNow() {
  const info = nowInfo();
  if (!DAYS.includes(info.date)) return { message: "開催日ではありません" };
  const todays = store.performances
    .filter((p) => p.date === info.date && store.favorites.has(perfKey(p)))
    .sort((a, b) => a.startMin - b.startMin);
  if (!todays.length) return { message: "本日のお気に入りが登録されていません" };
  const next = todays.find((p) => p.startMin > info.min);
  const prevList = todays.filter((p) => p.startMin <= info.min);
  const prev = prevList.length ? prevList[prevList.length - 1] : null;
  if (!next) return { message: "本日のお気に入り予定はすべて終了しました" };
  return prev
    ? { fromId: prev.venueId, toId: next.venueId, toPerf: next }
    : { fromHere: true, toId: next.venueId, toPerf: next };
}

// ---------- 共通部品 ----------

function venueLabel(v) {
  return `S${String(v.stageNo).padStart(2, "0")} ${v.name}`;
}

function shortVenueName(v) {
  return v.name.replace(/\s*supported by.*$/i, "");
}

// NOW ON AIRで設定した時刻シミュレーション中であることを他の画面でも分かるように表示するバッジ
function simBadge() {
  if (!store.simNow) return null;
  return el("div", { class: "sim-badge" },
    el("span", {}, `🕐 ${DAY_LABELS[store.simNow.date]} ${fmtMin(store.simNow.min)}（シミュレーション中）`),
    el("button", { class: "link", onclick: () => { store.simNow = null; render(); } }, "実時刻に戻す"));
}

function favButton(p) {
  const active = store.favorites.has(perfKey(p));
  return el("button", {
    class: `fav ${active ? "on" : ""}`,
    "aria-label": "お気に入り",
    onclick: (e) => {
      e.stopPropagation();
      toggleFavorite(perfKey(p));
      render();
    },
  }, active ? "★" : "☆");
}

function perfCard(p, opts = {}) {
  const v = store.venueById.get(p.venueId);
  const meta = [];
  if (p.genre) meta.push(p.genre);
  if (p.isU25) meta.push("U-25");
  if (p.region) meta.push(p.region);
  const badges = [];
  if (opts.walkMin != null) {
    badges.push(el("span", { class: "badge walk" }, `🚶${opts.walkMin}分`));
    if (opts.startsInMin != null) {
      const ok = opts.walkMin <= opts.startsInMin;
      badges.push(el("span", { class: `badge ${ok ? "ok" : "ng"}` }, ok ? "間に合う" : "間に合わない"));
    }
  }
  const highlightClass = opts.highlight === "playing" ? " playing" : opts.highlight === "next" ? " next-up" : "";
  return el("div", { class: `card${highlightClass}`, onclick: () => openArtist(p) },
    el("div", { class: "card-head" },
      opts.highlight ? el("span", { class: `flag ${opts.highlight}` },
        opts.highlight === "playing" ? "🔴 演奏中" : "▶ 次はここ") : null,
      el("span", { class: "time" }, `${p.start}–${p.end}`),
      opts.dayLabel ? el("span", { class: "day-tag" }, DAY_LABELS[p.date]) : null,
      favButton(p)),
    el("div", { class: "name" }, p.name),
    meta.length ? el("div", { class: "meta" }, meta.join(" ・ ")) : null,
    el("div", { class: "venue-line" },
      el("button", {
        class: "venue-link",
        onclick: (e) => { e.stopPropagation(); openVenue(p.venueId, p.date); },
      }, `📍 ${venueLabel(v).replace(/ supported by.*$/i, "")}`),
      ...badges));
}

// ---------- いま ----------

function viewNow() {
  const info = nowInfo();
  const wrap = el("div", { class: "view" });

  // 時刻シミュレーション行
  const simRow = el("div", { class: "sim-row" },
    el("span", {}, info.simulated
      ? `🕐 ${DAY_LABELS[info.date] || info.date} ${fmtMin(info.min)}（シミュレーション中）`
      : `🕐 ${fmtMin(info.min)} 現在`));
  if (store.simNow) {
    simRow.append(el("button", { class: "link", onclick: () => { store.simNow = null; render(); } }, "実時刻に戻す"));
  } else {
    const daySel = el("select", { class: "select sim-input" },
      DAYS.map((d) => el("option", { value: d }, DAY_LABELS[d])));
    const timeIn = el("input", { class: "select sim-input", type: "time", value: "14:00" });
    simRow.append(daySel, timeIn, el("button", {
      class: "link", onclick: () => {
        const [h, m] = timeIn.value.split(":").map(Number);
        if (Number.isFinite(h)) {
          store.simNow = { date: daySel.value, min: h * 60 + m };
          render();
        }
      },
    }, "この時刻で見る"));
  }
  wrap.append(simRow);

  wrap.append(locationRow());

  if (!DAYS.includes(info.date)) {
    wrap.append(el("p", { class: "note" },
      "開催日（9/12・9/13）ではありません。「時刻を変える」で当日の時間帯をプレビューできます。"));
    return wrap;
  }

  const todays = store.performances.filter((p) => p.date === info.date);
  const playing = todays.filter((p) => p.startMin <= info.min && info.min < p.endMin);
  const soon = todays.filter((p) => p.startMin > info.min && p.startMin - info.min <= 30);

  const section = (title, list, withCountdown) => {
    wrap.append(el("h2", {}, `${title}（${list.length}）`));
    if (!list.length) wrap.append(el("p", { class: "note" }, "該当なし"));
    for (const p of list) {
      wrap.append(perfCard(p, {
        walkMin: walkFromHere(p.venueId),
        startsInMin: withCountdown ? p.startMin - info.min : null,
      }));
    }
  };
  section("🎷 いま演奏中", playing, false);
  section("🕒 もうすぐ開始（30分以内）", soon, true);
  return wrap;
}

function locationRow() {
  return el("div", { class: "loc-row" },
    store.location
      ? el("span", { class: "note" }, "📍 現在地取得済み（徒歩時間は直線距離からの目安）")
      : el("button", {
        class: "btn small", onclick: async (e) => {
          e.target.textContent = "取得中…";
          try { await requestLocation(); render(); }
          catch { e.target.textContent = "現在地を取得できませんでした（再試行）"; }
        },
      }, "📍 現在地を取得して徒歩時間を表示"));
}

// ---------- 出演者・タイムテーブル ----------

function viewTimetable() {
  const wrap = el("div", { class: "view" });

  const search = el("input", {
    class: "search", type: "search", placeholder: "出演者名・かな・ジャンルで検索",
    value: ttState.q,
    oninput: (e) => { ttState.q = e.target.value; renderTTList(listBox); },
  });

  const dayTabs = el("div", { class: "day-tabs" },
    [{ value: "", label: "すべて" }, ...DAYS.map((d) => ({ value: d, label: DAY_LABELS[d] }))]
      .map(({ value, label }) => el("button", {
        class: `day-tab ${ttState.day === value ? "active" : ""}`,
        onclick: () => { ttState.day = value; render(); },
      }, label)));

  const venueSel = el("select", { class: "select", onchange: (e) => { ttState.venue = e.target.value; renderTTList(listBox); } },
    el("option", { value: "" }, "全会場"),
    store.venues.map((v) => {
      const o = el("option", { value: v.id }, venueLabel(v));
      if (ttState.venue === v.id) o.selected = true;
      return o;
    }));

  const genres = [...new Set(store.performances.map((p) => p.genre).filter(Boolean))].sort();
  const genreSel = el("select", { class: "select", onchange: (e) => { ttState.genre = e.target.value; renderTTList(listBox); } },
    el("option", { value: "" }, "全ジャンル"),
    genres.map((g) => {
      const o = el("option", { value: g }, g);
      if (ttState.genre === g) o.selected = true;
      return o;
    }));

  const listBox = el("div", {});
  wrap.append(dayTabs, search, el("div", { class: "filter-row" }, venueSel, genreSel), listBox);
  renderTTList(listBox);
  return wrap;
}

function renderTTList(box) {
  box.replaceChildren();
  const q = normalize(ttState.q);
  const crossDate = ttState.day === ""; // 「すべての日程」選択時は日付をまたいで探す
  let list = crossDate ? store.performances : store.performances.filter((p) => p.date === ttState.day);
  if (ttState.venue) list = list.filter((p) => p.venueId === ttState.venue);
  if (ttState.genre) list = list.filter((p) => p.genre === ttState.genre);
  if (q) list = list.filter((p) =>
    normalize(p.name).includes(q) || normalize(p.kana).includes(q) || normalize(p.genre).includes(q));

  box.append(el("p", { class: "note" }, `${list.length}件`));
  if (ttState.venue || q) {
    // 会場指定・検索時はフラットに時刻順（日付をまたぐ場合は日付バッジを表示）
    for (const p of list) box.append(perfCard(p, { dayLabel: crossDate }));
  } else {
    // 会場ごとにグループ表示（日付をまたぐ場合は日付バッジを表示）
    for (const v of store.venues) {
      const ps = list.filter((p) => p.venueId === v.id);
      if (!ps.length) continue;
      const det = el("details", {
        ontoggle: (e) => {
          if (e.target.open) expandedVenues.add(v.id);
          else expandedVenues.delete(v.id);
        },
      },
        el("summary", {}, `${venueLabel(v)}（${ps.length}）`),
        ps.map((p) => perfCard(p, { dayLabel: crossDate })));
      det.open = expandedVenues.has(v.id);
      box.append(det);
    }
  }
}

// ---------- マップ ----------

function viewMap() {
  const wrap = el("div", { class: "view map-view" });
  const mapDiv = el("div", { id: "map" });
  wrap.append(mapDiv);
  const badge = simBadge();
  if (badge) { badge.classList.add("sim-badge-map"); wrap.append(badge); }
  return wrap;
}

function initMap(mapDiv, wrap) {
  if (map) { map.remove(); map = null; }
  map = L.map(mapDiv).setView([38.2625, 140.871], 15);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);

  markers = new Map();
  for (const v of store.venues) {
    const icon = L.divIcon({
      className: "stage-pin",
      html: `<span>${v.stageNo}</span>`,
      iconSize: [26, 26], iconAnchor: [13, 13],
    });
    const m = L.marker([v.lat, v.lng], { icon }).addTo(map);
    m.bindTooltip(venueLabel(v), { direction: "top", offset: [0, -14] });
    m.bindPopup(() => popupHtml(v), { maxWidth: 260 });
    markers.set(v.id, m);
  }
  for (const t of store.tieup) {
    const isJunior = t.id === "J";
    const icon = L.divIcon({
      className: isJunior ? "tieup-pin junior" : "tieup-pin",
      html: `<span>${t.id}</span>`,
      iconSize: isJunior ? [26, 26] : [30, 24], iconAnchor: isJunior ? [13, 13] : [15, 12],
    });
    const m = L.marker([t.lat, t.lng], { icon }).addTo(map);
    m.bindTooltip(`${t.name}${t.approx ? "（位置は目安）" : ""}`, { direction: "top", offset: [0, -14] });
    m.bindPopup(tieupPopupHtml(t), { maxWidth: 260 });
  }
  if (store.location) {
    meMarker = L.circleMarker([store.location.lat, store.location.lng],
      { radius: 8, color: "#fff", weight: 2, fillColor: "#2b7de9", fillOpacity: 1 }).addTo(map);
  }

  const locBtn = L.control({ position: "topleft" });
  locBtn.onAdd = () => {
    const b = L.DomUtil.create("button", "map-loc-btn");
    b.textContent = "📍";
    b.title = "現在地";
    L.DomEvent.on(b, "click", async (e) => {
      L.DomEvent.stop(e);
      try {
        const loc = await requestLocation();
        if (meMarker) meMarker.setLatLng([loc.lat, loc.lng]);
        else meMarker = L.circleMarker([loc.lat, loc.lng],
          { radius: 8, color: "#fff", weight: 2, fillColor: "#2b7de9", fillOpacity: 1 }).addTo(map);
        map.setView([loc.lat, loc.lng], 16);
        drawActiveRoute(wrap);
      } catch { b.textContent = "❌"; setTimeout(() => { b.textContent = "📍"; }, 1500); }
    });
    return b;
  };
  locBtn.addTo(map);

  const myRouteBtn = L.control({ position: "topleft" });
  myRouteBtn.onAdd = () => {
    const b = L.DomUtil.create("button", "map-loc-btn map-mode-btn");
    b.textContent = "🕒";
    b.title = "マイルート（現在時刻に応じた次の移動先を表示）";
    b.classList.toggle("active", !!activeRoute?.myRoute);
    L.DomEvent.on(b, "click", (e) => {
      L.DomEvent.stop(e);
      activeRoute = activeRoute?.myRoute ? null : { myRoute: true };
      b.classList.toggle("active", !!activeRoute?.myRoute);
      drawActiveRoute(wrap);
    });
    return b;
  };
  myRouteBtn.addTo(map);

  drawActiveRoute(wrap);
}

// 会場間（または現在地→会場）のルートを地図上に描画し、Googleリンク付きのバナーを出す
function drawActiveRoute(wrap) {
  if (routeLayer) { map.removeLayer(routeLayer); routeLayer = null; }
  document.getElementById("route-banner")?.remove();
  if (!activeRoute) return;

  const closeBtn = el("button", {
    class: "btn small close-route",
    onclick: () => { activeRoute = null; render(); },
  }, "✕");

  // マイルートモード: 表示のたびに現在時刻から改めて「次の移動先」を計算し直す
  let spec = activeRoute;
  if (activeRoute.myRoute) {
    const my = computeMyRouteNow();
    if (my.message) {
      wrap.append(el("div", { id: "route-banner", class: "route-banner" },
        el("div", { class: "route-banner-text" },
          el("div", { class: "route-banner-title" }, "🕒 マイルート"),
          el("div", { class: "route-banner-sub" }, my.message)),
        el("div", { class: "route-banner-btns" }, closeBtn)));
      return;
    }
    spec = {
      myRoute: true,
      fromHere: !!my.fromHere,
      fromId: my.fromId,
      toId: my.toId,
      fromLabel: my.fromId ? shortVenueName(store.venueById.get(my.fromId)) : null,
      toLabel: shortVenueName(store.venueById.get(my.toId)),
      nextPerf: my.toPerf,
    };
  }

  const to = store.venueById.get(spec.toId);
  let coords = null, from = null, precomputed = null;

  if (spec.fromHere) {
    if (store.location) {
      from = store.location;
      coords = [[store.location.lat, store.location.lng], [to.lat, to.lng]];
    }
  } else {
    from = store.venueById.get(spec.fromId);
    precomputed = getRoute(spec.fromId, spec.toId);
    coords = precomputed ? precomputed.coords : [[from.lat, from.lng], [to.lat, to.lng]];
  }

  const isApprox = !precomputed;
  const fromLabel = spec.fromHere ? "現在地" : spec.fromLabel;

  let subText;
  if (!coords) {
    subText = "現在地が未取得です（📍ボタンで取得できます）";
  } else if (precomputed) {
    subText = `🚶 徒歩約${precomputed.durMin}分（約${precomputed.distM}m）`;
  } else {
    subText = `📏 直線距離の目安 約${Math.round(haversineM(coords[0][0], coords[0][1], coords[1][0], coords[1][1]))}m（実測ルート未取得）`;
  }
  if (spec.myRoute && spec.nextPerf) {
    subText += ` ／ 次: ${spec.nextPerf.start} ${spec.nextPerf.name}`;
  }

  if (coords) {
    // 地図タイルの色（特に主要道路のオレンジ系）に埋もれないよう、白い縁取り＋高彩度の線色で描画する
    const color = isApprox ? "#3f7dff" : "#ff2f92";
    const dash = isApprox ? "7 9" : null;
    const halo = L.polyline(coords, { color: "#ffffff", weight: isApprox ? 7 : 9, opacity: 0.95, dashArray: dash });
    const line = L.polyline(coords, { color, weight: isApprox ? 3 : 5, opacity: 1, dashArray: dash });
    routeLayer = L.featureGroup([halo, line]).addTo(map);
    map.fitBounds(routeLayer.getBounds(), { padding: [48, 48] });
  }

  const gUrl = gmapsWalkUrl(to.lat, to.lng, from?.lat, from?.lng);
  wrap.append(el("div", { id: "route-banner", class: "route-banner" },
    el("div", { class: "route-banner-text" },
      el("div", { class: "route-banner-title" }, `${spec.myRoute ? "🕒 " : ""}${fromLabel} → ${spec.toLabel}`),
      el("div", { class: "route-banner-sub" }, subText)),
    el("div", { class: "route-banner-btns" },
      el("a", { class: "btn small go", target: "_blank", rel: "noopener", href: gUrl }, "Googleで開く"),
      closeBtn)));
}

function popupHtml(v) {
  const info = nowInfo();
  const div = document.createElement("div");
  div.className = "popup";
  let lines = `<b>${venueLabel(v)}</b>`;
  if (DAYS.includes(info.date)) {
    const ps = store.performances.filter((p) => p.date === info.date && p.venueId === v.id);
    const playing = ps.find((p) => p.startMin <= info.min && info.min < p.endMin);
    const next = ps.find((p) => p.startMin > info.min);
    if (playing) lines += `<br>🎷 演奏中: ${playing.name}（〜${playing.end}）`;
    if (next) lines += `<br>🕒 次: ${next.start} ${next.name}`;
  }
  const w = walkFromHere(v.id);
  if (w != null) lines += `<br>🚶 現在地から約${w}分`;
  div.innerHTML = lines;
  const btns = document.createElement("div");
  btns.className = "popup-btns";
  const detail = document.createElement("button");
  detail.className = "btn small";
  detail.textContent = "タイムテーブル";
  detail.onclick = () => openVenue(v.id, DAYS.includes(info.date) ? info.date : DAYS[0]);
  const go = document.createElement("a");
  go.className = "btn small go";
  go.textContent = "ここへ行く";
  go.target = "_blank";
  go.rel = "noopener";
  go.href = gmapsWalkUrl(v.lat, v.lng, store.location?.lat, store.location?.lng);
  btns.append(detail, go);
  div.append(btns);
  return div;
}

function tieupPopupHtml(t) {
  const div = document.createElement("div");
  div.className = "popup";
  let lines = `<b>タイアップステージ ${t.id}</b><br>${t.name}`;
  if (t.sponsor) lines += `<br>主催: ${t.sponsor}`;
  lines += `<br><span class="note">出演スケジュールは主催者発表をご確認ください${t.approx ? "／位置は目安です" : ""}</span>`;
  div.innerHTML = lines;
  const btns = document.createElement("div");
  btns.className = "popup-btns";
  if (t.sourceUrl) {
    const src = document.createElement("a");
    src.className = "btn small";
    src.textContent = "主催者発表を見る";
    src.target = "_blank";
    src.rel = "noopener";
    src.href = t.sourceUrl;
    btns.append(src);
  }
  const go = document.createElement("a");
  go.className = "btn small go";
  go.textContent = "ここへ行く";
  go.target = "_blank";
  go.rel = "noopener";
  go.href = gmapsWalkUrl(t.lat, t.lng, store.location?.lat, store.location?.lng);
  btns.append(go);
  div.append(btns);
  return div;
}

// ---------- マイ ----------

function viewMy() {
  const wrap = el("div", { class: "view" });
  const favs = store.performances.filter((p) => store.favorites.has(perfKey(p)));
  if (!favs.length) {
    wrap.append(el("p", { class: "note" }, "☆をタップしてお気に入り登録すると、ここに自分のタイムテーブルができます。"));
    return wrap;
  }

  const badge = simBadge();
  if (badge) wrap.append(badge);

  const dayTabs = el("div", { class: "day-tabs" },
    DAYS.map((d) => el("button", {
      class: `day-tab ${myState.day === d ? "active" : ""}`,
      onclick: () => { myState.day = d; render(); },
    }, DAY_LABELS[d])));
  wrap.append(dayTabs);

  // 現在時刻に該当する（演奏中、なければ次に始まる）お気に入りへ自動スクロール＋強調表示するための目印
  const info = nowInfo();
  let scrollTarget = null, scrollTargetKind = null;
  if (DAYS.includes(info.date)) {
    const todays = favs.filter((p) => p.date === info.date).sort((a, b) => a.startMin - b.startMin);
    const playing = todays.find((p) => p.startMin <= info.min && info.min < p.endMin);
    scrollTarget = playing || todays.find((p) => p.startMin > info.min);
    scrollTargetKind = playing ? "playing" : "next";
  }
  for (const day of [myState.day]) {
    const list = favs.filter((p) => p.date === day);
    if (!list.length) continue;
    wrap.append(el("h2", {}, DAY_LABELS[day]));
    let prev = null;
    for (const p of list) {
      // 前のお気に入りとの間の移動チェック（クリックで地図にその2会場間のルートを表示、横のリンクでGoogleマップも開ける）
      if (prev) {
        const need = walkBetween(prev.venueId, p.venueId);
        const gap = p.startMin - prev.endMin;
        const prevV = store.venueById.get(prev.venueId), curV = store.venueById.get(p.venueId);
        const gHref = gmapsWalkUrl(curV.lat, curV.lng, prevV.lat, prevV.lng);
        const moveRow = (labelClass, text) => el("div", { class: "move-row" },
          el("button", {
            class: labelClass, onclick: () => showRouteBetween(prevV.id, curV.id),
          }, text),
          el("a", { class: "gmap-link", href: gHref, target: "_blank", rel: "noopener" }, "Googleで開く"));
        if (gap < 0) {
          wrap.append(moveRow("warn", `⚠️ 時間が重なっています（会場間 徒歩約${need}分）`));
        } else if (need > 0) {
          const ok = need <= gap;
          wrap.append(moveRow(ok ? "move" : "warn",
            `${ok ? "🚶" : "⚠️"} 移動 約${need}分（空き${gap}分）${ok ? "" : " — 間に合わない可能性"}`));
        }
      }
      const isTarget = scrollTarget && p === scrollTarget;
      const card = perfCard(p, { walkMin: walkFromHere(p.venueId), highlight: isTarget ? scrollTargetKind : null });
      if (isTarget) card.dataset.scrollTarget = "true";
      wrap.append(card);
      prev = p;
    }
  }
  return wrap;
}

// ---------- 詳細モーダル（会場・アーティスト） ----------

function openVenue(venueId, day) {
  detail = { kind: "venue", venueId, day: day || DAYS[0], from: "here" };
  renderDetail();
}

function openArtist(perf) {
  detail = { kind: "artist", perf };
  renderDetail();
}

function closeDetail() {
  detail = null;
  renderDetail();
  render();
}

function renderDetail() {
  document.getElementById("modal")?.remove();
  if (!detail) return;
  const modal = detail.kind === "venue" ? venueModal(detail) : artistModal(detail.perf);
  document.body.append(modal);
}

function venueModal(d) {
  const v = store.venueById.get(d.venueId);

  const dayTabs = el("div", { class: "day-tabs" },
    DAYS.map((day) => el("button", {
      class: `day-tab ${d.day === day ? "active" : ""} ${v.days.includes(day) ? "" : "disabled"}`,
      onclick: () => { d.day = day; renderDetail(); },
    }, DAY_LABELS[day] + (v.days.includes(day) ? "" : "（開催なし）"))));

  // 移動元セレクタ
  const fromSel = el("select", { class: "select", onchange: (e) => { d.from = e.target.value; renderDetail(); } },
    el("option", { value: "here" }, "現在地から"),
    store.venues.filter((x) => x.id !== v.id).map((x) => {
      const o = el("option", { value: x.id }, venueLabel(x));
      if (d.from === x.id) o.selected = true;
      return o;
    }));
  if (d.from === "here") fromSel.value = "here";

  let walkText;
  if (d.from === "here") {
    const w = walkFromHere(v.id);
    walkText = w != null ? `🚶 徒歩 約${w}分` : "（現在地未取得）";
  } else {
    walkText = `🚶 徒歩 約${walkBetween(d.from, v.id)}分`;
  }

  const ps = store.performances.filter((p) => p.date === d.day && p.venueId === v.id);
  const info = nowInfo();

  return el("div", { id: "modal", onclick: (e) => { if (e.target.id === "modal") closeDetail(); } },
    el("div", { class: "modal-body" },
      el("div", { class: "modal-head" },
        el("h2", {}, `S${String(v.stageNo).padStart(2, "0")} ${shortVenueName(v)}`),
        el("button", { class: "close", onclick: closeDetail }, "✕")),
      el("div", { class: "walk-row" },
        fromSel,
        el("span", { class: "walk-min" }, walkText)),
      el("div", { class: "walk-row" },
        el("button", {
          class: "btn small",
          onclick: () => (d.from === "here" ? showRouteFromHere(v.id) : showRouteBetween(d.from, v.id)),
        }, "🗺 地図で見る"),
        el("a", {
          class: "btn small go", target: "_blank", rel: "noopener",
          href: gmapsWalkUrl(v.lat, v.lng,
            d.from === "here" ? store.location?.lat : store.venueById.get(d.from)?.lat,
            d.from === "here" ? store.location?.lng : store.venueById.get(d.from)?.lng),
        }, "ここへ行く")),
      dayTabs,
      el("div", { class: "modal-list" },
        ps.length ? ps.map((p) => {
          const playingNow = info.date === p.date && p.startMin <= info.min && info.min < p.endMin;
          const c = perfCard(p);
          if (playingNow) c.classList.add("playing");
          return c;
        }) : el("p", { class: "note" }, "この日の演奏はありません"))));
}

function artistModal(p) {
  const v = store.venueById.get(p.venueId);
  const active = store.favorites.has(perfKey(p));

  const badges = [];
  if (p.genre) badges.push(el("span", { class: "badge" }, p.genre));
  if (p.isU25) badges.push(el("span", { class: "badge" }, "U-25"));
  if (p.region) badges.push(el("span", { class: "badge" }, p.region));
  if (p.awardEntry && p.awardEntry !== "参加しない") badges.push(el("span", { class: "badge award" }, `🏆 ${p.awardEntry}`));

  return el("div", { id: "modal", onclick: (e) => { if (e.target.id === "modal") closeDetail(); } },
    el("div", { class: "modal-body" },
      el("div", { class: "modal-head" },
        el("div", { class: "modal-head-title" },
          el("h2", {}, p.name),
          p.kana ? el("div", { class: "kana" }, p.kana) : null),
        el("button", {
          class: `fav big ${active ? "on" : ""}`,
          "aria-label": "お気に入り",
          onclick: () => { toggleFavorite(perfKey(p)); renderDetail(); },
        }, active ? "★" : "☆"),
        el("button", { class: "close", onclick: closeDetail }, "✕")),
      badges.length ? el("div", { class: "badge-row" }, badges) : null,
      el("div", { class: "artist-when" }, `🕒 ${DAY_LABELS[p.date]} ${p.start}–${p.end}`),
      el("button", {
        class: "venue-link big",
        onclick: () => openVenue(p.venueId, p.date),
      }, `📍 S${String(v.stageNo).padStart(2, "0")} ${shortVenueName(v)}`),
      p.intro
        ? el("p", { class: "intro" }, p.intro)
        : el("p", { class: "note" }, "紹介文はありません"),
      el("a", {
        class: "btn go", target: "_blank", rel: "noopener",
        href: gmapsWalkUrl(v.lat, v.lng, store.location?.lat, store.location?.lng),
      }, "この会場へ行く")));
}

// ---------- タブ・描画 ----------

const views = { now: viewNow, timetable: viewTimetable, map: viewMap, my: viewMy };

function render() {
  const view = views[currentTab]();
  main.replaceChildren(view);
  for (const b of document.querySelectorAll(".tab-btn")) {
    b.classList.toggle("active", b.dataset.tab === currentTab);
  }
  // DOMへの接続後、同期的に初期化する（rAFに任せるとバックグラウンドタブで遅延・スキップされるため）
  if (currentTab === "map") initMap(view.querySelector("#map"), view);
  if (currentTab === "my") view.querySelector("[data-scroll-target]")?.scrollIntoView({ block: "center" });
  renderDetail(); // detail が null のときは既存モーダルの除去だけ行う
}

document.getElementById("tabs").addEventListener("click", (e) => {
  const b = e.target.closest(".tab-btn");
  if (!b) return;
  currentTab = b.dataset.tab;
  if (currentTab === "my") {
    // マイタイムテーブルを開くたびに、現在時刻（シミュレーション込み）の日付に合わせる
    const info = nowInfo();
    myState.day = DAYS.includes(info.date) ? info.date : DAYS[0];
  }
  render();
});

// sw.jsのCACHE名（jsf-navi-${VERSION}）から現在キャッシュされているバージョンを読み取る。
// sw.js側のVERSIONと二重管理にならないよう、値そのものはここでは持たない
async function currentSwVersion() {
  if (!("caches" in window)) return null;
  try {
    const key = (await caches.keys()).find((k) => k.startsWith("jsf-navi-"));
    return key ? key.slice("jsf-navi-".length) : null;
  } catch {
    return null;
  }
}

loadData().then(async () => {
  const d = new Date(store.checkedAt);
  const ver = await currentSwVersion();
  document.getElementById("updated").textContent =
    `確認: ${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}時点` +
    (ver ? ` / ${ver}` : "");
  render();
}).catch((e) => {
  main.textContent = `データの読み込みに失敗しました: ${e.message}`;
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
