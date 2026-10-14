$ErrorActionPreference = 'Stop'
$cli = Join-Path (Split-Path -Parent $PSScriptRoot) 'public/poligome-byom-windows.ps1'
$tokens = $null
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($cli, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
foreach ($name in @('Read-Options', 'Invoke-Start')) {
  $definition = $ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true) | Select-Object -First 1
  Invoke-Expression $definition.Extent.Text
}
function Fail([string] $Message) { throw $Message }
$DefaultPort = 8080

foreach ($arguments in @(
  @('-Port', 'abc'), @('-Port', '0'), @('-Port', '65536'), @('-Port', '8080.5'),
  @('-Port'), @('-Image'), @('-ModelId', '-Image', 'test')
)) {
  $rejected = $false
  try { Read-Options $arguments | Out-Null } catch { $rejected = $true }
  if (-not $rejected) { throw "Invalid arguments accepted: $arguments" }
}
$parsed = Read-Options @('--model-id', 'byom-example', '--image', 'example', '--port', '8081', '--env', 'METHOD=otsu')
if ($parsed.ModelId -ne 'byom-example' -or $parsed.Port -ne 8081 -or $parsed.Env[0] -ne 'METHOD=otsu') { throw 'UI command arguments changed' }
Write-Host 'ok - native BYOM validates ports and required values and accepts the UI commands'

function Assert-ModelId {}
function Assert-Docker {}
function Get-Registration { [pscustomobject]@{ endpoint = 'http://127.0.0.1:8080'; image = '' } }
function Get-PortFromEndpoint { 8080 }
function Get-ContainerName { 'poligome-byom-example' }
function Test-Ping { $false }
function docker { throw 'Docker must not be changed for an imported endpoint without an image' }
$rejected = $false
try { Invoke-Start @{ ModelId = 'byom-example' } } catch {
  if ($_.Exception.Message -notmatch 'importado pelo editor') { throw }
  $rejected = $true
}
if (-not $rejected) { throw 'Imported stopped endpoint silently accepted' }
Write-Host 'ok - imported stopped BYOM explains how to restart without removing a container'
