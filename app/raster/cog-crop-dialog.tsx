"use client";

// Crop step for COG/GeoTIFF files inside the annotator.
//
// The annotator cannot — and should not — open a gigapixel raster: the browser does not
// decode TIFF and the bitmap would not fit in memory. Here the file is read by tiles, only
// so the user can pick where to work; what comes out is a size-limited PNG that enters the
// image list like any other. That way every existing tool, SAM included, works without
// knowing the crop came from a COG.
//
// OpenLayers is browser-only, so it comes in through import() inside the effect.

import { useCallback, useEffect, useRef, useState } from "react";
import type OlMapa from "ol/Map.js";
import type OlDesenho from "ol/interaction/Draw.js";
import { dimensionaRecorte, ehArquivoTiff, geraRecorte, leMetadados, prepareDisplay, readRgba } from "../lib/cog";
import type { MetadadosCog, PerfilCog, Recorte, SessaoRaster } from "../lib/cog";
import type { RasterReference } from "../lib/georeference";
import { fill } from "../lib/i18n";
import type { Copy, TranslationKey } from "../lib/i18n";

/** The profile is stored as a key so the label can follow the interface language. */
const ROTULO_PERFIL: Record<PerfilCog, TranslationKey> = {
  complete: "cogProfileComplete",
  "tiled-no-overviews": "cogProfileTiledNoOverviews",
  striped: "cogProfileStriped",
};

type Modo = "visivel" | "retangulo";

type Janela = { x: number; y: number; w: number; h: number };

export type CogRecorteProps = {
  origem: File | string;
  nome: string;
  reference?: RasterReference;
  copy: Copy;
  onCancelar: () => void;
  onPronto: (recorte: Recorte, nome: string) => void;
};

const LIMITE_MS = 45_000;

/** Port of the local conversion helper. SAM uses 7860; this is the one next door. */
const CONVERSOR_PADRAO = "http://127.0.0.1:7861";
const CHAVE_CONVERSOR = "poligome-cog-endpoint";
/** Key from before the rebranding; read once so an already saved endpoint is not lost. */
const CHAVE_CONVERSOR_LEGADA = "epiaka-cog-endpoint";

/** Rates measured on this codebase with `rio cogeo create`: deflate holds 20–25 MP/s and
 *  JPEG drops from 7 to 5 as the file grows. The estimate is deliberately pessimistic:
 *  overshooting annoys less than a bar that blows past its own deadline. */
function estimaMinutos(megapixels: number) {
  return Math.max(1, Math.ceil(megapixels / 5 / 60));
}

type Trabalho = {
  id: string;
  estado: "convertendo" | "pronto" | "erro";
  megapixels?: number;
  bytes_saida?: number;
  valido?: boolean;
  detalhe?: string;
  url?: string;
};

function inteiro(valor: number) {
  return Math.round(valor).toLocaleString("pt-BR");
}

