$ErrorActionPreference = 'Stop'
$MinimumNodeVersion = [Version]'22.13.0'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw '[Poligome] Node.js >= 22.13.0 is required.' }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw '[Poligome] npm is required.' }
$NodeVersionText = (& node -p "process.versions.node").Trim()
if ([Version]$NodeVersionText -lt $MinimumNodeVersion) { throw "[Poligome] Node.js >= 22.13.0 is required (found $NodeVersionText)." }
Set-Location $PSScriptRoot
Write-Host '[Poligome] Installing locked dependencies...'
& npm ci
if ($LASTEXITCODE -ne 0) { throw '[Poligome] npm ci failed.' }
Write-Host '[Poligome] Installation complete. Run: npm run dev'
