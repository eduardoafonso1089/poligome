export type Label = {
  id: string;
  name: string;
  color: string;
  key: string;
  /** Optional 1–5 review score, saved with the project. */
  reviewScore?: number;
};

/** X = a*x + b*y + c; Y = d*x + e*y + f, measured at source-raster pixel edges. */
export type RasterTransform = [number, number, number, number, number, number];

export type GeoRef = {
  /** Affine transform from source-raster pixels to source CRS coordinates. */
  transform?: RasterTransform;
  /** Name or URL of the source raster. */
  source: string;
  /** EPSG code/definition of the file, or "sem CRS". */
  crs: string;
  /** Upper-left source-raster edge in CRS units. */
  originX: number;
  originY: number;
  /** CRS units per source-raster pixel. */
  scaleX: number;
  scaleY: number;
  sourceWidth: number;
  sourceHeight: number;
  /** Window in source-raster pixels. Full tiled rasters use the whole source extent. */
  window: { x: number; y: number; w: number; h: number };
  /** Display asset dimensions. For native tiled rasters these equal source dimensions. */
  cropWidth: number;
  cropHeight: number;
};

export type RasterAsset = {
  kind: "cog";
  mode: "tiled";
  sourceType: "local" | "remote" | "bundled";
  profile?: "complete" | "tiled-no-overviews" | "striped";
  reference?: { transform?: RasterTransform; crs?: string };
};

export type Asset = {
  id: string;
  name: string;
  src: string;
  local?: boolean;
  missing?: boolean;
  byteSize?: number;
  width?: number;
  height?: number;
  geo?: GeoRef;
  raster?: RasterAsset;
  /**
   * Runtime-only handle to a local or legacy-bundled tiled raster. This field is
   * never serialized into newly saved annotation-only project files.
   */
  runtimeRasterSource?: File;
  reviewScore?: number;
};

export type SamPrompt = {
  x: number;
  y: number;
  label: 0 | 1;
};
