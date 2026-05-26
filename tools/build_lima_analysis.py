import json
import math
import re
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
SATELLITE_DIR = DATA_DIR / "satellite_samples"
OUTPUT_JS = DATA_DIR / "lima_analysis_data.js"
MOUNTAIN_JS = DATA_DIR / "lima_mountain_zones.js"

WORLD_IMAGERY_EXPORT = (
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export"
)

HEATWAVE_FILE = DATA_DIR / "senamhi_heatwave_frequency_lima.geojson"
HAZARD_FILE = DATA_DIR / "senamhi_climate_multi_hazard_lima.geojson"
MOUNTAIN_FILE = DATA_DIR / "senamhi_mountain_zones_lima.geojson"
CLIMATE_FILE = DATA_DIR / "senamhi_climate_classification_lima.geojson"

HAZARD_SCORE = {
    "Bajo": 0.25,
    "Medio": 0.5,
    "Alto": 0.75,
    "Muy Alto": 1.0,
}


def decode_text(value):
    if not isinstance(value, str):
        return value
    try:
        decoded = value.encode("latin1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        decoded = value
    return (
        decoded.replace("Ð", "Ñ")
        .replace("ð", "ñ")
        .replace("Ã‘", "Ñ")
        .replace("Ã±", "ñ")
    )


def slugify(value):
    lowered = decode_text(value).lower()
    cleaned = re.sub(r"[^a-z0-9]+", "-", lowered)
    return cleaned.strip("-") or "point"


def load_geojson(path):
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


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
            return {
                "code": code,
                "description": description,
                "isMountain": bool(
                    re.search(r"Frío|Semifrígido|Hielo|Glaciar|Loma", description, re.IGNORECASE)
                )
                or bool(re.search(r"Glaciar|Loma", code, re.IGNORECASE)),
            }
    return {
        "code": "Sin codigo",
        "description": "Sin clasificacion climatica puntual",
        "isMountain": False,
    }


def imagery_bbox(lon, lat, radius_km=0.9):
    lat_delta = radius_km / 110.574
    lon_delta = radius_km / (111.320 * math.cos(math.radians(lat)))
    return (
        lon - lon_delta,
        lat - lat_delta,
        lon + lon_delta,
        lat + lat_delta,
    )


def fetch_satellite_png(lon, lat, out_path, size=384):
    bbox = imagery_bbox(lon, lat)
    params = {
        "bbox": ",".join(f"{value:.8f}" for value in bbox),
        "bboxSR": "4326",
        "imageSR": "4326",
        "size": f"{size},{size}",
        "format": "png32",
        "transparent": "false",
        "f": "image",
    }
    url = f"{WORLD_IMAGERY_EXPORT}?{urllib.parse.urlencode(params)}"
    request = urllib.request.Request(url, headers={"User-Agent": "GeoportalLima/1.0"})
    with urllib.request.urlopen(request, timeout=60) as response:
        payload = response.read()
    out_path.write_bytes(payload)
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


def priority_score(heat_frequency, hazard_level, construction_index):
    heat_score = min(max(heat_frequency / 1.35, 0), 1)
    hazard_score = HAZARD_SCORE.get(hazard_level, 0)
    value = 0.4 * heat_score + 0.3 * hazard_score + 0.3 * construction_index
    return round(value, 3)


def main():
    SATELLITE_DIR.mkdir(parents=True, exist_ok=True)

    heatwave = load_geojson(HEATWAVE_FILE)
    hazard = load_geojson(HAZARD_FILE)
    mountains = load_geojson(MOUNTAIN_FILE)
    climate = load_geojson(CLIMATE_FILE)

    points = []
    for feature in heatwave["features"]:
        props = feature["properties"]
        lon, lat = feature["geometry"]["coordinates"]
        name = decode_text(props["nombre"])
        slug = slugify(name)
        image_path = SATELLITE_DIR / f"{slug}.png"
        payload, satellite_url = fetch_satellite_png(lon, lat, image_path)
        satellite_metrics = analyze_satellite(payload)
        hazard_info = find_hazard((lon, lat), hazard["features"])
        mountain_context = find_mountain_context((lon, lat), mountains["features"])
        climate_context = find_climate_context((lon, lat), climate["features"])

        point_record = {
            "id": str(props.get("cod_anteri", name)),
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
            "hazardLevel": hazard_info["level"],
            "hazardRange": hazard_info["range"],
            "climateCode": climate_context["code"],
            "climateDescription": climate_context["description"],
            "mountainZone": climate_context["isMountain"],
            "constructionIndex": satellite_metrics["constructionIndex"],
            "constructionLabel": construction_label(satellite_metrics["constructionIndex"]),
            "satelliteMetrics": satellite_metrics,
            "satelliteThumb": f"data/satellite_samples/{slug}.png",
            "satelliteSource": satellite_url,
            "mountainContext": mountain_context,
        }
        point_record["priorityScore"] = priority_score(
            point_record["frequency"],
            point_record["hazardLevel"],
            point_record["constructionIndex"],
        )
        points.append(point_record)

    points.sort(key=lambda item: (-item["priorityScore"], -item["constructionIndex"], -item["frequency"]))

    output = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "analysisMethod": {
            "imagery": "Esri World Imagery export",
            "windowRadiusKm": 0.9,
            "sizePx": 384,
            "rule": (
                "Construccion estimada por combinacion local de superficie impermeable, textura/edges "
                "y presencia de tonos grises, con penalizacion por suelo desnudo."
            ),
        },
        "points": points,
    }

    serialized = json.dumps(output, ensure_ascii=False, indent=2)
    OUTPUT_JS.write_text(
        f"window.GEOPORTAL_LIMA_DATA = {serialized};\n",
        encoding="utf-8",
    )

    mountain_payload = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {
                    "codigo": decode_text(feature["properties"].get("codigo", "Sin codigo")),
                    "descripcion": decode_text(
                        feature["properties"].get("descripcion", "Sin descripcion")
                    ),
                    "area_km2": feature["properties"].get("area_km2"),
                },
                "geometry": feature["geometry"],
            }
            for feature in mountains["features"]
        ],
    }
    MOUNTAIN_JS.write_text(
        f"window.GEOPORTAL_LIMA_MOUNTAINS = {json.dumps(mountain_payload, ensure_ascii=False)};\n",
        encoding="utf-8",
    )
    print(f"Generated {OUTPUT_JS}")
    print(f"Generated {MOUNTAIN_JS}")
    print(f"Points analyzed: {len(points)}")


if __name__ == "__main__":
    main()
