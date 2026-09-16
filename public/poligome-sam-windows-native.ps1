<#
.SYNOPSIS
  Poligome SAM local - instalador nativo de Windows, sem WSL2.

.DESCRIPTION
  Irmao do poligome-sam-macos-linux.sh, com o mesmo contrato: cria um ambiente
  Python por familia de modelo em %USERPROFILE%\.poligome-sam, baixa apenas o
  checkpoint escolhido, sobe o conector em 127.0.0.1:7860 e segura o terminal
  enquanto ele roda.

  A diferenca esta no poligome-sam-windows.bat, que nao instala nada no Windows:
  ele repassa tudo ao WSL2. Este script e o caminho para quem nao quer WSL. As
  duas instalacoes sao independentes e nao se enxergam: o .bat escreve no home da
  distribuicao, este aqui em C:\Users\<voce>\.poligome-sam.

  O conector e o mesmo arquivo nos dois casos, e ele ja resolve o venv por
  familia com Scripts\python.exe quando os.name == "nt".

.PARAMETER Model
  Identificador do modelo. Sem ele, o script abre um menu com os dez.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File poligome-sam-windows-native.ps1 sam2.1-hiera-small
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [string] $Model,
  [switch] $Help
)

# Continue, e nao Stop, de proposito: o PowerShell 5.1 embrulha cada linha de
# stderr de um .exe num ErrorRecord, entao com Stop um aviso do pip, ou o
# "No suitable Python runtime found" que o py.exe imprime quando sondamos uma
# versao ausente, abortaria a instalacao inteira. Este script decide pelo codigo
# de saida e por verificacoes de resultado (tamanho do arquivo, import do
# runtime, /health), nunca por ausencia de mensagem em stderr.
$ErrorActionPreference = 'Continue'
# Invoke-WebRequest com barra de progresso fica ordens de grandeza mais lento em
# arquivos grandes; o checkpoint do SAM 3 tem 3,45 GB.
$ProgressPreference = 'SilentlyContinue'

$POLIGOME_SAM_INSTALLER_API = 2

$DefaultSiteUrl = 'https://www.poligome.com'
$DefaultAssetBaseUrl = 'https://raw.githubusercontent.com/eduardoafonso1089/poligome/main/public'
$DefaultConnectorSha256 = '79bd0246a9b66ec8c68eb94a384abad77dc82af4d1471bb11ef1cb0b4edb1bf1'

$SiteUrl = if ($env:POLIGOME_SITE_URL) { $env:POLIGOME_SITE_URL.TrimEnd('/') } else { $DefaultSiteUrl }
$AssetBaseUrl = if ($env:POLIGOME_ASSET_BASE_URL) { $env:POLIGOME_ASSET_BASE_URL.TrimEnd('/') } else { $DefaultAssetBaseUrl }
$AssetBaseOverridden = [bool]$env:POLIGOME_ASSET_BASE_URL

$AppDir = Join-Path $env:USERPROFILE '.poligome-sam'
$VenvsDir = Join-Path $AppDir 'venvs'
$ModelsDir = Join-Path $AppDir 'models'
$Connector = Join-Path $AppDir 'poligome-sam-local.py'
$SelectedModelFile = Join-Path $AppDir 'selected-model.txt'
$PendingModelFile = Join-Path $AppDir 'pending-model.txt'
$Port = 7860
$StartupTimeout = if ($env:POLIGOME_STARTUP_TIMEOUT) { [int]$env:POLIGOME_STARTUP_TIMEOUT } else { 1800 }
# auto escolhe CUDA e depois CPU. Forcar cpu e a saida de quem tem uma GPU que o
# PyTorch enxerga mas que nao aguenta o modelo. mps nao existe no Windows.
$Device = if ($env:POLIGOME_DEVICE) { $env:POLIGOME_DEVICE } else { 'auto' }

$Sam2Revision = '2b90b9f5ceec907a1c18123530e92e794ad901a4'
$Sam3Revision = '8f0b7f4d4e7eda2ed606ebde6702c93359ad01da'
# As rodas oficiais do PyTorch CUDA 12.8 trazem kernels de sm_70 em diante.
$Sam3MinComputeMajor = 7
# O conector sai com este codigo quando /load pede outra familia; ver
# _exec_with_model em poligome-sam-local.py.
$SwitchExitCode = 75

function Fail([string] $Message) {
  Write-Host ''
  Write-Host "Erro: $Message" -ForegroundColor Red
  exit 1
}

