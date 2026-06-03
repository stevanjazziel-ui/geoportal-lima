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
  surfaceTemp: {
    title: "NASA GIBS · MODIS Terra Land Surface Temperature",
    url: "https://gibs.earthdata.nasa.gov/wms/epsg3857/best/",
    layers: "MODIS_Terra_Land_Surface_Temp_Day",
    options: {
      format: "image/png",
      transparent: true,
      opacity: 0.5,
      version: "1.3.0",
      styles: "default",
    },
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
    label: "NASA POWER · climatologia de temperatura, humedad, viento y earth skin temperature",
    url: "https://power.larc.nasa.gov/docs/services/api/temporal/climatology/",
  },
  {
    label: "NASA GIBS · capa satelital MODIS de temperatura superficial",
    url: "https://gibs.earthdata.nasa.gov/wms/epsg3857/best/?SERVICE=WMS&REQUEST=GetCapabilities",
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
    label: "Sentinel-2 ImageServer · fuente multiespectral usada para NDBI",
    url: "https://sentinel.arcgis.com/arcgis/rest/services/Sentinel2/ImageServer",
  },
  {
    label: "Esri World Imagery · mapa base visual del visor",
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

const esriSatelliteNativeZoomLevels = {
  stable: 17,
};

// Same stable overzoom pattern used in the crops geoportal.
function getEsriSatelliteNativeZoom() {
  return esriSatelliteNativeZoomLevels.stable;
}

const TRANSPARENT_TILE_DATA_URI =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

const state = {
  data: null,
  map: null,
  boundaryLayer: null,
  cellLayer: null,
  hybridHotspotLayer: null,
  stationLayer: null,
  rankingPinsLayer: null,
  mountainLayer: null,
  drawnItems: null,
  drawControl: null,
  remoteLayers: new Map(),
  cellById: new Map(),
  stationById: new Map(),
  selectedCellIds: new Set(),
  sortedByPriority: [],
  activeDrawer: null,
  baseLayers: new Map(),
  activeBaseLayerKey: "imagery",
};

const dom = {};
const FOCUS_OVERLAY_STORAGE_KEY = "geoportal-focus-overlay-visible";

document.addEventListener("DOMContentLoaded", () => {
  cacheDom();
  wirePanelDrawers();
  wireFocusOverlay();
  wireRiskWindow();
  initMap();
  wireBaseMapSwitcher();
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
  dom.baseImagery = document.getElementById("base-imagery");
  dom.baseLight = document.getElementById("base-light");
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
  dom.riskWindow = document.getElementById("risk-window");
  dom.riskWindowCard = document.getElementById("risk-window-card");
  dom.riskWindowTitle = document.getElementById("risk-window-title");
  dom.riskWindowSummary = document.getElementById("risk-window-summary");
  dom.riskWindowMetrics = document.getElementById("risk-window-metrics");
  dom.riskWindowSolution = document.getElementById("risk-window-solution");
  dom.hideRiskWindow = document.getElementById("hide-risk-window");
  dom.selectionStats = document.getElementById("selection-stats");
  dom.clearSelection = document.getElementById("clear-selection");
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

function wireRiskWindow() {
  dom.hideRiskWindow?.addEventListener("click", hideRiskWindow);
}

function initMap() {
  const imageryBase = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      attribution:
        "Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community",
      errorTileUrl: TRANSPARENT_TILE_DATA_URI,
      maxNativeZoom: getEsriSatelliteNativeZoom(),
      maxZoom: 19,
      updateWhenIdle: true,
      updateWhenZooming: false,
      keepBuffer: 4,
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
  state.baseLayers.set("imagery", imageryBase);
  state.baseLayers.set("light", lightBase);

  state.map.fitBounds(LIMA_BOUNDS, { padding: [18, 18] });
  initDrawTools();
  scheduleMapResize();
}

function wireBaseMapSwitcher() {
  if (!dom.baseImagery || !dom.baseLight) return;

  dom.baseImagery.addEventListener("click", () => setBaseMap("imagery"));
  dom.baseLight.addEventListener("click", () => setBaseMap("light"));
  syncBaseMapButtons();
}

function wireToggles() {
  bindToggle("toggle-heatwave", (checked) => toggleLeafletLayer(state.stationLayer, checked));
  bindToggle("toggle-hazard", (checked) => toggleLeafletLayer(state.cellLayer, checked));
  bindToggle("toggle-hybrid-hotspots", (checked) => toggleLeafletLayer(state.hybridHotspotLayer, checked));
  bindToggle("toggle-climate", (checked) => toggleRemoteLayer("climate", checked));
  bindToggle("toggle-surface-temp", (checked) => toggleRemoteLayer("surfaceTemp", checked));
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
    (a, b) =>
      b.priorityScore - a.priorityScore ||
      Number(b.hybridHeatIndex || 0) - Number(a.hybridHeatIndex || 0) ||
      b.constructionIndex - a.constructionIndex
  );

  drawRegionBoundary();
  drawRegionalCells();
  drawHybridHotspots();
  drawHeatStations();
  drawRankingPins();
  renderSources();
  updateMetrics();
  updateHeroSummary();
  renderRanking();
  updateFocusCard();
  updateSelectionSummary();
  scheduleMapResize();
  setStatus(
    `Resultados listos. Se analizaron ${prepared.cells.length} celdas con frecuencia oficial SENAMHI, hotspots termicos hibridos y ${prepared.stations.length} estaciones base.`,
    "ok"
  );

  dom.iclStatus.textContent =
    "Las capas del ICL quedan como apoyo. La prioridad principal ya cruza frecuencia SENAMHI, termica hibrida NASA POWER y NDBI de Sentinel-2.";
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
      return getCellStyle(cell, state.selectedCellIds.has(cell.id));
    },
    onEachFeature(feature, layerRef) {
      const cell = feature.properties;
      layerRef.bindPopup(buildCellPopupHtml(cell));
      layerRef.on("click", () => showRiskWindowForCell(cell));
      state.cellById.set(cell.id, layerRef);
    },
  });

  state.cellLayer.addTo(state.map);
}

