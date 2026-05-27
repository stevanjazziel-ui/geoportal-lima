const LIMA_BOUNDS = [
  [-13.35, -77.95],
  [-10.55, -75.45],
];

const REMOTE_LAYERS = {
  climate: {
    title: "SENAMHI · Clasificacion climatica 1981-2010",
    url: "https://idesep.senamhi.gob.pe:443/geoserver/g_05_01/wms?",
    layers: "g_05_01:05_01_001_03_001_512_2021_00_00",
    options: { format: "image/png", transparent: true, opacity: 0.42 },
  },
  construction: {
    title: "ICL · Proyectos de construccion",
    url: "https://ide.icl.gob.pe:8443/geoserver/IDEP/idep_tg_construccion/wms",
    layers: "IDEP:idep_tg_construccion",
    options: { format: "image/png", transparent: true, opacity: 0.74 },
  },
  blocks: {
    title: "ICL · Manzanas catastrales",
    url: "https://ide.icl.gob.pe:8443/geoserver/IDEP/idep_tg_manzana/wms",
    layers: "IDEP:idep_tg_manzana",
    options: { format: "image/png", transparent: true, opacity: 0.45 },
  },
  parks: {
    title: "ICL · Areas verdes",
    url: "https://ide.icl.gob.pe:8443/geoserver/IDEP/idep_tg_parques/wms",
    layers: "IDEP:idep_tg_parques",
    options: { format: "image/png", transparent: true, opacity: 0.68 },
  },
};

const SOURCES = [
  {
    label: "SENAMHI · Catalogo IDESEP",
    url: "https://idesep.senamhi.gob.pe/portalidesep/wms.do",
  },
  {
    label: "GeoIDEP · Catalogo del Instituto Catastral de Lima",
    url: "https://www.geoidep.gob.pe/catalogo-nacional-de-servicios-web?id_institucion=268&search_token=oweq8Q37yv5EdudwlRyms46dQWlEyHD5OPYy3U2nQJw",
  },
  {
    label: "IGN · Limite departamental oficial de Lima",
    url: "https://www.idep.gob.pe/geoportal/rest/services/DATOS_GEOESPACIALES/L%C3%8DMITES/FeatureServer/3/query?where=NOMBDEP%3D%27LIMA%27&outFields=*&returnGeometry=true&f=geojson",
  },
  {
    label: "Esri World Imagery · base satelital usada para el indice local",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer",
  },
];

const HAZARD_ORDER = {
  "Muy Alto": 4,
  Alto: 3,
  Medio: 2,
  Bajo: 1,
  "Sin dato": 0,
};

const state = {
  data: null,
  map: null,
  boundaryLayer: null,
  cellLayer: null,
  stationLayer: null,
  rankingPinsLayer: null,
  mountainLayer: null,
  remoteLayers: new Map(),
  cellById: new Map(),
  stationById: new Map(),
  sortedByPriority: [],
  activeDrawer: null,
};

const dom = {};
const FOCUS_OVERLAY_STORAGE_KEY = "geoportal-focus-overlay-visible";

document.addEventListener("DOMContentLoaded", () => {
  cacheDom();
  wirePanelDrawers();
  wireFocusOverlay();
  initMap();
  wireToggles();
  loadPreparedData();
  window.addEventListener("resize", scheduleMapResize);
});

function cacheDom() {
  dom.panelLeft = document.querySelector(".panel-left");
  dom.panelRight = document.querySelector(".panel-right");
  dom.panelBackdrop = document.getElementById("panel-backdrop");
  dom.openLeftPanel = document.getElementById("open-left-panel");
  dom.openRightPanel = document.getElementById("open-right-panel");
  dom.closeLeftPanel = document.getElementById("close-left-panel");
  dom.closeRightPanel = document.getElementById("close-right-panel");
  dom.metricPoints = document.getElementById("metric-points");
  dom.metricRisk = document.getElementById("metric-risk");
  dom.metricPeak = document.getElementById("metric-peak");
  dom.metricConstruction = document.getElementById("metric-construction");
  dom.heroCellCount = document.getElementById("hero-cell-count");
  dom.heroPeakHeat = document.getElementById("hero-peak-heat");
  dom.heroTopSector = document.getElementById("hero-top-sector");
  dom.heroTopStation = document.getElementById("hero-top-station");
  dom.heroSummaryNote = document.getElementById("hero-summary-note");
  dom.rankingList = document.getElementById("ranking-list");
  dom.status = document.getElementById("app-status");
  dom.iclStatus = document.getElementById("icl-status");
  dom.sourceList = document.getElementById("source-list");
  dom.focusTitle = document.getElementById("focus-title");
  dom.focusDescription = document.getElementById("focus-description");
  dom.focusOverlay = document.getElementById("focus-overlay");
  dom.showFocusOverlay = document.getElementById("show-focus-overlay");
  dom.hideFocusOverlay = document.getElementById("hide-focus-overlay");
}

