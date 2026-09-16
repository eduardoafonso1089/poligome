@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion
title Poligome SAM local - instalar modelo
set "POLIGOME_SAM_WINDOWS_INSTALLER_API=2"

set "DEFAULT_SITE_URL=https://www.poligome.com"
set "DEFAULT_ASSET_BASE_URL=https://raw.githubusercontent.com/eduardoafonso1089/poligome/main/public"
set "DEFAULT_CONNECTOR_URL=%DEFAULT_ASSET_BASE_URL%/poligome-sam-local.py"
set "DEFAULT_CONNECTOR_SHA256=d58d8d6ddf92d2e2378eab50ea39e27217d8a7ddb94106c6e237ae0716165b33"
set "SITE_URL=%POLIGOME_SITE_URL%"
if not defined SITE_URL set "SITE_URL=%DEFAULT_SITE_URL%"
if "!SITE_URL:~-1!"=="/" set "SITE_URL=!SITE_URL:~0,-1!"
set "ASSET_BASE_URL=%POLIGOME_ASSET_BASE_URL%"
if defined ASSET_BASE_URL (
  set "ASSET_BASE_OVERRIDDEN=1"
  if "!ASSET_BASE_URL:~-1!"=="/" set "ASSET_BASE_URL=!ASSET_BASE_URL:~0,-1!"
  set "CONNECTOR_URL=!ASSET_BASE_URL!/poligome-sam-local.py"
  set "CONNECTOR_SHA256="
) else (
  set "ASSET_BASE_OVERRIDDEN="
  set "ASSET_BASE_URL=%DEFAULT_ASSET_BASE_URL%"
  set "CONNECTOR_URL=%DEFAULT_CONNECTOR_URL%"
  set "CONNECTOR_SHA256=%DEFAULT_CONNECTOR_SHA256%"
)
set "APP_DIR=%LOCALAPPDATA%\PoligomeSAM"
set "BIN_DIR=%APP_DIR%\bin"
set "INSTALLER_CACHE=%BIN_DIR%\poligome-sam-windows.bat"
set "SELECTED_MODEL_FILE=%APP_DIR%\selected-model.txt"
set "PENDING_MODEL_FILE=%APP_DIR%\pending-model.txt"
set "PORT=7860"

if /I "%~1"=="--help" goto :help
if /I "%~1"=="-h" goto :help
if /I "%~1"=="/?" goto :help
if not "%~2"=="" goto :too_many_args
call :validate_site_url
if errorlevel 1 goto :site_error
call :derive_site_origin
if errorlevel 1 goto :site_error
call :validate_asset_base_url
if errorlevel 1 goto :asset_base_error

set "MODEL_ID=%~1"
if not defined MODEL_ID (
  call :choose_model
  if errorlevel 1 goto :invalid_model
)
call :normalize_model_id
if errorlevel 1 goto :invalid_model

call :set_model_metadata
if errorlevel 1 goto :invalid_model
call :cache_windows_installer
if errorlevel 1 goto :state_error
call :stage_windows_selection
if errorlevel 1 goto :state_error
goto :install_wsl_model

:choose_model
echo.
echo Escolha o modelo:
echo.
echo   1^) SAM 2.1 Hiera Tiny   ^(instalação automática no WSL2^)
echo   2^) SAM 2.1 Hiera Small  ^(WSL2; recomendado^)
echo   3^) SAM 2.1 Hiera Base+  ^(instalação automática no WSL2^)
echo   4^) SAM 2.1 Hiera Large  ^(instalação automática no WSL2^)
echo   5^) MedSAM2              ^(imagem medica geral; WSL2^)
echo   6^) MedSAM2 lesao em TC  ^(tomografia; WSL2^)
echo   7^) MedSAM2 lesao em RM  ^(figado; WSL2^)
echo   8^) MedSAM2 ecocardio    ^(ultrassom; WSL2^)
echo   9^) MedSAM2 2411         ^(versao anterior; WSL2^)
echo  10^) SAM 3 Concepts       ^(WSL2 + GPU NVIDIA^)
echo.
set /p "MODEL_CHOICE=Digite 1-10 ou o ID completo: "
if "!MODEL_CHOICE!"=="1" (
  set "MODEL_ID=sam2.1-hiera-tiny"
  exit /b 0
)
if "!MODEL_CHOICE!"=="2" (
  set "MODEL_ID=sam2.1-hiera-small"
  exit /b 0
)
if "!MODEL_CHOICE!"=="3" (
  set "MODEL_ID=sam2.1-hiera-base-plus"
  exit /b 0
)
if "!MODEL_CHOICE!"=="4" (
  set "MODEL_ID=sam2.1-hiera-large"
  exit /b 0
)
if "!MODEL_CHOICE!"=="5" (
  set "MODEL_ID=medsam2-latest"
  exit /b 0
)
if "!MODEL_CHOICE!"=="6" (
  set "MODEL_ID=medsam2-ct-lesion"
  exit /b 0
)
if "!MODEL_CHOICE!"=="7" (
  set "MODEL_ID=medsam2-mri-liver-lesion"
  exit /b 0
)
if "!MODEL_CHOICE!"=="8" (
  set "MODEL_ID=medsam2-us-heart"
  exit /b 0
)
if "!MODEL_CHOICE!"=="9" (
  set "MODEL_ID=medsam2-2411"
  exit /b 0
)
if "!MODEL_CHOICE!"=="10" (
  set "MODEL_ID=sam3-concepts"
  exit /b 0
)
set "MODEL_ID=!MODEL_CHOICE!"
if not defined MODEL_ID exit /b 1
exit /b 0