function Show-Usage {
  @'
Poligome SAM local - instalador nativo de Windows

Uso:
  powershell -ExecutionPolicy Bypass -File poligome-sam-windows-native.ps1 [MODELO]
  powershell -ExecutionPolicy Bypass -File poligome-sam-windows-native.ps1 -Help

Modelos aceitos:
  sam2.1-hiera-tiny
  sam2.1-hiera-small         (recomendado)
  sam2.1-hiera-base-plus
  sam2.1-hiera-large
  medsam2-latest             (alias aceito: medsam2)
  medsam2-ct-lesion          (alias aceito: medsam2-ct)
  medsam2-mri-liver-lesion   (alias aceito: medsam2-mri)
  medsam2-us-heart           (alias aceito: medsam2-us)
  medsam2-2411
  sam3-concepts              (alias aceito: sam3)

Sem MODELO, o instalador abre um menu. O SAM 3 exige GPU NVIDIA, Python 3.12+ e
acesso aprovado ao checkpoint gated da Meta no Hugging Face.

Este instalador NAO usa WSL2. Para o caminho por WSL2, use
poligome-sam-windows.bat; as duas instalacoes sao independentes.

Variaveis opcionais:
  POLIGOME_SITE_URL        URL HTTPS aberta no navegador e aceita no CORS
  POLIGOME_ASSET_BASE_URL  origem HTTPS publica dos arquivos do instalador
  POLIGOME_CONNECTOR_PATH  conector local explicito para desenvolvimento/offline
  POLIGOME_STARTUP_TIMEOUT segundos maximos para o primeiro carregamento (1800)
  POLIGOME_DEVICE          auto (padrao), cpu ou cuda
'@ | Write-Host
}

# ---------------------------------------------------------------- catalogo ---

$ModelAliases = @{
  'medsam2'       = 'medsam2-latest'
  'medsam2-ct'    = 'medsam2-ct-lesion'
  'medsam2-mri'   = 'medsam2-mri-liver-lesion'
  'medsam2-us'    = 'medsam2-us-heart'
  'sam3'          = 'sam3-concepts'
}

$Sam2TinyConfig = 'configs/sam2.1/sam2.1_hiera_t.yaml'
$ModelCatalog = [ordered]@{
  'sam2.1-hiera-tiny' = @{
    Family = 'sam2'; CheckpointName = 'sam2.1_hiera_tiny.pt'
    Url = 'https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_tiny.pt'
    Size = 156008466; Config = $Sam2TinyConfig
  }
  'sam2.1-hiera-small' = @{
    Family = 'sam2'; CheckpointName = 'sam2.1_hiera_small.pt'
    Url = 'https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_small.pt'
    Size = 184416285; Config = 'configs/sam2.1/sam2.1_hiera_s.yaml'
  }
  'sam2.1-hiera-base-plus' = @{
    Family = 'sam2'; CheckpointName = 'sam2.1_hiera_base_plus.pt'
    Url = 'https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_base_plus.pt'
    Size = 323606802; Config = 'configs/sam2.1/sam2.1_hiera_b+.yaml'
  }
  'sam2.1-hiera-large' = @{
    Family = 'sam2'; CheckpointName = 'sam2.1_hiera_large.pt'
    Url = 'https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_large.pt'
    Size = 898083611; Config = 'configs/sam2.1/sam2.1_hiera_l.yaml'
  }
  'medsam2-latest' = @{
    Family = 'sam2'; CheckpointName = 'MedSAM2_latest.pt'
    Url = 'https://huggingface.co/wanglab/MedSAM2/resolve/main/MedSAM2_latest.pt'
    Size = 156040129; Config = $Sam2TinyConfig
  }
  'medsam2-ct-lesion' = @{
    Family = 'sam2'; CheckpointName = 'MedSAM2_CTLesion.pt'
    Url = 'https://huggingface.co/wanglab/MedSAM2/resolve/main/MedSAM2_CTLesion.pt'
    Size = 156041079; Config = $Sam2TinyConfig
  }
  'medsam2-mri-liver-lesion' = @{
    Family = 'sam2'; CheckpointName = 'MedSAM2_MRI_LiverLesion.pt'
    Url = 'https://huggingface.co/wanglab/MedSAM2/resolve/main/MedSAM2_MRI_LiverLesion.pt'
    Size = 156044532; Config = $Sam2TinyConfig
  }
  'medsam2-us-heart' = @{
    Family = 'sam2'; CheckpointName = 'MedSAM2_US_Heart.pt'
    Url = 'https://huggingface.co/wanglab/MedSAM2/resolve/main/MedSAM2_US_Heart.pt'
    Size = 156041079; Config = $Sam2TinyConfig
  }
  'medsam2-2411' = @{
    Family = 'sam2'; CheckpointName = 'MedSAM2_2411.pt'
    Url = 'https://huggingface.co/wanglab/MedSAM2/resolve/main/MedSAM2_2411.pt'
    Size = 156039179; Config = $Sam2TinyConfig
  }
  'sam3-concepts' = @{
    Family = 'sam3'; CheckpointName = 'sam3.pt'
    Url = ''; Size = 3450062241; Config = ''
  }
}