function wirePanelDrawers() {
  if (!dom.panelLeft || !dom.panelRight || !dom.openLeftPanel || !dom.openRightPanel) return;

  setActiveDrawer(null);

  dom.openLeftPanel.addEventListener("click", () => toggleDrawer("left"));
  dom.openRightPanel.addEventListener("click", () => toggleDrawer("right"));
  dom.closeLeftPanel?.addEventListener("click", () => setActiveDrawer(null));
  dom.closeRightPanel?.addEventListener("click", () => setActiveDrawer(null));

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      setActiveDrawer(null);
    }
  });
}

function wireFocusOverlay() {
  if (!dom.focusOverlay || !dom.showFocusOverlay || !dom.hideFocusOverlay) return;

  const storedPreference = readFocusOverlayPreference();
  setFocusOverlayVisible(storedPreference === null ? false : storedPreference);

  dom.showFocusOverlay.addEventListener("click", () => setFocusOverlayVisible(true));
  dom.hideFocusOverlay.addEventListener("click", () => setFocusOverlayVisible(false));
}

function initMap() {
  const imageryBase = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      attribution:
        "Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community",
      maxZoom: 19,
    }
  );

  const lightBase = L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; CARTO',
      subdomains: "abcd",
      maxZoom: 19,
    }
  );

  state.map = L.map("map", {
    center: [-11.97, -76.98],
    zoom: 8,
    layers: [imageryBase],
    zoomControl: true,
  });

  L.control
    .layers(
      {
        "Imagen satelital": imageryBase,
        "Base clara": lightBase,
      },
      {},
      { position: "topright", collapsed: false }
    )
    .addTo(state.map);

  state.map.fitBounds(LIMA_BOUNDS, { padding: [18, 18] });
  scheduleMapResize();
}

function wireToggles() {
  bindToggle("toggle-heatwave", (checked) => toggleLeafletLayer(state.stationLayer, checked));
  bindToggle("toggle-hazard", (checked) => toggleLeafletLayer(state.cellLayer, checked));
  bindToggle("toggle-climate", (checked) => toggleRemoteLayer("climate", checked));
  bindToggle("toggle-construction", (checked) => toggleRemoteLayer("construction", checked));
  bindToggle("toggle-blocks", (checked) => toggleRemoteLayer("blocks", checked));
  bindToggle("toggle-parks", (checked) => toggleRemoteLayer("parks", checked));
  bindToggle("toggle-mountains", (checked) => {
    if (!state.mountainLayer) {
      drawMountainCells();
    }
    toggleLeafletLayer(state.mountainLayer, checked);
  });
}

function bindToggle(id, handler) {
  const input = document.getElementById(id);
  if (!input) return;
  input.addEventListener("change", (event) => {
    Promise.resolve(handler(event.target.checked)).catch((error) => {
      console.error(error);
      setStatus("Una capa externa no respondio, pero el analisis regional sigue visible.", "warn");
    });
  });
}

function loadPreparedData() {
  const prepared = window.GEOPORTAL_LIMA_DATA;
  if (!prepared || !Array.isArray(prepared.cells) || !Array.isArray(prepared.stations)) {
    setStatus("No se encontro el dataset regional preparado. Ejecuta el generador de analisis.", "error");
    return;
  }

  state.data = prepared;
  state.sortedByPriority = [...prepared.cells].sort(
    (a, b) => b.priorityScore - a.priorityScore || b.constructionIndex - a.constructionIndex
  );

  drawRegionBoundary();
  drawRegionalCells();
  drawHeatStations();
  drawRankingPins();
  renderSources();
  updateMetrics();
  updateHeroSummary();
  renderRanking();
  updateFocusCard();
  scheduleMapResize();
  setStatus(
    `Resultados listos. Se analizaron ${prepared.cells.length} celdas sobre toda la region Lima y ${prepared.stations.length} estaciones base de SENAMHI.`,
    "ok"
  );

  dom.iclStatus.textContent =
    "Las capas del ICL quedan como apoyo. El indice principal ya fue calculado localmente para toda la region Lima con malla satelital.";
}

