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
POWER_CACHE = DATA_DIR / "nasa_power_summer_cache.json"

SENTINEL2_IMAGE_SERVER = "https://sentinel.arcgis.com/arcgis/rest/services/Sentinel2/ImageServer"
SENTINEL2_EXPORT = f"{SENTINEL2_IMAGE_SERVER}/exportImage"
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
POWER_COMMUNITY = "SB"
POWER_GRID_DEGREES = 0.5
POWER_SUMMER_MONTHS = ("DEC", "JAN", "FEB", "MAR")
POWER_CLIMATOLOGY_URL = "https://power.larc.nasa.gov/api/temporal/climatology/point"
POWER_PARAMETERS = ("T2M_MAX", "RH2M", "WS2M", "TS")

SENTINEL_NATURAL_COLOR = {"rasterFunction": "Natural Color with DRA"}
SENTINEL_NDBI = {"rasterFunction": "Normalized Difference Built-Up Index (NDBI)"}
SENTINEL_NDVI = {"rasterFunction": "NDVI Raw"}
SENTINEL_NDWI = {"rasterFunction": "NDWI Raw"}

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


def load_json_cache(path):
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def save_json_cache(path, payload):
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


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


def imagery_export_url(
    lon,
    lat,
    radius_km=ANALYSIS_RADIUS_KM,
    size=IMAGE_SIZE,
    image_format="png32",
    pixel_type=None,
    rendering_rule=None,
):
    bbox = imagery_bbox(lon, lat, radius_km=radius_km)
    params = {
        "bbox": ",".join(f"{value:.8f}" for value in bbox),
        "bboxSR": "4326",
        "imageSR": "4326",
        "size": f"{size},{size}",
        "format": image_format,
        "transparent": "false",
        "f": "image",
    }
    if pixel_type:
        params["pixelType"] = pixel_type
    if rendering_rule:
        params["renderingRule"] = json.dumps(rendering_rule, separators=(",", ":"))
    return f"{SENTINEL2_EXPORT}?{urllib.parse.urlencode(params)}"