function Resolve-ModelId([string] $Value) {
  $normalized = $Value.Trim().ToLowerInvariant()
  if ($ModelAliases.ContainsKey($normalized)) { $normalized = $ModelAliases[$normalized] }
  if (-not $ModelCatalog.Contains($normalized)) { return $null }
  return $normalized
}

function Select-ModelInteractively {
  $ids = @($ModelCatalog.Keys)
  Write-Host ''
  Write-Host 'Escolha o modelo:'
  Write-Host ''
  $labels = @(
    'SAM 2.1 Hiera Tiny        (~156 MB; roda em CPU)',
    'SAM 2.1 Hiera Small       (~184 MB; recomendado, roda em CPU)',
    'SAM 2.1 Hiera Base+       (~324 MB; roda em CPU)',
    'SAM 2.1 Hiera Large       (~898 MB; roda em CPU)',
    'MedSAM2                   (imagem medica geral)',
    'MedSAM2 lesao em TC       (tomografia)',
    'MedSAM2 lesao em RM       (figado)',
    'MedSAM2 ecocardiograma    (ultrassom)',
    'MedSAM2 2411              (versao anterior)',
    'SAM 3 Concepts            (~3,45 GB; exige GPU NVIDIA)'
  )
  for ($i = 0; $i -lt $ids.Count; $i++) {
    Write-Host ('  {0,2}) {1}' -f ($i + 1), $labels[$i])
  }
  Write-Host ''
  $answer = Read-Host 'Digite 1-10 ou o ID completo'
  if ($answer -match '^\d+$') {
    $index = [int]$answer - 1
    if ($index -ge 0 -and $index -lt $ids.Count) { return $ids[$index] }
    return $null
  }
  return (Resolve-ModelId $answer)
}

# ----------------------------------------------------------------- rede ------

function Assert-Https([string] $Url) {
  if ($Url -notmatch '^https://') { Fail "download recusado porque a URL nao usa HTTPS: $Url" }
  if ($Url -match '[\s?#]') { Fail "URL HTTPS invalida; consultas, fragmentos e espacos nao sao aceitos: $Url" }
  $authority = ($Url -replace '^https://', '') -split '/' | Select-Object -First 1
  if (-not $authority -or $authority.Contains('@')) { Fail "URL HTTPS invalida; host ausente ou credenciais embutidas: $Url" }
}

function Get-FileSize([string] $Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return 0L }
  return (Get-Item -LiteralPath $Path).Length
}

function Invoke-AtomicDownload([string] $Url, [string] $Destination, [long] $ExpectedSize) {
  Assert-Https $Url
  $parent = Split-Path -Parent $Destination
  if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Force $parent | Out-Null }
  $partial = "$Destination.part"
  if (Test-Path -LiteralPath $partial) { Remove-Item -LiteralPath $partial -Force }
  try {
    # -ErrorAction Stop porque a preferencia global e Continue: sem isso o catch
    # abaixo nunca rodaria e um 404 viraria apenas um arquivo vazio.
    Invoke-WebRequest -Uri $Url -OutFile $partial -UseBasicParsing -MaximumRedirection 5 -ErrorAction Stop
  } catch {
    if (Test-Path -LiteralPath $partial) { Remove-Item -LiteralPath $partial -Force }
    Fail "nao foi possivel baixar o arquivo esperado de ${Url}: $($_.Exception.Message)"
  }
  $actual = Get-FileSize $partial
  if ($ExpectedSize -gt 0 -and $actual -ne $ExpectedSize) {
    Remove-Item -LiteralPath $partial -Force
    Fail "o download de $Url ficou incompleto ($actual bytes; esperado: $ExpectedSize)."
  }
  Move-Item -LiteralPath $partial -Destination $Destination -Force
}

function Test-ConnectorCompatible([string] $Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
  $text = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
  return ($text -match '(?m)^API_VERSION = 2$') -and ($text.Contains('"--model"'))
}

