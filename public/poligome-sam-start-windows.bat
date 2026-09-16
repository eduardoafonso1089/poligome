@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion
title Poligome SAM local - iniciar modelo selecionado
set "POLIGOME_SAM_WINDOWS_STARTER_API=2"

set "DEFAULT_SITE_URL=https://www.poligome.com"
set "DEFAULT_ASSET_BASE_URL=https://raw.githubusercontent.com/eduardoafonso1089/poligome/main/public"
set "SITE_URL=%POLIGOME_SITE_URL%"
if not defined SITE_URL set "SITE_URL=%DEFAULT_SITE_URL%"
if "!SITE_URL:~-1!"=="/" set "SITE_URL=!SITE_URL:~0,-1!"
set "ASSET_BASE_URL=%POLIGOME_ASSET_BASE_URL%"
if defined ASSET_BASE_URL (
  set "ASSET_BASE_OVERRIDDEN=1"
) else (
  set "ASSET_BASE_OVERRIDDEN="
  set "ASSET_BASE_URL=%DEFAULT_ASSET_BASE_URL%"
)
if "!ASSET_BASE_URL:~-1!"=="/" set "ASSET_BASE_URL=!ASSET_BASE_URL:~0,-1!"
set "APP_DIR=%LOCALAPPDATA%\PoligomeSAM"
set "SELECTED_MODEL_FILE=%APP_DIR%\selected-model.txt"
set "PENDING_MODEL_FILE=%APP_DIR%\pending-model.txt"
set "CONNECTOR=%APP_DIR%\poligome-sam-local.py"
set "SIBLING_INSTALLER=%~dp0poligome-sam-windows.bat"
set "CACHED_INSTALLER=%APP_DIR%\bin\poligome-sam-windows.bat"
set "INSTALLER="
set "PORT=7860"

if /I "%~1"=="--help" goto :help
if /I "%~1"=="-h" goto :help
if /I "%~1"=="/?" goto :help
if not "%~1"=="" goto :unexpected_argument
call :validate_site_url
if errorlevel 1 goto :site_error
call :derive_site_origin
if errorlevel 1 goto :site_error
call :validate_asset_base_url
if errorlevel 1 goto :asset_base_error

if exist "%PENDING_MODEL_FILE%" (
  set "MODEL_ID="
  set /p "MODEL_ID="<"%PENDING_MODEL_FILE%"
  call :normalize_model_id
  if errorlevel 1 goto :invalid_pending_state
  call :resolve_installer
  if errorlevel 1 goto :pending_installer_missing
  echo.
  echo Retomando automaticamente a instalação pendente de !MODEL_ID!...
  call "!INSTALLER!" "!MODEL_ID!"
  set "RESUME_EXIT=!ERRORLEVEL!"
  exit /b !RESUME_EXIT!
)

if not exist "%SELECTED_MODEL_FILE%" goto :not_installed

set "MODEL_ID="
set /p "MODEL_ID="<"%SELECTED_MODEL_FILE%"
call :normalize_model_id
if errorlevel 1 goto :invalid_state
call :set_model_metadata
if errorlevel 1 goto :invalid_state
goto :start_wsl_model

:resolve_installer
set "INSTALLER_CANDIDATE=!CACHED_INSTALLER!"
call :installer_is_api2
if not errorlevel 1 (
  set "INSTALLER=!INSTALLER_CANDIDATE!"
  exit /b 0
)
set "INSTALLER_CANDIDATE=!SIBLING_INSTALLER!"
call :installer_is_api2
if not errorlevel 1 (
  set "INSTALLER=!INSTALLER_CANDIDATE!"
  exit /b 0
)
set "INSTALLER="
exit /b 1

:installer_is_api2
if not exist "!INSTALLER_CANDIDATE!" exit /b 1
findstr /C:":stage_windows_selection" "!INSTALLER_CANDIDATE!" >nul 2>nul
if errorlevel 1 exit /b 1
findstr /C:":commit_windows_selection" "!INSTALLER_CANDIDATE!" >nul 2>nul
if errorlevel 1 exit /b 1
powershell -NoProfile -ExecutionPolicy Bypass -Command "$marker='set '+[char]34+'POLIGOME_SAM_WINDOWS_INSTALLER_API=2'+[char]34; if (-not (Select-String -LiteralPath $env:INSTALLER_CANDIDATE -SimpleMatch $marker -Quiet)) { exit 1 }; exit 0" >nul 2>nul
exit /b %ERRORLEVEL%

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

:wait_existing_ready
powershell -NoProfile -ExecutionPolicy Bypass -Command "$deadline=(Get-Date).AddMinutes(60); while ((Get-Date) -lt $deadline) { try { $health=Invoke-RestMethod -Uri ('http://127.0.0.1:'+$env:PORT+'/health') -TimeoutSec 2; if ($health.service -ne 'Poligome SAM local' -or [Int32]$health.api_version -lt 2 -or $health.model_id -ne $env:MODEL_ID -or $health.status -eq 'error') { exit 1 }; if ($health.status -eq 'ready') { exit 0 } } catch {}; Start-Sleep -Seconds 1 }; exit 1" >nul 2>nul
exit /b %ERRORLEVEL%

