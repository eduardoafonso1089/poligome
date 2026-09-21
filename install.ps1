$ErrorActionPreference = 'Stop'
$MinimumNodeVersion = [Version]'22.13.0'
$NodeVersion = '22.13.1'

function Get-NodePath {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if ($node -and $node.Path) { return $node.Path }
  $installedNode = Join-Path $env:ProgramFiles 'nodejs\node.exe'
  if (Test-Path $installedNode) { return $installedNode }
  return $null
}

function Test-NodeVersion {
  param([string]$NodePath)
  if (-not $NodePath) { return $false }
  try {
    $version = [Version]((& $NodePath -p "process.versions.node").Trim())
    return $version -ge $MinimumNodeVersion
  } catch {
    return $false
  }
}

function Refresh-NodePath {
  $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  $nodeDirectory = Join-Path $env:ProgramFiles 'nodejs'
  $env:Path = "$nodeDirectory;$machinePath;$userPath"
}

function Install-Node {
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if ($winget) {
    Write-Host '[Poligome] Trying to install Node.js LTS with winget...'
    & winget upgrade --id OpenJS.NodeJS.LTS --exact --silent --accept-package-agreements --accept-source-agreements
    Refresh-NodePath
    if (Test-NodeVersion (Get-NodePath)) { return }

    & winget install --id OpenJS.NodeJS.LTS --exact --silent --accept-package-agreements --accept-source-agreements
    Refresh-NodePath
    if (Test-NodeVersion (Get-NodePath)) { return }
  }

  $installer = Join-Path ([IO.Path]::GetTempPath()) "node-v$NodeVersion-x64.msi"
  try {
    Write-Host "[Poligome] Downloading Node.js v$NodeVersion installer..."
    Invoke-WebRequest -Uri "https://nodejs.org/dist/v$NodeVersion/node-v$NodeVersion-x64.msi" -OutFile $installer
    $arguments = "/i `"$installer`" /qn /norestart"
    $process = Start-Process msiexec.exe -ArgumentList $arguments -Wait -PassThru
    if ($process.ExitCode -notin @(0, 3010)) { throw "Node.js installer failed with exit code $($process.ExitCode)." }
    if ($process.ExitCode -eq 3010) { Write-Host '[Poligome] Node.js was installed and Windows needs a restart to finish setup.' }
  } finally {
    Remove-Item $installer -Force -ErrorAction SilentlyContinue
  }
  Refresh-NodePath
}

$nodePath = Get-NodePath
if (-not (Test-NodeVersion $nodePath)) {
  $foundVersion = if ($nodePath) { (& $nodePath -p "process.versions.node").Trim() } else { 'not found' }
  Write-Host "[Poligome] Node.js >= $MinimumNodeVersion is required (found $foundVersion)."
  Install-Node
  $nodePath = Get-NodePath
}
if (-not (Test-NodeVersion $nodePath)) { throw "[Poligome] Node.js >= $MinimumNodeVersion is required after automatic setup." }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw '[Poligome] npm is required but was not provided by Node.js.' }

Set-Location $PSScriptRoot
Write-Host '[Poligome] Installing locked dependencies...'
& npm ci
if ($LASTEXITCODE -ne 0) { throw '[Poligome] npm ci failed.' }
Write-Host '[Poligome] Installation complete. Run: npm run dev'
