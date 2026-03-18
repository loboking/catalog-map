// ── 상태 ──────────────────────────────────────────────────────────
const STORAGE_KEY = "delivery_status_v1";

function loadDeliveryState() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); }
  catch { return {}; }
}
function saveDeliveryState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// 시군구명 정규화
function normalizeSigungu(sg) {
  if (!sg) return "";
  sg = sg.trim().replace("충청남도 ", "");
  if (sg === "천안시") return "천안시동남구"; // 구 미분류 → 동남구로 편입
  if (sg.startsWith("아산시")) return "아산시"; // 공백 제거
  return sg;
}

let deliveryState = loadDeliveryState();
const properties = PROPERTIES.map(p => ({
  ...p,
  sigungu: normalizeSigungu(p.sigungu),
  isDelivered: deliveryState.hasOwnProperty(p.id)
    ? deliveryState[p.id]
    : p.isDelivered
}));

let currentFilter = "all";
let currentSigungu = "";
let currentDong = "";
let searchQuery = "";

// ── 지도 초기화 (Leaflet) ─────────────────────────────────────────
const map = L.map("map").setView([36.8065, 127.1105], 11);

L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
  attribution: "© OpenStreetMap contributors © CARTO",
  maxZoom: 19
}).addTo(map);

// ── 마커 아이콘 ───────────────────────────────────────────────────
function makeIcon(color) {
  const c = color === "red" ? "#EF4444" : "#22C55E";
  const stroke = color === "red" ? "#B91C1C" : "#15803D";
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='32'>
    <path d='M12 1C7.58 1 4 4.58 4 9c0 7 8 20 8 20s8-13 8-20c0-4.42-3.58-8-8-8z'
      fill='${c}' stroke='${stroke}' stroke-width='1.5'/>
    <circle cx='12' cy='9' r='3.5' fill='white'/>
  </svg>`;
  return L.divIcon({
    html: `<img src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}" width="24" height="32"/>`,
    className: "",
    iconSize: [24, 32],
    iconAnchor: [12, 32],
    popupAnchor: [0, -32]
  });
}

const ICON_RED   = makeIcon("red");
const ICON_GREEN = makeIcon("green");

// ── 클러스터 그룹 ─────────────────────────────────────────────────
const clusterGroup = L.markerClusterGroup({
  maxClusterRadius: 50,
  iconCreateFunction(cluster) {
    const markers = cluster.getAllChildMarkers();
    const done = markers.filter(m => m.options._delivered).length;
    const total = markers.length;
    const pct = total ? done / total : 0;
    const color = pct >= 0.71 ? "#22c55e" : pct >= 0.31 ? "#eab308" : "#ef4444";
    return L.divIcon({
      html: `<div style="
        width:42px;height:42px;border-radius:50%;
        background:${color};color:#fff;
        font-weight:bold;font-size:13px;
        display:flex;align-items:center;justify-content:center;
        border:2px solid rgba(255,255,255,0.6);
        box-shadow:0 2px 6px rgba(0,0,0,0.3);">${total}</div>`,
      className: "",
      iconSize: [42, 42]
    });
  }
});
map.addLayer(clusterGroup);

// ── 마커 생성 ─────────────────────────────────────────────────────
const markerMap = {};

properties.forEach(p => {
  if (!p.lat || !p.lng) return;
  const marker = L.marker([p.lat, p.lng], {
    icon: p.isDelivered ? ICON_GREEN : ICON_RED,
    _delivered: p.isDelivered,
    _id: p.id
  });
  marker.on("click", () => openPopup(p));
  markerMap[p.id] = marker;
});

// ── 필터링 & 렌더링 ───────────────────────────────────────────────
function getFiltered() {
  return properties.filter(p => {
    if (!p.lat || !p.lng) return false;
    if (currentFilter === "delivered" && !p.isDelivered) return false;
    if (currentFilter === "pending"   &&  p.isDelivered) return false;
    if (currentSigungu && !p.sigungu.includes(currentSigungu)) return false;
    if (currentDong    && p.beopjeongdong !== currentDong)     return false;
    if (searchQuery) {
      const q = searchQuery;
      if (!p.name.includes(q) && !(p.address||"").includes(q)) return false;
    }
    return true;
  });
}

