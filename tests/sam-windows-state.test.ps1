# Execute real PowerShell selection handlers without installing model weights.
# This suite also runs on Linux with pwsh; Windows launch/argv tests are separate.
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$native = Join-Path $project 'public/poligome-sam-windows-native.ps1'
$tokens = $null
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($native, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
$save = $ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Save-Selection' }, $true)[0].Extent.Text
$selectionSwitch = $ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.SwitchStatementAst] -and $node.Condition.Extent.Text -like '*Get-ServerState $venvPython $modelId*' }, $true)[0]
if (-not $selectionSwitch) { throw 'Native selection switch not found' }
$root = Join-Path ([System.IO.Path]::GetTempPath()) ('poligome-windows-state-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $root | Out-Null
$pwsh = (Get-Process -Id $PID).Path
function Quote-Literal([string] $value) { return "'" + $value.Replace("'", "''") + "'" }
try {
  foreach ($state in @('other-model', 'ready')) {
    $clause = $selectionSwitch.Clauses | Where-Object { $_.Item1.Extent.Text -eq "'$state'" } | Select-Object -First 1
    if (-not $clause) { throw "Missing handler: $state" }
    $app = Join-Path $root $state
    New-Item -ItemType Directory -Path $app | Out-Null
    $selected = Join-Path $app 'selected-model.txt'
    $pending = Join-Path $app 'pending-model.txt'
    [System.IO.File]::WriteAllText($selected, "sam2.1-hiera-small`n")
    [System.IO.File]::WriteAllText($pending, "sam2.1-hiera-tiny`n")
    $runner = Join-Path $app 'run.ps1'
    $code = @"
`$ErrorActionPreference = 'Stop'
`$AppDir = $(Quote-Literal $app)
`$SelectedModelFile = $(Quote-Literal $selected)
`$PendingModelFile = $(Quote-Literal $pending)
`$modelId = 'sam2.1-hiera-tiny'
`$SiteUrl = 'https://poligome.com'
`$Port = 7860
function Start-Process { }
$save
& $($clause.Item2.Extent.Text)
"@
    [System.IO.File]::WriteAllText($runner, $code)
    & $pwsh -NoProfile -File $runner
    if ($LASTEXITCODE -ne 0) { throw "Native handler failed: $state" }
    $expected = if ($state -eq 'other-model') { 'sam2.1-hiera-small' } else { 'sam2.1-hiera-tiny' }
    if ((Get-Content -LiteralPath $selected -Raw).Trim() -ne $expected) { throw "Wrong persisted selection for $state" }
    if (Test-Path -LiteralPath $pending) { throw "Completed installation left pending state: $state" }
    Write-Host "ok - native $state preserves the selected model or confirms the ready model"
  }

  $starter = [System.IO.File]::ReadAllText((Join-Path $project 'public/poligome-sam-start-windows.bat'))
  $match = [regex]::Match($starter, '(?ms)^:sync_wsl_selection\r?\n.*?^-?powershell .*?-Command "(.*?)" >nul 2>nul')
  if (-not $match.Success) { throw 'WSL selection sync command not found' }
  $sync = $match.Groups[1].Value
  foreach ($model in @('sam2.1-hiera-tiny', 'sam2.1-hiera-small', 'sam2.1-hiera-base-plus', 'sam2.1-hiera-large', 'medsam2-latest', 'medsam2-ct-lesion', 'medsam2-mri-liver-lesion', 'medsam2-us-heart', 'medsam2-2411', 'sam3-concepts', 'invalid-model', '')) {
    $app = Join-Path $root ('sync-' + [guid]::NewGuid())
    New-Item -ItemType Directory -Path $app | Out-Null
    $selected = Join-Path $app 'selected-model.txt'
    [System.IO.File]::WriteAllText($selected, "sam2.1-hiera-small`n")
    $runner = Join-Path $app 'run.ps1'
    $code = @"
`$ErrorActionPreference = 'Stop'
`$env:SELECTED_MODEL_FILE = $(Quote-Literal $selected)
function wsl.exe { `$global:LASTEXITCODE = 0; $(Quote-Literal $model) }
$sync
"@
    [System.IO.File]::WriteAllText($runner, $code)
    & $pwsh -NoProfile -File $runner
    if ($LASTEXITCODE -ne 0) { throw "Sync command failed for '$model'" }
    $expected = if ($model -in @('', 'invalid-model')) { 'sam2.1-hiera-small' } else { $model }
    if ((Get-Content -LiteralPath $selected -Raw).Trim() -ne $expected) { throw "WSL selection ignored for '$model'" }
    $bytes = [System.IO.File]::ReadAllBytes($selected)
    if ($bytes[0] -eq 239) { throw 'Selection acquired a UTF-8 BOM' }
  }
  Write-Host 'ok - Windows starter reads the WSL choice for all ten models and rejects empty or unknown IDs'
} finally {
  Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
