// ── Supabase 초기화 ───────────────────────────────────────────────
const { createClient } = supabase;
const sb = createClient(
  'https://kyhyaphsyykqxtbxqqfa.supabase.co',
  'sb_publishable_0gaX2d8Tc5CjYu3Fp0BNrg_qZPV0tbP'
);

// ── 시군구명 정규화 ───────────────────────────────────────────────
function normalizeSigungu(sg) {
  if (!sg) return "";
  sg = sg.trim().replace("충청남도 ", "");
  if (sg === "천안시") return "천안시동남구";
  if (sg.startsWith("아산시")) return "아산시";
  return sg;
}

let properties = [];
let currentFilter = "all";
let currentSigungu = "";
let currentDong = "";
let searchQuery = "";
let currentView = "map";

// ── 지도 초기화 (Leaflet) ─────────────────────────────────────────
const map = L.map("map").setView([36.8065, 127.1105], 11);
L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
  attribution: "© OpenStreetMap contributors © CARTO",
  maxZoom: 19
}).addTo(map);

// ── 마커 아이콘 ───────────────────────────────────────────────────
function makeIcon(color) {
  const colors = {
    red:   { fill: "#EF4444", stroke: "#B91C1C" },
    green: { fill: "#22C55E", stroke: "#15803D" },
    black: { fill: "#1e293b", stroke: "#000000" }
  };
  const { fill, stroke } = colors[color];
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='32'>
    <path d='M12 1C7.58 1 4 4.58 4 9c0 7 8 20 8 20s8-13 8-20c0-4.42-3.58-8-8-8z'
      fill='${fill}' stroke='${stroke}' stroke-width='1.5'/>
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
const ICON_BLACK = makeIcon("black");

function getIcon(status) {
  if (status === "delivered") return ICON_GREEN;
  if (status === "closed")    return ICON_BLACK;
  return ICON_RED;
}

// ── 클러스터 그룹 ─────────────────────────────────────────────────
const clusterGroup = L.markerClusterGroup({
  maxClusterRadius: 50,
  iconCreateFunction(cluster) {
    const markers = cluster.getAllChildMarkers();
    const done  = markers.filter(m => m.options._status === "delivered").length;
    const total = markers.length;
    const pct   = total ? done / total : 0;
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

const markerMap = {};

// ── Supabase 상태 저장 ────────────────────────────────────────────
async function saveStatus(propertyId, status, deliveredAt) {
  await sb.from('delivery_status').upsert({
    property_id: propertyId,
    status: status,
    delivered_at: deliveredAt || null
  }, { onConflict: 'property_id' });
}

// ── 필터링 ────────────────────────────────────────────────────────
function getFiltered() {
  return properties.filter(p => {
    if (!p.lat || !p.lng) return false;
    if (currentFilter !== "all" && p.status !== currentFilter) return false;
    if (currentSigungu && !p.sigungu.includes(currentSigungu)) return false;
    if (currentDong    && p.beopjeongdong !== currentDong)     return false;
    if (searchQuery) {
      const q = searchQuery;
      if (!(p.name||"").includes(q) && !(p.address||"").includes(q)) return false;
    }
    return true;
  });
}

function renderMarkers() {
  clusterGroup.clearLayers();
  getFiltered().forEach(p => {
    const m = markerMap[p.id];
    if (m) clusterGroup.addLayer(m);
  });
}

// ── 통계 ─────────────────────────────────────────────────────────
function updateStats() {
  const total  = properties.length;
  const done   = properties.filter(p => p.status === "delivered").length;
  const closed = properties.filter(p => p.status === "closed").length;
  const left   = total - done - closed;
  const pct    = total ? Math.round(done / total * 100) : 0;

  document.getElementById("stat-total").textContent   = total.toLocaleString();
  document.getElementById("stat-done").textContent    = done.toLocaleString();
  document.getElementById("stat-left").textContent    = left.toLocaleString();
  document.getElementById("stat-pct").textContent     = pct;
  document.getElementById("progress-bar").style.width = pct + "%";
  const el = document.getElementById("stat-closed");
  if (el) el.textContent = closed.toLocaleString();
}

// ── 지역별 통계 패널 ──────────────────────────────────────────────
function buildRegionStats() {
  const regionMap = {};
  properties.forEach(p => {
    const sg = p.sigungu || "기타";
    const bd = p.beopjeongdong || "기타";
    if (!regionMap[sg]) regionMap[sg] = {};
    if (!regionMap[sg][bd]) regionMap[sg][bd] = { total: 0, done: 0, closed: 0 };
    regionMap[sg][bd].total++;
    if (p.status === "delivered") regionMap[sg][bd].done++;
    if (p.status === "closed")   regionMap[sg][bd].closed++;
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
      const totSg    = Object.values(dongs).reduce((s, v) => s + v.total,  0);
      const doneSg   = Object.values(dongs).reduce((s, v) => s + v.done,   0);
      const closedSg = Object.values(dongs).reduce((s, v) => s + v.closed, 0);
      const pctSg    = totSg ? Math.round(doneSg / totSg * 100) : 0;
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
        <div class="region-count">${pctSg}% 완료 · 미배포 ${(totSg - doneSg - closedSg).toLocaleString()}개 · 폐업 ${closedSg}개</div>
        <div class="dong-list" id="dong-${sg.replace(/\s/g, '')}">
          ${Object.entries(dongs)
            .sort((a, b) => b[1].total - a[1].total)
            .map(([bd, v]) => `<div class="dong-item" data-sg="${sg}" data-bd="${bd}">
              <span>${bd}</span>
              <span>완료${v.done} 폐업${v.closed} / ${v.total}</span>
            </div>`).join("")}
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
  map.fitBounds(L.latLngBounds(pts.map(p => [p.lat, p.lng])), { padding: [30, 30] });
}
function flyToDong(dong) {
  const pts = properties.filter(p => p.lat && p.beopjeongdong === dong);
  if (!pts.length) return;
  map.fitBounds(L.latLngBounds(pts.map(p => [p.lat, p.lng])), { padding: [40, 40] });
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

  let closedBtn = document.getElementById("popup-closed-btn");
  if (!closedBtn) {
    closedBtn = document.createElement("button");
    closedBtn.id = "popup-closed-btn";
    action.parentNode.insertBefore(closedBtn, action.nextSibling);
  }

  if (p.status === "delivered") {
    badge.textContent  = "🟢 배포완료";
    badge.className    = "badge delivered";
    action.textContent = "↩ 배포 취소";
    action.className   = "cancel";
    closedBtn.textContent   = "⚫ 폐업 처리";
    closedBtn.className     = "closed-btn";
    closedBtn.style.display = "";
  } else if (p.status === "closed") {
    badge.textContent  = "⚫ 폐업";
    badge.className    = "badge closed";
    action.textContent = "↩ 폐업 취소";
    action.className   = "cancel";
    closedBtn.style.display = "none";
  } else {
    badge.textContent  = "🔴 미배포";
    badge.className    = "badge pending";
    action.textContent = "✓ 배포 완료 처리";
    action.className   = "deliver";
    closedBtn.textContent   = "⚫ 폐업 처리";
    closedBtn.className     = "closed-btn";
    closedBtn.style.display = "";
  }

  closedBtn.onclick = async () => {
    const pp = properties.find(x => x.id === currentPopupId);
    if (!pp) return;
    pp.status = pp.status === "closed" ? "pending" : "closed";
    if (pp.status === "closed") pp.deliveredAt = null;
    await saveStatus(pp.id, pp.status, pp.deliveredAt);
    const m = markerMap[pp.id];
    if (m) { m.setIcon(getIcon(pp.status)); m.options._status = pp.status; }
    updateStats(); buildRegionStats(); renderMarkers();
    closePopup();
  };

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

document.getElementById("popup-action").addEventListener("click", async () => {
  if (currentPopupId === null) return;
  const p = properties.find(x => x.id === currentPopupId);
  if (!p) return;

  if (p.status === "delivered") {
    p.status = "pending";
    p.deliveredAt = null;
  } else if (p.status === "closed") {
    p.status = "pending";
  } else {
    p.status = "delivered";
    p.deliveredAt = new Date().toISOString();
  }

  await saveStatus(p.id, p.status, p.deliveredAt);
  const m = markerMap[p.id];
  if (m) { m.setIcon(getIcon(p.status)); m.options._status = p.status; }
  updateStats(); buildRegionStats(); renderMarkers();
  closePopup();
});

// ── 현재 뷰에 맞게 렌더링 ────────────────────────────────────────
function renderCurrent() {
  renderMarkers();
  if (currentView === "list") renderList();
}

// ── 필터 버튼 ─────────────────────────────────────────────────────
document.querySelectorAll(".filter-btn").forEach(btn => {
  btn.addEventListener("click", function () {
    document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
    this.classList.add("active");
    currentFilter = this.dataset.filter;
    renderCurrent();
  });
});

// ── 지역 드롭다운 ─────────────────────────────────────────────────
const selSigungu = document.getElementById("sel-sigungu");
const selDong    = document.getElementById("sel-dong");

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
  renderCurrent();
});

selDong.addEventListener("change", () => {
  currentDong = selDong.value;
  renderCurrent();
  if (currentDong) flyToDong(currentDong);
});

// ── 검색 ─────────────────────────────────────────────────────────
document.getElementById("search-box").addEventListener("input", function () {
  searchQuery = this.value.trim();
  renderCurrent();
});

// ── 뷰 탭 전환 ───────────────────────────────────────────────────
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
  document.getElementById("list-count").textContent = `총 ${filtered.length.toLocaleString()}개`;

  tbody.innerHTML = "";
  filtered.forEach((p, idx) => {
    const tr = document.createElement("tr");
    tr.className = p.status === "delivered" ? "row-done" : p.status === "closed" ? "row-closed" : "";
    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td class="td-name">${p.name || "-"}</td>
      <td>${p.sigungu || "-"}</td>
      <td>${p.beopjeongdong || "-"}</td>
      <td class="td-addr">${p.address || "-"}</td>
      <td>${p.phone || p.mobile || "-"}</td>
      <td><span class="badge ${p.status}">
        ${{delivered:"🟢 완료", closed:"⚫ 폐업", pending:"🔴 미배포"}[p.status]}
      </span></td>
      <td style="display:flex;gap:4px;">
        <button class="btn-toggle" data-id="${p.id}" ${p.status === "closed" ? "disabled style='opacity:0.3;cursor:not-allowed;'" : ""}>
          ${p.status === "delivered" ? "배포취소" : "완료"}
        </button>
        <button class="btn-close-toggle" data-id="${p.id}" style="background:#e2e8f0;color:#475569;">
          ${p.status === "closed" ? "폐업취소" : "폐업"}
        </button>
      </td>`;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll(".btn-toggle").forEach(btn => {
    btn.addEventListener("click", async () => {
      const p = properties.find(x => x.id == btn.dataset.id);
      if (!p) return;
      if (p.status === "delivered") {
        p.status = "pending";
        p.deliveredAt = null;
      } else {
        p.status = "delivered";
        p.deliveredAt = new Date().toISOString();
      }
      await saveStatus(p.id, p.status, p.deliveredAt);
      const m = markerMap[p.id];
      if (m) { m.setIcon(getIcon(p.status)); m.options._status = p.status; }
      updateStats(); buildRegionStats(); renderList();
    });
  });

  tbody.querySelectorAll(".btn-close-toggle").forEach(btn => {
    btn.addEventListener("click", async () => {
      const p = properties.find(x => x.id == btn.dataset.id);
      if (!p) return;
      p.status = p.status === "closed" ? "pending" : "closed";
      await saveStatus(p.id, p.status, p.deliveredAt);
      const m = markerMap[p.id];
      if (m) { m.setIcon(getIcon(p.status)); m.options._status = p.status; }
      updateStats(); buildRegionStats(); renderList();
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
    "배포상태": p.status === "delivered" ? "완료" : p.status === "closed" ? "폐업" : "미배포",
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

// ── 실시간 구독 (다른 기기 변경사항 자동 반영) ────────────────────
function subscribeRealtime() {
  sb.channel('delivery_status_changes')
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'delivery_status'
    }, payload => {
      const row = payload.new;
      if (!row) return;
      const p = properties.find(x => x.id === row.property_id);
      if (!p) return;
      p.status     = row.status || "pending";
      p.deliveredAt = row.delivered_at || null;
      const m = markerMap[p.id];
      if (m) { m.setIcon(getIcon(p.status)); m.options._status = p.status; }
      updateStats(); buildRegionStats(); renderCurrent();
    })
    .subscribe();
}

// ── 초기화 ────────────────────────────────────────────────────────
async function init() {
  // Supabase에서 배포 상태 로드
  const { data } = await sb.from('delivery_status').select('*');
  const stateMap = {};
  if (data) {
    data.forEach(row => {
      stateMap[row.property_id] = { status: row.status, deliveredAt: row.delivered_at };
    });
  }

  // properties 초기화
  PROPERTIES.forEach(p => {
    const saved = stateMap[p.id];
    const status      = saved ? saved.status      : (p.isDelivered ? "delivered" : "pending");
    const deliveredAt = saved ? saved.deliveredAt : null;
    properties.push({ ...p, sigungu: normalizeSigungu(p.sigungu), status, deliveredAt });
  });

  // 마커 생성
  properties.forEach(p => {
    if (!p.lat || !p.lng) return;
    const marker = L.marker([p.lat, p.lng], {
      icon: getIcon(p.status),
      _status: p.status,
      _id: p.id
    });
    marker.on("click", () => openPopup(p));
    markerMap[p.id] = marker;
  });

  // 시군구 드롭다운 초기화
  const sgs = [...new Set(properties.map(p => p.sigungu).filter(Boolean))].sort();
  sgs.forEach(sg => {
    const opt = document.createElement("option");
    opt.value = sg; opt.textContent = sg;
    selSigungu.appendChild(opt);
  });

  // 렌더링
  updateStats();
  buildRegionStats();
  renderMarkers();

  // 실시간 구독
  subscribeRealtime();
}

init();