:normalize_model_id
if /I "!MODEL_ID!"=="sam2.1-hiera-tiny" (
  set "MODEL_ID=sam2.1-hiera-tiny"
  exit /b 0
)
if /I "!MODEL_ID!"=="sam2.1-hiera-small" (
  set "MODEL_ID=sam2.1-hiera-small"
  exit /b 0
)
if /I "!MODEL_ID!"=="sam2.1-hiera-base-plus" (
  set "MODEL_ID=sam2.1-hiera-base-plus"
  exit /b 0
)
if /I "!MODEL_ID!"=="sam2.1-hiera-large" (
  set "MODEL_ID=sam2.1-hiera-large"
  exit /b 0
)
if /I "!MODEL_ID!"=="sam3" (
  set "MODEL_ID=sam3-concepts"
  exit /b 0
)
if /I "!MODEL_ID!"=="medsam2-latest" (
  set "MODEL_ID=medsam2-latest"
  exit /b 0
)
if /I "!MODEL_ID!"=="medsam2" (
  set "MODEL_ID=medsam2-latest"
  exit /b 0
)
if /I "!MODEL_ID!"=="medsam2-ct-lesion" (
  set "MODEL_ID=medsam2-ct-lesion"
  exit /b 0
)
if /I "!MODEL_ID!"=="medsam2-ct" (
  set "MODEL_ID=medsam2-ct-lesion"
  exit /b 0
)
if /I "!MODEL_ID!"=="medsam2-mri-liver-lesion" (
  set "MODEL_ID=medsam2-mri-liver-lesion"
  exit /b 0
)
if /I "!MODEL_ID!"=="medsam2-mri" (
  set "MODEL_ID=medsam2-mri-liver-lesion"
  exit /b 0
)
if /I "!MODEL_ID!"=="medsam2-us-heart" (
  set "MODEL_ID=medsam2-us-heart"
  exit /b 0
)
if /I "!MODEL_ID!"=="medsam2-us" (
  set "MODEL_ID=medsam2-us-heart"
  exit /b 0
)
if /I "!MODEL_ID!"=="medsam2-2411" (
  set "MODEL_ID=medsam2-2411"
  exit /b 0
)
if /I "!MODEL_ID!"=="sam3-concepts" (
  set "MODEL_ID=sam3-concepts"
  exit /b 0
)
exit /b 1

:set_model_metadata
set "FAMILY=wsl"
if /I "!MODEL_ID!"=="sam2.1-hiera-tiny" exit /b 0
if /I "!MODEL_ID!"=="sam2.1-hiera-small" exit /b 0
if /I "!MODEL_ID!"=="sam2.1-hiera-base-plus" exit /b 0
if /I "!MODEL_ID!"=="sam2.1-hiera-large" exit /b 0
if /I "!MODEL_ID!"=="medsam2-latest" exit /b 0
if /I "!MODEL_ID!"=="medsam2-ct-lesion" exit /b 0
if /I "!MODEL_ID!"=="medsam2-mri-liver-lesion" exit /b 0
if /I "!MODEL_ID!"=="medsam2-us-heart" exit /b 0
if /I "!MODEL_ID!"=="medsam2-2411" exit /b 0
if /I "!MODEL_ID!"=="sam3-concepts" exit /b 0
exit /b 1