function renderMarkers() {
  clusterGroup.clearLayers();
  const filtered = getFiltered();
  filtered.forEach(p => {
    const m = markerMap[p.id];
    if (m) clusterGroup.addLayer(m);
  });
}

// ── 통계 ─────────────────────────────────────────────────────────
function updateStats() {
  const total = properties.length;
  const done  = properties.filter(p => p.isDelivered).length;
  const left  = total - done;
  const pct   = total ? Math.round(done / total * 100) : 0;

  document.getElementById("stat-total").textContent = total.toLocaleString();
  document.getElementById("stat-done").textContent  = done.toLocaleString();
  document.getElementById("stat-left").textContent  = left.toLocaleString();
  document.getElementById("stat-pct").textContent   = pct;
  document.getElementById("progress-bar").style.width = pct + "%";
}

// ── 지역별 통계 패널 ──────────────────────────────────────────────
function buildRegionStats() {
  const regionMap = {};
  properties.forEach(p => {
    const sg = p.sigungu || "기타";
    const bd = p.beopjeongdong || "기타";
    if (!regionMap[sg]) regionMap[sg] = {};
    if (!regionMap[sg][bd]) regionMap[sg][bd] = { total: 0, done: 0 };
    regionMap[sg][bd].total++;
    if (p.isDelivered) regionMap[sg][bd].done++;
  });

  const container = document.getElementById("region-stats");
  container.innerHTML = "";

  Object.entries(regionMap)
    .sort((a, b) => {
      const ta = Object.values(a[1]).reduce((s, v) => s + v.total, 0);
      const tb = Object.values(b[1]).reduce((s, v) => s + v.total, 0);
      return tb - ta;
    })
    .forEach(([sg, dongs]) => {
      const totSg  = Object.values(dongs).reduce((s, v) => s + v.total, 0);
      const doneSg = Object.values(dongs).reduce((s, v) => s + v.done,  0);
      const pctSg  = totSg ? Math.round(doneSg / totSg * 100) : 0;
      const barColor = pctSg >= 71 ? "#22c55e" : pctSg >= 31 ? "#eab308" : "#ef4444";

      const item = document.createElement("div");
      item.className = "region-item";
      item.innerHTML = `
        <div class="region-name" data-sg="${sg}">
          <span>${sg}</span>
          <span class="region-nums">${doneSg}/${totSg}</span>
        </div>
        <div class="region-bar-wrap">
          <div class="region-bar" style="width:${pctSg}%;background:${barColor}"></div>
        </div>
        <div class="region-count">${pctSg}% 완료 · 미배포 ${(totSg - doneSg).toLocaleString()}개</div>
        <div class="dong-list" id="dong-${sg.replace(/\s/g, '')}">
          ${Object.entries(dongs)
            .sort((a, b) => b[1].total - a[1].total)
            .map(([bd, v]) => {
              const p2 = v.total ? Math.round(v.done / v.total * 100) : 0;
              return `<div class="dong-item" data-sg="${sg}" data-bd="${bd}">
                <span>${bd}</span>
                <span>${v.done}/${v.total} (${p2}%)</span>
              </div>`;
            }).join("")}
        </div>`;
      container.appendChild(item);

      item.querySelector(".region-name").addEventListener("click", function () {
        item.querySelector(".dong-list").classList.toggle("open");
        currentSigungu = this.dataset.sg;
        currentDong = "";
        document.getElementById("sel-sigungu").value = this.dataset.sg;
        document.getElementById("sel-dong").value = "";
        renderMarkers();
        flyToRegion(sg);
      });

      item.querySelectorAll(".dong-item").forEach(di => {
        di.addEventListener("click", () => {
          currentSigungu = di.dataset.sg;
          currentDong    = di.dataset.bd;
          renderMarkers();
          flyToDong(di.dataset.bd);
        });
      });
    });
}