function drawRegionBoundary() {
  const boundary = state.data.region?.boundary;
  if (!boundary) return;

  state.boundaryLayer = L.geoJSON(boundary, {
    style() {
      return {
        color: "#f6f0e2",
        weight: 2.4,
        opacity: 0.95,
        fillOpacity: 0,
        dashArray: "8 6",
      };
    },
  }).addTo(state.map);

  state.map.fitBounds(state.boundaryLayer.getBounds(), { padding: [22, 22] });
}

function drawRegionalCells() {
  const featureCollection = {
    type: "FeatureCollection",
    features: state.data.cells.map((cell) => ({
      type: "Feature",
      properties: cell,
      geometry: cell.geometry,
    })),
  };

  state.cellById.clear();
  state.cellLayer = L.geoJSON(featureCollection, {
    style(feature) {
      const cell = feature.properties;
      return {
        color: getHazardColor(cell.hazardLevel),
        weight: 0.9 + cell.priorityScore * 1.2,
        opacity: 0.82,
        fillColor: getConstructionColor(cell.constructionIndex),
        fillOpacity: 0.18 + cell.priorityScore * 0.22,
      };
    },
    onEachFeature(feature, layerRef) {
      const cell = feature.properties;
      layerRef.bindPopup(buildCellPopupHtml(cell));
      state.cellById.set(cell.id, layerRef);
    },
  });

  state.cellLayer.addTo(state.map);
}

function drawHeatStations() {
  state.stationById.clear();
  state.stationLayer = L.layerGroup();

  state.data.stations.forEach((station) => {
    const latLng = [station.lat, station.lon];
    const frequencyColor = getFrequencyColor(station.frequency);
    const frequencyBand = getFrequencyBand(station.frequency);
    const popupHtml = buildStationPopupHtml(station);

    const buffer = L.circle(latLng, {
      radius: getStationBufferRadiusMeters(station.frequency),
      color: frequencyColor,
      weight: 1.2 + station.frequency * 0.9,
      opacity: 0.2 + station.frequency * 0.12,
      fillColor: frequencyColor,
      fillOpacity: 0.05 + station.frequency * 0.04,
      dashArray: getStationDashArray(station.frequency),
      className: `station-buffer station-${frequencyBand}`,
    });

    const halo = L.circleMarker(latLng, {
      radius: 10 + station.frequency * 8,
      color: frequencyColor,
      weight: 1.4,
      opacity: 0.55,
      fillColor: frequencyColor,
      fillOpacity: 0.08,
      className: `station-halo station-${frequencyBand}`,
    });

    const marker = L.circleMarker(latLng, {
      radius: 4.6 + station.frequency * 4.4,
      color: "#fff8ee",
      weight: 1.8,
      fillColor: frequencyColor,
      fillOpacity: 0.96,
      className: `station-core station-${frequencyBand}`,
    });

    const nucleus = L.circleMarker(latLng, {
      radius: 1.8 + station.frequency * 1.2,
      color: "#163132",
      weight: 0,
      fillColor: "#fffaf2",
      fillOpacity: 0.92,
      interactive: false,
      className: `station-nucleus station-${frequencyBand}`,
    });

    [buffer, halo, marker, nucleus].forEach((layer) => {
      layer.bindPopup?.(popupHtml);
      state.stationLayer.addLayer(layer);
    });

    state.stationById.set(station.id, marker);
  });

  state.stationLayer.addTo(state.map);
}

