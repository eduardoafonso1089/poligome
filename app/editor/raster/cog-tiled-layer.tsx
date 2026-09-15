"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Asset } from "../../lib/types";
import type { Copy } from "../../lib/i18n";
import { translateErrorCode } from "../../lib/error-message";
import { leMetadados, prepareDisplay, readRgba, type SessaoRaster } from "../../lib/cog";
import type { ViewportState } from "../viewport/viewport-controller";
import { planRasterTiles, type RasterTile } from "./tile-plan";
import { COG_TILE_CACHE_LIMIT, LruCache } from "./tile-cache";

export type CogTiledLayerProps = {
  asset: Asset;
  viewport: ViewportState;
  layout: {
    surfaceWidth: number;
    surfaceHeight: number;
    width: number;
    height: number;
    left: number;
    top: number;
  };
  copy: Copy;
  onError?: (message: string) => void;
};

function TileCanvas({ session, tile, sourceWidth, sourceHeight, cache }: {
  session: SessaoRaster;
  tile: RasterTile;
  sourceWidth: number;
  sourceHeight: number;
  cache: LruCache<ImageData>;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    canvas.width = tile.outputWidth;
    canvas.height = tile.outputHeight;
    const cached = cache.get(tile.key);
    if (cached) {
      context.putImageData(cached, 0, 0);
      return;
    }

    const controller = new AbortController();
    let live = true;
    void readRgba(session, { x: tile.x, y: tile.y, w: tile.width, h: tile.height }, tile.outputWidth, tile.outputHeight, controller.signal)
      .then((pixels) => {
        if (!live || controller.signal.aborted) return;
        const currentCanvas = ref.current;
        const currentContext = currentCanvas?.getContext("2d");
        if (!currentCanvas || !currentContext) return;
        const image = new ImageData(pixels, tile.outputWidth, tile.outputHeight);
        cache.set(tile.key, image);
        currentContext.putImageData(image, 0, 0);
      })
      .catch((error) => {
        if (!controller.signal.aborted && error instanceof Error && error.name !== "AbortError") console.warn("COG tile read failed", error);
      });
    return () => {
      live = false;
      controller.abort();
    };
  }, [session, tile.key, tile.x, tile.y, tile.width, tile.height, tile.outputWidth, tile.outputHeight, cache]);

  return <canvas
    ref={ref}
    width={tile.outputWidth}
    height={tile.outputHeight}
    aria-hidden="true"
    style={{
      position: "absolute",
      left: `${tile.x / sourceWidth * 100}%`,
      top: `${tile.y / sourceHeight * 100}%`,
      width: `${tile.width / sourceWidth * 100}%`,
      height: `${tile.height / sourceHeight * 100}%`,
      pointerEvents: "none",
      display: "block",
    }}
  />;
}

export function CogTiledLayer({ asset, viewport, layout, copy, onError }: CogTiledLayerProps) {
  const [session, setSession] = useState<SessaoRaster | null>(null);
  const cacheRef = useRef(new LruCache<ImageData>(COG_TILE_CACHE_LIMIT));

  useEffect(() => {
    cacheRef.current.clear();
    if (asset.raster?.mode !== "tiled") {
      setSession(null);
      return;
    }
    const controller = new AbortController();
    let opened: SessaoRaster | null = null;
    let live = true;
    const origin = asset.runtimeRasterSource ?? asset.src;
    void leMetadados(origin, asset.raster.reference ?? {}, controller.signal)
      .then(async (next) => {
        opened = next;
        await prepareDisplay(next);
        if (!live || controller.signal.aborted) {
          next.close();
          return;
        }
        setSession(next);
      })
      .catch((error) => {
        if (!controller.signal.aborted) onError?.(translateErrorCode(error, copy, copy.rasterInvalidTiff));
      });
    return () => {
      live = false;
      controller.abort();
      opened?.close();
      setSession(null);
      cacheRef.current.clear();
    };
  }, [asset.id, asset.src, asset.runtimeRasterSource, asset.raster?.mode, copy, onError]);

  const tiles = useMemo(() => planRasterTiles({
    sourceWidth: asset.width ?? 1,
    sourceHeight: asset.height ?? 1,
    renderedWidth: layout.width,
    renderedHeight: layout.height,
    canvasLeft: layout.left,
    canvasTop: layout.top,
    scrollLeft: viewport.scrollLeft,
    scrollTop: viewport.scrollTop,
    viewportWidth: viewport.viewport.width,
    viewportHeight: viewport.viewport.height,
  }), [asset.width, asset.height, layout.width, layout.height, layout.left, layout.top, viewport.scrollLeft, viewport.scrollTop, viewport.viewport.width, viewport.viewport.height]);

  if (!session || asset.raster?.mode !== "tiled") {
    return <div aria-hidden="true" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none", background: "var(--canvas-bg)", color: "var(--muted)", fontSize: 12 }}>{copy.progress}…</div>;
  }
  const sourceWidth = asset.width ?? session.largura;
  const sourceHeight = asset.height ?? session.altura;
  return <div aria-hidden="true" style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none", background: "var(--canvas-bg)" }}>
    {tiles.map((tile) => <TileCanvas key={tile.key} session={session} tile={tile} sourceWidth={sourceWidth} sourceHeight={sourceHeight} cache={cacheRef.current} />)}
  </div>;
}
