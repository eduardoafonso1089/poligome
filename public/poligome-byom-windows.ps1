<#
.SYNOPSIS
  Poligome BYOM - modelos em conteiner trazidos por voce, nativamente no Windows.

.DESCRIPTION
  Irmao do poligome-byom-macos-linux.sh, com os mesmos comandos e o mesmo
  registro. O contrato imita o do SageMaker para reaproveitar conteineres ja
  empacotados la: a imagem sobe com `serve`, escuta em 8080, responde GET /ping
  quando esta pronta e recebe a inferencia em POST /invocations.

  Este script cuida do registro e do ciclo de vida do conteiner; o conector do
  Poligome descobre os modelos registrados sozinho e nunca chama o docker.

  O registro fica em %USERPROFILE%\.poligome-sam\byom, que e onde o conector
  NATIVO de Windows le. Se voce instalou o SAM pelo poligome-sam-windows.bat, o
  conector roda dentro do WSL2 e le o home da distribuicao: nesse caso use a
  versao bash deste script, de dentro do WSL, ou os dois registros ficarao em
  lugares diferentes.
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [string] $Command,
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]] $Rest = @()
)

# Continue, e nao Stop: o PowerShell 5.1 transforma cada linha de stderr do
# docker.exe num ErrorRecord, e `docker rm -f` de um conteiner inexistente e um
# caminho normal aqui. Quem decide e o codigo de saida.
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'

$AppDir = if ($env:POLIGOME_APP_DIR) { $env:POLIGOME_APP_DIR } else { Join-Path $env:USERPROFILE '.poligome-sam' }
$RegistryDir = Join-Path $AppDir 'byom'
$ContainerPrefix = 'poligome-byom'
$DefaultPort = 8080
$StartTimeout = if ($env:POLIGOME_BYOM_START_TIMEOUT) { [int]$env:POLIGOME_BYOM_START_TIMEOUT } else { 120 }
$ExampleImage = 'poligome-byom-exemplo'
$ModelIdPattern = '^byom-[a-z0-9][a-z0-9._-]{0,62}$'

function Show-Usage {
  @'
Poligome BYOM - modelos em conteiner trazidos por voce (Windows nativo)

Uso:
  powershell -ExecutionPolicy Bypass -File poligome-byom-windows.ps1 <comando> [opcoes]

Comandos:
  examples  [-Path DIR]                    constroi e registra os dois exemplos oficiais
  build     -Path DIR -Image NOME          constroi a imagem a partir de um Dockerfile
  register  -ModelId ID -Image NOME        registra o modelo e o deixa visivel no Poligome
            [-Name "Rotulo"] [-Port N] [-Env CHAVE=VALOR]...
  start     -ModelId ID                    sobe o conteiner e espera o /ping responder
  stop      -ModelId ID                    encerra o conteiner
  status    [-ModelId ID]                  mostra registro, conteiner e /ping
  list                                     lista os modelos registrados
  logs      -ModelId ID [-Follow]          mostra a saida do conteiner
  remove    -ModelId ID [-Purge]           remove o registro (com -Purge, apaga o conteiner)

O ID precisa comecar com "byom-" para nunca colidir com um modelo oficial.

Variaveis opcionais:
  POLIGOME_APP_DIR            raiz das instalacoes (padrao: %USERPROFILE%\.poligome-sam)
  POLIGOME_BYOM_START_TIMEOUT segundos de espera pelo /ping (padrao: 120)
'@ | Write-Host
}

function Fail([string] $Message) {
  Write-Host ''
  Write-Host "Erro: $Message" -ForegroundColor Red
  exit 1
}

function Assert-Docker {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Fail @'
docker nao foi encontrado no PATH do Windows.

Ha dois caminhos:
  - Docker Desktop, que instala o docker.exe nativo; ou
  - o Docker Engine que voce ja tenha dentro do WSL2, apontando este shell para
    ele com  $env:DOCKER_HOST = "tcp://127.0.0.1:2375"  e o daemon exposto la.
'@
  }
  docker info *> $null
  if ($LASTEXITCODE -ne 0) { Fail 'o daemon do Docker nao respondeu. Inicie o Docker e tente de novo.' }
}

function Assert-ModelId([string] $ModelId) {
  if (-not $ModelId) { Fail 'informe -ModelId.' }
  if ($ModelId -cnotmatch $ModelIdPattern) {
    Fail "model-id invalido: $ModelId. Use o prefixo byom- seguido de letras minusculas, numeros, ponto, hifen ou sublinhado."
  }
}

function Get-RegistrationPath([string] $ModelId) { Join-Path $RegistryDir "$ModelId.json" }
function Get-ContainerName([string] $ModelId) { "$ContainerPrefix-" + ($ModelId -replace '^byom-', '') }

