param([string] $Python = 'python')
$ErrorActionPreference = 'Stop'
$installerPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'public\poligome-sam-windows-native.ps1'
$parseTokens = $null
$parseErrors = $null
$installerAst = [System.Management.Automation.Language.Parser]::ParseFile($installerPath, [ref]$parseTokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
foreach ($functionName in @('ConvertTo-NativeArgument', 'Invoke-Hf', 'Get-ServerState')) {
  $definition = $installerAst.FindAll({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $functionName }, $true) | Select-Object -First 1
  if (-not $definition) { throw "Missing installer function: $functionName" }
  Invoke-Expression $definition.Extent.Text
}

$qaRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('poligome-native-regression-' + [guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $qaRoot | Out-Null
$argvScript = Join-Path $qaRoot 'argv file with spaces.py'
$argvResult = Join-Path $qaRoot 'argv result.json'
@'
import json, pathlib, sys
pathlib.Path(sys.argv[1]).write_text(json.dumps(sys.argv[2:]), encoding="utf-8")
'@ | Set-Content -LiteralPath $argvScript -Encoding UTF8
$expectedArguments = @('C:\profile with spaces\model checkpoint.pt', 'quoted "argument"', 'C:\trailing path\', '')
$qaArguments = @($argvScript, $argvResult) + $expectedArguments
$quotedArguments = $qaArguments | ForEach-Object { ConvertTo-NativeArgument $_ }
$argumentProcess = Start-Process -FilePath $Python -ArgumentList ($quotedArguments -join ' ') -WindowStyle Hidden -PassThru
$argumentProcess.WaitForExit()
if ($argumentProcess.ExitCode -ne 0) { throw 'Python argument probe failed' }
$actualArguments = Get-Content -LiteralPath $argvResult -Raw | ConvertFrom-Json
if ($actualArguments.Count -ne $expectedArguments.Count) { throw 'Argument boundaries changed' }
for ($index = 0; $index -lt $expectedArguments.Count; $index++) {
  if ($actualArguments[$index] -cne $expectedArguments[$index]) { throw "Argument $index changed" }
}
Write-Host 'ok - real Windows Python argv preserves spaces, quotes, trailing backslashes and empty arguments'

# Resolve the current package entry point without login or reading credentials.
$ErrorActionPreference = 'Continue'
try {
  Invoke-Hf $Python @('--help') *> $null
  if ($LASTEXITCODE -ne 0) { throw 'Current Hugging Face CLI entry point failed' }
} finally { $ErrorActionPreference = 'Stop' }
Write-Host 'ok - Hugging Face hf entry point works without the removed module'

$healthFile = Join-Path $qaRoot 'health.json'
$portFile = Join-Path $qaRoot 'port.txt'
$healthScript = Join-Path $qaRoot 'health service with spaces.py'
@'
import json, pathlib, sys
from http.server import BaseHTTPRequestHandler, HTTPServer
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        body = pathlib.Path(sys.argv[1]).read_bytes().lstrip(b"\xef\xbb\xbf")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def log_message(self, *args): pass
server = HTTPServer(("127.0.0.1", 0), Handler)
pathlib.Path(sys.argv[2]).write_text(str(server.server_port))
server.serve_forever()
'@ | Set-Content -LiteralPath $healthScript -Encoding UTF8
@{ service = 'Poligome SAM local'; api_version = 2; status = 'ready'; model_id = 'sam2.1-hiera-small'; device = 'cpu' } | ConvertTo-Json | Set-Content -LiteralPath $healthFile -Encoding UTF8
$healthArguments = @($healthScript, $healthFile, $portFile) | ForEach-Object { ConvertTo-NativeArgument $_ }
$healthProcess = Start-Process -FilePath $Python -ArgumentList ($healthArguments -join ' ') -WindowStyle Hidden -PassThru
try {
  $deadline = (Get-Date).AddSeconds(10)
  while (-not (Test-Path -LiteralPath $portFile)) {
    if ((Get-Date) -gt $deadline -or $healthProcess.HasExited) { throw 'Health fixture did not start' }
    Start-Sleep -Milliseconds 100
  }
  $Port = [int](Get-Content -LiteralPath $portFile -Raw)
  $Device = 'cpu'
  if ((Get-ServerState $Python 'sam2.1-hiera-small') -ne 'ready') { throw 'Matching CPU was rejected' }
  $Device = 'auto'
  if ((Get-ServerState $Python 'sam2.1-hiera-small') -ne 'ready') { throw 'Auto should accept the ready runtime' }
  $Device = 'cuda'
  if ((Get-ServerState $Python 'sam2.1-hiera-small') -ne 'device-mismatch') { throw 'Explicit CUDA silently accepted CPU' }
  Write-Host 'ok - actual health probe distinguishes ready CPU, auto and requested CUDA'
} finally {
  # A Windows venv may launch a child Python process. Stop only the child that
  # belongs to this fixture before stopping its redirector.
  Get-CimInstance Win32_Process -Filter "ParentProcessId = $($healthProcess.Id)" |
    Where-Object { $_.CommandLine -and $_.CommandLine.Contains($healthScript) } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  if (-not $healthProcess.HasExited) { $healthProcess.Kill(); $healthProcess.WaitForExit() }
}
Write-Host "Test evidence retained in $qaRoot"