function drawRankingPins() {
  state.rankingPinsLayer = L.layerGroup();

  state.sortedByPriority.slice(0, 8).forEach((cell, index) => {
    const marker = L.marker([cell.lat, cell.lon], {
      icon: L.divIcon({
        className: "rank-pin-wrapper",
        html: `<span class="rank-pin rank-${Math.min(index + 1, 5)}">${index + 1}</span>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15],
      }),
    });
    marker.bindPopup(buildCellPopupHtml(cell));
    state.rankingPinsLayer.addLayer(marker);
  });

  state.rankingPinsLayer.addTo(state.map);
}

function drawMountainCells() {
  const featureCollection = {
    type: "FeatureCollection",
    features: state.data.cells
      .filter((cell) => cell.mountainZone || (cell.mountainContext && cell.mountainContext.length))
      .map((cell) => ({
        type: "Feature",
        properties: cell,
        geometry: cell.geometry,
      })),
  };

  state.mountainLayer = L.geoJSON(featureCollection, {
    style() {
      return {
        color: "#4d402d",
        weight: 1.1,
        opacity: 0.84,
        fillColor: "#8c7551",
        fillOpacity: 0.28,
      };
    },
    onEachFeature(feature, layerRef) {
      const cell = feature.properties;
      layerRef.bindPopup(buildCellPopupHtml(cell));
    },
  });
}

function toggleRemoteLayer(key, visible) {
  if (!state.remoteLayers.has(key)) {
    const config = REMOTE_LAYERS[key];
    const layer = L.tileLayer.wms(config.url, {
      layers: config.layers,
      transparent: true,
      version: "1.1.1",
      ...config.options,
      attribution: config.title,
    });
    state.remoteLayers.set(key, layer);
  }

  toggleLeafletLayer(state.remoteLayers.get(key), visible);
}

function toggleLeafletLayer(layer, visible) {
  if (!layer) return;
  if (visible) {
    layer.addTo(state.map);
  } else {
    state.map.removeLayer(layer);
  }
  scheduleMapResize();
}

function updateMetrics() {
  const cells = state.data.cells;
  const mediumPlus = cells.filter((cell) => HAZARD_ORDER[cell.hazardLevel] >= HAZARD_ORDER.Medio).length;
  const peakFrequency = cells.reduce((max, cell) => Math.max(max, cell.frequency), 0);
  const avgConstruction =
    cells.reduce((sum, cell) => sum + Number(cell.constructionIndex || 0), 0) / cells.length;

  dom.metricPoints.textContent = String(cells.length);
  dom.metricRisk.textContent = String(mediumPlus);
  dom.metricPeak.textContent = peakFrequency.toFixed(2);
  dom.metricConstruction.textContent = avgConstruction.toFixed(2);
}

function updateHeroSummary() {
  if (!dom.heroCellCount || !state.data?.cells?.length) return;

  const topPriority = state.sortedByPriority[0];
  const hottestCell = [...state.data.cells].sort(
    (a, b) => b.frequency - a.frequency || b.priorityScore - a.priorityScore
  )[0];
  const peakStation =
    state.data.stations.reduce(
      (best, station) => (station.frequency > best.frequency ? station : best),
      state.data.stations[0]
    ) || null;

  dom.heroCellCount.textContent = String(state.data.cells.length);
  dom.heroPeakHeat.textContent = hottestCell.frequency.toFixed(2);
  dom.heroTopSector.textContent = compactLabel(topPriority.name, 26);
  dom.heroTopStation.textContent = compactLabel(topPriority.nearestStation || peakStation?.name || "--", 24);
  dom.heroSummaryNote.textContent =
    `${compactLabel(topPriority.name, 42)} lidera la prioridad regional (${topPriority.priorityScore.toFixed(2)}), ` +
    `con vulnerabilidad ${String(topPriority.hazardLevel).toLowerCase()} y pico termico de ${hottestCell.frequency.toFixed(
      2
    )}.`;
}

function renderRanking() {
  dom.rankingList.innerHTML = "";

  state.sortedByPriority.slice(0, 14).forEach((cell, index) => {
    const item = document.createElement("article");
    item.className = "ranking-item";
    item.innerHTML = `
      <div class="ranking-topline">
        <strong>${index + 1}. ${escapeHtml(cell.name)}</strong>
        <span class="ranking-score">prioridad ${cell.priorityScore.toFixed(2)}</span>
      </div>
      <div class="ranking-meta">
        <span class="ranking-chip">Construccion ${cell.constructionIndex.toFixed(2)}</span>
        <span class="ranking-chip">Calor ${cell.frequency.toFixed(2)}</span>
        <span class="ranking-chip">Riesgo ${escapeHtml(cell.hazardLevel)}</span>
      </div>
      <p class="ranking-text">
        Cerca de ${escapeHtml(cell.nearestStation)} · ${escapeHtml(cell.climateDescription)} · ${
          cell.mountainZone ? "celda serrana o de loma." : "celda no serrana."
        }
      </p>
    `;

    item.addEventListener("click", () => focusCell(cell.id));
    dom.rankingList.appendChild(item);
  });
}

function updateFocusCard() {
  const topPriority = state.sortedByPriority[0];
  const topConstruction = [...state.data.cells].sort((a, b) => b.constructionIndex - a.constructionIndex)[0];

  dom.focusTitle.textContent = `${topPriority.name} lidera el cruce calor + vulnerabilidad`;
  dom.focusDescription.textContent =
    `${topPriority.name} alcanza prioridad ${topPriority.priorityScore.toFixed(2)} y se apoya en la estacion ${topPriority.nearestStation}. ` +
    `${topConstruction.name} muestra el mayor indice constructivo regional (${topConstruction.constructionIndex.toFixed(
      2
    )}).`;
}

function renderSources() {
  const generatedAt = state.data.generatedAt
    ? new Date(state.data.generatedAt).toLocaleString("es-PE", { timeZone: "America/Lima" })
    : "Sin fecha";

  const methodEntry = {
    label: `Archivo regional generado: ${generatedAt}`,
    url: state.data.region?.sourceUrl || SOURCES[2].url,
  };

  dom.sourceList.innerHTML = [...SOURCES, methodEntry]
    .map(
      (source) =>
        `<li><a href="${source.url}" target="_blank" rel="noreferrer">${escapeHtml(source.label)}</a></li>`
    )
    .join("");
}

function focusCell(cellId) {
  const cell = state.data.cells.find((entry) => entry.id === cellId);
  const layer = state.cellById.get(cellId);
  if (!cell || !layer) return;
  state.map.flyTo([cell.lat, cell.lon], 10, { duration: 0.7 });
  layer.openPopup();
}

function buildCellPopupHtml(cell) {
  const mountainText =
    cell.mountainZone || (cell.mountainContext && cell.mountainContext.length)
      ? "Si, con rasgo serrano o de loma"
      : "No dominante";

  return `
    <div class="popup-card">
      <h3 class="popup-title">${escapeHtml(cell.name)}</h3>
      <img class="popup-thumb" src="${cell.satellitePreview}" alt="Muestra satelital de ${escapeHtml(cell.name)}">
      <div class="popup-grid">
        <span><strong>Indice constructivo:</strong> ${cell.constructionIndex.toFixed(2)} (${escapeHtml(
          cell.constructionLabel
        )})</span>
        <span><strong>Calor interpolado:</strong> ${cell.frequency.toFixed(2)} · ${escapeHtml(cell.heatLabel)}</span>
        <span><strong>Vulnerabilidad:</strong> ${escapeHtml(cell.hazardLevel)} (${escapeHtml(
          cell.hazardRange
        )})</span>
        <span><strong>Clase climatica:</strong> ${escapeHtml(cell.climateDescription)}</span>
        <span><strong>Contexto de montana:</strong> ${escapeHtml(mountainText)}</span>
        <span><strong>Estacion mas cercana:</strong> ${escapeHtml(cell.nearestStation)} (${cell.nearestStationDistanceKm.toFixed(
          1
        )} km)</span>
        <span><strong>Metrica satelital:</strong> impermeable ${cell.satelliteMetrics.imperviousRatio.toFixed(
          2
        )}, bordes ${cell.satelliteMetrics.edgeRatio.toFixed(2)}</span>
      </div>
    </div>
  `;
}

function buildStationPopupHtml(station) {
  const mountainText =
    station.mountainZone || (station.mountainContext && station.mountainContext.length)
      ? "Si, ligada a montana o loma"
      : "No dominante";

  return `
    <div class="popup-card">
      <h3 class="popup-title">${escapeHtml(station.name)}</h3>
      <img class="popup-thumb" src="${station.satellitePreview}" alt="Muestra satelital de ${escapeHtml(
        station.name
      )}">
      <div class="popup-grid">
        <span><strong>Frecuencia observada:</strong> ${station.frequency.toFixed(2)} · ${escapeHtml(
          station.heatLabel
        )}</span>
        <span><strong>Indice constructivo:</strong> ${station.constructionIndex.toFixed(2)} (${escapeHtml(
          station.constructionLabel
        )})</span>
        <span><strong>Vulnerabilidad:</strong> ${escapeHtml(station.hazardLevel)} (${escapeHtml(
          station.hazardRange
        )})</span>
        <span><strong>Clase climatica:</strong> ${escapeHtml(station.climateDescription)}</span>
        <span><strong>Contexto de montana:</strong> ${escapeHtml(mountainText)}</span>
        <span><strong>Eventos de calor:</strong> ${station.eventCount} en ${station.summerDays} dias observados</span>
      </div>
    </div>
  `;
}

function getFrequencyColor(frequency) {
  if (frequency >= 1.2) return "#c8372d";
  if (frequency >= 0.9) return "#ea7b34";
  if (frequency >= 0.6) return "#efb43e";
  return "#3191c4";
}

function getFrequencyBand(frequency) {
  if (frequency >= 1.2) return "extreme";
  if (frequency >= 0.9) return "high";
  if (frequency >= 0.6) return "medium";
  return "low";
}

function getStationBufferRadiusMeters(frequency) {
  return 6000 + frequency * 10000;
}

function getStationDashArray(frequency) {
  if (frequency >= 1.2) return "2 10";
  if (frequency >= 0.9) return "6 10";
  if (frequency >= 0.6) return "10 9";
  return "14 11";
}

function getHazardColor(level) {
  switch (level) {
    case "Muy Alto":
      return "#c73b2e";
    case "Alto":
      return "#df7a34";
    case "Medio":
      return "#e8c449";
    case "Bajo":
      return "#6faa88";
    default:
      return "#95a49d";
  }
}

function getConstructionColor(score) {
  if (score >= 0.72) return "#b2312a";
  if (score >= 0.52) return "#d7652d";
  if (score >= 0.32) return "#efb03b";
  return "#5aa288";
}

function setStatus(message, tone = "info") {
  dom.status.textContent = message;
  dom.status.style.borderLeftColor =
    tone === "error" ? "#c8372d" : tone === "warn" ? "#e49a2d" : tone === "ok" ? "#4e9c83" : "#256b78";
  dom.status.style.background =
    tone === "error"
      ? "rgba(200, 55, 45, 0.08)"
      : tone === "warn"
        ? "rgba(228, 154, 45, 0.12)"
        : tone === "ok"
          ? "rgba(78, 156, 131, 0.12)"
          : "rgba(37, 107, 120, 0.08)";
}

function scheduleMapResize() {
  if (!state.map) return;
  window.requestAnimationFrame(() => {
    state.map.invalidateSize(false);
  });
}

function toggleDrawer(side) {
  setActiveDrawer(state.activeDrawer === side ? null : side);
}

function setActiveDrawer(side) {
  state.activeDrawer = side;

  const leftOpen = side === "left";
  const rightOpen = side === "right";
  const hasOpenDrawer = leftOpen || rightOpen;

  dom.panelLeft?.classList.toggle("is-open", leftOpen);
  dom.panelRight?.classList.toggle("is-open", rightOpen);
  dom.panelBackdrop?.classList.toggle("is-visible", hasOpenDrawer);
  dom.openLeftPanel?.classList.toggle("is-active", leftOpen);
  dom.openRightPanel?.classList.toggle("is-active", rightOpen);

  if (dom.openLeftPanel) {
    dom.openLeftPanel.setAttribute("aria-expanded", String(leftOpen));
  }

  if (dom.openRightPanel) {
    dom.openRightPanel.setAttribute("aria-expanded", String(rightOpen));
  }

  scheduleMapResize();
}

function setFocusOverlayVisible(visible) {
  if (!dom.focusOverlay) return;
  dom.focusOverlay.classList.toggle("is-collapsed", !visible);
  writeFocusOverlayPreference(visible);
}

function readFocusOverlayPreference() {
  try {
    const value = window.localStorage.getItem(FOCUS_OVERLAY_STORAGE_KEY);
    if (value === "1") return true;
    if (value === "0") return false;
  } catch (error) {
    console.warn("No se pudo leer la preferencia del panel de enfoque.", error);
  }
  return null;
}

function writeFocusOverlayPreference(visible) {
  try {
    window.localStorage.setItem(FOCUS_OVERLAY_STORAGE_KEY, visible ? "1" : "0");
  } catch (error) {
    console.warn("No se pudo guardar la preferencia del panel de enfoque.", error);
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function compactLabel(value, maxLength) {
  const text = String(value ?? "").trim();
  if (!text || text.length <= maxLength) return text || "--";
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}
