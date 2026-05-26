import json
import math
import re
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
OUTPUT_JS = DATA_DIR / "lima_analysis_data.js"
MOUNTAIN_JS = DATA_DIR / "lima_mountain_zones.js"
BOUNDARY_CACHE = DATA_DIR / "ign_lima_region_boundary.geojson"

WORLD_IMAGERY_EXPORT = (
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export"
)
LIMA_BOUNDARY_URL = (
    "https://www.idep.gob.pe/geoportal/rest/services/"
    "DATOS_GEOESPACIALES/L%C3%8DMITES/FeatureServer/3/query"
    "?where=NOMBDEP%3D%27LIMA%27&outFields=*&returnGeometry=true&f=geojson"
)

HEATWAVE_FILE = DATA_DIR / "senamhi_heatwave_frequency_lima.geojson"
HAZARD_FILE = DATA_DIR / "senamhi_climate_multi_hazard_lima.geojson"
MOUNTAIN_FILE = DATA_DIR / "senamhi_mountain_zones_lima.geojson"
CLIMATE_FILE = DATA_DIR / "senamhi_climate_classification_lima.geojson"

GRID_SPACING_KM = 16.0
IMAGE_SIZE = 224
ANALYSIS_RADIUS_KM = 0.65
WORKERS = 4

HAZARD_SCORE = {
    "Bajo": 0.25,
    "Medio": 0.5,
    "Alto": 0.75,
    "Muy Alto": 1.0,
}


def decode_text(value):
    if not isinstance(value, str):
        return value
    decoded = value
    for _ in range(2):
        try:
            candidate = decoded.encode("latin1").decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            break
        if candidate == decoded:
            break
        decoded = candidate
    return (
        decoded.replace("Ã", "Ñ")
        .replace("Ã°", "ñ")
        .replace("Ãƒâ€˜", "Ñ")
        .replace("ÃƒÂ±", "ñ")
        .replace("Ð", "Ñ")
        .replace("ð", "ñ")
    )


def slugify(value):
    lowered = decode_text(value).lower()
    cleaned = re.sub(r"[^a-z0-9]+", "-", lowered)
    return cleaned.strip("-") or "item"


def load_geojson(path):
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def load_or_fetch_geojson(cache_path, url):
    if cache_path.exists():
        return load_geojson(cache_path)

    request = urllib.request.Request(url, headers={"User-Agent": "GeoportalLima/2.0"})
    with urllib.request.urlopen(request, timeout=90) as response:
        payload = response.read()
    cache_path.write_bytes(payload)
    return json.loads(payload.decode("utf-8"))


def walk_coords(coords, collector):
    if isinstance(coords[0], (int, float)):
        collector(coords[0], coords[1])
        return
    for item in coords:
        walk_coords(item, collector)


def geometry_bounds(geometry):
    xs = []
    ys = []

    def collect(x, y):
        xs.append(x)
        ys.append(y)

    walk_coords(geometry["coordinates"], collect)
    return min(xs), min(ys), max(xs), max(ys)


def point_in_ring(point, ring):
    x, y = point
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        crosses = ((yi > y) != (yj > y)) and (
            x < ((xj - xi) * (y - yi)) / ((yj - yi) or 1e-12) + xi
        )
        if crosses:
            inside = not inside
        j = i
    return inside


def point_in_polygon(point, polygon_rings):
    if not polygon_rings:
        return False
    if not point_in_ring(point, polygon_rings[0]):
        return False
    for hole in polygon_rings[1:]:
        if point_in_ring(point, hole):
            return False
    return True


def point_in_feature(point, feature):
    geometry = feature.get("geometry") or {}
    coordinates = geometry.get("coordinates")
    geometry_type = geometry.get("type")
    if geometry_type == "Polygon":
        return point_in_polygon(point, coordinates)
    if geometry_type == "MultiPolygon":
        return any(point_in_polygon(point, polygon) for polygon in coordinates)
    return False


def feature_bbox(feature):
    min_x, min_y, max_x, max_y = geometry_bounds(feature["geometry"])
    return {
        "minX": min_x,
        "minY": min_y,
        "maxX": max_x,
        "maxY": max_y,
    }