function Install-Connector {
  if ($env:POLIGOME_CONNECTOR_PATH) {
    if (-not (Test-Path -LiteralPath $env:POLIGOME_CONNECTOR_PATH)) {
      Fail "POLIGOME_CONNECTOR_PATH aponta para um arquivo que nao existe: $env:POLIGOME_CONNECTOR_PATH"
    }
    Copy-Item -LiteralPath $env:POLIGOME_CONNECTOR_PATH -Destination $Connector -Force
  } else {
    $url = "$AssetBaseUrl/poligome-sam-local.py"
    Write-Host 'Baixando o conector local...'
    Invoke-AtomicDownload $url $Connector 0
    if (-not $AssetBaseOverridden) {
      # O pino de integridade so vale para a origem oficial: uma origem passada
      # a mao e, por definicao, outro arquivo.
      $hash = (Get-FileHash -LiteralPath $Connector -Algorithm SHA256).Hash.ToLowerInvariant()
      if ($hash -ne $DefaultConnectorSha256) {
        Remove-Item -LiteralPath $Connector -Force
        Fail "o conector baixado nao confere com a soma oficial (esperado $DefaultConnectorSha256, obtido $hash)."
      }
    }
  }
  if (-not (Test-ConnectorCompatible $Connector)) {
    Fail 'o conector obtido nao e compativel com este instalador (API 2).'
  }
}

# ---------------------------------------------------------------- python -----

function Find-SystemPython([int] $MinorMinimum) {
  $candidates = @()
  if (Get-Command py -ErrorAction SilentlyContinue) {
    foreach ($minor in 13, 12, 11, 10) {
      if ($minor -ge $MinorMinimum) { $candidates += , @('py', "-3.$minor") }
    }
  }
  foreach ($name in 'python3', 'python') {
    $command = Get-Command $name -ErrorAction SilentlyContinue
    if ($command) { $candidates += , @($command.Source) }
  }
  foreach ($candidate in $candidates) {
    $exe = $candidate[0]
    $prefix = @($candidate | Select-Object -Skip 1)
    $probe = @($prefix) + @('-c', "import sys; raise SystemExit(0 if sys.version_info >= (3, $MinorMinimum) else 1)")
    & $exe @probe 2>$null
    if ($LASTEXITCODE -eq 0) { return , $candidate }
  }
  return $null
}

function Initialize-Venv([string] $Family, [string] $VenvDir, [string] $VenvPython) {
  $minorMinimum = if ($Family -eq 'sam3') { 12 } else { 10 }

  if (Test-Path -LiteralPath $VenvPython) {
    & $VenvPython -c "import sys; raise SystemExit(0 if sys.version_info >= (3, $minorMinimum) else 1)" 2>$null
    if ($LASTEXITCODE -ne 0) {
      $backup = "$VenvDir.incompatible-" + (Get-Date -Format 'yyyyMMddHHmmss')
      Write-Host "Preservando o ambiente Python incompativel em $backup e recriando o runtime..."
      Move-Item -LiteralPath $VenvDir -Destination $backup -Force
    }
  }

  if (-not (Test-Path -LiteralPath $VenvPython)) {
    $system = Find-SystemPython $minorMinimum
    if (-not $system) {
      Fail "Python 3.$minorMinimum+ nao foi encontrado. Instale-o de https://www.python.org/downloads/windows/ marcando 'Add python.exe to PATH' e execute de novo."
    }
    $exe = $system[0]
    $prefix = @($system | Select-Object -Skip 1)
    Write-Host "Criando ambiente isolado da familia $Family com $exe $prefix..."
    New-Item -ItemType Directory -Force $VenvsDir | Out-Null
    $venvArgs = @($prefix) + @('-m', 'venv', $VenvDir)
    & $exe @venvArgs
    if ($LASTEXITCODE -ne 0) { Fail 'nao foi possivel criar o ambiente virtual.' }
  }

  & $VenvPython -c "import sys; raise SystemExit(0 if sys.version_info >= (3, $minorMinimum) else 1)" 2>$null
  if ($LASTEXITCODE -ne 0) { Fail "o ambiente $VenvDir nao pode ser criado com Python 3.$minorMinimum+." }
}