function getCellStyle(cell, selected = false) {
  const baseWeight = 0.9 + Number(cell.priorityScore || 0) * 1.2;
  const baseOpacity = 0.82;
  const baseFillOpacity = 0.18 + Number(cell.priorityScore || 0) * 0.22;

  if (!selected) {
    return {
      color: getHazardColor(cell.hazardLevel),
      weight: baseWeight,
      opacity: baseOpacity,
      fillColor: getConstructionColor(cell.constructionIndex),
      fillOpacity: baseFillOpacity,
    };
  }

  return {
    color: "#fff7ee",
    weight: baseWeight + 1.9,
    opacity: 0.98,
    fillColor: getHybridColor(getHybridHeatIndex(cell)),
    fillOpacity: Math.min(0.72, baseFillOpacity + 0.26),
    dashArray: "8 6",
  };
}

// Soft territorial hotspot layer so the hybrid thermal signal is legible before opening panels.
function drawHybridHotspots() {
  state.hybridHotspotLayer = L.layerGroup();

  state.data.cells.forEach((cell) => {
    const hybridIndex = getHybridHeatIndex(cell);
    const surfaceTempC = getSurfaceTempC(cell);

    if (hybridIndex < 0.16 && surfaceTempC < 24.5) return;

    const latLng = [cell.lat, cell.lon];
    const color = getHybridColor(hybridIndex);
    const band = getHybridBand(hybridIndex);
    const popupHtml = buildCellPopupHtml(cell);

    const glow = L.circleMarker(latLng, {
      radius: getHybridHotspotGlowRadius(hybridIndex, surfaceTempC),
      stroke: false,
      fillColor: color,
      fillOpacity: getHybridHotspotGlowOpacity(hybridIndex),
      interactive: false,
      className: `cell-hotspot-glow hotspot-${band}`,
    });

    const ring = L.circleMarker(latLng, {
      radius: getHybridHotspotRingRadius(hybridIndex, surfaceTempC),
      color,
      weight: 1 + hybridIndex * 1.1,
      opacity: 0.42 + hybridIndex * 0.42,
      fillColor: color,
      fillOpacity: 0.1 + hybridIndex * 0.18,
      className: `cell-hotspot-ring hotspot-${band}`,
    });

    const core = L.circleMarker(latLng, {
      radius: getHybridHotspotCoreRadius(surfaceTempC),
      color: "#fffaf2",
      weight: 1,
      opacity: 0.92,
      fillColor: color,
      fillOpacity: 0.9,
      className: `cell-hotspot-core hotspot-${band}`,
    });

    [ring, core].forEach((layer) => {
      layer.bindPopup(popupHtml);
      layer.on("click", () => showRiskWindowForCell(cell));
    });

    [glow, ring, core].forEach((layer) => state.hybridHotspotLayer.addLayer(layer));
  });

  state.hybridHotspotLayer.addTo(state.map);
}

function initDrawTools() {
  if (!state.map) return;

  state.drawnItems = L.featureGroup().addTo(state.map);
  if (dom.clearSelection) dom.clearSelection.disabled = true;
  dom.clearSelection?.addEventListener("click", clearSelectionShapes);

  if (!L.Control?.Draw) {
    if (dom.selectionStats) {
      dom.selectionStats.textContent =
        "Las herramientas de dibujo no cargaron en este navegador. El análisis principal sigue disponible.";
      dom.selectionStats.classList.add("selection-stats-empty");
    }
    return;
  }

  state.drawControl = new L.Control.Draw({
    position: "bottomright",
    edit: {
      featureGroup: state.drawnItems,
      edit: true,
      remove: true,
    },
    draw: {
      polygon: {
        allowIntersection: false,
        showArea: true,
        shapeOptions: {
          color: "#f5c79d",
          weight: 2,
          fillColor: "#f5c79d",
          fillOpacity: 0.16,
        },
      },
      rectangle: {
        shapeOptions: {
          color: "#8fd2de",
          weight: 2,
          fillColor: "#8fd2de",
          fillOpacity: 0.14,
        },
      },
      polyline: false,
      circle: false,
      marker: false,
      circlemarker: false,
    },
  });

  state.map.addControl(state.drawControl);
  state.map.on(L.Draw.Event.CREATED, handleShapeCreated);
  state.map.on(L.Draw.Event.EDITED, updateSelectionSummary);
  state.map.on(L.Draw.Event.DELETED, updateSelectionSummary);
}

function handleShapeCreated(event) {
  if (!state.drawnItems) return;
  state.drawnItems.addLayer(event.layer);
  updateSelectionSummary();
}

function clearSelectionShapes() {
  state.drawnItems?.clearLayers();
  updateSelectionSummary();
}

