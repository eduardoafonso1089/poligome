import type { Asset } from "../../lib/types";
import { geoReference, type RasterReference } from "../../lib/georeference";
import { leMetadados } from "../../lib/cog";

export type CreateTiledRasterAssetOptions = {
  origin: File | string;
  name: string;
  reference?: RasterReference;
  makeId: (prefix: string) => string;
};

export async function createTiledRasterAsset({ origin, name, reference = {}, makeId }: CreateTiledRasterAssetOptions): Promise<Asset> {
  const session = await leMetadados(origin, reference);
  try {
    if (!session.tiled) throw new Error("rasterTiledRequired");
    const source = typeof origin === "string" ? origin : name;
    const geo = geoReference(source, session.largura, session.altura, {
      transform: session.transform,
      crs: session.crs === "sem CRS" ? undefined : session.crs,
    });
    return {
      id: makeId("raster"),
      name,
      src: typeof origin === "string" ? origin : URL.createObjectURL(origin),
      local: typeof origin !== "string",
      byteSize: typeof origin === "string" ? undefined : origin.size,
      width: session.largura,
      height: session.altura,
      geo,
      raster: {
        kind: "cog",
        mode: "tiled",
        sourceType: typeof origin === "string" ? "remote" : "local",
        profile: session.perfil,
        reference: {
          transform: session.transform,
          crs: session.crs === "sem CRS" ? undefined : session.crs,
        },
      },
      runtimeRasterSource: typeof origin === "string" ? undefined : origin,
    };
  } finally {
    session.close();
  }
}