function Install-Runtime([string] $Family, [string] $VenvDir, [string] $VenvPython) {
  $revision = if ($Family -eq 'sam3') { $Sam3Revision } else { $Sam2Revision }
  $marker = Join-Path $VenvDir ".poligome-$Family-$revision.ok"

  # A prova de que o runtime está instalado é ele importar, não um arquivo ao lado
  # dele existir. O marcador é só atalho: perdê-lo não pode custar ao usuário o
  # download do PyTorch de novo, que foi o que aconteceu aqui.
  $probe = if ($Family -eq 'sam3') {
    'import cv2, fastapi, torch, uvicorn; from sam3.model.sam3_image_processor import Sam3Processor; from sam3.model_builder import build_sam3_image_model'
  } else {
    'import cv2, fastapi, torch, uvicorn; from sam2.build_sam import build_sam2; from sam2.sam2_image_predictor import SAM2ImagePredictor'
  }
  if (Test-Path -LiteralPath $VenvPython) {
    & $VenvPython -c $probe 2>$null
    if ($LASTEXITCODE -eq 0) {
      if (-not (Test-Path -LiteralPath $marker)) { New-Item -ItemType File -Force -Path $marker | Out-Null }
      return
    }
  }

  Write-Host "Instalando dependencias oficiais da familia $Family. Isso pode demorar..."
  & $VenvPython -m pip install --upgrade pip wheel
  if ($LASTEXITCODE -ne 0) { Fail 'falha ao atualizar pip e wheel.' }

  if ($Family -eq 'sam3') {
    # A revisao fixada do SAM 3 ainda importa pkg_resources, removido no 81+.
    & $VenvPython -m pip install --upgrade 'setuptools<81'
    & $VenvPython -m pip install torch==2.10.0 torchvision --index-url https://download.pytorch.org/whl/cu128
    if ($LASTEXITCODE -ne 0) { Fail 'falha ao instalar o PyTorch CUDA 12.8 do SAM 3.' }
    & $VenvPython -m pip install "https://github.com/facebookresearch/sam3/archive/$Sam3Revision.zip"
    if ($LASTEXITCODE -ne 0) { Fail 'falha ao instalar o pacote oficial do SAM 3.' }
    # A revisao oficial usa estes pacotes no import principal mas os declara
    # apenas como extras, ou nao os declara.
    & $VenvPython -m pip install fastapi uvicorn pillow einops huggingface_hub psutil pycocotools 'opencv-python-headless<4.12' 'numpy<2'
  } else {
    & $VenvPython -m pip install --upgrade setuptools
    & $VenvPython -m pip install 'torch>=2.5.1' 'torchvision>=0.20.1'
    if ($LASTEXITCODE -ne 0) { Fail 'falha ao instalar o PyTorch.' }
    # Sem isto o pacote tenta compilar a extensao CUDA, que no Windows exige o
    # MSVC e o nvcc casados; o proprio upstream trata a extensao como opcional.
    $previous = $env:SAM2_BUILD_CUDA
    $env:SAM2_BUILD_CUDA = '0'
    try {
      & $VenvPython -m pip install "https://github.com/facebookresearch/sam2/archive/$Sam2Revision.zip"
    } finally {
      $env:SAM2_BUILD_CUDA = $previous
    }
    if ($LASTEXITCODE -ne 0) { Fail 'falha ao instalar o pacote oficial do SAM 2.1.' }
    & $VenvPython -m pip install fastapi uvicorn pillow opencv-python-headless numpy
  }
  if ($LASTEXITCODE -ne 0) { Fail "falha ao instalar as dependencias de runtime da familia $Family." }

  Write-Host "Verificando imports do runtime $Family..."
  $verify = if ($Family -eq 'sam3') {
    'import cv2, fastapi, huggingface_hub, pkg_resources, torch, uvicorn; from sam3.model.sam3_image_processor import Sam3Processor; from sam3.model_builder import build_sam3_image_model'
  } else {
    'import cv2, fastapi, torch, uvicorn; from sam2.build_sam import build_sam2; from sam2.sam2_image_predictor import SAM2ImagePredictor'
  }
  & $VenvPython -c $verify
  if ($LASTEXITCODE -ne 0) {
    Fail "as dependencias da familia $Family foram instaladas, mas o teste de importacao acima falhou."
  }
  New-Item -ItemType File -Force -Path $marker | Out-Null
}