function Get-Registration([string] $ModelId) {
  $path = Get-RegistrationPath $ModelId
  if (-not (Test-Path -LiteralPath $path)) {
    Fail "modelo $ModelId nao esta registrado. Rode o comando register antes."
  }
  return (Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json)
}

function Get-PortFromEndpoint([string] $Endpoint) {
  if ($Endpoint -match ':(\d+)\s*$') { return [int]$Matches[1] }
  return $DefaultPort
}

function Test-Ping([string] $Endpoint) {
  try {
    $response = Invoke-WebRequest -Uri "$Endpoint/ping" -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Save-Registration([hashtable] $Document, [string] $Path) {
  New-Item -ItemType Directory -Force (Split-Path -Parent $Path) | Out-Null
  $json = $Document | ConvertTo-Json -Depth 5
  # Sem BOM: o conector le este arquivo com json.load e um BOM o quebraria.
  [System.IO.File]::WriteAllText($Path, "$json`n", (New-Object System.Text.UTF8Encoding($false)))
}

function ConvertTo-EnvMap([string[]] $Pairs) {
  $map = @{}
  foreach ($pair in $Pairs) {
    if (-not $pair) { continue }
    if ($pair -notmatch '=') { Fail "-Env espera CHAVE=VALOR; recebido: $pair" }
    $key, $value = $pair -split '=', 2
    if (-not $key) { Fail "-Env com chave vazia: $pair" }
    $map[$key] = $value
  }
  return $map
}

# ------------------------------------------------------------- argumentos ----

function Read-Options([string[]] $Arguments) {
  $options = @{ ModelId = ''; Image = ''; Name = ''; Port = $DefaultPort; Path = ''; Env = @(); Follow = $false; Purge = $false }
  $i = 0
  while ($i -lt $Arguments.Count) {
    $flag = $Arguments[$i]
    $value = if ($i + 1 -lt $Arguments.Count) { $Arguments[$i + 1] } else { $null }
    switch -regex ($flag) {
      '^-{1,2}(ModelId|model-id)$' { $options.ModelId = $value; $i += 2 }
      '^-{1,2}(Image|image)$'      { $options.Image = $value; $i += 2 }
      '^-{1,2}(Name|name)$'        { $options.Name = $value; $i += 2 }
      '^-{1,2}(Port|port)$'        { $options.Port = [int]$value; $i += 2 }
      '^-{1,2}(Path|path)$'        { $options.Path = $value; $i += 2 }
      '^-{1,2}(Env|env)$'          { $options.Env += $value; $i += 2 }
      '^-{1,2}(Follow|follow)$'    { $options.Follow = $true; $i += 1 }
      '^-{1,2}(Purge|purge)$'      { $options.Purge = $true; $i += 1 }
      default { Fail "opcao desconhecida: $flag" }
    }
  }
  return $options
}

# --------------------------------------------------------------- comandos ----

function Invoke-Register([hashtable] $Options) {
  Assert-ModelId $Options.ModelId
  if (-not $Options.Image) { Fail 'informe -Image com o nome da imagem ja construida.' }
  if ($Options.Port -lt 1 -or $Options.Port -gt 65535) { Fail "porta invalida: $($Options.Port)." }
  Assert-Docker
  docker image inspect $Options.Image *> $null
  if ($LASTEXITCODE -ne 0) {
    Fail "a imagem $($Options.Image) nao existe localmente. Construa antes com o comando build ou com docker build."
  }

  $path = Get-RegistrationPath $Options.ModelId
  $document = @{
    model_id = $Options.ModelId
    name     = if ($Options.Name) { $Options.Name } else { $Options.ModelId }
    image    = $Options.Image
    endpoint = "http://127.0.0.1:$($Options.Port)"
    env      = (ConvertTo-EnvMap $Options.Env)
  }
  Save-Registration $document $path
  Write-Host ''
  Write-Host "Modelo $($Options.ModelId) registrado em $path"
  Write-Host 'Suba o conteiner com:'
  Write-Host "  powershell -ExecutionPolicy Bypass -File poligome-byom-windows.ps1 start -ModelId $($Options.ModelId)"
}

function Invoke-Build([hashtable] $Options) {
  if (-not $Options.Path) { Fail 'informe -Path com o diretorio que contem o Dockerfile.' }
  if (-not $Options.Image) { Fail 'informe -Image com o nome da imagem a construir.' }
  if (-not (Test-Path -LiteralPath (Join-Path $Options.Path 'Dockerfile'))) {
    Fail "nao ha Dockerfile em $($Options.Path)."
  }
  Assert-Docker
  Write-Host "Construindo $($Options.Image) a partir de $($Options.Path)..."
  docker build -t $Options.Image $Options.Path
  if ($LASTEXITCODE -ne 0) { Fail 'docker build falhou.' }
  Write-Host ''
  Write-Host "Imagem $($Options.Image) pronta. Registre com:"
  Write-Host "  powershell -ExecutionPolicy Bypass -File poligome-byom-windows.ps1 register -ModelId byom-SEU-ID -Image $($Options.Image)"
}

function Invoke-Start([hashtable] $Options) {
  Assert-ModelId $Options.ModelId
  $registration = Get-Registration $Options.ModelId
  Assert-Docker
  $endpoint = $registration.endpoint
  $port = Get-PortFromEndpoint $endpoint
  $container = Get-ContainerName $Options.ModelId

  if (Test-Ping $endpoint) {
    Write-Host "O modelo $($Options.ModelId) ja esta respondendo em $endpoint."
    return
  }

  docker rm -f $container *> $null
  # As variaveis guardadas no registro voltam aqui, para que dois modelos saiam
  # da mesma imagem mudando so a configuracao.
  $envArgs = @()
  if ($registration.env) {
    foreach ($property in $registration.env.PSObject.Properties) {
      $envArgs += @('-e', "$($property.Name)=$($property.Value)")
    }
  }
  Write-Host "Subindo $($Options.ModelId) a partir de $($registration.image) na porta $port..."
  # A publicacao fica presa a 127.0.0.1 de proposito: o conteiner nao deve ficar
  # exposto na rede, porque a inferencia precisa permanecer local.
  $runArgs = @('run', '-d', '--name', $container, '-p', "127.0.0.1:${port}:8080") + $envArgs + @($registration.image, 'serve')
  docker @runArgs *> $null
  if ($LASTEXITCODE -ne 0) { Fail "docker run falhou para a imagem $($registration.image)." }

  $deadline = (Get-Date).AddSeconds($StartTimeout)
  while ((Get-Date) -lt $deadline) {
    if (Test-Ping $endpoint) {
      Write-Host "Pronto: $($Options.ModelId) respondeu 200 em $endpoint/ping."
      Write-Host 'No editor, abra o modelo de IA e rode este BYOM sobre a imagem.'
      return
    }
    $running = docker ps -q -f "name=^$container$" 2>$null
    if (-not $running) {
      Write-Host ''
      Write-Host 'O conteiner encerrou antes de ficar pronto. Ultimas linhas do log:'
      docker logs --tail 20 $container
      Fail "o conteiner $container nao permaneceu no ar."
    }
    Start-Sleep -Seconds 1
  }
  Fail "o conteiner nao respondeu em $endpoint/ping dentro de ${StartTimeout}s."
}

function Invoke-Stop([hashtable] $Options) {
  Assert-ModelId $Options.ModelId
  Get-Registration $Options.ModelId | Out-Null
  Assert-Docker
  $container = Get-ContainerName $Options.ModelId
  docker rm -f $container *> $null
  if ($LASTEXITCODE -ne 0) { Fail "nao havia conteiner $container para encerrar." }
  Write-Host "Conteiner de $($Options.ModelId) encerrado."
}

function Write-StatusLine([string] $ModelId) {
  $path = Get-RegistrationPath $ModelId
  $registration = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
  $container = Get-ContainerName $ModelId
  $state = 'parado'
  if (Get-Command docker -ErrorAction SilentlyContinue) {
    $running = docker ps -q -f "name=^$container$" 2>$null
    if ($running) { $state = 'no ar' }
  }
  $ping = if (Test-Ping $registration.endpoint) { '200' } else { 'sem resposta' }
  Write-Host ('  {0,-28} {1,-26} {2,-9} {3,-12} {4}' -f $ModelId, $registration.image, $state, $ping, $registration.endpoint)
}

function Invoke-List {
  if (-not (Test-Path -LiteralPath $RegistryDir)) { Write-Host 'Nenhum modelo BYOM registrado.'; return }
  $files = @(Get-ChildItem -LiteralPath $RegistryDir -Filter '*.json' -File -ErrorAction SilentlyContinue)
  if ($files.Count -eq 0) { Write-Host 'Nenhum modelo BYOM registrado.'; return }
  Write-Host ''
  Write-Host ('  {0,-28} {1,-26} {2,-9} {3,-12} {4}' -f 'MODEL-ID', 'IMAGEM', 'CONTEINER', '/ping', 'ENDPOINT')
  foreach ($file in $files) { Write-StatusLine ([System.IO.Path]::GetFileNameWithoutExtension($file.Name)) }
  Write-Host ''
}

function Invoke-Status([hashtable] $Options) {
  if (-not $Options.ModelId) { Invoke-List; return }
  Assert-ModelId $Options.ModelId
  Get-Registration $Options.ModelId | Out-Null
  Write-Host ''
  Write-Host ('  {0,-28} {1,-26} {2,-9} {3,-12} {4}' -f 'MODEL-ID', 'IMAGEM', 'CONTEINER', '/ping', 'ENDPOINT')
  Write-StatusLine $Options.ModelId
  Write-Host ''
}

function Invoke-Logs([hashtable] $Options) {
  Assert-ModelId $Options.ModelId
  Get-Registration $Options.ModelId | Out-Null
  Assert-Docker
  $container = Get-ContainerName $Options.ModelId
  if ($Options.Follow) { docker logs -f $container } else { docker logs --tail 50 $container }
}

function Invoke-Remove([hashtable] $Options) {
  Assert-ModelId $Options.ModelId
  $path = Get-RegistrationPath $Options.ModelId
  if (-not (Test-Path -LiteralPath $path)) {
    Fail "modelo $($Options.ModelId) nao esta registrado."
  }
  $purged = $false
  if ($Options.Purge -and (Get-Command docker -ErrorAction SilentlyContinue)) {
    docker rm -f (Get-ContainerName $Options.ModelId) *> $null
    if ($LASTEXITCODE -eq 0) { $purged = $true }
  }
  Remove-Item -LiteralPath $path -Force
  Write-Host "Registro de $($Options.ModelId) removido."
  # So afirma ter apagado o conteiner quando o docker rm de fato apagou um: sem
  # Docker no PATH, ou sem conteiner com esse nome, nao ha o que apagar, e dizer
  # o contrario manda o usuario procurar um resto que nao existe.
  if ($Options.Purge) {
    if ($purged) { Write-Host 'O conteiner tambem foi apagado. A imagem continua no Docker.' }
    else { Write-Host 'Nao havia conteiner desse modelo para apagar.' }
  }
}

function Invoke-Examples([hashtable] $Options) {
  $path = $Options.Path
  if (-not $path) { $path = Join-Path $PSScriptRoot 'byom' }
  if (-not (Test-Path -LiteralPath (Join-Path $path 'Dockerfile'))) {
    Fail "nao ha Dockerfile em $path. Aponte -Path para o diretorio byom do repositorio."
  }
  $source = Join-Path $path 'examples'
  if (-not (Test-Path -LiteralPath $source)) { Fail "nao ha exemplos em $source." }
  Assert-Docker

  Write-Host "Construindo a imagem dos exemplos ($ExampleImage)..."
  $log = Join-Path $env:TEMP "poligome-byom-build.$PID.log"
  docker build -t $ExampleImage $path *> $log
  if ($LASTEXITCODE -ne 0) {
    Write-Host ''
    Get-Content -LiteralPath $log -Tail 20 | Write-Host
    Remove-Item -LiteralPath $log -Force -ErrorAction SilentlyContinue
    Fail 'docker build falhou.'
  }
  Remove-Item -LiteralPath $log -Force -ErrorAction SilentlyContinue

  New-Item -ItemType Directory -Force $RegistryDir | Out-Null
  $examples = @(Get-ChildItem -LiteralPath $source -Filter '*.json' -File)
  if ($examples.Count -eq 0) { Fail "nenhum exemplo encontrado em $source." }
  foreach ($example in $examples) {
    $target = Join-Path $RegistryDir $example.Name
    # O registro do usuario manda: reinstalar os exemplos nao apaga uma anotacao
    # nem uma porta que alguem ja tenha ajustado a mao.
    if (Test-Path -LiteralPath $target) {
      Write-Host "  $([System.IO.Path]::GetFileNameWithoutExtension($example.Name)) ja registrado; mantendo o seu registro."
    } else {
      Copy-Item -LiteralPath $example.FullName -Destination $target
      Write-Host "  $([System.IO.Path]::GetFileNameWithoutExtension($example.Name)) registrado."
    }
  }

  Write-Host ''
  Write-Host 'Subindo os exemplos...'
  foreach ($example in $examples) {
    $id = [System.IO.Path]::GetFileNameWithoutExtension($example.Name)
    try {
      Invoke-Start @{ ModelId = $id }
    } catch {
      Write-Host "  $id nao subiu; use logs -ModelId $id para ver o motivo."
    }
  }
}

# =================================================================== main ====

if (-not $Command -or $Command -in @('-h', '--help', 'help', '/?')) {
  Show-Usage
  if (-not $Command) { exit 1 }
  exit 0
}

$options = Read-Options $Rest

switch ($Command.ToLowerInvariant()) {
  'examples' { Invoke-Examples $options }
  'build'    { Invoke-Build $options }
  'register' { Invoke-Register $options }
  'start'    { Invoke-Start $options }
  'stop'     { Invoke-Stop $options }
  'status'   { Invoke-Status $options }
  'list'     { Invoke-List }
  'logs'     { Invoke-Logs $options }
  'remove'   { Invoke-Remove $options }
  default    { Show-Usage; Fail "comando desconhecido: $Command" }
}