// ── 지도 이동 ─────────────────────────────────────────────────────
function flyToRegion(sigungu) {
  const pts = properties.filter(p => p.lat && p.sigungu.includes(sigungu));
  if (!pts.length) return;
  const bounds = L.latLngBounds(pts.map(p => [p.lat, p.lng]));
  map.fitBounds(bounds, { padding: [30, 30] });
}
function flyToDong(dong) {
  const pts = properties.filter(p => p.lat && p.beopjeongdong === dong);
  if (!pts.length) return;
  const bounds = L.latLngBounds(pts.map(p => [p.lat, p.lng]));
  map.fitBounds(bounds, { padding: [40, 40] });
}

// ── 팝업 ─────────────────────────────────────────────────────────
let currentPopupId = null;

function openPopup(p) {
  currentPopupId = p.id;
  document.getElementById("popup-name").textContent  = p.name;
  document.getElementById("popup-addr").textContent  = "📍 " + (p.address || "-");
  document.getElementById("popup-phone").textContent = "📞 " + (p.phone || p.mobile || "-");
  document.getElementById("popup-dong").textContent  =
    "🏘️ " + p.beopjeongdong + (p.haengjeongdong ? " / " + p.haengjeongdong : "");

  const badge  = document.getElementById("popup-badge");
  const action = document.getElementById("popup-action");

  if (p.isDelivered) {
    badge.textContent  = "🟢 배포완료";
    badge.className    = "badge delivered";
    action.textContent = "↩ 배포 취소";
    action.className   = "cancel";
  } else {
    badge.textContent  = "🔴 미배포";
    badge.className    = "badge pending";
    action.textContent = "✓ 배포 완료 처리";
    action.className   = "deliver";
  }

  document.getElementById("popup").classList.remove("hidden");
  document.getElementById("overlay").classList.add("show");
}

function closePopup() {
  document.getElementById("popup").classList.add("hidden");
  document.getElementById("overlay").classList.remove("show");
  currentPopupId = null;
}

document.getElementById("popup-close").addEventListener("click", closePopup);
document.getElementById("overlay").addEventListener("click", closePopup);

document.getElementById("popup-action").addEventListener("click", () => {
  if (currentPopupId === null) return;
  const p = properties.find(x => x.id === currentPopupId);
  if (!p) return;

  p.isDelivered = !p.isDelivered;
  p.deliveredAt = p.isDelivered ? new Date().toISOString() : null;

  deliveryState[p.id] = p.isDelivered;
  saveDeliveryState(deliveryState);

  const m = markerMap[p.id];
  if (m) {
    m.setIcon(p.isDelivered ? ICON_GREEN : ICON_RED);
    m.options._delivered = p.isDelivered;
  }

  updateStats();
  buildRegionStats();
  renderMarkers();
  closePopup();
});

// ── 필터 버튼 ─────────────────────────────────────────────────────
document.querySelectorAll(".filter-btn").forEach(btn => {
  btn.addEventListener("click", function () {
    document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
    this.classList.add("active");
    currentFilter = this.dataset.filter;
    renderMarkers();
  });
});

// ── 지역 드롭다운 ─────────────────────────────────────────────────
const selSigungu = document.getElementById("sel-sigungu");
const selDong    = document.getElementById("sel-dong");

const sgs = [...new Set(properties.map(p => p.sigungu).filter(Boolean))].sort();
sgs.forEach(sg => {
  const opt = document.createElement("option");
  opt.value = sg; opt.textContent = sg;
  selSigungu.appendChild(opt);
});

selSigungu.addEventListener("change", () => {
  currentSigungu = selSigungu.value;
  currentDong = "";
  selDong.innerHTML = '<option value="">-- 법정동 전체 --</option>';
  if (currentSigungu) {
    const dongs = [...new Set(
      properties
        .filter(p => p.sigungu.includes(currentSigungu))
        .map(p => p.beopjeongdong)
        .filter(Boolean)
    )].sort();
    dongs.forEach(d => {
      const opt = document.createElement("option");
      opt.value = d; opt.textContent = d;
      selDong.appendChild(opt);
    });
    flyToRegion(currentSigungu);
  }
  renderMarkers();
});

selDong.addEventListener("change", () => {
  currentDong = selDong.value;
  renderMarkers();
  if (currentDong) flyToDong(currentDong);
});