def fetch_remote_bytes(url, timeout=60):
    request = urllib.request.Request(url, headers={"User-Agent": "GeoportalLima/2.0"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def clamp(value, minimum=0.0, maximum=1.0):
    return max(minimum, min(maximum, value))


def seasonal_average(month_values, months=POWER_SUMMER_MONTHS):
    values = []
    for month in months:
        value = month_values.get(month)
        if value is None:
            continue
        value = float(value)
        if not math.isfinite(value) or value <= -999:
            continue
        values.append(value)
    if not values:
        return None
    return round(sum(values) / len(values), 3)


def round_power_grid(value):
    return round(round(value / POWER_GRID_DEGREES) * POWER_GRID_DEGREES, 3)


def power_cache_key(lon, lat):
    return f"{round_power_grid(lat):.3f},{round_power_grid(lon):.3f}"


def fetch_power_climatology(lon, lat):
    params = {
        "parameters": ",".join(POWER_PARAMETERS),
        "community": POWER_COMMUNITY,
        "longitude": round_power_grid(lon),
        "latitude": round_power_grid(lat),
        "format": "JSON",
    }
    url = f"{POWER_CLIMATOLOGY_URL}?{urllib.parse.urlencode(params)}"
    payload = json.loads(fetch_remote_bytes(url, timeout=45).decode("utf-8"))
    parameter_root = payload["properties"]["parameter"]
    return {
        "gridLat": round_power_grid(lat),
        "gridLon": round_power_grid(lon),
        "range": payload["header"].get("range", ""),
        "airTempMaxC": seasonal_average(parameter_root["T2M_MAX"]),
        "relativeHumidity": seasonal_average(parameter_root["RH2M"]),
        "windSpeedMs": seasonal_average(parameter_root["WS2M"]),
        "earthSkinTempC": seasonal_average(parameter_root["TS"]),
        "months": list(POWER_SUMMER_MONTHS),
    }


def prefetch_power_metrics(points):
    cache = load_json_cache(POWER_CACHE)
    pending = {}

    for point in points:
        key = power_cache_key(point["lon"], point["lat"])
        if key not in cache:
            pending[key] = (point["lon"], point["lat"])

    if pending:
        with ThreadPoolExecutor(max_workers=min(6, len(pending))) as executor:
            future_map = {
                executor.submit(fetch_power_climatology, lon, lat): key
                for key, (lon, lat) in pending.items()
            }
            for future in as_completed(future_map):
                cache[future_map[future]] = future.result()
        save_json_cache(POWER_CACHE, cache)

    return cache


def get_power_metrics(lon, lat, power_cache):
    key = power_cache_key(lon, lat)
    return dict(power_cache[key])


def fetch_sentinel_index_raster(
    lon,
    lat,
    rendering_rule,
    size=IMAGE_SIZE,
    radius_km=ANALYSIS_RADIUS_KM,
):
    url = imagery_export_url(
        lon,
        lat,
        radius_km=radius_km,
        size=size,
        image_format="tiff",
        pixel_type="F32",
        rendering_rule=rendering_rule,
    )
    return fetch_remote_bytes(url)


def sentinel_preview_url(lon, lat, size=IMAGE_SIZE, radius_km=ANALYSIS_RADIUS_KM):
    return imagery_export_url(
        lon,
        lat,
        radius_km=radius_km,
        size=size,
        image_format="png32",
        rendering_rule=SENTINEL_NATURAL_COLOR,
    )


def read_single_band_float_image(payload):
    image = Image.open(BytesIO(payload))
    if image.mode != "F":
        image = image.convert("F")
    return image


def analyze_satellite(ndbi_payload, ndvi_payload, ndwi_payload):
    ndbi_image = read_single_band_float_image(ndbi_payload)
    ndvi_image = read_single_band_float_image(ndvi_payload)
    ndwi_image = read_single_band_float_image(ndwi_payload)

    width, height = ndbi_image.size
    if ndvi_image.size != (width, height) or ndwi_image.size != (width, height):
        raise ValueError("Sentinel-2 rasters do not share the same dimensions")

    ndbi_pixels = ndbi_image.load()
    ndvi_pixels = ndvi_image.load()
    ndwi_pixels = ndwi_image.load()
    center_x = width / 2
    center_y = height / 2
    radius = min(width, height) * 0.44
    radius_sq = radius * radius

    valid_samples = 0
    analysis_samples = 0
    positive_count = 0
    built_up_count = 0
    dense_built_count = 0
    vegetation_mask_count = 0
    water_mask_count = 0
    neutral_count = 0
    ndbi_sum = 0.0
    positive_ndbi_sum = 0.0

    for y in range(1, height - 1, 2):
        for x in range(1, width - 1, 2):
            dx = x - center_x
            dy = y - center_y
            if dx * dx + dy * dy > radius_sq:
                continue

            ndbi = float(ndbi_pixels[x, y])
            ndvi = float(ndvi_pixels[x, y])
            ndwi = float(ndwi_pixels[x, y])

            if not (
                math.isfinite(ndbi)
                and math.isfinite(ndvi)
                and math.isfinite(ndwi)
                and -1.25 <= ndbi <= 1.25
                and -1.25 <= ndvi <= 1.25
                and -1.25 <= ndwi <= 1.25
            ):
                continue

            valid_samples += 1
            ndbi_sum += ndbi

            vegetation = ndvi >= 0.22 and ndvi > ndbi
            water = ndwi >= 0.12 and ndwi > ndbi

            if vegetation:
                vegetation_mask_count += 1
                continue

            if water:
                water_mask_count += 1
                continue

            analysis_samples += 1

            if ndbi >= 0:
                positive_count += 1
                positive_ndbi_sum += ndbi

            if -0.02 <= ndbi < 0.10:
                neutral_count += 1

            if ndbi >= 0.05:
                built_up_count += 1
            if ndbi >= 0.18:
                dense_built_count += 1

    valid_samples = max(valid_samples, 1)
    analysis_samples = max(analysis_samples, 1)
    ndbi_mean = ndbi_sum / valid_samples
    positive_ndbi_mean = positive_ndbi_sum / positive_count if positive_count else 0.0
    positive_ratio = positive_count / analysis_samples
    built_up_ratio = built_up_count / analysis_samples
    dense_built_ratio = dense_built_count / analysis_samples
    vegetation_mask_ratio = vegetation_mask_count / valid_samples
    water_mask_ratio = water_mask_count / valid_samples
    neutral_ratio = neutral_count / analysis_samples
    positive_ndbi_norm = min(max((positive_ndbi_mean - 0.05) / 0.30, 0), 1)

    raw_score = (
        0.45 * built_up_ratio
        + 0.25 * dense_built_ratio
        + 0.20 * positive_ndbi_norm
        + 0.10 * positive_ratio
    )
    penalized_score = raw_score - 0.12 * neutral_ratio
    construction_index = max(0.0, min(1.0, penalized_score))

    return {
        "constructionIndex": round(construction_index, 3),
        "ndbiMean": round(ndbi_mean, 3),
        "positiveNdbiMean": round(positive_ndbi_mean, 3),
        "positiveRatio": round(positive_ratio, 3),
        "builtUpRatio": round(built_up_ratio, 3),
        "denseBuiltRatio": round(dense_built_ratio, 3),
        "vegetationMaskRatio": round(vegetation_mask_ratio, 3),
        "waterMaskRatio": round(water_mask_ratio, 3),
        "neutralRatio": round(neutral_ratio, 3),
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


def thermal_label(score):
    if score >= 0.72:
        return "Muy alta"
    if score >= 0.54:
        return "Alta"
    if score >= 0.36:
        return "Media"
    return "Baja"


def vapor_pressure_hpa(temp_c, relative_humidity):
    return (relative_humidity / 100.0) * 6.105 * math.exp((17.27 * temp_c) / (237.7 + temp_c))


def apparent_temperature_c(temp_c, relative_humidity, wind_speed_ms):
    vapor_pressure = vapor_pressure_hpa(temp_c, relative_humidity)
    return temp_c + 0.33 * vapor_pressure - 0.70 * wind_speed_ms - 4.0


def surface_adjustment_c(satellite_metrics):
    urban_heat = (
        4.6 * satellite_metrics["builtUpRatio"]
        + 2.4 * satellite_metrics["denseBuiltRatio"]
        + 1.8 * max(satellite_metrics["positiveNdbiMean"], 0.0)
    )
    cooling = (
        3.8 * satellite_metrics["vegetationMaskRatio"]
        + 1.4 * satellite_metrics["waterMaskRatio"]
        + 0.8 * satellite_metrics["neutralRatio"]
    )
    return round(max(-2.5, min(6.5, urban_heat - cooling - 0.9)), 3)


def build_thermal_metrics(frequency, satellite_metrics, power_metrics):
    air_temp_max_c = float(power_metrics["airTempMaxC"])
    relative_humidity = float(power_metrics["relativeHumidity"])
    wind_speed_ms = float(power_metrics["windSpeedMs"])
    earth_skin_temp_c = float(power_metrics["earthSkinTempC"])
    surface_delta_c = surface_adjustment_c(satellite_metrics)
    surface_temp_c = earth_skin_temp_c + surface_delta_c
    apparent_temp = apparent_temperature_c(air_temp_max_c, relative_humidity, wind_speed_ms)
    hybrid_temp_c = apparent_temp + 0.2 * surface_delta_c

    frequency_score = clamp(frequency / 1.35, 0.0, 1.0)
    apparent_score = clamp((apparent_temp - 24.0) / 10.0, 0.0, 1.0)
    surface_score = clamp((surface_temp_c - 20.0) / 10.0, 0.0, 1.0)
    hybrid_index = clamp(
        0.55 * frequency_score + 0.25 * apparent_score + 0.20 * surface_score,
        0.0,
        1.0,
    )

    return {
        "frequencyScore": round(frequency_score, 3),
        "apparentScore": round(apparent_score, 3),
        "surfaceScore": round(surface_score, 3),
        "airTempMaxC": round(air_temp_max_c, 2),
        "relativeHumidity": round(relative_humidity, 2),
        "windSpeedMs": round(wind_speed_ms, 2),
        "earthSkinTempC": round(earth_skin_temp_c, 2),
        "surfaceAdjustmentC": round(surface_delta_c, 2),
        "surfaceTempC": round(surface_temp_c, 2),
        "apparentTempC": round(apparent_temp, 2),
        "hybridTempC": round(hybrid_temp_c, 2),
        "hybridHeatIndex": round(hybrid_index, 3),
        "hybridHeatLabel": thermal_label(hybrid_index),
        "powerRange": power_metrics["range"],
        "powerMonths": list(power_metrics["months"]),
        "powerGrid": {
            "lat": round(power_metrics["gridLat"], 3),
            "lon": round(power_metrics["gridLon"], 3),
        },
    }


def priority_score(thermal_index, hazard_level, construction_index):
    hazard_score = HAZARD_SCORE.get(hazard_level, 0)
    value = 0.4 * thermal_index + 0.3 * hazard_score + 0.3 * construction_index
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
    return sentinel_preview_url(lon, lat, radius_km=ANALYSIS_RADIUS_KM, size=IMAGE_SIZE)


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


def enrich_station(station_seed, hazard_features, climate_features, mountain_features, power_cache):
    preview_url = sentinel_preview_url(station_seed["lon"], station_seed["lat"])
    metrics = analyze_satellite(
        fetch_sentinel_index_raster(station_seed["lon"], station_seed["lat"], SENTINEL_NDBI),
        fetch_sentinel_index_raster(station_seed["lon"], station_seed["lat"], SENTINEL_NDVI),
        fetch_sentinel_index_raster(station_seed["lon"], station_seed["lat"], SENTINEL_NDWI),
    )
    power_metrics = get_power_metrics(station_seed["lon"], station_seed["lat"], power_cache)
    thermal_metrics = build_thermal_metrics(station_seed["frequency"], metrics, power_metrics)
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
    station_seed["thermalMetrics"] = thermal_metrics
    station_seed["hybridHeatIndex"] = thermal_metrics["hybridHeatIndex"]
    station_seed["hybridHeatLabel"] = thermal_metrics["hybridHeatLabel"]
    station_seed["hybridTempC"] = thermal_metrics["hybridTempC"]
    station_seed["apparentTempC"] = thermal_metrics["apparentTempC"]
    station_seed["surfaceTempC"] = thermal_metrics["surfaceTempC"]
    station_seed["airTempMaxC"] = thermal_metrics["airTempMaxC"]
    station_seed["relativeHumidity"] = thermal_metrics["relativeHumidity"]
    station_seed["windSpeedMs"] = thermal_metrics["windSpeedMs"]
    station_seed["earthSkinTempC"] = thermal_metrics["earthSkinTempC"]
    station_seed["surfaceAdjustmentC"] = thermal_metrics["surfaceAdjustmentC"]
    station_seed["satellitePreview"] = preview_url
    station_seed["priorityScore"] = priority_score(
        station_seed["hybridHeatIndex"],
        station_seed["hazardLevel"],
        station_seed["constructionIndex"],
    )
    return station_seed


def enrich_cell(cell_seed, stations, hazard_features, climate_features, mountain_features, power_cache):
    preview_url = sentinel_preview_url(cell_seed["lon"], cell_seed["lat"])
    metrics = analyze_satellite(
        fetch_sentinel_index_raster(cell_seed["lon"], cell_seed["lat"], SENTINEL_NDBI),
        fetch_sentinel_index_raster(cell_seed["lon"], cell_seed["lat"], SENTINEL_NDVI),
        fetch_sentinel_index_raster(cell_seed["lon"], cell_seed["lat"], SENTINEL_NDWI),
    )
    heat_info = interpolate_heat(cell_seed["lon"], cell_seed["lat"], stations)
    power_metrics = get_power_metrics(cell_seed["lon"], cell_seed["lat"], power_cache)
    thermal_metrics = build_thermal_metrics(heat_info["frequency"], metrics, power_metrics)
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
    cell_seed["thermalMetrics"] = thermal_metrics
    cell_seed["hybridHeatIndex"] = thermal_metrics["hybridHeatIndex"]
    cell_seed["hybridHeatLabel"] = thermal_metrics["hybridHeatLabel"]
    cell_seed["hybridTempC"] = thermal_metrics["hybridTempC"]
    cell_seed["apparentTempC"] = thermal_metrics["apparentTempC"]
    cell_seed["surfaceTempC"] = thermal_metrics["surfaceTempC"]
    cell_seed["airTempMaxC"] = thermal_metrics["airTempMaxC"]
    cell_seed["relativeHumidity"] = thermal_metrics["relativeHumidity"]
    cell_seed["windSpeedMs"] = thermal_metrics["windSpeedMs"]
    cell_seed["earthSkinTempC"] = thermal_metrics["earthSkinTempC"]
    cell_seed["surfaceAdjustmentC"] = thermal_metrics["surfaceAdjustmentC"]
    cell_seed["satellitePreview"] = preview_url
    cell_seed["priorityScore"] = priority_score(
        cell_seed["hybridHeatIndex"],
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
    cell_seeds = grid_cells(boundary_feature)
    power_cache = prefetch_power_metrics(station_seeds + cell_seeds)

    stations = run_parallel(
        station_seeds,
        lambda seed: enrich_station(
            seed,
            hazard["features"],
            climate["features"],
            mountains["features"],
            power_cache,
        ),
    )
    stations.sort(key=lambda item: item["name"])

    cells = run_parallel(
        cell_seeds,
        lambda seed: enrich_cell(
            seed,
            stations,
            hazard["features"],
            climate["features"],
            mountains["features"],
            power_cache,
        ),
    )
    cells.sort(key=lambda item: item["id"])

    ranked_cells = sorted(
        cells,
        key=lambda item: (-item["priorityScore"], -item["hybridHeatIndex"], -item["constructionIndex"]),
    )

    output = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "analysisMethod": {
            "imagery": "Sentinel-2 ImageServer export",
            "windowRadiusKm": ANALYSIS_RADIUS_KM,
            "sizePx": IMAGE_SIZE,
            "gridSpacingKm": GRID_SPACING_KM,
            "heatInterpolation": "IDW sobre estaciones SENAMHI de Lima",
            "officialHeatBase": "Frecuencia de olas de calor de SENAMHI",
            "surfaceTemperatureLayer": "NASA GIBS WMS MODIS_Terra_Land_Surface_Temp_Day",
            "powerClimatology": "NASA POWER climatologia 2001-2020 para T2M_MAX, RH2M, WS2M y TS",
            "rule": (
                "Indice constructivo estimado con NDBI de Sentinel-2, apoyado por mascaras "
                "espectrales de vegetacion y agua para resaltar superficie edificada."
            ),
            "thermalRule": (
                "Indice termico hibrido = 0.55 frecuencia SENAMHI + 0.25 sensacion termica "
                "(T2M_MAX, RH2M y WS2M de NASA POWER) + 0.20 temperatura superficial refinada "
                "(TS de NASA POWER ajustada con NDBI y vegetacion de Sentinel-2)."
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
