"use client";

import { useEffect, useRef, useState } from "react";
import type { Asset } from "../../lib/types";
import { getCopy, storedLanguage, type Language } from "../../lib/i18n";
import { translateErrorCode } from "../../lib/error-message";
import { readRasterSidecars } from "../../lib/georeference";
import type { RasterReference } from "../../lib/georeference";
import type { Recorte } from "../../lib/cog";
import CogCropDialog, { ehArquivoTiff } from "../../raster/cog-crop-dialog";
import { createTiledRasterAsset } from "../raster/tiled-raster-asset";

type PendingRaster = {
  origin: File | string;
  name: string;
  reference: RasterReference;
};

export type RasterImportResult = {
  asset: Asset;
  objectUrl?: string;
  message: string;
};

export type RasterImportControlProps = {
  makeId: (prefix: string) => string;
  language?: Language;
  disabled?: boolean;
  onImported: (result: RasterImportResult) => void;
  onMessage?: (message: string) => void;
  /**
   * Os três botões próprios. O editor os desliga e aciona o controle pelo menu
   * Arquivo (RASTER_IMPORT_EVENT): ali o controle desmontaria ao fechar o menu
   * e levaria junto o arquivo escolhido.
   */
  showTrigger?: boolean;
};

export type RasterImportMode = "crop" | "tiled" | "url";
export const RASTER_IMPORT_EVENT = "poligome:raster-import";

const RASTER_ACCEPT = [
  ".tif", ".tiff", ".geotiff", ".btf", ".tf8", ".btf8",
  ".tfw", ".tifw", ".wld", ".prj", ".aux.xml", "image/tiff",
].join(",");

function sourceBaseName(source: string) {
  try {
    const url = new URL(source);
    return decodeURIComponent(url.pathname.split("/").filter(Boolean).at(-1) ?? "raster.tif");
  } catch {
    return source.split(/[\\/]/).filter(Boolean).at(-1) ?? "raster.tif";
  }
}

function cropName(sourceName: string) {
  const name = sourceBaseName(sourceName);
  return `${name.replace(/\.[^/.]+$/, "") || "raster"}-crop.png`;
}