function updateSelectionSummary() {
  if (!dom.selectionStats) return;

  const selectedCells = getSelectedCells();
  state.selectedCellIds = new Set(selectedCells.map((cell) => cell.id));
  refreshCellSelectionStyles();

  if (!selectedCells.length) {
    dom.selectionStats.innerHTML =
      "Sin selección activa. Dibuja un polígono o rectángulo para ver calor, construcción y prioridad.";
    dom.selectionStats.classList.add("selection-stats-empty");
    if (dom.clearSelection) dom.clearSelection.disabled = true;
    return;
  }

  const avgHybridTemp =
    selectedCells.reduce((sum, cell) => sum + getHybridTempC(cell), 0) / selectedCells.length;
  const avgConstruction =
    selectedCells.reduce((sum, cell) => sum + Number(cell.constructionIndex || 0), 0) / selectedCells.length;
  const maxPriority = [...selectedCells].sort((a, b) => Number(b.priorityScore || 0) - Number(a.priorityScore || 0))[0];
  const highRiskCount = selectedCells.filter(
    (cell) => getHazardRank(cell.hazardLevel) >= HAZARD_ORDER.Alto
  ).length;

  dom.selectionStats.classList.remove("selection-stats-empty");
  dom.selectionStats.innerHTML = `
    <div class="selection-stat-grid">
      <article class="selection-stat">
        <span class="selection-stat-label">Celdas</span>
        <strong>${selectedCells.length}</strong>
      </article>
      <article class="selection-stat">
        <span class="selection-stat-label">Sensación media</span>
        <strong>${formatNumber(avgHybridTemp, 1)}°C</strong>
      </article>
      <article class="selection-stat">
        <span class="selection-stat-label">Construcción media</span>
        <strong>${formatNumber(avgConstruction, 2)}</strong>
      </article>
      <article class="selection-stat">
        <span class="selection-stat-label">Riesgo alto+</span>
        <strong>${highRiskCount}</strong>
      </article>
    </div>
    <p class="selection-summary-text">
      ${escapeHtml(maxPriority.name)} lidera dentro de la selección con prioridad ${formatNumber(
        maxPriority.priorityScore,
        2
      )} y frecuencia oficial ${formatNumber(maxPriority.frequency, 2)}.
    </p>
  `;

  if (dom.clearSelection) dom.clearSelection.disabled = false;
}

function getSelectedCells() {
  if (!state.data?.cells?.length || !state.drawnItems) return [];

  const layers = state.drawnItems.getLayers();
  if (!layers.length) return [];

  return state.data.cells.filter((cell) => layers.some((layer) => isCellInsideLayer(cell, layer)));
}

function isCellInsideLayer(cell, layer) {
  const latLng = L.latLng(cell.lat, cell.lon);

  if (typeof layer.getBounds === "function" && !layer.getBounds().contains(latLng)) {
    return false;
  }

  const rawLatLngs = typeof layer.getLatLngs === "function" ? layer.getLatLngs() : null;
  const ring = extractPrimaryRing(rawLatLngs);
  if (!ring?.length) return false;

  return pointInRing(latLng, ring);
}

function extractPrimaryRing(latLngs) {
  if (!Array.isArray(latLngs) || !latLngs.length) return null;
  if (Array.isArray(latLngs[0])) return latLngs[0];
  return latLngs;
}

function pointInRing(point, ring) {
  let inside = false;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].lng;
    const yi = ring[i].lat;
    const xj = ring[j].lng;
    const yj = ring[j].lat;
    const intersects =
      yi > point.lat !== yj > point.lat &&
      point.lng < ((xj - xi) * (point.lat - yi)) / ((yj - yi) || Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }

  return inside;
}

function refreshCellSelectionStyles() {
  if (!state.cellLayer) return;

  state.cellLayer.eachLayer((layerRef) => {
    const cell = layerRef.feature?.properties;
    if (!cell) return;
    layerRef.setStyle(getCellStyle(cell, state.selectedCellIds.has(cell.id)));
  });
}

