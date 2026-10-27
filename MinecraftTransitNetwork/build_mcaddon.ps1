# Builds dist/MinecraftTransitNetwork.mcaddon from the source packs.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$dist = Join-Path $root "dist"
New-Item -ItemType Directory -Force -Path $dist | Out-Null
$out = Join-Path $dist "MinecraftTransitNetwork.mcaddon"
if (Test-Path $out) { Remove-Item $out -Force }

$bp = Join-Path $root "BehaviorPack"
$rp = Join-Path $root "ResourcePack"
if (-not (Test-Path $bp)) { throw "BehaviorPack folder missing" }
if (-not (Test-Path $rp)) { throw "ResourcePack folder missing" }

# Validate JSON before packing.
Get-ChildItem -Path $bp,$rp -Recurse -Filter *.json | ForEach-Object {
  try { Get-Content $_.FullName -Raw | ConvertFrom-Json | Out-Null }
  catch { throw "Invalid JSON: $($_.FullName): $_" }
}

$stage = Join-Path ([System.IO.Path]::GetTempPath()) "mtn_stage"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path "$stage/BehaviorPack","$stage/ResourcePack" | Out-Null
Copy-Item "$bp/*" "$stage/BehaviorPack" -Recurse -Force
Copy-Item "$rp/*" "$stage/ResourcePack" -Recurse -Force

# Drop dev-only files from the shipped packs if present.
Get-ChildItem -Path $stage -Recurse -Include *.ps1,*.test.mjs -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue

Compress-Archive -Path "$stage/BehaviorPack","$stage/ResourcePack" -DestinationPath "$out.zip" -Force
Move-Item "$out.zip" $out -Force
Remove-Item $stage -Recurse -Force
Write-Output "Built: $out"