export default function CogRecorte({ origem, nome, reference, copy, onCancelar, onPronto }: CogRecorteProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const limpaRef = useRef<(() => void) | null>(null);
  const mapaRef = useRef<OlMapa | null>(null);
  const desenhoRef = useRef<OlDesenho | null>(null);
  const metaRef = useRef<MetadadosCog | null>(null);
  const sessaoRef = useRef<SessaoRaster | null>(null);
  const [crs, setCrs] = useState("");
  const caixaRef = useRef<Janela | null>(null);
  const modoRef = useRef<Modo>("visivel");

  const [meta, setMeta] = useState<MetadadosCog | null>(null);
  const [fase, setFase] = useState<"lendo" | "pronto" | "erro">("lendo");
  const [etapa, setEtapa] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [modo, setModo] = useState<Modo>("visivel");
  const [janela, setJanela] = useState<Janela | null>(null);
  const [gerando, setGerando] = useState(false);
  // The source can change mid-session: converting to COG replaces the File with the
  // address served by the helper, and the viewer remounts on top of it.
  const [fonte, setFonte] = useState<File | string>(origem);
  const [conversor, setConversor] = useState<"desconhecido" | "ativo" | "ausente">("desconhecido");
  const [conversao, setConversao] = useState<Trabalho | null>(null);
  const [segundos, setSegundos] = useState(0);
  const endpoint = typeof window === "undefined"
    ? CONVERSOR_PADRAO
    : localStorage.getItem(CHAVE_CONVERSOR) || localStorage.getItem(CHAVE_CONVERSOR_LEGADA) || CONVERSOR_PADRAO;

  // Map extent → pixel window of the file. It is the only conversion this component has
  // to do on its own; the rest lives in lib/cog.
  const janelaDe = useCallback((extent: number[]): Janela | null => {
    const m = metaRef.current;
    if (!m) return null;
    const x0 = Math.max(0, extent[0]);
    const x1 = Math.min(m.largura, extent[2]);
    const y0 = Math.max(0, -extent[3]);
    const y1 = Math.min(m.altura, -extent[1]);
    if (x1 <= x0 || y1 <= y0) return null;
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }, []);

  const atualizaJanela = useCallback(() => {
    const mapa = mapaRef.current;
    if (!mapa) return;
    if (modoRef.current === "retangulo") {
      setJanela(caixaRef.current);
      return;
    }
    const tamanho = mapa.getSize();
    if (!tamanho) return;
    setJanela(janelaDe(mapa.getView().calculateExtent(tamanho)));
  }, [janelaDe]);

  useEffect(() => () => limpaRef.current?.(), []);

  useEffect(() => {
    let cancelado = false;
    const controller = new AbortController();
    let session: SessaoRaster | undefined;
    let cleanupMap: (() => void) | undefined;
    const timeout = window.setTimeout(() => controller.abort(), LIMITE_MS);
    limpaRef.current?.();
    limpaRef.current = null;
    caixaRef.current = null;
    (async () => {
      try {
        setEtapa(copy.cogStepLibrary);
        const [
          { default: MapaOl }, { default: View }, { default: WebGLTileLayer },
          { default: DataTile }, { default: VectorLayer }, { default: VectorSource },
          { default: Draw, createBox }, { Style, Stroke, Fill }, { always },
          { default: Projection }, { default: TileGrid },
        ] = await Promise.all([
          import("ol/Map.js"), import("ol/View.js"), import("ol/layer/WebGLTile.js"),
          import("ol/source/DataTile.js"), import("ol/layer/Vector.js"), import("ol/source/Vector.js"),
          import("ol/interaction/Draw.js"), import("ol/style.js"), import("ol/events/condition.js"),
          import("ol/proj/Projection.js"), import("ol/tilegrid/TileGrid.js"),
        ]);
        if (cancelado) return;
        setFase("lendo"); setErro(null); setJanela(null);
        setEtapa(copy.cogStepHeader);
        session = await leMetadados(fonte, reference, controller.signal);
        if (cancelado) { session.close(); return; }
        const dados = session;
        sessaoRef.current = dados;
        metaRef.current = dados;
        setMeta(dados); setCrs(dados.crs === "sem CRS" ? "" : dados.crs);
        setEtapa(copy.cogStepBand);
        await prepareDisplay(dados);
        if (cancelado) return;
        // Work in source pixels; affine rotation, south-up and custom CRSs cannot distort
        // the crop rectangle. Only export applies the georeference.
        const extent = [0, -dados.altura, dados.largura, 0];
        const projection = new Projection({ code: "poligome-raster", units: "pixels", extent });
        const maxZoom = Math.max(0, Math.ceil(Math.log2(Math.max(dados.largura, dados.altura) / 256)));
        const resolutions = Array.from({ length: maxZoom + 1 }, (_, z) => 2 ** (maxZoom - z));
        const source = new DataTile({
          projection, tileGrid: new TileGrid({ extent, origin: [0, 0], resolutions, tileSize: 256 }),
          tileSize: 256, bandCount: 4, wrapX: false, transition: 0,
          loader: async (z, x, y, options) => {
            try {
              const step = resolutions[z] * 256;
              return await readRgba(dados, { x: x * step, y: y * step, w: step, h: step }, 256, 256,
                AbortSignal.any([dados.signal, options.signal]));
            } catch (error) {
              if (!cancelado && !options.signal.aborted && !dados.signal.aborted) {
                const key = error instanceof Error ? error.message : "";
                setErro(copy[key as TranslationKey] ?? copy.cogFailedHint);
              }
              throw error;
            }
          },
        });
        const selecao = new VectorSource();
        const estilo = new Style({ stroke: new Stroke({ color: "#44C995", width: 2.5 }), fill: new Fill({ color: "rgba(68,201,149,0.14)" }) });
        const view = new View({ projection, center: [dados.largura / 2, -dados.altura / 2], resolution: resolutions[0],
          minResolution: 0.125, maxResolution: resolutions[0] * 2 });
        const mapa = new MapaOl({
          target: hostRef.current!, maxTilesLoading: 2,
          // RGBA bytes are normalized by the texture upload. The default shader
          // preserves them; dividing these bands by 255 again hides the preview.
          layers: [new WebGLTileLayer({ source, cacheSize: 64 }), new VectorLayer({ source: selecao, style: estilo })], view,
        });
        mapaRef.current = mapa;
        cleanupMap = () => { mapa.setTarget(undefined); mapa.dispose(); source.dispose(); };
        view.fit(extent, { size: mapa.getSize(), padding: [8, 8, 8, 8] });
        const desenho = new Draw({ source: selecao, type: "Circle", geometryFunction: createBox(), style: estilo, freehandCondition: always });
        desenho.on("drawstart", () => selecao.clear());
        desenho.on("drawend", (evento) => {
          const extent = evento.feature.getGeometry()?.getExtent();
          if (extent) { caixaRef.current = janelaDe(extent); setJanela(caixaRef.current); }
        });
        desenho.setActive(modoRef.current === "retangulo");
        mapa.addInteraction(desenho); desenhoRef.current = desenho;
        mapa.on("moveend", atualizaJanela);
        mapa.once("rendercomplete", atualizaJanela);
        atualizaJanela();
        setFase("pronto"); setEtapa("");
      } catch (error) {
        if (cancelado) return;
        const key = error instanceof Error ? error.message : "";
        setErro(copy[key as TranslationKey] ?? copy.cogFailedHint); setFase("erro");
      } finally { window.clearTimeout(timeout); }
    })();
    const cleanup = () => {
      cancelado = true; window.clearTimeout(timeout); controller.abort(); session?.close(); cleanupMap?.();
      sessaoRef.current = null; mapaRef.current = null; desenhoRef.current = null;
    };
    limpaRef.current = cleanup;
    return cleanup;
  }, [fonte, reference, copy, janelaDe, atualizaJanela]);

  useEffect(() => {
    modoRef.current = modo;
    desenhoRef.current?.setActive(modo === "retangulo");
    if (modo === "retangulo") setJanela(caixaRef.current);
    else atualizaJanela();
  }, [modo, atualizaJanela]);

  // Only look for the helper when it would solve something: for a complete COG the
  // conversion changes nothing, and a pointless probe just logs an error for the user.
  useEffect(() => {
    if (!meta || meta.perfil === "complete") return;
    let vivo = true;
    const controle = new AbortController();
    const tempo = window.setTimeout(() => controle.abort(), 4000);
    fetch(`${endpoint}/health`, { signal: controle.signal })
      .then((resposta) => { if (vivo) setConversor(resposta.ok ? "ativo" : "ausente"); })
      .catch(() => { if (vivo) setConversor("ausente"); })
      .finally(() => window.clearTimeout(tempo));
    return () => { vivo = false; controle.abort(); };
  }, [meta, endpoint]);

  // Conversion clock: with no real percentage coming from GDAL, the elapsed time next to
  // the estimate is the honest information.
  useEffect(() => {
    if (conversao?.estado !== "convertendo") return;
    const id = window.setInterval(() => setSegundos((valor) => valor + 1), 1000);
    return () => window.clearInterval(id);
  }, [conversao?.estado]);

  async function converte() {
    if (typeof fonte === "string" || conversao?.estado === "convertendo") return;
    setSegundos(0);
    setErro(null);
    try {
      const corpo = new FormData();
      corpo.append("arquivo", fonte, nome);
      const resposta = await fetch(`${endpoint}/converter`, { method: "POST", body: corpo });
      if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
      let trabalho = await resposta.json() as Trabalho;
      setConversao(trabalho);
      // With no percentage from GDAL, all that is left is asking. Five seconds is short
      // enough to look alive and long enough not to drown the helper for 11 minutes.
      while (trabalho.estado === "convertendo") {
        await new Promise((resolve) => window.setTimeout(resolve, 5000));
        const atual = await fetch(`${endpoint}/trabalhos/${trabalho.id}`);
        if (!atual.ok) throw new Error(`HTTP ${atual.status}`);
        trabalho = await atual.json() as Trabalho;
        setConversao(trabalho);
      }
      if (trabalho.estado === "erro") throw new Error(trabalho.detalhe || "falha na conversão");
      // The helper serves the result with Range, so the viewer reads by tiles again.
      setFase("lendo");
      setJanela(null);
      caixaRef.current = null;
      setFonte(`${endpoint}${trabalho.url}`);
    } catch (falha) {
      setConversao(null);
      const key = falha instanceof Error ? falha.message : "";
      setErro(copy[key as TranslationKey] ?? copy.cogFailedHint);
    }
  }

  const previsao = janela ? dimensionaRecorte(janela.w, janela.h) : null;

  async function confirma() {
    if (!janela || gerando || !sessaoRef.current) return;
    setGerando(true);
    try {
      const session = sessaoRef.current;
      const recorte = await geraRecorte(session, nome, janela);
      if (session.signal.aborted) return;
      if (recorte.geo) recorte.geo.crs = crs.trim() || "sem CRS";
      onPronto(recorte, nome);
    } catch (falha) {
      const key = falha instanceof Error ? falha.message : "";
      setErro(copy[key as TranslationKey] ?? copy.cogFailedHint);
      setFase("erro");
    } finally {
      setGerando(false);
    }
  }

  return <div className="modal-backdrop cog-crop-backdrop">
    <section className="cog-crop" role="dialog" aria-modal="true" aria-labelledby="cog-crop-title">
      <header>
        <div>
          <h2 id="cog-crop-title">{copy.cogCropTitle}</h2>
          <p>{fase === "lendo" ? etapa : fase === "erro" ? copy.cogFailed : copy.cogCropHint}</p>
        </div>
        <button onClick={onCancelar} aria-label={copy.close}>×</button>
      </header>

      {fase === "lendo" && <div className="cog-crop-progress" role="progressbar" aria-label={etapa}><i /></div>}

      {erro && <div className="cog-crop-erro" role="alert">
        <b>{copy.cogFailed}</b>
        <p>{erro}</p>
        <p className="cog-crop-dica">{copy.cogFailedHint}</p>
      </div>}

      {meta && meta.perfil !== "complete" && <div className="cog-crop-aviso" role="status">
        <b>{fill(copy.cogNotOptimized, { profile: copy[ROTULO_PERFIL[meta.perfil]] })}</b>
        <p>{copy.cogNotOptimizedHint}</p>
        {conversao?.estado === "convertendo" ? <p className="cog-crop-convertendo">
          <i className="cog-crop-girando" aria-hidden="true" />
          {fill(copy.convRunning, {
            elapsed: `${Math.floor(segundos / 60)}:${String(segundos % 60).padStart(2, "0")}`,
            estimate: estimaMinutos(conversao.megapixels ?? 0),
          })}
        </p> : conversor === "ativo" && typeof fonte !== "string" ? <div className="cog-crop-converter">
          <button onClick={() => void converte()}>{copy.convButton}</button>
          <small>{fill(copy.convEstimate, {
            minutes: estimaMinutos((meta.largura * meta.altura) / 1e6),
          })}</small>
        </div> : conversor === "ausente" ? <p className="cog-crop-instala">
          {copy.convUnavailable} <a href="/poligome-cog-local.py" download>poligome-cog-local.py</a>
        </p> : null}
      </div>}

      <div className="cog-crop-corpo">
        <div className="cog-crop-mapa" ref={hostRef} />
        <aside>
          <h3>{copy.cogFileSection}</h3>
          <dl>
            <dt>{copy.cogPixels}</dt><dd>{meta ? `${inteiro(meta.largura)} × ${inteiro(meta.altura)}` : "—"}</dd>
            <dt>{copy.cogCrs}</dt><dd>{meta?.transform ? <input aria-label={copy.rasterCrsInput} title={copy.rasterCrsInput} placeholder="EPSG:31983" value={crs} onChange={event => setCrs(event.target.value)} style={{ width: "100%", minWidth: 0 }} /> : copy.rasterPixelOnly}</dd>
            <dt>{copy.cogBands}</dt><dd>{meta?.bandas ?? "—"}</dd>
            <dt>{copy.cogOverviews}</dt><dd>{meta?.overviews ?? "—"}</dd>
            <dt>{copy.cogProfile}</dt>
            <dd className={meta && meta.perfil !== "complete" ? "cog-bad" : ""}>{meta ? copy[ROTULO_PERFIL[meta.perfil]] : "—"}</dd>
          </dl>

          <h3>{copy.cogCropSection}</h3>
          {janela && previsao ? <dl>
            <dt>{copy.cogWindow}</dt><dd>{inteiro(janela.w)} × {inteiro(janela.h)} px</dd>
            <dt>{copy.cogResult}</dt><dd>{inteiro(previsao.largura)} × {inteiro(previsao.altura)} px</dd>
            <dt>{copy.cogDetail}</dt>
            <dd className={previsao.reducao > 1 ? "cog-warn" : ""}>
              {previsao.reducao <= 1.001
                ? copy.cogNative
                : fill(copy.cogReduced, { factor: previsao.reducao.toFixed(1) })}
            </dd>
            {meta && meta.escalaX > 0 && meta.crs !== "sem CRS" && <>
              <dt>{copy.cogGround}</dt>
              <dd>{(janela.w * meta.escalaX).toFixed(1)} × {(janela.h * meta.escalaY).toFixed(1)}</dd>
            </>}
          </dl> : <p className="cog-crop-vazio">
            {modo === "retangulo" ? copy.cogDrawPrompt : copy.cogNoWindow}
          </p>}
          <p className="cog-crop-nota">{meta?.transform ? copy.rasterCrsInput : copy.rasterPixelOnly}</p>
          <p className="cog-crop-nota">{fill(copy.cogCapNote, { side: 4096, mp: 12 })}</p>
        </aside>
      </div>

      <footer>
        <div className="cog-crop-modos">
          <button className={modo === "visivel" ? "on" : ""} onClick={() => setModo("visivel")}>
            {copy.cogModeVisible}
          </button>
          <button className={modo === "retangulo" ? "on" : ""} onClick={() => setModo("retangulo")}>
            {copy.cogModeRect}
          </button>
        </div>
        <div className="cog-crop-acoes">
          <button onClick={onCancelar}>{copy.cancel}</button>
          <button className="primary" disabled={!janela || gerando || fase !== "pronto"} onClick={() => void confirma()}>
            {gerando ? copy.cogGenerating : copy.cogUseCrop}
          </button>
        </div>
      </footer>
    </section>
  </div>;
}

export { ehArquivoTiff };