function drawHeatStations() {
  state.stationById.clear();
  state.stationLayer = L.layerGroup();

  state.data.stations.forEach((station) => {
    const latLng = [station.lat, station.lon];
    const frequencyColor = getFrequencyColor(station.frequency);
    const frequencyBand = getFrequencyBand(station.frequency);
    const hybridIndex = Number(station.hybridHeatIndex || 0);
    const hybridColor = getHybridColor(hybridIndex);
    const hybridBand = getHybridBand(hybridIndex);
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
      radius: 4.4 + hybridIndex * 5.2,
      color: "#fff8ee",
      weight: 1.8,
      fillColor: hybridColor,
      fillOpacity: 0.96,
      className: `station-core station-${frequencyBand} station-hybrid-${hybridBand}`,
    });

    const nucleus = L.circleMarker(latLng, {
      radius: 1.8 + hybridIndex * 1.7,
      color: "#163132",
      weight: 0.8,
      opacity: 0.92,
      fillColor: "#fffaf2",
      fillOpacity: 0.94,
      className: `station-nucleus station-${frequencyBand}`,
    });

    [buffer, halo, marker, nucleus].forEach((layer) => {
      layer.bindPopup(popupHtml);
      layer.on("click", () => showRiskWindowForStation(station));
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
    marker.on("click", () => showRiskWindowForCell(cell));
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
      layerRef.on("click", () => showRiskWindowForCell(cell));
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

function setBaseMap(key) {
  if (!state.map || state.activeBaseLayerKey === key) return;

  const nextLayer = state.baseLayers.get(key);
  const currentLayer = state.baseLayers.get(state.activeBaseLayerKey);
  if (!nextLayer) return;

  if (currentLayer && state.map.hasLayer(currentLayer)) {
    state.map.removeLayer(currentLayer);
  }

  nextLayer.addTo(state.map);
  state.activeBaseLayerKey = key;
  syncBaseMapButtons();
}

function syncBaseMapButtons() {
  dom.baseImagery?.classList.toggle("is-active", state.activeBaseLayerKey === "imagery");
  dom.baseLight?.classList.toggle("is-active", state.activeBaseLayerKey === "light");
}

function updateMetrics() {
  const cells = state.data.cells;
  const mediumPlus = cells.filter((cell) => HAZARD_ORDER[cell.hazardLevel] >= HAZARD_ORDER.Medio).length;
  const peakHybridTemp = cells.reduce((max, cell) => Math.max(max, Number(cell.hybridTempC || 0)), 0);
  const avgConstruction =
    cells.reduce((sum, cell) => sum + Number(cell.constructionIndex || 0), 0) / cells.length;

  dom.metricPoints.textContent = String(cells.length);
  dom.metricRisk.textContent = String(mediumPlus);
  dom.metricPeak.textContent = `${peakHybridTemp.toFixed(1)}°C`;
  dom.metricConstruction.textContent = avgConstruction.toFixed(2);
}

function updateHeroSummary() {
  if (!dom.heroCellCount || !state.data?.cells?.length) return;

  const topPriority = state.sortedByPriority[0];
  const hottestCell = [...state.data.cells].sort(
    (a, b) => Number(b.hybridTempC || 0) - Number(a.hybridTempC || 0) || b.priorityScore - a.priorityScore
  )[0];
  const peakStation =
    state.data.stations.reduce(
      (best, station) =>
        Number(station.hybridTempC || 0) > Number(best.hybridTempC || 0) ? station : best,
      state.data.stations[0]
    ) || null;

  dom.heroCellCount.textContent = String(state.data.cells.length);
  dom.heroPeakHeat.textContent = `${Number(hottestCell.hybridTempC || 0).toFixed(1)}°C`;
  dom.heroTopSector.textContent = compactLabel(topPriority.name, 26);
  dom.heroTopStation.textContent = compactLabel(topPriority.nearestStation || peakStation?.name || "--", 24);
  dom.heroSummaryNote.textContent =
    `${compactLabel(topPriority.name, 42)} lidera la prioridad regional (${topPriority.priorityScore.toFixed(2)}), ` +
    `con frecuencia oficial ${Number(topPriority.frequency || 0).toFixed(2)}, sensacion hibrida ${Number(
      topPriority.hybridTempC || 0
    ).toFixed(1)}°C y vulnerabilidad ${String(topPriority.hazardLevel).toLowerCase()}.`;
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
        <span class="ranking-chip">Frecuencia ${Number(cell.frequency || 0).toFixed(2)}</span>
        <span class="ranking-chip">Sensacion ${Number(cell.hybridTempC || 0).toFixed(1)}°C</span>
        <span class="ranking-chip">Superficie ${Number(cell.surfaceTempC || 0).toFixed(1)}°C</span>
        <span class="ranking-chip">Riesgo ${escapeHtml(cell.hazardLevel)}</span>
      </div>
      <p class="ranking-text">
        Cerca de ${escapeHtml(cell.nearestStation)} · hibrido ${Number(cell.hybridHeatIndex || 0).toFixed(
          2
        )} · ${escapeHtml(cell.climateDescription)} · ${
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

  dom.focusTitle.textContent = `${topPriority.name} lidera el cruce frecuencia + termica hibrida`;
  dom.focusDescription.textContent =
    `${topPriority.name} alcanza prioridad ${topPriority.priorityScore.toFixed(2)}, frecuencia oficial ${Number(
      topPriority.frequency || 0
    ).toFixed(2)} y sensacion hibrida ${Number(topPriority.hybridTempC || 0).toFixed(1)}°C. ` +
    `Su hotspot territorial queda visible sobre el mapa. ` +
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
  showRiskWindowForCell(cell);
  layer.openPopup();
}

function showRiskWindowForCell(cell) {
  if (!cell || !dom.riskWindow || !dom.riskWindowCard) return;

  const integratedRisk = getIntegratedRiskScore(cell);
  const hazardRank = getHazardRank(cell.hazardLevel);
  const builtUpRatio = getBuiltUpRatio(cell);
  const ndbiMean = getNdbiMean(cell);
  const hybridTempC = getHybridTempC(cell);
  const hybridHeatIndex = getHybridHeatIndex(cell);
  const surfaceTempC = getSurfaceTempC(cell);
  const tone = getRiskTone(integratedRisk);
  const mountainContext = hasMountainContext(cell)
    ? "Tambien presenta condicion serrana o de loma, lo que vuelve mas delicada la expansion y la respuesta termica."
    : "No muestra una condicion serrana dominante dentro de la celda.";

  dom.riskWindowCard.dataset.tone = tone;
  dom.riskWindow.classList.remove("is-hidden");
  dom.riskWindowTitle.textContent = cell.name;
  dom.riskWindowSummary.textContent =
    `${cell.name} registra un riesgo integrado de ${integratedRisk}/100, con vulnerabilidad ${hazardRank}/4 ` +
    `(${cell.hazardLevel}), frecuencia oficial ${Number(cell.frequency || 0).toFixed(2)}, sensacion hibrida ${hybridTempC.toFixed(
      1
    )}°C, superficie ${surfaceTempC.toFixed(1)}°C e indice constructivo ${cell.constructionIndex.toFixed(2)}. ${mountainContext}`;
  dom.riskWindowSolution.textContent = buildRiskRecommendation(cell, {
    integratedRisk,
    hazardRank,
    builtUpRatio,
    hybridTempC,
    hybridHeatIndex,
    surfaceTempC,
  });
  dom.riskWindowMetrics.innerHTML = buildRiskMetricsHtml(cell, {
    integratedRisk,
    hazardRank,
    builtUpRatio,
    ndbiMean,
    hybridTempC,
    hybridHeatIndex,
    surfaceTempC,
  });
}

function showRiskWindowForStation(station) {
  if (!station || !dom.riskWindow || !dom.riskWindowCard) return;

  const integratedRisk = getIntegratedRiskScore(station);
  const hazardRank = getHazardRank(station.hazardLevel);
  const builtUpRatio = getBuiltUpRatio(station);
  const ndbiMean = getNdbiMean(station);
  const hybridTempC = getHybridTempC(station);
  const hybridHeatIndex = getHybridHeatIndex(station);
  const surfaceTempC = getSurfaceTempC(station);
  const tone = getRiskTone(integratedRisk);
  const mountainContext = hasMountainContext(station)
    ? "La estacion se ubica en contexto serrano o de loma, por lo que el entorno merece lectura territorial cuidadosa."
    : "La estacion no se ubica en un contexto serrano dominante.";

  dom.riskWindowCard.dataset.tone = tone;
  dom.riskWindow.classList.remove("is-hidden");
  dom.riskWindowTitle.textContent = `${station.name} · estación base`;
  dom.riskWindowSummary.textContent =
    `${station.name} registra un riesgo integrado de ${integratedRisk}/100, con vulnerabilidad ${hazardRank}/4 ` +
    `(${station.hazardLevel}), frecuencia oficial ${formatNumber(station.frequency, 2)}, sensacion hibrida ${formatNumber(
      hybridTempC,
      1
    )}°C, superficie ${formatNumber(surfaceTempC, 1)}°C y ${formatInteger(station.eventCount)} eventos de calor en ${formatInteger(
      station.summerDays
    )} dias observados. ${mountainContext}`;
  dom.riskWindowSolution.textContent = buildRiskRecommendation(station, {
    integratedRisk,
    hazardRank,
    builtUpRatio,
    hybridTempC,
    hybridHeatIndex,
    surfaceTempC,
  });
  dom.riskWindowMetrics.innerHTML = buildStationRiskMetricsHtml(station, {
    integratedRisk,
    hazardRank,
    builtUpRatio,
    ndbiMean,
    hybridTempC,
    hybridHeatIndex,
    surfaceTempC,
  });
}

function hideRiskWindow() {
  dom.riskWindow?.classList.add("is-hidden");
}

function buildRiskMetricsHtml(cell, metrics) {
  const metricCards = [
    {
      label: "Riesgo integrado",
      value: `${metrics.integratedRisk}/100`,
      detail: `Prioridad ${cell.priorityScore.toFixed(2)}`,
    },
    {
      label: "Frecuencia SENAMHI",
      value: Number(cell.frequency || 0).toFixed(2),
      detail: `${String(cell.heatLabel || "Sin dato")} · ${String(cell.nearestStation || "--")}`,
    },
    {
      label: "Sensacion hibrida",
      value: `${metrics.hybridTempC.toFixed(1)}°C`,
      detail: `Indice ${metrics.hybridHeatIndex.toFixed(2)} · ${String(cell.hybridHeatLabel || "Sin dato")}`,
    },
    {
      label: "Superficie refinada",
      value: `${metrics.surfaceTempC.toFixed(1)}°C`,
      detail: `POWER ${getThermalMetric(cell, "earthSkinTempC").toFixed(1)}°C + ajuste ${getThermalMetric(
        cell,
        "surfaceAdjustmentC"
      ).toFixed(1)}°C`,
    },
    {
      label: "Humedad y viento",
      value: `${getThermalMetric(cell, "relativeHumidity").toFixed(0)}% · ${getThermalMetric(
        cell,
        "windSpeedMs"
      ).toFixed(1)} m/s`,
      detail: `Tmax ${getThermalMetric(cell, "airTempMaxC").toFixed(1)}°C · aparente ${getThermalMetric(
        cell,
        "apparentTempC"
      ).toFixed(1)}°C`,
    },
    {
      label: "Construccion NDBI",
      value: cell.constructionIndex.toFixed(2),
      detail: `${String(cell.constructionLabel || "Sin dato")} · ${Math.round(
        metrics.builtUpRatio * 100
      )}% edificada · NDBI ${metrics.ndbiMean.toFixed(2)}`,
    },
    {
      label: "Vulnerabilidad",
      value: `${metrics.hazardRank}/4`,
      detail: `${String(cell.hazardLevel || "Sin dato")} · ${Number(cell.nearestStationDistanceKm || 0).toFixed(
        1
      )} km de la estacion base`,
    },
  ];

  return metricCards
    .map(
      (entry) => `
        <article class="risk-metric">
          <span class="risk-metric-label">${escapeHtml(entry.label)}</span>
          <strong class="risk-metric-value">${escapeHtml(entry.value)}</strong>
          <span class="risk-metric-detail">${escapeHtml(entry.detail)}</span>
        </article>
      `
    )
    .join("");
}

function buildStationRiskMetricsHtml(station, metrics) {
  const metricCards = [
    {
      label: "Riesgo integrado",
      value: `${metrics.integratedRisk}/100`,
      detail: `Prioridad ${formatNumber(station.priorityScore, 2)}`,
    },
    {
      label: "Frecuencia SENAMHI",
      value: formatNumber(station.frequency, 2),
      detail: `${String(station.heatLabel || "Sin dato")} · ${formatInteger(station.eventCount)} eventos`,
    },
    {
      label: "Sensacion hibrida",
      value: `${formatNumber(metrics.hybridTempC, 1)}°C`,
      detail: `Indice ${formatNumber(metrics.hybridHeatIndex, 2)} · ${String(station.hybridHeatLabel || "Sin dato")}`,
    },
    {
      label: "Superficie refinada",
      value: `${formatNumber(metrics.surfaceTempC, 1)}°C`,
      detail: `POWER ${formatNumber(getThermalMetric(station, "earthSkinTempC"), 1)}°C + ajuste ${formatNumber(
        getThermalMetric(station, "surfaceAdjustmentC"),
        1
      )}°C`,
    },
    {
      label: "Humedad y viento",
      value: `${formatNumber(getThermalMetric(station, "relativeHumidity"), 0)}% · ${formatNumber(
        getThermalMetric(station, "windSpeedMs"),
        1
      )} m/s`,
      detail: `Tmax ${formatNumber(getThermalMetric(station, "airTempMaxC"), 1)}°C · aparente ${formatNumber(
        getThermalMetric(station, "apparentTempC"),
        1
      )}°C`,
    },
    {
      label: "Construccion NDBI",
      value: formatNumber(station.constructionIndex, 2),
      detail: `${String(station.constructionLabel || "Sin dato")} · ${Math.round(
        metrics.builtUpRatio * 100
      )}% edificada · NDBI ${formatNumber(metrics.ndbiMean, 2)}`,
    },
    {
      label: "Contexto y dias",
      value: `${metrics.hazardRank}/4`,
      detail: `${String(station.hazardLevel || "Sin dato")} · ${formatInteger(station.summerDays)} dias observados`,
    },
  ];

  return metricCards
    .map(
      (entry) => `
        <article class="risk-metric">
          <span class="risk-metric-label">${escapeHtml(entry.label)}</span>
          <strong class="risk-metric-value">${escapeHtml(entry.value)}</strong>
          <span class="risk-metric-detail">${escapeHtml(entry.detail)}</span>
        </article>
      `
    )
    .join("");
}

function getIntegratedRiskScore(cell) {
  return Math.max(0, Math.min(100, Math.round(Number(cell.priorityScore || 0) * 100)));
}

function getHazardRank(level) {
  return HAZARD_ORDER[level] || 0;
}

function getBuiltUpRatio(cell) {
  return Math.max(0, Math.min(1, Number(cell?.satelliteMetrics?.builtUpRatio ?? cell?.constructionIndex ?? 0)));
}

function getNdbiMean(cell) {
  return Number(cell?.satelliteMetrics?.ndbiMean ?? 0);
}

function getThermalMetric(cell, key) {
  return Number(cell?.thermalMetrics?.[key] ?? cell?.[key] ?? 0);
}

function getHybridHeatIndex(cell) {
  return getThermalMetric(cell, "hybridHeatIndex");
}

function getHybridTempC(cell) {
  return getThermalMetric(cell, "hybridTempC");
}

function getSurfaceTempC(cell) {
  return getThermalMetric(cell, "surfaceTempC");
}

function hasMountainContext(cell) {
  return Boolean(cell?.mountainZone || (Array.isArray(cell?.mountainContext) && cell.mountainContext.length));
}

function getRiskTone(score) {
  if (score >= 75) return "critical";
  if (score >= 55) return "high";
  if (score >= 35) return "medium";
  return "low";
}

function buildRiskRecommendation(cell, metrics) {
  const highFrequency = Number(cell.frequency || 0) >= 0.9;
  const veryHighFrequency = Number(cell.frequency || 0) >= 1.1;
  const highHybrid = metrics.hybridHeatIndex >= 0.55 || metrics.hybridTempC >= 31;
  const veryHighHybrid = metrics.hybridHeatIndex >= 0.72 || metrics.hybridTempC >= 33;
  const hotSurface = metrics.surfaceTempC >= 26.5;
  const highConstruction = Number(cell.constructionIndex || 0) >= 0.52;
  const denseConstruction = Number(cell.constructionIndex || 0) >= 0.72;
  const highHazard = metrics.hazardRank >= 3;
  const veryHighHazard = metrics.hazardRank >= 4;
  const mountain = hasMountainContext(cell);
  const stationDistance = Number(cell.nearestStationDistanceKm || 0);
  const humidity = getThermalMetric(cell, "relativeHumidity");

  let mainAction =
    "Mantener seguimiento de la celda y guiar nuevas obras con sombra, vegetacion y materiales de baja absorcion termica.";

  if (veryHighHazard && veryHighHybrid && highConstruction) {
    mainAction =
      "Priorizar enfriamiento urbano inmediato: arborizacion de calles, sombra continua, techos frios y retiro progresivo de superficies impermeables en vias y equipamientos.";
  } else if (highHazard && mountain) {
    mainAction =
      "Contener la expansion en ladera o loma, reforzar drenaje y estabilidad del suelo, y ubicar sombra y espacios publicos frescos en los nucleos mas expuestos.";
  } else if ((highFrequency || highHybrid) && !highConstruction) {
    mainAction =
      "Conservar suelo abierto y cobertura natural, evitar nuevo asfalto innecesario y sumar parques de bolsillo o franjas verdes antes de consolidar nueva edificacion.";
  } else if (hotSurface && (highConstruction || denseConstruction)) {
    mainAction =
      "Aplicar reconversion termica del tejido construido con techos frios, pavimentos permeables, arbolado vial y regulacion de patios duros o cubiertas reflectantes.";
  } else if (metrics.integratedRisk >= 55 || veryHighFrequency || veryHighHybrid) {
    mainAction =
      "Intervenir primero equipamientos sensibles, ejes peatonales y plazas con sombra, agua y materiales mas reflectivos para bajar exposicion termica.";
  }

  const supportNotes = [];

  if (metrics.builtUpRatio >= 0.45) {
    supportNotes.push(
      `La cobertura edificada estimada ya alcanza ${Math.round(metrics.builtUpRatio * 100)}%, por lo que conviene limitar mayor sellado del suelo`
    );
  }

  if (stationDistance >= 18) {
    supportNotes.push(
      `la estacion de apoyo queda a ${stationDistance.toFixed(1)} km y vale complementar con verificacion local`
    );
  }

  if (humidity >= 72 && highHybrid) {
    supportNotes.push("la humedad estacional sigue alta y puede sostener sensaciones termicas elevadas aun con viento moderado");
  }

  if (highHazard && !mountain) {
    supportNotes.push("la prioridad debe concentrarse en sombra peatonal, arbolado barrial y enfriamiento de cubiertas");
  }

  return supportNotes.length ? `${mainAction} ${capitalizeSentence(supportNotes.join("; "))}.` : mainAction;
}

function capitalizeSentence(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function formatNumber(value, digits = 2, fallback = "--") {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(digits) : fallback;
}

function formatInteger(value, fallback = "--") {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? String(Math.round(numeric)) : fallback;
}

function formatDistanceKm(value, digits = 1, fallback = "-- km") {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${numeric.toFixed(digits)} km` : fallback;
}

function buildSatellitePreviewHtml(label, preview) {
  if (!preview) {
    return `<div class="popup-thumb popup-thumb-empty">Vista satelital no disponible</div>`;
  }

  return `<img class="popup-thumb" src="${preview}" alt="Muestra satelital de ${escapeHtml(label)}">`;
}

function buildCellPopupHtml(cell) {
  const mountainText =
    cell.mountainZone || (cell.mountainContext && cell.mountainContext.length)
      ? "Si, con rasgo serrano o de loma"
      : "No dominante";
  const builtUpRatio = cell?.satelliteMetrics?.builtUpRatio;
  const ndbiMean = cell?.satelliteMetrics?.ndbiMean;
  const frequencyText = formatNumber(cell.frequency, 2);
  const hybridTempText = formatNumber(getHybridTempC(cell), 1);
  const hybridIndexText = formatNumber(cell.hybridHeatIndex, 2);
  const surfaceTempText = formatNumber(getSurfaceTempC(cell), 1);
  const constructionText = formatNumber(cell.constructionIndex, 2);
  const humidityText = formatNumber(getThermalMetric(cell, "relativeHumidity"), 0);
  const windText = formatNumber(getThermalMetric(cell, "windSpeedMs"), 1);
  const stationDistanceText = formatDistanceKm(cell.nearestStationDistanceKm);

  return `
    <div class="popup-card">
      <h3 class="popup-title">${escapeHtml(cell.name)}</h3>
      ${buildSatellitePreviewHtml(cell.name, cell.satellitePreview)}
      <div class="popup-grid">
        <span><strong>Frecuencia SENAMHI:</strong> ${frequencyText} · ${escapeHtml(cell.heatLabel || "Sin dato")}</span>
        <span><strong>Sensacion hibrida:</strong> ${hybridTempText}°C · ${hybridIndexText}</span>
        <span><strong>Temperatura superficial:</strong> ${surfaceTempText}°C</span>
        <span><strong>Indice constructivo:</strong> ${constructionText} (${escapeHtml(
          cell.constructionLabel || "Sin dato"
        )})</span>
        <span><strong>Vulnerabilidad:</strong> ${escapeHtml(cell.hazardLevel || "Sin dato")} (${escapeHtml(
          cell.hazardRange || "Sin rango"
        )})</span>
        <span><strong>Clase climatica:</strong> ${escapeHtml(cell.climateDescription || "Sin dato")}</span>
        <span><strong>Contexto de montana:</strong> ${escapeHtml(mountainText)}</span>
        <span><strong>Estacion mas cercana:</strong> ${escapeHtml(cell.nearestStation || "--")} (${stationDistanceText})</span>
        <span><strong>Humedad y viento:</strong> ${humidityText}% · ${windText} m/s</span>
        <span><strong>Metrica NDBI:</strong> media ${formatNumber(ndbiMean, 2)}, cobertura construida ${formatNumber(
          builtUpRatio,
          2
        )}</span>
      </div>
    </div>
  `;

  return `
    <div class="popup-card">
      <h3 class="popup-title">${escapeHtml(cell.name)}</h3>
      ${buildSatellitePreviewHtml(cell.name, cell.satellitePreview)}
      <div class="popup-grid">
        <span><strong>Frecuencia SENAMHI:</strong> ${Number(cell.frequency || 0).toFixed(2)} · ${escapeHtml(
          cell.heatLabel || "Sin dato"
        )}</span>
        <span><strong>Sensacion hibrida:</strong> ${getHybridTempC(cell).toFixed(1)}°C · ${Number(
          cell.hybridHeatIndex || 0
        ).toFixed(2)}</span>
        <span><strong>Temperatura superficial:</strong> ${getSurfaceTempC(cell).toFixed(1)}°C</span>
        <span><strong>Indice constructivo:</strong> ${cell.constructionIndex.toFixed(2)} (${escapeHtml(
          cell.constructionLabel || "Sin dato"
        )})</span>
        <span><strong>Vulnerabilidad:</strong> ${escapeHtml(cell.hazardLevel)} (${escapeHtml(
          cell.hazardRange
        )})</span>
        <span><strong>Clase climatica:</strong> ${escapeHtml(cell.climateDescription || "Sin dato")}</span>
        <span><strong>Contexto de montana:</strong> ${escapeHtml(mountainText)}</span>
        <span><strong>Estacion mas cercana:</strong> ${escapeHtml(cell.nearestStation || "--")} (${formatDistanceKm(
          cell.nearestStationDistanceKm
        )})</span>
        <span><strong>Humedad y viento:</strong> ${getThermalMetric(cell, "relativeHumidity").toFixed(
          0
        )}% · ${getThermalMetric(cell, "windSpeedMs").toFixed(1)} m/s</span>
        <span><strong>Metrica NDBI:</strong> media ${formatNumber(ndbiMean, 2)}, cobertura construida ${formatNumber(
          builtUpRatio,
          2
        )}</span>
      </div>
    </div>
  `;
}

function buildStationPopupHtml(station) {
  const mountainText =
    station.mountainZone || (station.mountainContext && station.mountainContext.length)
      ? "Si, ligada a montana o loma"
      : "No dominante";
  const builtUpRatio = station?.satelliteMetrics?.builtUpRatio;
  const ndbiMean = station?.satelliteMetrics?.ndbiMean;
  const frequencyText = formatNumber(station.frequency, 2);
  const hybridTempText = formatNumber(getHybridTempC(station), 1);
  const hybridIndexText = formatNumber(station.hybridHeatIndex, 2);
  const surfaceTempText = formatNumber(getSurfaceTempC(station), 1);
  const constructionText = formatNumber(station.constructionIndex, 2);
  const humidityText = formatNumber(getThermalMetric(station, "relativeHumidity"), 0);
  const windText = formatNumber(getThermalMetric(station, "windSpeedMs"), 1);
  const eventCountText = formatInteger(station.eventCount);
  const summerDaysText = formatInteger(station.summerDays);

  return `
    <div class="popup-card">
      <h3 class="popup-title">${escapeHtml(station.name)}</h3>
      ${buildSatellitePreviewHtml(station.name, station.satellitePreview)}
      <div class="popup-grid">
        <span><strong>Frecuencia observada:</strong> ${frequencyText} · ${escapeHtml(
          station.heatLabel || "Sin dato"
        )}</span>
        <span><strong>Sensacion hibrida:</strong> ${hybridTempText}°C · ${hybridIndexText}</span>
        <span><strong>Temperatura superficial:</strong> ${surfaceTempText}°C</span>
        <span><strong>Indice constructivo:</strong> ${constructionText} (${escapeHtml(
          station.constructionLabel || "Sin dato"
        )})</span>
        <span><strong>Vulnerabilidad:</strong> ${escapeHtml(station.hazardLevel || "Sin dato")} (${escapeHtml(
          station.hazardRange || "Sin rango"
        )})</span>
        <span><strong>Clase climatica:</strong> ${escapeHtml(station.climateDescription || "Sin dato")}</span>
        <span><strong>Contexto de montana:</strong> ${escapeHtml(mountainText)}</span>
        <span><strong>Eventos de calor:</strong> ${eventCountText} en ${summerDaysText} dias observados</span>
        <span><strong>Humedad y viento:</strong> ${humidityText}% · ${windText} m/s</span>
        <span><strong>Metrica NDBI:</strong> media ${formatNumber(ndbiMean, 2)}, cobertura construida ${formatNumber(
          builtUpRatio,
          2
        )}</span>
      </div>
    </div>
  `;

  return `
    <div class="popup-card">
      <h3 class="popup-title">${escapeHtml(station.name)}</h3>
      ${buildSatellitePreviewHtml(station.name, station.satellitePreview)}
      <div class="popup-grid">
        <span><strong>Frecuencia observada:</strong> ${Number(station.frequency || 0).toFixed(2)} · ${escapeHtml(
          station.heatLabel || "Sin dato"
        )}</span>
        <span><strong>Sensacion hibrida:</strong> ${getHybridTempC(station).toFixed(1)}°C · ${Number(
          station.hybridHeatIndex || 0
        ).toFixed(2)}</span>
        <span><strong>Temperatura superficial:</strong> ${getSurfaceTempC(station).toFixed(1)}°C</span>
        <span><strong>Indice constructivo:</strong> ${station.constructionIndex.toFixed(2)} (${escapeHtml(
          station.constructionLabel || "Sin dato"
        )})</span>
        <span><strong>Vulnerabilidad:</strong> ${escapeHtml(station.hazardLevel)} (${escapeHtml(
          station.hazardRange
        )})</span>
        <span><strong>Clase climatica:</strong> ${escapeHtml(station.climateDescription || "Sin dato")}</span>
        <span><strong>Contexto de montana:</strong> ${escapeHtml(mountainText)}</span>
        <span><strong>Eventos de calor:</strong> ${formatInteger(station.eventCount)} en ${formatInteger(
          station.summerDays
        )} dias observados</span>
        <span><strong>Humedad y viento:</strong> ${getThermalMetric(station, "relativeHumidity").toFixed(
          0
        )}% · ${getThermalMetric(station, "windSpeedMs").toFixed(1)} m/s</span>
        <span><strong>Metrica NDBI:</strong> media ${formatNumber(ndbiMean, 2)}, cobertura construida ${formatNumber(
          builtUpRatio,
          2
        )}</span>
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

function getHybridColor(index) {
  if (index >= 0.72) return "#c8372d";
  if (index >= 0.54) return "#ea7b34";
  if (index >= 0.36) return "#efb43e";
  return "#2d8dbf";
}

function getHybridBand(index) {
  if (index >= 0.72) return "extreme";
  if (index >= 0.54) return "high";
  if (index >= 0.36) return "medium";
  return "low";
}

function getHybridHotspotGlowRadius(index, surfaceTempC) {
  return 10 + index * 17 + Math.max(0, surfaceTempC - 24) * 0.45;
}

function getHybridHotspotGlowOpacity(index) {
  return 0.06 + index * 0.14;
}

function getHybridHotspotRingRadius(index, surfaceTempC) {
  return 4.6 + index * 7.2 + Math.max(0, surfaceTempC - 24) * 0.18;
}

function getHybridHotspotCoreRadius(surfaceTempC) {
  return 1.8 + Math.max(0, surfaceTempC - 24) * 0.12;
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
