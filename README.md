# Geoportal Lima

## Publicacion web

La version publicada por GitHub Pages queda en:

`https://stevanjazziel-ui.github.io/geoportal-lima/`

Visor geoespacial para comparar calor, vulnerabilidad climática y contexto urbanístico en toda la región Lima usando fuentes oficiales del Perú.

## Cómo abrirlo

1. Ejecuta `.\serve.ps1`
2. Abre `http://127.0.0.1:8000`

## Capas principales

- `SENAMHI`: estaciones de calor de verano usadas como base térmica para Lima.
- `SENAMHI`: índice multipeligro climático 2050.
- `SENAMHI`: clasificación climática nacional por WMS.
- `IGN`: límite oficial de la región Lima para construir la cobertura completa.
- `ICL`: proyectos de construcción, manzanas catastrales y áreas verdes como capas opcionales.

## Cobertura regional

El visor ya no se limita a puntos sueltos. Ahora calcula una malla regional de análisis sobre toda la región Lima, con:

- `136` celdas regionales con índice constructivo satelital.
- `11` estaciones de SENAMHI usadas para interpolar el patrón térmico regional.

## Supuesto analítico

La capa `zonas de montaña` se deriva de clases climáticas frías, semifrígidas, glaciar y loma dentro del recorte de Lima. Es una inferencia climática oficial útil para análisis territorial, pero no sustituye un mapa directo de pendiente o elevación.
