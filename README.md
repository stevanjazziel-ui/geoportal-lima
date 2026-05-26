# Geoportal Lima

## Publicacion web

La version publicada por GitHub Pages queda en:

`https://stevanjazziel-ui.github.io/geoportal-lima/`

Visor geoespacial para comparar calor, vulnerabilidad climática y contexto urbanístico en Lima usando fuentes oficiales del Perú.

## Cómo abrirlo

1. Ejecuta `.\serve.ps1`
2. Abre `http://127.0.0.1:8000`

## Capas principales

- `SENAMHI`: frecuencia de olas de calor en verano para Lima.
- `SENAMHI`: índice multipeligro climático 2050.
- `SENAMHI`: clasificación climática nacional por WMS.
- `ICL`: proyectos de construcción, manzanas catastrales y áreas verdes como capas opcionales.

## Supuesto analítico

La capa `zonas de montaña` se deriva de clases climáticas frías, semifrígidas, glaciar y loma dentro del recorte de Lima. Es una inferencia climática oficial útil para análisis territorial, pero no sustituye un mapa directo de pendiente o elevación.
