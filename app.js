const LIMA_BOUNDS = [
  [-13.35, -77.95],
  [-10.55, -75.45],
];

const REMOTE_LAYERS = {
  climate: {
    title: "SENAMHI · Clasificación Climática 1981-2010",
    url: "https://idesep.senamhi.gob.pe:443/geoserver/g_05_01/wms?",
    layers: "g_05_01:05_01_001_03_001_512_2021_00_00",
    options: { format: "image/png", transparent: true, opacity: 0.42 },
  },
  construction: {
    title: "ICL · Proyectos de construcción",
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
    title: "ICL · Áreas verdes",
    url: "https://ide.icl.gob.pe:8443/geoserver/IDEP/idep_tg_parques/wms",
    layers: "IDEP:idep_tg_parques",
    options: { format: "image/png", transparent: true, opacity: 0.68 },
  },
};

const SOURCES = [
  {
    label: "SENAMHI · Catálogo IDESEP",
    url: "https://idesep.senamhi.gob.pe/portalidesep/wms.do",
  },
  {
    label: "GeoIDEP · Catálogo del Instituto Catastral de Lima",
    url: "https://www.geoidep.gob.pe/catalogo-nacional-de-servicios-web?id_institucion=268&search_token=oweq8Q37yv5EdudwlRyms46dQWlEyHD5OPYy3U2nQJw",
  },
  {
    label: "Esri World Imagery · base satelital usada para el índice local",
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
  markerLayer: null,
  bufferLayer: null,
  rankingPinsLayer: null,
  mountainLayer: null,
  mountainPointLayer: null,
  remoteLayers: new Map(),
  markerById: new Map(),
  sortedByPriority: [],
};

const dom = {};

document.addEventListener("DOMContentLoaded", () => {
  cacheDom();
  initMap();
  wireToggles();
  loadPreparedData();
});

function cacheDom() {
  dom.metricPoints = document.getElementById("metric-points");
  dom.metricRisk = document.getElementById("metric-risk");
  dom.metricPeak = document.getElementById("metric-peak");
  dom.metricConstruction = document.getElementById("metric-construction");
  dom.rankingList = document.getElementById("ranking-list");
  dom.status = document.getElementById("app-status");
  dom.iclStatus = document.getElementById("icl-status");
  dom.sourceList = document.getElementById("source-list");
  dom.focusTitle = document.getElementById("focus-title");
  dom.focusDescription = document.getElementById("focus-description");
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
}

function wireToggles() {
  bindToggle("toggle-heatwave", (checked) => toggleLeafletLayer(state.markerLayer, checked));
  bindToggle("toggle-hazard", (checked) => toggleLeafletLayer(state.bufferLayer, checked));
  bindToggle("toggle-climate", (checked) => toggleRemoteLayer("climate", checked));
  bindToggle("toggle-construction", (checked) => toggleRemoteLayer("construction", checked));
  bindToggle("toggle-blocks", (checked) => toggleRemoteLayer("blocks", checked));
  bindToggle("toggle-parks", (checked) => toggleRemoteLayer("parks", checked));
  bindToggle("toggle-mountains", async (checked) => {
    if (checked) {
      await ensureMountainLayers();
    }
    toggleLeafletLayer(state.mountainLayer, checked);
    toggleLeafletLayer(state.mountainPointLayer, checked);
  });
}

function bindToggle(id, handler) {
  const input = document.getElementById(id);
  if (!input) return;
  input.addEventListener("change", (event) => {
    Promise.resolve(handler(event.target.checked)).catch((error) => {
      console.error(error);
      setStatus("Una capa externa no respondió, pero el análisis local sigue visible.", "warn");
    });
  });
}

function loadPreparedData() {
  const prepared = window.GEOPORTAL_LIMA_DATA;
  if (!prepared || !Array.isArray(prepared.points)) {
    setStatus("No se encontró el dataset local preparado. Ejecuta el generador de análisis.", "error");
    return;
  }

  state.data = prepared;
  state.sortedByPriority = [...prepared.points].sort(
    (a, b) => b.priorityScore - a.priorityScore || b.constructionIndex - a.constructionIndex
  );

  drawAnalysisBuffers();
  drawHeatMarkers();
  drawRankingPins();
  renderSources();
  updateMetrics();
  renderRanking();
  updateFocusCard();
  setStatus(
    `Resultados listos. Se analizaron ${prepared.points.length} puntos con imágenes satelitales locales de ${
      prepared.analysisMethod.imagery
    }.`,
    "ok"
  );

  dom.iclStatus.textContent =
    "Las capas del ICL quedan como apoyo cartográfico. El índice de construcción visible ya fue calculado localmente con recortes satelitales.";
}

function drawAnalysisBuffers() {
  if (!state.data) return;

  state.bufferLayer = L.layerGroup(
    state.data.points.map((point) => {
      const buffer = L.circle([point.lat, point.lon], {
        radius: 320 + point.constructionIndex * 680,
        color: getHazardColor(point.hazardLevel),
        weight: 2,
        opacity: 0.95,
        fillColor: getConstructionColor(point.constructionIndex),
        fillOpacity: 0.24,
      });
      buffer.bindPopup(buildPopupHtml(point));
      return buffer;
    })
  );

  state.bufferLayer.addTo(state.map);
}

function drawHeatMarkers() {
  if (!state.data) return;

  state.markerLayer = L.layerGroup();
  state.markerById.clear();

  state.data.points.forEach((point) => {
    const marker = L.circleMarker([point.lat, point.lon], {
      radius: 6 + point.frequency * 5.5,
      color: "#fff7ee",
      weight: 2,
      fillColor: getFrequencyColor(point.frequency),
      fillOpacity: 0.98,
    });
    marker.bindPopup(buildPopupHtml(point));
    state.markerById.set(point.id, marker);
    state.markerLayer.addLayer(marker);
  });

  state.markerLayer.addTo(state.map);
}

function drawRankingPins() {
  if (!state.data) return;

  state.rankingPinsLayer = L.layerGroup();

  state.sortedByPriority.slice(0, 5).forEach((point, index) => {
    const marker = L.marker([point.lat, point.lon], {
      icon: L.divIcon({
        className: "rank-pin-wrapper",
        html: `<span class="rank-pin rank-${index + 1}">${index + 1}</span>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      }),
    });
    marker.bindPopup(buildPopupHtml(point));
    state.rankingPinsLayer.addLayer(marker);
  });

  state.rankingPinsLayer.addTo(state.map);
}

async function ensureMountainLayers() {
  if (!window.GEOPORTAL_LIMA_MOUNTAINS) {
    await loadScript("data/lima_mountain_zones.js");
  }

  if (!state.mountainLayer) {
    state.mountainLayer = L.geoJSON(window.GEOPORTAL_LIMA_MOUNTAINS, {
      style() {
        return {
          color: "#4d402d",
          weight: 1.2,
          opacity: 0.8,
          fillColor: "#8c7551",
          fillOpacity: 0.16,
        };
      },
      onEachFeature(feature, layerRef) {
        const props = feature.properties || {};
        layerRef.bindPopup(
          `<strong class="popup-title">Zona de montaña</strong><div class="popup-grid"><span><strong>Clase:</strong> ${escapeHtml(
            props.codigo || "Sin código"
          )}</span><span>${escapeHtml(props.descripcion || "Sin descripción")}</span></div>`
        );
      },
    });
  }

  if (!state.mountainPointLayer) {
    const mountainPoints = state.data.points.filter(
      (point) => point.mountainZone || (point.mountainContext && point.mountainContext.length)
    );
    state.mountainPointLayer = L.layerGroup(
      mountainPoints.map((point) => {
        const marker = L.circleMarker([point.lat, point.lon], {
          radius: 9,
          color: "#fdf4e9",
          weight: 2,
          fillColor: "#6f5e48",
          fillOpacity: 0.95,
        });
        marker.bindPopup(buildPopupHtml(point));
        return marker;
      })
    );
  }
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
}

function updateMetrics() {
  const points = state.data.points;
  const mediumPlus = points.filter((point) => HAZARD_ORDER[point.hazardLevel] >= HAZARD_ORDER.Medio).length;
  const peakFrequency = points.reduce((max, point) => Math.max(max, point.frequency), 0);
  const avgConstruction =
    points.reduce((sum, point) => sum + Number(point.constructionIndex || 0), 0) / points.length;

  dom.metricPoints.textContent = String(points.length);
  dom.metricRisk.textContent = String(mediumPlus);
  dom.metricPeak.textContent = peakFrequency.toFixed(1);
  dom.metricConstruction.textContent = avgConstruction.toFixed(2);
}

function renderRanking() {
  dom.rankingList.innerHTML = "";

  state.sortedByPriority.forEach((point, index) => {
    const item = document.createElement("article");
    item.className = "ranking-item";
    item.innerHTML = `
      <div class="ranking-topline">
        <strong>${index + 1}. ${escapeHtml(point.name)}</strong>
        <span class="ranking-score">prioridad ${point.priorityScore.toFixed(2)}</span>
      </div>
      <div class="ranking-meta">
        <span class="ranking-chip">Construcción ${point.constructionIndex.toFixed(2)}</span>
        <span class="ranking-chip">Calor ${point.frequency.toFixed(1)}</span>
        <span class="ranking-chip">Riesgo ${escapeHtml(point.hazardLevel)}</span>
      </div>
      <p class="ranking-text">
        ${escapeHtml(point.heatLabel)} · ${escapeHtml(point.climateDescription)} · ${
          point.mountainZone ? "relación directa con montaña/loma." : "contexto no montañoso en la clasificación puntual."
        }
      </p>
    `;

    item.addEventListener("click", () => focusPoint(point.id));
    dom.rankingList.appendChild(item);
  });
}

function updateFocusCard() {
  const topPriority = state.sortedByPriority[0];
  const topConstruction = [...state.data.points].sort((a, b) => b.constructionIndex - a.constructionIndex)[0];

  dom.focusTitle.textContent = `${topPriority.name} lidera el cruce calor + vulnerabilidad`;
  dom.focusDescription.textContent =
    `${topPriority.name} alcanza prioridad ${topPriority.priorityScore.toFixed(2)}. ` +
    `${topConstruction.name} es el punto con mayor índice constructivo satelital (${topConstruction.constructionIndex.toFixed(
      2
    )}).`;
}

function renderSources() {
  const generatedAt = state.data.generatedAt
    ? new Date(state.data.generatedAt).toLocaleString("es-PE", { timeZone: "America/Lima" })
    : "Sin fecha";

  const methodEntry = {
    label: `Archivo local generado: ${generatedAt}`,
    url: state.data.points[0]?.satelliteSource || SOURCES[2].url,
  };

  dom.sourceList.innerHTML = [...SOURCES, methodEntry]
    .map(
      (source) =>
        `<li><a href="${source.url}" target="_blank" rel="noreferrer">${escapeHtml(source.label)}</a></li>`
    )
    .join("");
}

function focusPoint(pointId) {
  const point = state.data.points.find((entry) => entry.id === pointId);
  const marker = state.markerById.get(pointId);
  if (!point || !marker) return;
  state.map.flyTo([point.lat, point.lon], 12, { duration: 0.7 });
  marker.openPopup();
}

function buildPopupHtml(point) {
  const mountainText =
    point.mountainZone || (point.mountainContext && point.mountainContext.length)
      ? "Sí, ligado a montaña/loma"
      : "No dominante";

  return `
    <div class="popup-card">
      <h3 class="popup-title">${escapeHtml(point.name)}</h3>
      <img class="popup-thumb" src="${point.satelliteThumb}" alt="Recorte satelital de ${escapeHtml(point.name)}">
      <div class="popup-grid">
        <span><strong>Índice constructivo:</strong> ${point.constructionIndex.toFixed(2)} (${escapeHtml(
          point.constructionLabel
        )})</span>
        <span><strong>Frecuencia de calor:</strong> ${point.frequency.toFixed(1)} · ${escapeHtml(
          point.heatLabel
        )}</span>
        <span><strong>Vulnerabilidad:</strong> ${escapeHtml(point.hazardLevel)} (${escapeHtml(
          point.hazardRange
        )})</span>
        <span><strong>Clase climática:</strong> ${escapeHtml(point.climateDescription)}</span>
        <span><strong>Contexto de montaña:</strong> ${escapeHtml(mountainText)}</span>
        <span><strong>Métrica satelital:</strong> impermeable ${point.satelliteMetrics.imperviousRatio.toFixed(
          2
        )}, bordes ${point.satelliteMetrics.edgeRatio.toFixed(2)}</span>
      </div>
    </div>
  `;
}

function loadScript(path) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = path;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`No se pudo cargar ${path}`));
    document.head.appendChild(script);
  });
}

function getFrequencyColor(frequency) {
  if (frequency >= 1.2) return "#c8372d";
  if (frequency >= 0.9) return "#ea7b34";
  if (frequency >= 0.6) return "#efb43e";
  return "#3191c4";
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

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
