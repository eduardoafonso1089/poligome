export type InstallPlatform = "windows" | "wsl" | "linux" | "macos";
export const INSTALL_PLATFORMS: readonly InstallPlatform[] = ["windows", "wsl", "linux", "macos"];
export const RUNTIME_REPO = "https://github.com/eduardoafonso1089/poligome-runtime";

export function preferredInstallPlatform(host?: string | null): InstallPlatform {
  if (host === "Windows") return "windows";
  if (host === "WSL2") return "wsl";
  if (host === "macOS") return "macos";
  if (host === "Linux") return "linux";
  if (typeof navigator === "undefined") return "linux";
  const platform = `${navigator.userAgent} ${navigator.platform}`;
  return /Windows|Win32|Win64/i.test(platform) ? "windows" : /Macintosh|MacIntel|Mac OS X/i.test(platform) ? "macos" : "linux";
}

export function byomSetupCommands(platform: InstallPlatform) {
  const native = platform === "windows";
  const file = native ? "poligome-byom-windows.ps1" : "poligome-byom-macos-linux.sh";
  const cli = native ? `powershell -ExecutionPolicy Bypass -File .\\${file}` : `bash ${file}`;
  const folder = native ? String.raw`cd "$env:USERPROFILE\Downloads"` : platform === "wsl" ? String.raw`cd "$env:USERPROFILE\Downloads"
wsl` : "cd ~/Downloads";
  return {
    file, cli, folder,
    prepare: native
      ? String.raw`New-Item -ItemType Directory -Force .\poligome-byom | Out-Null
Copy-Item .\Dockerfile, .\serve.py, .\poligome-byom-windows.ps1 .\poligome-byom\
cd .\poligome-byom`
      : "mkdir -p poligome-byom\ncp Dockerfile serve.py poligome-byom-macos-linux.sh poligome-byom/\ncd poligome-byom",
    examples: `${cli} examples`,
    list: `${cli} list`,
    build: "docker build -t my-model .",
    register: native ? `${cli} register -ModelId byom-my-model -Image my-model -Port 8082` : `${cli} register --model-id byom-my-model --image my-model --port 8082`,
    start: native ? `${cli} start -ModelId byom-my-model` : `${cli} start --model-id byom-my-model`,
    logs: native ? `${cli} logs -ModelId byom-my-model` : `${cli} logs --model-id byom-my-model`,
    exampleLogs: native ? `${cli} logs -ModelId byom-otsu` : `${cli} logs --model-id byom-otsu`,
  };
}

export function runtimeSetupCommands(platform: InstallPlatform) {
  const native = platform === "windows";
  const python = native ? "py -3.12" : "python3.12";
  const environmentPython = native ? String.raw`.\.venv\Scripts\python.exe` : ".venv/bin/python";
  const pip = `${environmentPython} -m pip`;
  const home = native ? String.raw`cd "$env:USERPROFILE"` : "cd ~";
  const folder = native ? String.raw`cd "$env:USERPROFILE\poligome-runtime"` : "cd ~/poligome-runtime";
  return {
    terminal: platform === "wsl" ? "wsl" : null,
    check: `git --version\n${python} --version`,
    clone: `${home}\ngit clone ${RUNTIME_REPO}.git\ncd poligome-runtime`,
    install: `${python} -m venv .venv\n${pip} install --upgrade pip\n${pip} install torch torchvision${platform === "macos" ? "" : " --index-url https://download.pytorch.org/whl/cpu"}\n${pip} install -e ".[server]" -e adapters/fasterrcnn`,
    run: `${environmentPython} examples/serve_runtime.py --adapter fasterrcnn --device cpu`,
    restart: `${folder}\n${environmentPython} examples/serve_runtime.py --adapter fasterrcnn --device cpu`,
  };
}