:validate_site_url
powershell -NoProfile -ExecutionPolicy Bypass -Command "$uri=$null; if (-not [Uri]::TryCreate($env:SITE_URL,[UriKind]::Absolute,[ref]$uri)) { exit 1 }; if ($uri.Scheme -ne 'https' -or $uri.UserInfo -or $uri.Query -or $uri.Fragment -or $env:SITE_URL -match '\s') { exit 1 }; exit 0" >nul 2>nul
exit /b %ERRORLEVEL%

:derive_site_origin
set "SITE_ORIGIN="
for /f "delims=" %%O in ('powershell -NoProfile -ExecutionPolicy Bypass -Command "$builder=New-Object System.UriBuilder($env:SITE_URL); if ($builder.Port -eq 443) { $builder.Port=-1 }; $builder.Uri.GetLeftPart([System.UriPartial]::Authority)"') do set "SITE_ORIGIN=%%O"
if not defined SITE_ORIGIN exit /b 1
exit /b 0

:validate_asset_base_url
powershell -NoProfile -ExecutionPolicy Bypass -Command "$uri=$null; if (-not [Uri]::TryCreate($env:ASSET_BASE_URL,[UriKind]::Absolute,[ref]$uri)) { exit 1 }; if ($uri.Scheme -ne 'https' -or $uri.UserInfo -or $uri.Query -or $uri.Fragment -or $env:ASSET_BASE_URL -match '\s') { exit 1 }; exit 0" >nul 2>nul
exit /b %ERRORLEVEL%

:validate_wsl
where wsl.exe >nul 2>nul
if errorlevel 1 exit /b 1
wsl.exe -- bash -lc "command -v bash >/dev/null 2>&1" >nul 2>nul
if errorlevel 1 exit /b 2
wsl.exe -- bash -lc "grep -Eqi '(wsl2|microsoft-standard)' /proc/sys/kernel/osrelease" >nul 2>nul
if errorlevel 1 exit /b 3
wsl.exe -- bash -lc "command -v curl >/dev/null 2>&1 || command -v wget >/dev/null 2>&1" >nul 2>nul
if errorlevel 1 exit /b 4
exit /b 0

:enable_wsl_urls
set "POLIGOME_SITE_URL=!SITE_URL!"
set "POLIGOME_BOOTSTRAP_ASSET_BASE_URL=!ASSET_BASE_URL!"
set "POLIGOME_WINDOWS_PENDING_FILE=!PENDING_MODEL_FILE!"
set "POLIGOME_WINDOWS_SELECTED_FILE=!SELECTED_MODEL_FILE!"
if defined ASSET_BASE_OVERRIDDEN (
  set "POLIGOME_ASSET_BASE_URL=!ASSET_BASE_URL!"
  set "WSL_URL_VARIABLES=POLIGOME_SITE_URL:POLIGOME_BOOTSTRAP_ASSET_BASE_URL:POLIGOME_ASSET_BASE_URL"
) else (
  set "POLIGOME_ASSET_BASE_URL="
  set "WSL_URL_VARIABLES=POLIGOME_SITE_URL:POLIGOME_BOOTSTRAP_ASSET_BASE_URL"
)
if defined WSLENV (
  set "WSLENV=!WSL_URL_VARIABLES!:POLIGOME_WINDOWS_PENDING_FILE/p:POLIGOME_WINDOWS_SELECTED_FILE/p:!WSLENV!"
) else (
  set "WSLENV=!WSL_URL_VARIABLES!:POLIGOME_WINDOWS_PENDING_FILE/p:POLIGOME_WINDOWS_SELECTED_FILE/p"
)
exit /b 0

:stage_windows_selection
if not exist "!APP_DIR!" (
  mkdir "!APP_DIR!"
  if errorlevel 1 exit /b 1
)
>"!PENDING_MODEL_FILE!.part" echo !MODEL_ID!
if errorlevel 1 exit /b 1
move /Y "!PENDING_MODEL_FILE!.part" "!PENDING_MODEL_FILE!" >nul
if errorlevel 1 exit /b 1
exit /b 0

