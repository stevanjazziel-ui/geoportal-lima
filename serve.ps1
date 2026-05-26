param(
  [int]$Port = 8000
)

Write-Host "Sirviendo Geoportal Lima en http://127.0.0.1:$Port"
python -m http.server $Port