function Assert-RuntimeDevice([string] $Family, [string] $VenvPython) {
  if ($Family -ne 'sam3') { return }
  & $VenvPython -c 'import torch; raise SystemExit(0 if torch.cuda.is_available() else 1)' 2>$null
  if ($LASTEXITCODE -ne 0) {
    Fail 'o PyTorch do SAM 3 nao conseguiu usar a GPU NVIDIA. Confirme driver e compatibilidade CUDA 12.6+.'
  }
  # torch.cuda.is_available() responde "sim" mesmo quando a instalacao nao tem
  # kernel para a arquitetura da placa; ai o carregamento morre com "no kernel
  # image is available", que nao diz o que houve.
  $diagnostic = & $VenvPython -c @'
import torch
major, minor = torch.cuda.get_device_capability(0)
compiladas = [a for a in torch.cuda.get_arch_list() if a.startswith("sm_")]
suportadas = {int(a.removeprefix("sm_")) for a in compiladas}
if suportadas and (major * 10 + minor) not in suportadas:
    print(f"{torch.cuda.get_device_name(0)} tem capability {major}.{minor}, e este PyTorch traz kernels apenas para {', '.join(compiladas)}")
'@ 2>$null
  if ($diagnostic) {
    Fail "a GPU nao e compativel com o PyTorch instalado para o SAM 3: $diagnostic. O modelo nao chegaria a carregar. Escolha um SAM 2.1 ou MedSAM2, que rodam nesta maquina."
  }
}

function Assert-Sam3Platform {
  if (-not (Get-Command nvidia-smi -ErrorAction SilentlyContinue)) {
    Fail 'o SAM 3 exige uma GPU NVIDIA; nvidia-smi nao foi encontrado. Escolha um SAM 2.1 ou MedSAM2, que rodam em CPU.'
  }
  # Recusar aqui evita 11 GB de download para terminar num erro de CUDA.
  $capabilities = & nvidia-smi --query-gpu=name,compute_cap --format=csv,noheader 2>$null
  if ($LASTEXITCODE -eq 0 -and $capabilities) {
    foreach ($line in @($capabilities)) {
      $parts = $line -split ','
      if ($parts.Count -lt 2) { continue }
      $name = $parts[0].Trim()
      $major = [int]($parts[1].Trim() -split '\.')[0]
      if ($major -lt $Sam3MinComputeMajor) {
        Fail "a placa $name tem compute capability $($parts[1].Trim()), e o PyTorch CUDA 12.8 do SAM 3 traz kernels apenas de sm_$($Sam3MinComputeMajor)0 em diante. Escolha um SAM 2.1 ou MedSAM2."
      }
    }
  }
}

# ------------------------------------------------------------- checkpoint ----

function Test-CheckpointValid([string] $Path, [long] $ExpectedSize) {
  return (Get-FileSize $Path) -eq $ExpectedSize
}

function Invoke-Hf([string] $VenvPython, [string[]] $HfArgs) {
  # O console script hf.exe grava o caminho do interpretador dentro do binario e
  # para de funcionar se a pasta do app for renomeada; chamar o modulo pelo
  # proprio python do venv nao tem esse problema.
  & $VenvPython -m huggingface_hub.commands.huggingface_cli @HfArgs
}

function Install-Sam3Checkpoint([string] $VenvPython, [string] $Destination) {
  Invoke-Hf $VenvPython @('auth', 'whoami') *> $null
  if ($LASTEXITCODE -ne 0) {
    Write-Host ''
    Write-Host 'O checkpoint do SAM 3 e gated: a Meta precisa aprovar a sua conta.'
    Write-Host '  1. Crie a conta em https://huggingface.co/join'
    Write-Host '  2. Peca acesso em https://huggingface.co/facebook/sam3'
    Write-Host '  3. Acompanhe em https://huggingface.co/settings/gated-repos'
    Write-Host ''
    Write-Host 'Abrindo o login oficial do Hugging Face; o Poligome nao le nem guarda o seu token.'
    Invoke-Hf $VenvPython @('auth', 'login')
    if ($LASTEXITCODE -ne 0) { Fail 'o login no Hugging Face nao foi concluido.' }
  }
  $target = Split-Path -Parent $Destination
  New-Item -ItemType Directory -Force $target | Out-Null
  Invoke-Hf $VenvPython @('download', 'facebook/sam3', 'sam3.pt', '--local-dir', $target)
  if ($LASTEXITCODE -ne 0) {
    Fail 'nao foi possivel baixar o checkpoint gated do SAM 3. Confirme que o acesso foi aprovado em https://huggingface.co/settings/gated-repos'
  }
}

# ------------------------------------------------------------- conector ------