:cache_windows_installer
if not exist "!APP_DIR!" (
  mkdir "!APP_DIR!"
  if errorlevel 1 exit /b 1
)
if not exist "!BIN_DIR!" (
  mkdir "!BIN_DIR!"
  if errorlevel 1 exit /b 1
)
copy /Y "%~f0" "!INSTALLER_CACHE!.part" >nul
if errorlevel 1 exit /b 1
set "INSTALLER_CANDIDATE=!INSTALLER_CACHE!.part"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$marker='set '+[char]34+'POLIGOME_SAM_WINDOWS_INSTALLER_API=2'+[char]34; if (-not (Select-String -LiteralPath $env:INSTALLER_CANDIDATE -SimpleMatch $marker -Quiet)) { exit 1 }; exit 0" >nul 2>nul
if errorlevel 1 (
  del /Q "!INSTALLER_CACHE!.part" >nul 2>nul
  exit /b 1
)
move /Y "!INSTALLER_CACHE!.part" "!INSTALLER_CACHE!" >nul
if errorlevel 1 exit /b 1
exit /b 0

:commit_windows_selection
if not exist "!PENDING_MODEL_FILE!" (
  if not exist "!SELECTED_MODEL_FILE!" exit /b 1
  set "ACTIVE_MODEL_ID="
  set /p "ACTIVE_MODEL_ID="<"!SELECTED_MODEL_FILE!"
  if "!ACTIVE_MODEL_ID!"=="!MODEL_ID!" exit /b 0
  exit /b 1
)
set "STAGED_MODEL_ID="
set /p "STAGED_MODEL_ID="<"!PENDING_MODEL_FILE!"
if not "!STAGED_MODEL_ID!"=="!MODEL_ID!" exit /b 1
move /Y "!PENDING_MODEL_FILE!" "!SELECTED_MODEL_FILE!" >nul
if errorlevel 1 exit /b 1
exit /b 0

:install_wsl_model
echo.
echo ==========================================
echo  Poligome SAM via WSL2 - !MODEL_ID!
echo ==========================================
echo.
echo O modelo e as dependências serão mantidos em ~/.poligome-sam dentro do WSL2.
echo Nenhum checkpoint será copiado para a pasta do projeto.
echo.

call :validate_wsl
if errorlevel 4 goto :wsl_downloader_missing
if errorlevel 3 goto :wsl2_required
if errorlevel 2 goto :wsl_distro_error
if errorlevel 1 goto :wsl_missing

call :enable_wsl_urls

echo Baixando por HTTPS o instalador canônico para um arquivo temporário no WSL2...
echo A seleção será confirmada em !SELECTED_MODEL_FILE! somente após a instalação.
echo.
start "" "!SITE_URL!"
wsl.exe -- bash -lc "set -euo pipefail; set -f; app_dir=$HOME/.poligome-sam; install_dir=$app_dir/bin; mkdir -p $install_dir; final=$install_dir/poligome-sam-macos-linux.sh; partial=$final.part.$$; runner=$final; wsl_selected=$app_dir/selected-model.txt; wsl_pending=$app_dir/pending-model.txt; wsl_pending_tmp=$wsl_pending.part.$$; downloaded=0; monitor_pid=0; valid_installer() { test -s $1 && grep -Fxq 'POLIGOME_SAM_INSTALLER_API=2' $1; }; stage_wsl_pending() { echo !MODEL_ID! >$wsl_pending_tmp; mv -f $wsl_pending_tmp $wsl_pending; }; commit_windows_selection() { local IFS=; if test -f $wsl_pending; then return 1; fi; if test -f $wsl_selected; then wsl_model=$(head -n 1 $wsl_selected | tr -d '\r\n'); else return 1; fi; if test -f $POLIGOME_WINDOWS_PENDING_FILE; then windows_model=$(head -n 1 $POLIGOME_WINDOWS_PENDING_FILE | tr -d '\r\n'); else return 1; fi; if test x$wsl_model = x!MODEL_ID! && test x$windows_model = x!MODEL_ID!; then mv -f $POLIGOME_WINDOWS_PENDING_FILE $POLIGOME_WINDOWS_SELECTED_FILE; return 0; fi; return 1; }; monitor_commit() { while true; do if commit_windows_selection; then return 0; fi; sleep 1; done; }; cleanup() { if test $monitor_pid -ne 0; then kill $monitor_pid >/dev/null 2>&1 || true; wait $monitor_pid >/dev/null 2>&1 || true; fi; rm -f $partial $wsl_pending_tmp; }; trap 'cleanup' EXIT HUP INT TERM; if command -v curl >/dev/null 2>&1 && curl --fail --location --proto '=https' --proto-redir '=https' --retry 3 --retry-delay 2 --output $partial $POLIGOME_BOOTSTRAP_ASSET_BASE_URL/poligome-sam-macos-linux.sh; then downloaded=1; elif command -v wget >/dev/null 2>&1 && wget --https-only --tries=3 --output-document=$partial $POLIGOME_BOOTSTRAP_ASSET_BASE_URL/poligome-sam-macos-linux.sh; then downloaded=1; fi; if test $downloaded -eq 1 && valid_installer $partial; then runner=$partial; else rm -f $partial; valid_installer $final || exit 1; echo 'Download indisponível ou incompatível; usando o instalador WSL2 API 2 validado em cache.' >&2; fi; stage_wsl_pending; monitor_commit & monitor_pid=$(jobs -p); if POLIGOME_SITE_URL=$POLIGOME_SITE_URL bash $runner !MODEL_ID!; then run_status=0; else run_status=$?; fi; commit_windows_selection || true; kill $monitor_pid >/dev/null 2>&1 || true; wait $monitor_pid >/dev/null 2>&1 || true; monitor_pid=0; test $run_status -eq 0; if test $runner = $partial; then chmod 700 $partial; mv -f $partial $final; fi; trap - EXIT HUP INT TERM"
if errorlevel 1 goto :wsl_install_error