def haversine_km(lat1, lon1, lat2, lon2):
    radius = 6371.0088
    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)
    a = (
        math.sin(d_lat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(d_lon / 2) ** 2
    )
    return 2 * radius * math.asin(math.sqrt(a))


def find_hazard(point, features):
    for feature in features:
        if point_in_feature(point, feature):
            props = feature.get("properties", {})
            return {
                "level": decode_text(props.get("nivel", "Sin dato")),
                "range": decode_text(props.get("rango", "Sin dato")),
            }
    return {"level": "Sin dato", "range": "No intersecta"}


def find_mountain_context(point, features):
    matches = []
    for feature in features:
        if point_in_feature(point, feature):
            props = feature.get("properties", {})
            matches.append(
                {
                    "code": decode_text(props.get("codigo", "Sin codigo")),
                    "description": decode_text(props.get("descripcion", "Sin descripcion")),
                }
            )
    return matches


def find_climate_context(point, features):
    for feature in features:
        if point_in_feature(point, feature):
            props = feature.get("properties", {})
            description = decode_text(props.get("descripcion", "Sin descripcion"))
            code = decode_text(props.get("codigo", "Sin codigo"))
            is_mountain = bool(
                re.search(r"Frio|Frío|Semifrigido|Semifrígido|Hielo|Glaciar|Loma", description, re.IGNORECASE)
            ) or bool(re.search(r"Glaciar|Loma", code, re.IGNORECASE))
            return {
                "code": code,
                "description": description,
                "isMountain": is_mountain,
            }
    return {
        "code": "Sin codigo",
        "description": "Sin clasificacion climatica puntual",
        "isMountain": False,
    }


def imagery_bbox(lon, lat, radius_km=ANALYSIS_RADIUS_KM):
    lat_delta = radius_km / 110.574
    lon_delta = radius_km / (111.320 * max(math.cos(math.radians(lat)), 0.2))
    return (
        lon - lon_delta,
        lat - lat_delta,
        lon + lon_delta,
        lat + lat_delta,
    )


def imagery_export_url(lon, lat, radius_km=ANALYSIS_RADIUS_KM, size=IMAGE_SIZE):
    bbox = imagery_bbox(lon, lat, radius_km=radius_km)
    params = {
        "bbox": ",".join(f"{value:.8f}" for value in bbox),
        "bboxSR": "4326",
        "imageSR": "4326",
        "size": f"{size},{size}",
        "format": "png32",
        "transparent": "false",
        "f": "image",
    }
    return f"{WORLD_IMAGERY_EXPORT}?{urllib.parse.urlencode(params)}"


def fetch_satellite_png(lon, lat, size=IMAGE_SIZE, radius_km=ANALYSIS_RADIUS_KM):
    url = imagery_export_url(lon, lat, radius_km=radius_km, size=size)
    request = urllib.request.Request(url, headers={"User-Agent": "GeoportalLima/2.0"})
    with urllib.request.urlopen(request, timeout=60) as response:
        payload = response.read()
    return payload, url


def analyze_satellite(payload):
    image = Image.open(BytesIO(payload)).convert("RGB")
    width, height = image.size
    pixels = image.load()
    center_x = width / 2
    center_y = height / 2
    radius = min(width, height) * 0.44
    radius_sq = radius * radius

    land_samples = 0
    impervious_count = 0
    vegetation_count = 0
    water_shadow_count = 0
    bare_soil_count = 0
    gray_count = 0
    edge_count = 0
    edge_samples = 0

    for y in range(1, height - 1, 2):
        for x in range(1, width - 1, 2):
            dx = x - center_x
            dy = y - center_y
            if dx * dx + dy * dy > radius_sq:
                continue

            r, g, b = pixels[x, y]
            brightness = (r + g + b) / 3.0
            spread = max(r, g, b) - min(r, g, b)
            saturation = 0 if max(r, g, b) == 0 else spread / max(r, g, b)
            exg = 2 * g - r - b

            vegetation = exg > 24 and g > r and g > b
            water_shadow = brightness < 42 or (b > r + 18 and b > g + 10 and brightness < 135)
            bare_soil = saturation > 0.24 and r > g + 12 and brightness > 95 and exg < 10

            if vegetation:
                vegetation_count += 1
                continue

            if water_shadow:
                water_shadow_count += 1
                continue

            land_samples += 1

            gray_like = spread < 36
            bright_compact = brightness > 88 and saturation < 0.22
            reflective_roof = brightness > 142 and spread < 60 and saturation < 0.30
            impervious = (gray_like and brightness > 72) or bright_compact or reflective_roof

            if gray_like:
                gray_count += 1

            if bare_soil:
                bare_soil_count += 1
                impervious = False

            if impervious:
                impervious_count += 1

            r2, g2, b2 = pixels[x + 1, y]
            r3, g3, b3 = pixels[x, y + 1]
            lum = 0.299 * r + 0.587 * g + 0.114 * b
            lum_right = 0.299 * r2 + 0.587 * g2 + 0.114 * b2
            lum_down = 0.299 * r3 + 0.587 * g3 + 0.114 * b3
            contrast = (abs(lum - lum_right) + abs(lum - lum_down)) / 2.0
            edge_samples += 1
            if contrast > 18:
                edge_count += 1

    land_samples = max(land_samples, 1)
    edge_samples = max(edge_samples, 1)
    impervious_ratio = impervious_count / land_samples
    vegetation_ratio = vegetation_count / max(1, vegetation_count + land_samples + water_shadow_count)
    bare_soil_ratio = bare_soil_count / land_samples
    gray_ratio = gray_count / land_samples
    edge_ratio = edge_count / edge_samples
    edge_norm = min(max((edge_ratio - 0.09) / 0.28, 0), 1)

    raw_score = 0.55 * impervious_ratio + 0.30 * edge_norm + 0.15 * gray_ratio
    penalized_score = raw_score - 0.18 * bare_soil_ratio + 0.05 * (1 - vegetation_ratio)
    construction_index = max(0.0, min(1.0, penalized_score))

    return {
        "constructionIndex": round(construction_index, 3),
        "imperviousRatio": round(impervious_ratio, 3),
        "edgeRatio": round(edge_ratio, 3),
        "vegetationRatio": round(vegetation_ratio, 3),
        "bareSoilRatio": round(bare_soil_ratio, 3),
        "grayRatio": round(gray_ratio, 3),
    }


def construction_label(score):
    if score >= 0.72:
        return "Muy alto"
    if score >= 0.52:
        return "Alto"
    if score >= 0.32:
        return "Medio"
    return "Bajo"


def heat_label(frequency):
    if frequency >= 1.2:
        return "Muy alta"
    if frequency >= 0.9:
        return "Alta"
    if frequency >= 0.6:
        return "Media"
    return "Baja"


def priority_score(heat_frequency, hazard_level, construction_index):
    heat_score = min(max(heat_frequency / 1.35, 0), 1)
    hazard_score = HAZARD_SCORE.get(hazard_level, 0)
    value = 0.4 * heat_score + 0.3 * hazard_score + 0.3 * construction_index
    return round(value, 3)


def interpolate_heat(lon, lat, stations):
    weighted_sum = 0.0
    total_weight = 0.0
    distances = []

    for station in stations:
        distance = haversine_km(lat, lon, station["lat"], station["lon"])
        distances.append((distance, station))
        if distance < 0.8:
            return {
                "frequency": station["frequency"],
                "label": heat_label(station["frequency"]),
                "nearestStation": station["name"],
                "nearestDistanceKm": round(distance, 1),
                "contributors": [station["name"]],
            }
        weight = 1.0 / ((distance + 1.5) ** 2.1)
        weighted_sum += station["frequency"] * weight
        total_weight += weight

    distances.sort(key=lambda item: item[0])
    value = weighted_sum / max(total_weight, 1e-9)
    return {
        "frequency": round(value, 3),
        "label": heat_label(value),
        "nearestStation": distances[0][1]["name"],
        "nearestDistanceKm": round(distances[0][0], 1),
        "contributors": [entry[1]["name"] for entry in distances[:3]],
    }


def station_preview(feature):
    lon, lat = feature["geometry"]["coordinates"]
    return imagery_export_url(lon, lat, radius_km=ANALYSIS_RADIUS_KM, size=IMAGE_SIZE)


def build_station_seed(feature):
    props = feature["properties"]
    lon, lat = feature["geometry"]["coordinates"]
    name = decode_text(props.get("nombre", "Estacion"))
    return {
        "id": f"station-{props.get('cod_anteri', slugify(name))}",
        "name": name,
        "department": decode_text(props.get("departamen", "LIMA")),
        "lat": round(lat, 6),
        "lon": round(lon, 6),
        "frequency": round(float(props.get("frecuencia", 0)), 3),
        "eventCount": int(props.get("conteo_eve", 0)),
        "summerDays": int(props.get("sum_dias_o", 0)),
        "heatCategory": decode_text(props.get("cat_frecue", "Sin dato")),
        "heatLabel": decode_text(props.get("categoria", "Sin dato")),
        "type": decode_text(props.get("tipo", "Sin dato")),
        "satellitePreview": station_preview(feature),
    }


def grid_cells(boundary_feature, spacing_km=GRID_SPACING_KM):
    bbox = feature_bbox(boundary_feature)
    lat_step = spacing_km / 110.574
    cells = []
    row = 0
    lat = bbox["minY"] + lat_step / 2

    while lat <= bbox["maxY"] - lat_step / 2:
        row += 1
        lon_step = spacing_km / (111.320 * max(math.cos(math.radians(lat)), 0.2))
        col = 0
        lon = bbox["minX"] + lon_step / 2
        while lon <= bbox["maxX"] - lon_step / 2:
            if point_in_feature((lon, lat), boundary_feature):
                col += 1
                half_lon = lon_step / 2
                half_lat = lat_step / 2
                ring = [
                    [round(lon - half_lon, 6), round(lat - half_lat, 6)],
                    [round(lon + half_lon, 6), round(lat - half_lat, 6)],
                    [round(lon + half_lon, 6), round(lat + half_lat, 6)],
                    [round(lon - half_lon, 6), round(lat + half_lat, 6)],
                    [round(lon - half_lon, 6), round(lat - half_lat, 6)],
                ]
                cells.append(
                    {
                        "id": f"cell-{len(cells) + 1:03d}",
                        "name": f"Sector regional {len(cells) + 1:03d}",
                        "row": row,
                        "col": col,
                        "lat": round(lat, 6),
                        "lon": round(lon, 6),
                        "geometry": {
                            "type": "Polygon",
                            "coordinates": [ring],
                        },
                    }
                )
            lon += lon_step
        lat += lat_step

    return cells


def enrich_station(station_seed, hazard_features, climate_features, mountain_features):
    payload, preview_url = fetch_satellite_png(station_seed["lon"], station_seed["lat"])
    metrics = analyze_satellite(payload)
    hazard_info = find_hazard((station_seed["lon"], station_seed["lat"]), hazard_features)
    climate_context = find_climate_context((station_seed["lon"], station_seed["lat"]), climate_features)
    mountain_context = find_mountain_context((station_seed["lon"], station_seed["lat"]), mountain_features)

    station_seed["hazardLevel"] = hazard_info["level"]
    station_seed["hazardRange"] = hazard_info["range"]
    station_seed["climateCode"] = climate_context["code"]
    station_seed["climateDescription"] = climate_context["description"]
    station_seed["mountainZone"] = climate_context["isMountain"]
    station_seed["mountainContext"] = mountain_context
    station_seed["constructionIndex"] = metrics["constructionIndex"]
    station_seed["constructionLabel"] = construction_label(metrics["constructionIndex"])
    station_seed["satelliteMetrics"] = metrics
    station_seed["satellitePreview"] = preview_url
    station_seed["priorityScore"] = priority_score(
        station_seed["frequency"],
        station_seed["hazardLevel"],
        station_seed["constructionIndex"],
    )
    return station_seed


def enrich_cell(cell_seed, stations, hazard_features, climate_features, mountain_features):
    payload, preview_url = fetch_satellite_png(cell_seed["lon"], cell_seed["lat"])
    metrics = analyze_satellite(payload)
    heat_info = interpolate_heat(cell_seed["lon"], cell_seed["lat"], stations)
    hazard_info = find_hazard((cell_seed["lon"], cell_seed["lat"]), hazard_features)
    climate_context = find_climate_context((cell_seed["lon"], cell_seed["lat"]), climate_features)
    mountain_context = find_mountain_context((cell_seed["lon"], cell_seed["lat"]), mountain_features)

    cell_seed["nearestStation"] = heat_info["nearestStation"]
    cell_seed["nearestStationDistanceKm"] = heat_info["nearestDistanceKm"]
    cell_seed["heatContributors"] = heat_info["contributors"]
    cell_seed["frequency"] = heat_info["frequency"]
    cell_seed["heatLabel"] = heat_info["label"]
    cell_seed["hazardLevel"] = hazard_info["level"]
    cell_seed["hazardRange"] = hazard_info["range"]
    cell_seed["climateCode"] = climate_context["code"]
    cell_seed["climateDescription"] = climate_context["description"]
    cell_seed["mountainZone"] = climate_context["isMountain"]
    cell_seed["mountainContext"] = mountain_context
    cell_seed["constructionIndex"] = metrics["constructionIndex"]
    cell_seed["constructionLabel"] = construction_label(metrics["constructionIndex"])
    cell_seed["satelliteMetrics"] = metrics
    cell_seed["satellitePreview"] = preview_url
    cell_seed["priorityScore"] = priority_score(
        cell_seed["frequency"],
        cell_seed["hazardLevel"],
        cell_seed["constructionIndex"],
    )
    return cell_seed


def run_parallel(items, fn, workers=WORKERS):
    results = []
    with ThreadPoolExecutor(max_workers=workers) as executor:
        future_map = {executor.submit(fn, item): item for item in items}
        for future in as_completed(future_map):
            results.append(future.result())
    return results


def make_boundary_payload(boundary_feature):
    props = boundary_feature.get("properties", {})
    return {
        "type": "Feature",
        "properties": {
            "name": decode_text(props.get("NOMBDEP", "LIMA")),
            "code": decode_text(props.get("CCDD", "15")),
            "source": decode_text(props.get("FUENTE", "IGN")),
        },
        "geometry": boundary_feature["geometry"],
    }


def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    boundary_geojson = load_or_fetch_geojson(BOUNDARY_CACHE, LIMA_BOUNDARY_URL)
    boundary_feature = boundary_geojson["features"][0]
    heatwave = load_geojson(HEATWAVE_FILE)
    hazard = load_geojson(HAZARD_FILE)
    mountains = load_geojson(MOUNTAIN_FILE)
    climate = load_geojson(CLIMATE_FILE)

    station_seeds = [build_station_seed(feature) for feature in heatwave["features"]]
    stations = run_parallel(
        station_seeds,
        lambda seed: enrich_station(
            seed,
            hazard["features"],
            climate["features"],
            mountains["features"],
        ),
    )
    stations.sort(key=lambda item: item["name"])

    cell_seeds = grid_cells(boundary_feature)
    cells = run_parallel(
        cell_seeds,
        lambda seed: enrich_cell(
            seed,
            stations,
            hazard["features"],
            climate["features"],
            mountains["features"],
        ),
    )
    cells.sort(key=lambda item: item["id"])

    ranked_cells = sorted(
        cells,
        key=lambda item: (-item["priorityScore"], -item["constructionIndex"], -item["frequency"]),
    )

    output = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "analysisMethod": {
            "imagery": "Esri World Imagery export",
            "windowRadiusKm": ANALYSIS_RADIUS_KM,
            "sizePx": IMAGE_SIZE,
            "gridSpacingKm": GRID_SPACING_KM,
            "heatInterpolation": "IDW sobre estaciones SENAMHI de Lima",
            "rule": (
                "Construccion estimada por combinacion local de superficie impermeable, "
                "textura y tonos grises, con penalizacion por suelo desnudo."
            ),
        },
        "region": {
            "name": "Region Lima",
            "sourceLabel": "IGN - Limite departamental oficial",
            "sourceUrl": LIMA_BOUNDARY_URL,
            "boundary": make_boundary_payload(boundary_feature),
        },
        "stations": stations,
        "points": stations,
        "cells": cells,
        "topCells": ranked_cells[:12],
    }

    OUTPUT_JS.write_text(
        f"window.GEOPORTAL_LIMA_DATA = {json.dumps(output, ensure_ascii=False)};\n",
        encoding="utf-8",
    )

    mountain_payload = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {
                    "id": cell["id"],
                    "codigo": cell["climateCode"],
                    "descripcion": cell["climateDescription"],
                    "priorityScore": cell["priorityScore"],
                    "constructionIndex": cell["constructionIndex"],
                },
                "geometry": cell["geometry"],
            }
            for cell in cells
            if cell["mountainZone"]
        ],
    }
    MOUNTAIN_JS.write_text(
        f"window.GEOPORTAL_LIMA_MOUNTAINS = {json.dumps(mountain_payload, ensure_ascii=False)};\n",
        encoding="utf-8",
    )

    print(f"Generated {OUTPUT_JS}")
    print(f"Generated {MOUNTAIN_JS}")
    print(f"Stations analyzed: {len(stations)}")
    print(f"Regional cells analyzed: {len(cells)}")


if __name__ == "__main__":
    main()