:server_status
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $health=Invoke-RestMethod -Uri ('http://127.0.0.1:' + $env:PORT + '/health') -TimeoutSec 2; if ($health.service -ne 'Poligome SAM local' -or [Int32]$health.api_version -lt 2) { exit 3 }; if ($health.model_id -ne $env:MODEL_ID) { exit 2 }; if ($health.status -eq 'ready') { exit 0 }; if ($health.status -eq 'loading') { exit 4 }; exit 2 } catch { $client=New-Object System.Net.Sockets.TcpClient; try { $client.Connect('127.0.0.1',[Int32]$env:PORT); exit 3 } catch { exit 1 } finally { $client.Dispose() } }" >nul 2>nul
exit /b %ERRORLEVEL%

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
exit /b 0

:enable_wsl_urls
set "POLIGOME_SITE_URL=!SITE_URL!"
set "POLIGOME_BOOTSTRAP_ASSET_BASE_URL=!ASSET_BASE_URL!"
if defined ASSET_BASE_OVERRIDDEN (
  set "POLIGOME_ASSET_BASE_URL=!ASSET_BASE_URL!"
  set "WSL_URL_VARIABLES=POLIGOME_SITE_URL:POLIGOME_BOOTSTRAP_ASSET_BASE_URL:POLIGOME_ASSET_BASE_URL"
) else (
  set "POLIGOME_ASSET_BASE_URL="
  set "WSL_URL_VARIABLES=POLIGOME_SITE_URL:POLIGOME_BOOTSTRAP_ASSET_BASE_URL"
)
if defined WSLENV (
  set "WSLENV=!WSL_URL_VARIABLES!:!WSLENV!"
) else (
  set "WSLENV=!WSL_URL_VARIABLES!"
)
exit /b 0

:start_wsl_model
echo.
echo ==========================================
echo  Poligome SAM via WSL2 - !MODEL_ID!
echo ==========================================
echo.

call :validate_wsl
if errorlevel 3 goto :wsl2_required
if errorlevel 2 goto :wsl_distro_error
if errorlevel 1 goto :wsl_missing

call :server_status
set "SERVER_STATUS=!ERRORLEVEL!"
if "!SERVER_STATUS!"=="0" (
  echo O conector de !MODEL_ID! já está em execução na porta !PORT!.
  start "" "!SITE_URL!"
  timeout /t 2 >nul
  exit /b 0
)
if "!SERVER_STATUS!"=="4" (
  call :wait_existing_ready
  if errorlevel 1 goto :connector_conflict
  start "" "!SITE_URL!"
  exit /b 0
)
if "!SERVER_STATUS!"=="2" goto :connector_conflict
if "!SERVER_STATUS!"=="3" goto :port_conflict

call :enable_wsl_urls
echo Atualizando por HTTPS o iniciador canônico dentro do WSL2...
echo O modelo selecionado será sincronizado com ~/.poligome-sam/selected-model.txt.
echo.
start "" "!SITE_URL!"
wsl.exe -- bash -lc "set -euo pipefail; set -f; app_dir=$HOME/.poligome-sam; install_dir=$app_dir/bin; mkdir -p $install_dir; final=$install_dir/poligome-sam-start-macos-linux.sh; installer_cache=$install_dir/poligome-sam-macos-linux.sh; partial=$final.part.$$; runner=$final; runner_mode=starter; selected=$app_dir/selected-model.txt; pending=$app_dir/pending-model.txt; pending_tmp=$pending.part.$$; downloaded=0; valid_launcher() { test -s $1 && grep -Fxq 'POLIGOME_SAM_STARTER_API=2' $1; }; valid_installer() { test -s $1 && grep -Fxq 'POLIGOME_SAM_INSTALLER_API=2' $1; }; stage_pending() { echo !MODEL_ID! >$pending_tmp; mv -f $pending_tmp $pending; }; trap 'rm -f $partial $pending_tmp' EXIT HUP INT TERM; if command -v curl >/dev/null 2>&1 && curl --fail --location --proto '=https' --proto-redir '=https' --retry 3 --retry-delay 2 --output $partial $POLIGOME_BOOTSTRAP_ASSET_BASE_URL/poligome-sam-start-macos-linux.sh; then downloaded=1; elif command -v wget >/dev/null 2>&1 && wget --https-only --tries=3 --output-document=$partial $POLIGOME_BOOTSTRAP_ASSET_BASE_URL/poligome-sam-start-macos-linux.sh; then downloaded=1; fi; if test $downloaded -eq 1 && valid_launcher $partial; then runner=$partial; else rm -f $partial; if valid_launcher $final; then runner=$final; elif valid_installer $installer_cache; then runner=$installer_cache; runner_mode=installer; else exit 1; fi; echo 'Download indisponível ou incompatível; usando o runtime WSL2 API 2 validado em cache.' >&2; fi; if test -f $pending; then current=$(head -n 1 $pending | tr -d '\r\n'); if test x$current = x!MODEL_ID!; then :; else stage_pending; fi; elif test -f $selected; then current=$(head -n 1 $selected | tr -d '\r\n'); if test x$current = x!MODEL_ID!; then :; else stage_pending; fi; else stage_pending; fi; if test $runner_mode = installer; then POLIGOME_SITE_URL=$POLIGOME_SITE_URL bash $runner !MODEL_ID!; else POLIGOME_SITE_URL=$POLIGOME_SITE_URL bash $runner; fi; if test $runner = $partial; then chmod 700 $partial; mv -f $partial $final; fi; trap - EXIT HUP INT TERM"
if errorlevel 1 goto :wsl_start_error