call :commit_windows_selection
if errorlevel 1 goto :state_error

echo.
echo O instalador WSL2 foi encerrado normalmente.
echo Para reutilizar o modelo, execute poligome-sam-start-windows.bat.
pause
exit /b 0

:help
echo Poligome SAM local - instalador para Windows e WSL2
echo.
echo Uso:
echo   poligome-sam-windows.bat [MODELO]
echo   poligome-sam-windows.bat --help
echo.
echo SAM 2.1 é instalado automaticamente na distribuição WSL2 padrão.
echo SAM 3 também usa WSL2 e exige GPU NVIDIA disponível no WSL,
echo Python 3.12+ e um runtime CUDA compatível com 12.6+.
echo.
echo O alias sam3 é aceito e normalizado para sam3-concepts.
echo.
echo Variáveis de ambiente opcionais:
echo   POLIGOME_SITE_URL       Site HTTPS aberto no navegador e autorizado no CORS.
echo   POLIGOME_ASSET_BASE_URL Origem HTTPS do conector e dos scripts canônicos.
echo A origem padrão dos assets é !DEFAULT_ASSET_BASE_URL!.
exit /b 0

:wsl_missing
echo.
echo O comando wsl.exe não foi encontrado.
echo Instale o WSL2 com uma distribuição Linux e execute este instalador novamente.
echo Em um PowerShell como administrador, normalmente: wsl --install
pause
exit /b 1

:wsl_distro_error
echo.
echo O WSL está instalado, mas a distribuição Linux padrão não iniciou com bash.
echo Abra a distribuição uma vez para concluir a configuração e tente novamente.
pause
exit /b 1

:wsl2_required
echo.
echo A distribuição Linux padrão não parece estar usando WSL2.
echo Converta-a com: wsl --set-version NOME_DA_DISTRIBUICAO 2
echo Consulte os nomes disponíveis com: wsl --list --verbose
pause
exit /b 1

:wsl_downloader_missing
echo.
echo O WSL2 precisa de curl ou wget para baixar o instalador canônico por HTTPS.
echo No Ubuntu, execute: sudo apt update ^&^& sudo apt install -y curl
pause
exit /b 1

:wsl_install_error
echo.
echo A instalação de !MODEL_ID! no WSL2 falhou ou foi interrompida.
echo Downloads incompletos do instalador foram removidos; checkpoints ficam somente no WSL2.
echo A seleção anterior foi preservada e !MODEL_ID! continua pendente para retomada.
echo Revise a mensagem acima; o iniciador tentará retomar a instalação automaticamente.
pause
exit /b 1

:too_many_args
echo Erro: informe no máximo um modelo. Use --help para ver os IDs.
exit /b 1

:site_error
echo Erro: POLIGOME_SITE_URL deve ser uma URL HTTPS absoluta, sem credenciais, consulta, fragmento ou espaços.
exit /b 1

:asset_base_error
echo Erro: POLIGOME_ASSET_BASE_URL deve ser uma URL HTTPS absoluta, sem credenciais, consulta, fragmento ou espaços.
exit /b 1

:invalid_model
echo Erro: modelo inválido. Use --help para ver os IDs aceitos.
exit /b 1

:state_error
echo.
echo Não foi possível preparar ou confirmar a seleção em !SELECTED_MODEL_FILE!.
echo Nenhum arquivo de seleção parcial foi ativado.
pause
exit /b 1