// ── 검색 ─────────────────────────────────────────────────────────
document.getElementById("search-box").addEventListener("input", function () {
  searchQuery = this.value.trim();
  renderMarkers();
});

// ── 뷰 탭 전환 ───────────────────────────────────────────────────
let currentView = "map";

document.querySelectorAll(".view-tab").forEach(tab => {
  tab.addEventListener("click", function () {
    document.querySelectorAll(".view-tab").forEach(t => t.classList.remove("active"));
    this.classList.add("active");
    currentView = this.dataset.view;

    if (currentView === "map") {
      document.getElementById("map-view").classList.remove("hidden");
      document.getElementById("list-view").classList.add("hidden");
      map.invalidateSize();
    } else {
      document.getElementById("map-view").classList.add("hidden");
      document.getElementById("list-view").classList.remove("hidden");
      renderList();
    }
  });
});

// ── 리스트 렌더링 ─────────────────────────────────────────────────
function renderList() {
  const filtered = getFiltered();
  const tbody = document.getElementById("list-tbody");
  document.getElementById("list-count").textContent =
    `총 ${filtered.length.toLocaleString()}개`;

  tbody.innerHTML = "";
  filtered.forEach((p, idx) => {
    const tr = document.createElement("tr");
    tr.className = p.isDelivered ? "row-done" : "";
    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td class="td-name">${p.name || "-"}</td>
      <td>${p.sigungu || "-"}</td>
      <td>${p.beopjeongdong || "-"}</td>
      <td class="td-addr">${p.address || "-"}</td>
      <td>${p.phone || p.mobile || "-"}</td>
      <td><span class="badge ${p.isDelivered ? "delivered" : "pending"}">
        ${p.isDelivered ? "🟢 완료" : "🔴 미배포"}
      </span></td>
      <td>
        <button class="btn-toggle" data-id="${p.id}">
          ${p.isDelivered ? "취소" : "완료"}
        </button>
      </td>`;
    tbody.appendChild(tr);
  });

  // 행 내 완료/취소 버튼
  tbody.querySelectorAll(".btn-toggle").forEach(btn => {
    btn.addEventListener("click", () => {
      const p = properties.find(x => x.id == btn.dataset.id);
      if (!p) return;
      p.isDelivered = !p.isDelivered;
      p.deliveredAt = p.isDelivered ? new Date().toISOString() : null;
      deliveryState[p.id] = p.isDelivered;
      saveDeliveryState(deliveryState);
      const m = markerMap[p.id];
      if (m) { m.setIcon(p.isDelivered ? ICON_GREEN : ICON_RED); m.options._delivered = p.isDelivered; }
      updateStats();
      buildRegionStats();
      renderList();
    });
  });
}

// ── Excel 다운로드 ────────────────────────────────────────────────
document.getElementById("btn-export").addEventListener("click", () => {
  const filtered = getFiltered();
  const rows = filtered.map(p => ({
    "업소명": p.name || "",
    "시군구": p.sigungu || "",
    "법정동": p.beopjeongdong || "",
    "행정동": p.haengjeongdong || "",
    "주소": p.address || "",
    "전화번호": p.phone || "",
    "핸드폰": p.mobile || "",
    "배포상태": p.isDelivered ? "완료" : "미배포",
    "완료일시": p.deliveredAt ? p.deliveredAt.slice(0, 10) : ""
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "배포현황");
  XLSX.writeFile(wb, `배포현황_${new Date().toISOString().slice(0,10)}.xlsx`);
});

// ── 지역별 현황 패널 토글 ─────────────────────────────────────────
document.getElementById("panel-toggle").addEventListener("click", () => {
  document.getElementById("stats-panel").classList.add("closed");
  document.getElementById("panel-open-btn").classList.add("show");
  map.invalidateSize();
});
document.getElementById("panel-open-btn").addEventListener("click", () => {
  document.getElementById("stats-panel").classList.remove("closed");
  document.getElementById("panel-open-btn").classList.remove("show");
  map.invalidateSize();
});

// ── 초기 실행 ─────────────────────────────────────────────────────
updateStats();
buildRegionStats();
renderMarkers();
