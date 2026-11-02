param([switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$dist = Join-Path (Split-Path -Parent $root) 'Map_Editor_Release'
if (-not $SkipBuild) {
    $previousIcon = [Environment]::GetEnvironmentVariable('ARKNIGHTS_APP_ICON', 'Process')
    Push-Location (Join-Path $root 'desktop')
    try {
        $env:ARKNIGHTS_APP_ICON = Join-Path $root 'app.ico'
        cargo build --release --locked --offline
        if ($LASTEXITCODE -ne 0) { throw 'Build failed' }
    } finally {
        if ($null -eq $previousIcon) { Remove-Item Env:ARKNIGHTS_APP_ICON -ErrorAction SilentlyContinue } else { $env:ARKNIGHTS_APP_ICON = $previousIcon }
        Pop-Location
    }
}
New-Item -ItemType Directory -Force -Path $dist | Out-Null
Copy-Item -LiteralPath (Join-Path $root 'desktop/target/release/arknights-map-editor.exe') -Destination (Join-Path $dist 'Arknights_Map_Editor.exe') -Force
Copy-Item -LiteralPath (Join-Path $root 'README.md') -Destination $dist -Force
$web = Join-Path $dist 'browser'
New-Item -ItemType Directory -Force -Path $web | Out-Null
# Explicit runtime assets keep unrelated source files out of the release.
$assets = @('index.html', 'styles.css', 'schema.js', 'map-model.js', 'tile-renderer.js', 'map-editor.js', 'editor-ui.js')
# Remove assets shipped by the previous preview-enabled build when updating in place.
foreach ($retired in @('engine.js', 'enemy_index.js', 'enemy-prefab-data.js', 'tile-image-assets.js', 'editor.css')) {
    $oldAsset = Join-Path $web $retired
    if (Test-Path -LiteralPath $oldAsset -PathType Leaf) { Remove-Item -LiteralPath $oldAsset -Force }
}
foreach ($asset in $assets) { Copy-Item -LiteralPath (Join-Path $root $asset) -Destination $web -Force }
Compress-Archive -Path (Join-Path $dist 'Arknights_Map_Editor.exe'),(Join-Path $dist 'README.md'),$web -DestinationPath (Join-Path $dist 'Arknights_Map_Editor.zip') -Force
Write-Output (Join-Path $dist 'Arknights_Map_Editor.exe')
