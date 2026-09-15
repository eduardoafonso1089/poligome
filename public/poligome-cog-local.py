#!/usr/bin/env python3
"""Local TIFF-to-COG converter for Poligome.

Converting in the browser does not work for the files that need it most: the process has
to read the whole raster and build the overview pyramid, and a gigapixel GeoTIFF does not
fit in a tab's memory. Measured on this codebase: 3,288 MP took 11 minutes and 619 MB of
input. Here it runs on the user's own machine, in the background.

The server also serves the finished COG with Range support, so Poligome can read the
result by tiles without downloading the file again.

    python poligome-cog-local.py
    python poligome-cog-local.py --port 7861 --folder ~/poligome-cog
"""

from __future__ import annotations

import argparse
import os
import shutil
import tempfile
import threading
import uuid
from pathlib import Path

import rasterio
import uvicorn
from fastapi import BackgroundTasks, FastAPI, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from rio_cogeo.cogeo import cog_translate, cog_validate
from rio_cogeo.profiles import cog_profiles

app = FastAPI(title="Poligome local COG", version="1.0")
app.add_middleware(
    CORSMiddleware,
    # Do not turn a service on localhost into a public API for every site the user
    # visits. Self-hosted Poligome instances can provide their own anchored regex.
    allow_origin_regex=os.environ.get(
        "POLIGOME_ALLOWED_ORIGIN_REGEX",
        r"^(https://(www\.)?poligome\.com|http://(localhost|127\.0\.0\.1)(:\d+)?)$",
    ),
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
    # Without this the browser does not expose Content-Range to geotiff.js, and tiled
    # reading falls back to the slow path of downloading everything.
    expose_headers=["Content-Length", "Content-Range", "Accept-Ranges"],
)

PASTA = Path(tempfile.gettempdir()) / "poligome-cog"
TRABALHOS: dict[str, dict] = {}
TRAVA = threading.Lock()


@app.middleware("http")
async def allow_local_browser_access(request: Request, call_next):
    resposta = await call_next(request)
    # Chrome blocks requests from a public page to 127.0.0.1 without this header.
    resposta.headers["Access-Control-Allow-Private-Network"] = "true"
    resposta.headers["Accept-Ranges"] = "bytes"
    return resposta


@app.get("/")
def root():
    return {"service": "Poligome local COG", "status": "ready", "folder": str(PASTA)}


@app.get("/health")
def health():
    with TRAVA:
        rodando = sum(1 for t in TRABALHOS.values() if t["estado"] == "convertendo")
    return {"status": "ready", "convertendo": rodando, "trabalhos": len(TRABALHOS)}


def perfil_para(caminho: Path) -> str:
    """Re-encoding JPEG as deflate would multiply the size by six; keeping the source
    compression is what makes the output fit in the same space as the input."""
    with rasterio.open(caminho) as fonte:
        compressao = str(fonte.profile.get("compress") or "").lower()
        bandas = fonte.count
    if compressao == "jpeg" and bandas in (1, 3):
        return "jpeg"
    if compressao in ("webp",):
        return "webp"
    return "deflate"


def converte(identificador: str, entrada: Path, saida: Path) -> None:
    try:
        perfil = perfil_para(entrada)
        with TRAVA:
            TRABALHOS[identificador]["perfil"] = perfil
        config = {"GDAL_NUM_THREADS": "ALL_CPUS", "GDAL_TIFF_OVR_BLOCKSIZE": "512"}
        cog_translate(
            str(entrada), str(saida), cog_profiles.get(perfil),
            overview_resampling="average", config=config, quiet=True, in_memory=False,
        )
        valido, _, _ = cog_validate(str(saida), quiet=True)
        with TRAVA:
            TRABALHOS[identificador].update(
                estado="pronto", valido=bool(valido),
                bytes_saida=saida.stat().st_size,
                url=f"/arquivos/{identificador}",
            )
    except Exception as erro:  # noqa: BLE001 - the reason has to reach the browser
        with TRAVA:
            TRABALHOS[identificador].update(estado="erro", detalhe=str(erro)[:500])
    finally:
        entrada.unlink(missing_ok=True)


@app.post("/converter")
async def converter(tarefas: BackgroundTasks, arquivo: UploadFile):
    nome = Path(arquivo.filename or "entrada.tif").name
    if not nome.lower().endswith((".tif", ".tiff")):
        raise HTTPException(status_code=400, detail="Send a .tif or .tiff file.")

    identificador = uuid.uuid4().hex[:12]
    PASTA.mkdir(parents=True, exist_ok=True)
    entrada = PASTA / f"{identificador}-entrada.tif"
    saida = PASTA / f"{identificador}.tif"

    # On disk, not in memory: the upload can be hundreds of megabytes.
    with entrada.open("wb") as destino:
        while pedaco := await arquivo.read(8 * 1024 * 1024):
            destino.write(pedaco)

    try:
        with rasterio.open(entrada) as fonte:
            largura, altura, bandas = fonte.width, fonte.height, fonte.count
    except Exception as erro:  # noqa: BLE001
        entrada.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail=f"Not a readable GeoTIFF: {erro}") from erro

    with TRAVA:
        TRABALHOS[identificador] = {
            "id": identificador, "nome": nome, "estado": "convertendo",
            "pixels": [largura, altura], "bandas": bandas,
            "megapixels": round(largura * altura / 1e6, 1),
            "bytes_entrada": entrada.stat().st_size,
        }
    tarefas.add_task(converte, identificador, entrada, saida)
    with TRAVA:
        return JSONResponse(TRABALHOS[identificador], status_code=202)


@app.get("/trabalhos/{identificador}")
def trabalho(identificador: str):
    with TRAVA:
        dados = TRABALHOS.get(identificador)
    if not dados:
        raise HTTPException(status_code=404, detail="Trabalho desconhecido.")
    return dados


@app.get("/arquivos/{identificador}")
def arquivo_pronto(identificador: str):
    caminho = PASTA / f"{identificador}.tif"
    if not caminho.exists():
        raise HTTPException(status_code=404, detail="File not found.")
    # FileResponse already answers Range requests, which is what allows reading the COG by tiles.
    return FileResponse(caminho, media_type="image/tiff", filename=f"{identificador}.tif")


@app.delete("/arquivos/{identificador}")
def descarta(identificador: str):
    caminho = PASTA / f"{identificador}.tif"
    caminho.unlink(missing_ok=True)
    with TRAVA:
        TRABALHOS.pop(identificador, None)
    return {"removido": identificador}


def main() -> None:
    global PASTA
    parser = argparse.ArgumentParser(description="Local TIFF-to-COG converter for Poligome")
    parser.add_argument("--port", type=int, default=7861)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--folder", default=str(PASTA),
                        help="onde guardar os COGs convertidos")
    argumentos = parser.parse_args()
    PASTA = Path(os.path.expanduser(argumentos.folder))
    PASTA.mkdir(parents=True, exist_ok=True)
    livre = shutil.disk_usage(PASTA).free / 1024 ** 3
    print(f"Poligome local COG at http://{argumentos.host}:{argumentos.port}")
    print(f"Converted files go to {PASTA} ({livre:.1f} GB free)")
    uvicorn.run(app, host=argumentos.host, port=argumentos.port, log_level="warning")


if __name__ == "__main__":
    main()