echo.
echo O conector WSL2 foi encerrado normalmente.
pause
exit /b 0

:help
echo Poligome SAM local - iniciar modelo selecionado no Windows ou WSL2
echo.
echo Uso:
echo   poligome-sam-start-windows.bat
echo   poligome-sam-start-windows.bat --help
echo.
echo O modelo é lido de %%LOCALAPPDATA%%\PoligomeSAM\selected-model.txt.
echo Para trocar de modelo, execute novamente o instalador.
echo SAM 2.1 e SAM 3 são executados pelo WSL2.
echo.
echo Variáveis de ambiente opcionais:
echo   POLIGOME_SITE_URL       Site HTTPS aberto no navegador e autorizado no CORS.
echo   POLIGOME_ASSET_BASE_URL Origem HTTPS dos scripts canônicos.
echo A origem padrão dos assets é !DEFAULT_ASSET_BASE_URL!.
exit /b 0

:wsl_missing
echo.
echo O comando wsl.exe não foi encontrado.
echo Instale o WSL2 com uma distribuição Linux e tente novamente.
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

:wsl_start_error
echo.
echo Não foi possível iniciar !MODEL_ID! pelo WSL2.
echo Downloads incompletos foram removidos e a seleção anterior do WSL2 foi restaurada.
echo Se o runtime ou checkpoint ainda não existir, execute poligome-sam-windows.bat !MODEL_ID!.
pause
exit /b 1

:invalid_pending_state
echo.
echo O arquivo pending-model.txt contém um ID inválido: !MODEL_ID!
echo Corrija a instalação pendente executando novamente o instalador com um ID válido.
pause
exit /b 1

:pending_installer_missing
echo.
echo Não foi encontrado um instalador Windows API 2 compatível ao lado do iniciador nem no cache local.
echo Baixe novamente poligome-sam-windows.bat e mantenha o par na mesma pasta.
pause
exit /b 1

:resume_installation
set "RESUME_INSTALLER_MISSING="
call :resolve_installer
if errorlevel 1 (
  set "RESUME_INSTALLER_MISSING=1"
  exit /b 1
)
echo Retomando automaticamente a instalação de !MODEL_ID! com !INSTALLER!...
if defined MODEL_ID (
  call "!INSTALLER!" "!MODEL_ID!"
) else (
  call "!INSTALLER!"
)
exit /b !ERRORLEVEL!

:not_installed
echo.
echo A instalação completa do modelo selecionado não foi encontrada.
call :resume_installation
set "RESUME_EXIT=!ERRORLEVEL!"
if defined RESUME_INSTALLER_MISSING goto :pending_installer_missing
exit /b !RESUME_EXIT!

:invalid_state
echo.
echo O arquivo selected-model.txt contém um ID inválido: !MODEL_ID!
echo Execute novamente o instalador para selecionar um modelo válido.
pause
exit /b 1

:unexpected_argument
echo Erro: este iniciador não recebe modelo. Use o instalador para trocar a seleção.
echo Execute com --help para mais detalhes.
exit /b 1

:site_error
echo Erro: POLIGOME_SITE_URL deve ser uma URL HTTPS absoluta, sem credenciais, consulta, fragmento ou espaços.
exit /b 1

:asset_base_error
echo Erro: POLIGOME_ASSET_BASE_URL deve ser uma URL HTTPS absoluta, sem credenciais, consulta, fragmento ou espaços.
exit /b 1

:connector_conflict
echo.
echo A porta !PORT! contém um conector Poligome incompatível com !MODEL_ID!,
echo com outro modelo ou em estado de erro. Encerre a janela antiga e tente novamente.
pause
exit /b 1

:port_conflict
echo.
echo A porta !PORT! está ocupada por um serviço que não é o conector Poligome compatível.
echo Encerre o serviço nessa porta e tente novamente.
pause
exit /b 1
