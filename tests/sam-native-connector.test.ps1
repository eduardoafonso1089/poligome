# Origem do conector no instalador nativo de Windows. Roda em qualquer pwsh
# (Windows, Linux ou macOS) porque simula os downloads:
#   pwsh -NoProfile -File tests/sam-native-connector.test.ps1
#
# O caso que motivou este teste: o site e publicado a mao e servia um .ps1 com um
# pino diferente do conector do GitHub, e todo Windows sem WSL parava em "o
# conector baixado nao confere com a soma oficial", sem saida.
$ErrorActionPreference = 'Stop'
$installerPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'public/poligome-sam-windows-native.ps1'
$parseTokens = $null
$parseErrors = $null
$installerAst = [System.Management.Automation.Language.Parser]::ParseFile($installerPath, [ref]$parseTokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
foreach ($functionName in @('Assert-Https', 'Get-FileSize', 'Get-FileSha256', 'Test-ConnectorCompatible', 'Get-SiteOrigin', 'Install-Connector')) {
  $definition = $installerAst.FindAll({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $functionName }, $true) | Select-Object -First 1
  if (-not $definition) { throw "Missing installer function: $functionName" }
  # Fora do arquivo original $PSScriptRoot fica vazio; cada caso usa a propria pasta.
  Invoke-Expression ($definition.Extent.Text -replace '\$PSScriptRoot', '$script:case')
}

$root = Join-Path ([System.IO.Path]::GetTempPath()) ('poligome-native-connector-' + [guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $root | Out-Null
$goodText = "API_VERSION = 2`nparser.add_argument(`"--model`")`n# atual`n"
$staleText = "API_VERSION = 2`nparser.add_argument(`"--model`")`n# antigo`n"
$goodFile = Join-Path $root 'good.py'
$staleFile = Join-Path $root 'stale.py'
[System.IO.File]::WriteAllText($goodFile, $goodText)
[System.IO.File]::WriteAllText($staleFile, $staleText)

# Estado lido pelas funcoes extraidas, como no script de verdade.
$SiteUrl = 'https://poligome.com'
$AssetBaseUrl = 'https://raw.githubusercontent.com/eduardoafonso1089/poligome/main/public'
$AssetBaseOverridden = $false
$DefaultConnectorSha256 = (Get-FileHash -LiteralPath $goodFile -Algorithm SHA256).Hash.ToLowerInvariant()
$env:POLIGOME_CONNECTOR_PATH = ''

function Fail([string] $Message) { throw "FAIL: $Message" }
function Invoke-InstallerSelfUpdate([string[]] $Obtained) { $script:selfUpdate = $Obtained; throw 'SELF-UPDATE' }
# url -> arquivo servido; ausente = sem resposta.
function Invoke-OptionalDownload([string] $Url, [string] $Destination) {
  $script:requested += $Url
  $source = $script:served[$Url]
  if (-not $source) { return $false }
  Copy-Item -LiteralPath $source -Destination $Destination -Force
  return $true
}

function Reset-Case([string] $Name) {
  $script:case = Join-Path $root $Name
  New-Item -ItemType Directory -Path $script:case | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $script:case 'app') | Out-Null
  $script:Connector = Join-Path $script:case 'app/poligome-sam-local.py'
  $script:requested = @()
  $script:selfUpdate = $null
  $script:served = @{}
}
$siteConnector = 'https://poligome.com/poligome-sam-local.py'
$githubConnector = "$AssetBaseUrl/poligome-sam-local.py"

try {
  Reset-Case 'site-velho'
  $served[$siteConnector] = $staleFile
  $served[$githubConnector] = $goodFile
  Install-Connector
  if ((Get-FileHash -LiteralPath $Connector -Algorithm SHA256).Hash.ToLowerInvariant() -ne $DefaultConnectorSha256) { throw 'site velho: o conector certo do GitHub nao foi instalado' }
  if ($requested[0] -ne $siteConnector) { throw 'site velho: o site deveria ser consultado primeiro' }
  Write-Host 'ok - site desatualizado cai para o GitHub em vez de abortar'

  Reset-Case 'site-certo'
  $served[$siteConnector] = $goodFile
  $served[$githubConnector] = $staleFile
  Install-Connector
  if ($requested.Count -ne 1) { throw 'site certo: nao deveria consultar o GitHub' }
  Write-Host 'ok - conector publicado junto com o instalador no site vem primeiro'

  Reset-Case 'ja-instalado'
  Copy-Item -LiteralPath $goodFile -Destination $Connector
  Install-Connector
  if ($requested.Count -ne 0) { throw 'ja instalado: nao deveria baixar nada' }
  Write-Host 'ok - conector ja instalado e identico ao pino nao e baixado de novo'

  Reset-Case 'instalador-velho'
  $served[$siteConnector] = $staleFile
  $served[$githubConnector] = $staleFile
  $raised = $null
  try { Install-Connector } catch { $raised = "$_" }
  if ($raised -ne 'SELF-UPDATE' -or $selfUpdate.Count -ne 2) { throw "instalador velho: esperava auto-atualizacao, veio: $raised" }
  if (Test-Path -LiteralPath "$Connector.download") { throw 'instalador velho: sobrou download parcial' }
  Write-Host 'ok - instalador mais velho que o conector publicado se atualiza em vez de parar no erro de soma'

  Reset-Case 'sem-rede'
  Copy-Item -LiteralPath $staleFile -Destination $Connector
  Install-Connector
  if (-not (Test-Path -LiteralPath $Connector)) { throw 'sem rede: o conector compativel foi apagado' }
  Write-Host 'ok - sem internet, o conector compativel ja instalado continua valendo'

  Reset-Case 'sem-rede-sem-conector'
  $raised = $null
  try { Install-Connector } catch { $raised = "$_" }
  if ($raised -notlike 'FAIL: *internet*') { throw "sem rede e sem conector: mensagem inesperada: $raised" }
  Write-Host 'ok - sem internet e sem conector, o erro fala da conexao, nao de soma'

  # A auto-atualizacao de verdade: baixa o instalador atual e o executa com o
  # mesmo modelo e o device que a pessoa pediu, e devolve o codigo de saida dele.
  $selfUpdateDefinition = $installerAst.FindAll({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Invoke-InstallerSelfUpdate' }, $true) | Select-Object -First 1
  $runner = Join-Path $root 'self-update-runner.ps1'
  $result = Join-Path $root 'self-update-result.txt'
  $fresh = Join-Path $root 'fresh.ps1'
  [System.IO.File]::WriteAllText($fresh, @"
`$POLIGOME_SAM_INSTALLER_API = 2
`$DefaultConnectorSha256 = 'outro-pino'
"@ + "`n[System.IO.File]::WriteAllText('$result', `"`$(`$args[0])|`$env:POLIGOME_DEVICE|`$env:POLIGOME_INSTALLER_UPDATED`")`nexit 7`n")
  $mockDownload = (Get-Command Invoke-OptionalDownload).ScriptBlock.ToString()
  $selfUpdateText = $selfUpdateDefinition.Extent.Text
  [System.IO.File]::WriteAllText($runner, @"
`$AppDir = '$(Join-Path $root 'appdir')'
`$SiteUrl = 'https://poligome.com'
`$AssetBaseUrl = '$AssetBaseUrl'
`$DefaultConnectorSha256 = '$DefaultConnectorSha256'
`$RequestedDevice = 'cpu'
`$ModelForRelaunch = 'sam3-concepts'
function Fail([string] `$Message) { Write-Host `$Message; exit 99 }
function Get-SiteOrigin { 'https://poligome.com' }
function Assert-Https([string] `$Url) {}
`$served = @{ '$AssetBaseUrl/poligome-sam-windows-native.ps1' = '$fresh' }
`$requested = @()
function Invoke-OptionalDownload {
$mockDownload
}
$selfUpdateText
Invoke-InstallerSelfUpdate @('x -> y')
"@)
  $env:POLIGOME_INSTALLER_UPDATED = ''
  $runnerOutput = & (Get-Process -Id $PID).Path -NoProfile -File $runner 2>&1
  $code = $LASTEXITCODE
  if ($code -ne 7) { throw "auto-atualizacao: codigo de saida $code, esperado 7 (o do instalador novo): $($runnerOutput | Out-String)" }
  $observed = [System.IO.File]::ReadAllText($result)
  if ($observed -ne 'sam3-concepts|cpu|1') { throw "auto-atualizacao: o instalador novo recebeu '$observed'" }
  Write-Host 'ok - a auto-atualizacao roda o instalador atual com o mesmo modelo e device, uma vez so'
} finally {
  Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