export function RasterImportControl({ makeId, language, disabled = false, onImported, onMessage, showTrigger = true }: RasterImportControlProps) {
  const cropInputRef = useRef<HTMLInputElement>(null);
  const tiledInputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<PendingRaster | null>(null);
  const [urlVisible, setUrlVisible] = useState(false);
  const [url, setUrl] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [openingTiled, setOpeningTiled] = useState(false);
  const copy = getCopy(language ?? storedLanguage());

  useEffect(() => {
    const open = (event: Event) => {
      if (disabled) return;
      const mode = (event as CustomEvent<RasterImportMode>).detail;
      if (mode === "crop") cropInputRef.current?.click();
      else if (mode === "tiled") tiledInputRef.current?.click();
      else if (mode === "url") setUrlVisible(true);
    };
    window.addEventListener(RASTER_IMPORT_EVENT, open);
    return () => window.removeEventListener(RASTER_IMPORT_EVENT, open);
  }, [disabled]);

  async function chooseCrop(files: File[]) {
    if (!files.length) return;
    const rasters = files.filter((file) => ehArquivoTiff(file.name, file.type));
    if (rasters.length !== 1) {
      onMessage?.(rasters.length ? copy.rasterImportHint : copy.rasterUnsupported);
      return;
    }
    try {
      const reference = await readRasterSidecars(rasters[0], files);
      setPending({ origin: rasters[0], name: rasters[0].name, reference });
    } catch (error) {
      onMessage?.(translateErrorCode(error, copy, copy.rasterInvalidReference));
    }
  }

  async function chooseTiled(files: File[]) {
    if (!files.length || openingTiled) return;
    const rasters = files.filter((file) => ehArquivoTiff(file.name, file.type));
    if (rasters.length !== 1) {
      onMessage?.(rasters.length ? copy.rasterImportHint : copy.rasterUnsupported);
      return;
    }
    setOpeningTiled(true);
    try {
      const reference = await readRasterSidecars(rasters[0], files);
      const asset = await createTiledRasterAsset({ origin: rasters[0], name: rasters[0].name, reference, makeId });
      onImported({
        asset,
        objectUrl: asset.src.startsWith("blob:") ? asset.src : undefined,
        message: `${copy.cogOpenTiff}: ${asset.name} (${asset.width}×${asset.height}px${asset.geo ? `, ${asset.geo.crs}` : ""}).`,
      });
    } catch (error) {
      onMessage?.(error instanceof Error && error.message === "rasterTiledRequired"
        ? copy.rasterUnsupported
        : translateErrorCode(error, copy, copy.rasterInvalidTiff));
    } finally {
      setOpeningTiled(false);
    }
  }

  async function openRemoteTiled() {
    // O erro aparece no próprio diálogo: a barra de status fica atrás dele.
    const fail = (message: string) => { setUrlError(message); onMessage?.(message); };
    setUrlError(null);
    const value = url.trim();
    if (!value || openingTiled) return;
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      fail(copy.rasterUrlInvalid);
      return;
    }
    if (!/^https?:$/.test(parsed.protocol)) {
      fail(copy.rasterUrlInvalid);
      return;
    }
    setOpeningTiled(true);
    try {
      const source = parsed.toString();
      // Ler 16 bytes antes separa "não é um TIFF" de "o navegador não alcança o
      // arquivo". Sem isso, um servidor sem CORS virava "O arquivo não contém um
      // TIFF válido", e a pessoa ia procurar o problema no arquivo.
      let probe: Response;
      try {
        probe = await fetch(source, { headers: { Range: "bytes=0-15" } });
      } catch {
        fail(copy.rasterUrlUnreachable);
        return;
      }
      if (!probe.ok) {
        fail(copy.rasterUrlHttp.replace("{status}", String(probe.status)));
        return;
      }
      void probe.body?.cancel().catch(() => undefined);
      const asset = await createTiledRasterAsset({ origin: source, name: sourceBaseName(source), makeId });
      onImported({ asset, message: `${copy.cogOpenTiff}: ${asset.name} (${asset.width}×${asset.height}px${asset.geo ? `, ${asset.geo.crs}` : ""}).` });
      setUrlVisible(false);
    } catch (error) {
      fail(translateErrorCode(error, copy, copy.rasterInvalidTiff));
    } finally {
      setOpeningTiled(false);
    }
  }

  function finish(recorte: Recorte, sourceName: string) {
    const objectUrl = URL.createObjectURL(recorte.blob);
    const asset: Asset = {
      id: makeId("raster"),
      name: cropName(sourceName),
      src: objectUrl,
      local: true,
      byteSize: recorte.blob.size,
      width: recorte.largura,
      height: recorte.altura,
      geo: recorte.geo,
    };
    setPending(null);
    onImported({
      asset,
      objectUrl,
      message: `${copy.cogCropAdded} ${asset.name} (${recorte.largura}×${recorte.altura}px${recorte.geo ? `, ${recorte.geo.crs}` : ""}).`,
    });
  }

  return <>
    <input
      ref={cropInputRef}
      type="file"
      accept={RASTER_ACCEPT}
      multiple
      hidden
      onChange={(event) => {
        void chooseCrop(Array.from(event.target.files ?? []));
        event.currentTarget.value = "";
      }}
    />
    <input
      ref={tiledInputRef}
      type="file"
      accept={RASTER_ACCEPT}
      multiple
      hidden
      onChange={(event) => {
        void chooseTiled(Array.from(event.target.files ?? []));
        event.currentTarget.value = "";
      }}
    />
    {showTrigger && <>
      <button type="button" title={copy.rasterImportHint} disabled={disabled} onClick={() => cropInputRef.current?.click()}>
        {copy.cogOpenTiff} · {copy.cogModeRect}
      </button>
      <button type="button" title={copy.rasterImportHint} disabled={disabled || openingTiled} onClick={() => tiledInputRef.current?.click()}>
        {openingTiled ? `${copy.progress}…` : `${copy.cogOpenTiff} · tiled`}
      </button>
      <button type="button" disabled={disabled || openingTiled} onClick={() => setUrlVisible((value) => !value)}>
        COG URL
      </button>
    </>}
    {urlVisible && !showTrigger && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setUrlVisible(false); }}>
      <form className="raster-url-dialog" role="dialog" aria-modal="true" aria-label={copy.rasterUrlItem} onSubmit={(event) => { event.preventDefault(); void openRemoteTiled(); }} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setUrlVisible(false); } }}>
        <b>{copy.rasterUrlItem}</b>
        <small>{copy.rasterUrlHint}</small>
        <input type="url" value={url} autoFocus placeholder="https://…/orthomosaic.tif" aria-label={copy.rasterUrlItem} aria-invalid={Boolean(urlError)} onChange={(event) => { setUrl(event.target.value); setUrlError(null); }} />
        {urlError && <p role="alert">{urlError}</p>}
        <div>
          <button type="button" onClick={() => setUrlVisible(false)}>{copy.cancel}</button>
          <button type="submit" className="primary" disabled={!url.trim() || openingTiled}>{openingTiled ? `${copy.progress}…` : copy.rasterUrlOpen}</button>
        </div>
      </form>
    </div>}
    {urlVisible && showTrigger && <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
      <input
        type="url"
        value={url}
        placeholder="https://…/orthomosaic.tif"
        aria-label="COG URL"
        onChange={(event) => setUrl(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter") void openRemoteTiled(); }}
        style={{ minWidth: 260 }}
      />
      <button type="button" disabled={!url.trim() || openingTiled} onClick={() => void openRemoteTiled()}>{copy.openProject}</button>
      <button type="button" onClick={() => setUrlVisible(false)}>{copy.cancel}</button>
    </span>}
    {pending && <CogCropDialog
      origem={pending.origin}
      nome={pending.name}
      reference={pending.reference}
      copy={copy}
      onCancelar={() => setPending(null)}
      onPronto={finish}
    />}
  </>;
}
