// JSF Navi 2026 - メインUI

import { DAYS, DAY_LABELS, fmtMin, normalize, el, gmapsWalkUrl } from "./util.js";
import { store, loadData, walkBetween, walkFromHere, toggleFavorite, nowInfo, requestLocation } from "./store.js";

const main = document.getElementById("main");
let currentTab = "now";
let map = null, markers = new Map(), meMarker = null;
let ttState = { day: DAYS[0], q: "", venue: "", genre: "" };
let detailVenueId = null, detailDay = DAYS[0], detailFrom = "here";

// ---------- 共通部品 ----------

function venueLabel(v) {
  return `S${String(v.stageNo).padStart(2, "0")} ${v.name}`;
}

function shortVenueName(v) {
  return v.name.replace(/\s*supported by.*$/i, "");
}

function favButton(p) {
  const active = store.favorites.has(p.id);
  return el("button", {
    class: `fav ${active ? "on" : ""}`,
    "aria-label": "お気に入り",
    onclick: (e) => {
      e.stopPropagation();
      toggleFavorite(p.id);
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
  return el("div", { class: "card", onclick: () => openVenue(p.venueId, p.date) },
    el("div", { class: "card-head" },
      el("span", { class: "time" }, `${p.start}–${p.end}`),
      opts.dayLabel ? el("span", { class: "day-tag" }, DAY_LABELS[p.date]) : null,
      favButton(p)),
    el("div", { class: "name" }, p.name),
    meta.length ? el("div", { class: "meta" }, meta.join(" ・ ")) : null,
    el("div", { class: "venue-line" },
      el("span", { class: "venue" }, `📍 ${venueLabel(v).replace(/ supported by.*$/i, "")}`),
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

  const dayTabs = el("div", { class: "day-tabs" },
    DAYS.map((d) => el("button", {
      class: `day-tab ${ttState.day === d ? "active" : ""}`,
      onclick: () => { ttState.day = d; render(); },
    }, DAY_LABELS[d])));

  const search = el("input", {
    class: "search", type: "search", placeholder: "出演者名・かな・ジャンルで検索",
    value: ttState.q,
    oninput: (e) => { ttState.q = e.target.value; renderTTList(listBox); },
  });

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
  let list = store.performances.filter((p) => p.date === ttState.day);
  if (ttState.venue) list = list.filter((p) => p.venueId === ttState.venue);
  if (ttState.genre) list = list.filter((p) => p.genre === ttState.genre);
  if (q) list = list.filter((p) =>
    normalize(p.name).includes(q) || normalize(p.kana).includes(q) || normalize(p.genre).includes(q));

  box.append(el("p", { class: "note" }, `${list.length}件`));
  if (ttState.venue || q) {
    // 会場指定・検索時はフラットに時刻順
    for (const p of list) box.append(perfCard(p));
  } else {
    // 会場ごとにグループ表示
    for (const v of store.venues) {
      const ps = list.filter((p) => p.venueId === v.id);
      if (!ps.length) continue;
      const det = el("details", {},
        el("summary", {}, `${venueLabel(v)}（${ps.length}）`),
        ps.map((p) => perfCard(p)));
      box.append(det);
    }
  }
}

// ---------- マップ ----------

function viewMap() {
  const wrap = el("div", { class: "view map-view" });
  const mapDiv = el("div", { id: "map" });
  wrap.append(mapDiv);
  requestAnimationFrame(() => initMap(mapDiv));
  return wrap;
}

function initMap(mapDiv) {
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
    m.bindPopup(() => popupHtml(v), { maxWidth: 260 });
    markers.set(v.id, m);
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
      } catch { b.textContent = "❌"; setTimeout(() => { b.textContent = "📍"; }, 1500); }
    });
    return b;
  };
  locBtn.addTo(map);
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

// ---------- マイ ----------

function viewMy() {
  const wrap = el("div", { class: "view" });
  const favs = store.performances.filter((p) => store.favorites.has(p.id));
  if (!favs.length) {
    wrap.append(el("p", { class: "note" }, "☆をタップしてお気に入り登録すると、ここに自分のタイムテーブルができます。"));
    return wrap;
  }
  for (const day of DAYS) {
    const list = favs.filter((p) => p.date === day);
    if (!list.length) continue;
    wrap.append(el("h2", {}, DAY_LABELS[day]));
    let prev = null;
    for (const p of list) {
      // 前のお気に入りとの間の移動チェック
      if (prev) {
        const need = walkBetween(prev.venueId, p.venueId);
        const gap = p.startMin - prev.endMin;
        if (gap < 0) {
          wrap.append(el("p", { class: "warn" }, "⚠️ 時間が重なっています"));
        } else if (need > 0) {
          const ok = need <= gap;
          wrap.append(el("p", { class: ok ? "move" : "warn" },
            `${ok ? "🚶" : "⚠️"} 移動 約${need}分（空き${gap}分）${ok ? "" : " — 間に合わない可能性"}`));
        }
      }
      wrap.append(perfCard(p, { walkMin: walkFromHere(p.venueId) }));
      prev = p;
    }
  }
  return wrap;
}

// ---------- 会場詳細（モーダル） ----------

function openVenue(venueId, day) {
  detailVenueId = venueId;
  detailDay = day || DAYS[0];
  renderDetail();
}

function renderDetail() {
  document.getElementById("modal")?.remove();
  if (!detailVenueId) return;
  const v = store.venueById.get(detailVenueId);

  const close = () => { detailVenueId = null; renderDetail(); render(); };

  const dayTabs = el("div", { class: "day-tabs" },
    DAYS.map((d) => el("button", {
      class: `day-tab ${detailDay === d ? "active" : ""} ${v.days.includes(d) ? "" : "disabled"}`,
      onclick: () => { detailDay = d; renderDetail(); },
    }, DAY_LABELS[d] + (v.days.includes(d) ? "" : "（開催なし）"))));

  // 移動元セレクタ
  const fromSel = el("select", { class: "select", onchange: (e) => { detailFrom = e.target.value; renderDetail(); } },
    el("option", { value: "here" }, "現在地から"),
    store.venues.filter((x) => x.id !== v.id).map((x) => {
      const o = el("option", { value: x.id }, venueLabel(x));
      if (detailFrom === x.id) o.selected = true;
      return o;
    }));
  if (detailFrom === "here") fromSel.value = "here";

  let walkText;
  if (detailFrom === "here") {
    const w = walkFromHere(v.id);
    walkText = w != null ? `🚶 徒歩 約${w}分` : "（現在地未取得）";
  } else {
    walkText = `🚶 徒歩 約${walkBetween(detailFrom, v.id)}分`;
  }

  const ps = store.performances.filter((p) => p.date === detailDay && p.venueId === v.id);
  const info = nowInfo();

  const modal = el("div", { id: "modal", onclick: (e) => { if (e.target.id === "modal") close(); } },
    el("div", { class: "modal-body" },
      el("div", { class: "modal-head" },
        el("h2", {}, `S${String(v.stageNo).padStart(2, "0")} ${shortVenueName(v)}`),
        el("button", { class: "close", onclick: close }, "✕")),
      el("div", { class: "walk-row" },
        fromSel,
        el("span", { class: "walk-min" }, walkText),
        el("a", {
          class: "btn small go", target: "_blank", rel: "noopener",
          href: gmapsWalkUrl(v.lat, v.lng,
            detailFrom === "here" ? store.location?.lat : store.venueById.get(detailFrom)?.lat,
            detailFrom === "here" ? store.location?.lng : store.venueById.get(detailFrom)?.lng),
        }, "ここへ行く")),
      dayTabs,
      el("div", { class: "modal-list" },
        ps.length ? ps.map((p) => {
          const playingNow = info.date === p.date && p.startMin <= info.min && info.min < p.endMin;
          const c = perfCard(p);
          if (playingNow) c.classList.add("playing");
          return c;
        }) : el("p", { class: "note" }, "この日の演奏はありません"))));
  document.body.append(modal);
}

// ---------- タブ・描画 ----------

const views = { now: viewNow, timetable: viewTimetable, map: viewMap, my: viewMy };

function render() {
  main.replaceChildren(views[currentTab]());
  for (const b of document.querySelectorAll(".tab-btn")) {
    b.classList.toggle("active", b.dataset.tab === currentTab);
  }
  if (detailVenueId) renderDetail();
}

document.getElementById("tabs").addEventListener("click", (e) => {
  const b = e.target.closest(".tab-btn");
  if (!b) return;
  currentTab = b.dataset.tab;
  render();
});

loadData().then(() => {
  const d = new Date(store.updatedAt);
  document.getElementById("updated").textContent =
    `データ: ${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}時点`;
  render();
}).catch((e) => {
  main.textContent = `データの読み込みに失敗しました: ${e.message}`;
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