function Get-ServerState([string] $VenvPython, [string] $ExpectedModel) {
  $state = & $VenvPython -c @"
import json, urllib.request
try:
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open('http://127.0.0.1:$Port/health', timeout=2) as response:
        payload = json.load(response)
except Exception:
    print('offline'); raise SystemExit(0)
if payload.get('service') != 'Poligome SAM local' or payload.get('api_version') != 2:
    print('mismatch')
elif payload.get('model_id') != '$ExpectedModel':
    print('mismatch')
elif payload.get('status') in {'loading', 'ready', 'error'}:
    print(payload['status'])
else:
    print('unhealthy')
"@ 2>$null
  if (-not $state) { return 'offline' }
  return ($state | Select-Object -Last 1).Trim()
}

function Get-ServerError([string] $VenvPython) {
  $message = & $VenvPython -c @"
import json, urllib.request
try:
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open('http://127.0.0.1:$Port/health', timeout=2) as response:
        payload = json.load(response)
except Exception:
    raise SystemExit(0)
print(str(payload.get('error') or 'erro nao detalhado').replace(chr(10), ' ')[:500])
"@ 2>$null
  if ($message) { return ($message | Select-Object -Last 1).Trim() }
  return 'erro nao detalhado'
}

function Test-PortInUse {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $async = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
    $ok = $async.AsyncWaitHandle.WaitOne(1000)
    if ($ok -and $client.Connected) { return $true }
    return $false
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

function Save-Selection([string] $Path, [string] $Value) {
  New-Item -ItemType Directory -Force $AppDir | Out-Null
  $partial = "$Path.part"
  # Sem BOM: o conector e os iniciadores leem este arquivo como texto simples.
  [System.IO.File]::WriteAllText($partial, "$Value`n", (New-Object System.Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $partial -Destination $Path -Force
}

function Get-SiteOrigin {
  Assert-Https $SiteUrl
  $authority = ($SiteUrl -replace '^https://', '') -split '/' | Select-Object -First 1
  if ($authority.EndsWith(':443')) { $authority = $authority.Substring(0, $authority.Length - 4) }
  return "https://$authority"
}

# =================================================================== main ====

if ($Help -or $Model -in @('--help', '-h', '/?')) { Show-Usage; exit 0 }

if ($Device -notin @('auto', 'cpu', 'cuda')) {
  Fail "POLIGOME_DEVICE aceita auto, cpu ou cuda no Windows; recebido: $Device"
}
if ($StartupTimeout -le 0) { Fail 'POLIGOME_STARTUP_TIMEOUT deve ser um numero inteiro positivo de segundos.' }

$siteOrigin = Get-SiteOrigin
if (-not $env:POLIGOME_CONNECTOR_PATH) { Assert-Https $AssetBaseUrl }

if ($Model) {
  $modelId = Resolve-ModelId $Model
  if (-not $modelId) { Show-Usage; Fail "modelo invalido: $Model" }
} else {
  $modelId = Select-ModelInteractively
  if (-not $modelId) { Fail 'modelo invalido; rode de novo e escolha um numero de 1 a 10.' }
}

$spec = $ModelCatalog[$modelId]
$family = $spec.Family
$venvDir = Join-Path $VenvsDir $family
$venvPython = Join-Path $venvDir 'Scripts\python.exe'
$checkpoint = Join-Path (Join-Path $ModelsDir $modelId) $spec.CheckpointName

Write-Host ''
Write-Host '=========================================='
Write-Host " Poligome SAM local (Windows nativo) - $modelId"
Write-Host '=========================================='
Write-Host ''

if ($family -eq 'sam3') { Assert-Sam3Platform }

New-Item -ItemType Directory -Force $AppDir, $VenvsDir, $ModelsDir | Out-Null
Save-Selection $PendingModelFile $modelId
Install-Connector
Initialize-Venv $family $venvDir $venvPython
Install-Runtime $family $venvDir $venvPython
Assert-RuntimeDevice $family $venvPython

if (-not (Test-CheckpointValid $checkpoint $spec.Size)) {
  if (Test-Path -LiteralPath $checkpoint) {
    Write-Host 'O checkpoint existente esta incompleto ou nao corresponde ao arquivo oficial; baixando uma copia integra.'
  }
  Write-Host "Baixando checkpoint oficial $($spec.CheckpointName)..."
  if ($family -eq 'sam3') {
    Install-Sam3Checkpoint $venvPython $checkpoint
  } else {
    Invoke-AtomicDownload $spec.Url $checkpoint $spec.Size
  }
  if (-not (Test-CheckpointValid $checkpoint $spec.Size)) {
    Fail 'o checkpoint instalado nao passou na validacao final de tamanho.'
  }
}

switch (Get-ServerState $venvPython $modelId) {
  'ready' {
    Save-Selection $SelectedModelFile $modelId
    Remove-Item -LiteralPath $PendingModelFile -Force -ErrorAction SilentlyContinue
    Write-Host ''
    Write-Host "O modelo $modelId ja esta carregado pelo conector na porta $Port."
    exit 0
  }
  'loading' {
    Write-Host "O conector ja esta carregando $modelId; aguardando o modelo ficar pronto..."
  }
  { $_ -in 'error', 'mismatch', 'unhealthy' } {
    Fail "a porta $Port ja esta ocupada por um conector com erro, outro modelo ou outro servico. Feche-o e execute novamente."
  }
  default {
    if (Test-PortInUse) { Fail "a porta $Port ja esta ocupada por outro processo. Feche-o e execute novamente." }
  }
}

# O conector sai com SWITCH_EXIT_CODE quando /load pede outra familia. No Windows
# nao ha execv de verdade, entao quem relanca e este laco: ele reconsulta o
# selected-model.txt, que /load acabou de gravar, e sobe o venv certo.
$env:POLIGOME_ALLOWED_ORIGINS = "$siteOrigin,http://localhost:5173,http://127.0.0.1:5173"
$firstRun = $true
while ($true) {
  $spec = $ModelCatalog[$modelId]
  $family = $spec.Family
  $venvDir = Join-Path $VenvsDir $family
  $venvPython = Join-Path $venvDir 'Scripts\python.exe'
  $checkpoint = Join-Path (Join-Path $ModelsDir $modelId) $spec.CheckpointName

  if (-not (Test-Path -LiteralPath $venvPython)) {
    Fail "a troca pediu $modelId, mas o ambiente da familia $family nao esta instalado. Rode este instalador para esse modelo."
  }

  $arguments = @($Connector, '--model', $modelId, '--checkpoint', $checkpoint)
  if ($spec.Config) { $arguments += @('--model-config', $spec.Config) }
  $arguments += @('--device', $Device, '--port', "$Port", '--app-dir', $AppDir)

  Write-Host "Iniciando o conector e aguardando $modelId ficar pronto..."
  $process = Start-Process -FilePath $venvPython -ArgumentList $arguments -NoNewWindow -PassThru
  # Tocar em Handle faz o .NET guardar o handle do processo; sem isso o
  # ExitCode volta vazio depois que o processo sai.
  $null = $process.Handle

  $deadline = (Get-Date).AddSeconds($StartupTimeout)
  $ready = $false
  while ((Get-Date) -lt $deadline) {
    if ($process.HasExited) { break }
    switch (Get-ServerState $venvPython $modelId) {
      'ready' { $ready = $true }
      'error' {
        $message = Get-ServerError $venvPython
        if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
        Fail "o modelo $modelId nao conseguiu carregar: $message"
      }
      { $_ -in 'mismatch', 'unhealthy' } {
        if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
        Fail "a porta $Port respondeu com um servico ou modelo diferente durante a inicializacao."
      }
    }
    if ($ready) { break }
    Start-Sleep -Seconds 2
  }

  if ($ready) {
    Save-Selection $SelectedModelFile $modelId
    Remove-Item -LiteralPath $PendingModelFile -Force -ErrorAction SilentlyContinue
    if ($firstRun) {
      Write-Host ''
      Write-Host "Modelo $modelId instalado, carregado e selecionado."
      Write-Host "A selecao foi salva em $SelectedModelFile."
      Start-Process $SiteUrl | Out-Null
      $firstRun = $false
    } else {
      Write-Host "Modelo $modelId carregado."
    }
    Write-Host 'Mantenha esta janela aberta enquanto usar o SAM.'
    Write-Host ''
  } elseif (-not $process.HasExited) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    Fail "o carregamento de $modelId excedeu $StartupTimeout segundos."
  }

  $process.WaitForExit()
  $code = $process.ExitCode
  if ($code -ne $SwitchExitCode) {
    if ($code -ne 0) { Fail "o conector terminou com codigo $code." }
    exit 0
  }

  if (-not (Test-Path -LiteralPath $SelectedModelFile)) {
    Fail 'o conector pediu uma troca de modelo, mas nao ha selecao gravada para retomar.'
  }
  $requested = (Get-Content -LiteralPath $SelectedModelFile -TotalCount 1).Trim()
  $next = Resolve-ModelId $requested
  if (-not $next) { Fail "a troca pediu um modelo desconhecido: $requested" }
  Write-Host ''
  Write-Host "Trocando para $next a pedido do editor..."
  $modelId = $next
}
