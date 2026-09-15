# Raster import, annotation and export

Select images and their matching sidecars together with **Import images** (or drag
and drop them together). Everything is decoded on the user's machine.

## Supported inputs

- TIFF, GeoTIFF, BigTIFF and COG (`.tif`, `.tiff`, `.geotif`, `.geotiff`, `.btf`,
  `.tf8`, `.btf8`), subject to the codecs supported by geotiff.js.
- Browser-supported PNG, JPEG, WebP, BMP, GIF and AVIF. TIFF is decoded by the
  raster reader; ordinary images use the browser decoder.
- Matching world files (`.tfw`, `.tifw`, `.jgw`, `.jpgw`, `.jpegw`, `.pgw`,
  `.pngw`, `.bpw`, `.bmpw`, `.gfw`, `.gifw`, `.wld`), `.prj` and GDAL `.aux.xml`.
  Names are matched case-insensitively, first by full filename, then exact stem.
  A world file supplies the transform; a PRJ supplies the CRS, not the transform.
- Embedded TIFF georeferencing takes precedence; sidecars supply missing fields.
  TIFF tiepoint offsets, signed scales, ModelTransformation rotation/shear and
  RasterPixelIsPoint's half-pixel offset are preserved. Auxiliary GeoTransform
  values use GDAL order; world files use pixel-centre coordinates.

This is not a browser implementation of every GDAL driver. JP2, IMG, DEM, NetCDF,
VRTs, RPC/GCP-only georeferencing and other unsupported inputs must first be
converted/warped to an affine GeoTIFF/COG using GIS software. Unsupported files
produce a message instead of silently disappearing. For multipage TIFFs, the
first image is the annotation source; unrelated pages are not pyramid levels.

## TIFF preview and crops

The preview and crop share one TIFF session and decoder pool (at most two
workers). The preview uses a source-pixel tile grid; georeferencing is applied
when exporting, so rotated/south-up rasters do not distort crop selection.
Reduced-resolution IFDs are selected on both axes. Masks are excluded from colour
levels and applied as transparency; unrelated TIFF pages are excluded entirely.

A tile/crop reads only the intersecting window and requested bands. Nearest
sampling uses exact source pixel centres, including unaligned overview windows.
RGBA alpha and NoData are respected. TIFF photometric conversion handles palette,
YCbCr and CMYK through geotiff.js. RGB imagery uses RGB channels; grayscale and
multiband rasters with grayscale photometric interpretation display the first
band. This is a display image, not an export of scientific raster band values.
8-bit colour keeps its native range; higher-depth/float values use a bounded
radiometric sample from the coarsest level. This sample may not capture distant
extrema; there is no manual band/stretch editor in this change.

Crops are capped at 4096 pixels per side and 12 million pixels, retaining their
exact source window. COCO/YOLO coordinates address the generated crop PNG. Use a
smaller window to annotate at native resolution. The affine reference remains in
`.plgm`, COCO's `images[].georeference`, and YOLO's `georeferences.json`.

Memory estimates include whole decoded TIFF strips/tiles: reducing the *output*
size alone does not bound geotiff.js's input allocation. Reads estimated above
128 MiB are refused before decoding. This is a per-read guard, not a total browser
memory guarantee; the preview limits concurrent tile loads to two and caches 64
tiles. Large files without overviews may require the existing local COG converter
or a smaller/closer view. Remote TIFF servers must return HTTP 206 and allow CORS;
a server ignoring Range is rejected without downloading its entire response.
Closing/changing the raster cancels reads and releases the decoder/map resources.

## Coordinate-safe GeoJSON

GeoJSON is RFC 7946 longitude/latitude in **WGS84**, regardless of source CRS.
Different UTM zones can coexist because each feature is reprojected. Polygons
retain holes and use the required ring winding; lines remain open. Original CRS,
source filename, crop and class stay in feature properties. No legacy top-level
`crs` member is emitted.

### Feature properties

| Property | Type | Meaning |
|---|---|---|
| `id` | string | Stable annotation id, the same one used inside the project file. |
| `class` | string | Class display name, or the class id when the class is gone. |
| `class_id` | string | Class id, stable across renames. |
| `color` | string \| null | Class colour as `#rrggbb`. |
| `shape` | string | `box`, `polygon`, `line` or `point`. |
| `rotation` | number | Box rotation in radians, clockwise around the box centre. Absent for other shapes. |
| `source_image` | string | File name of the annotated image or crop. |
| `source_raster` | string | Name or URL of the raster the georeference came from. |
| `crs` | string | CRS of that source raster, for provenance. Coordinates are always WGS84. |

> **Renamed in a breaking change.** These properties were previously Portuguese:
> `classe`, `classe_id`, `cor`, `forma`, `rotacao`, `recorte` and `origem`.
> Geometry, CRS and every value are unchanged, but QGIS styles, filters or
> scripts keyed on the old names must be updated.

Offline projection definitions include WGS84 geographic/Web Mercator, WGS84 UTM
north/south, and SIRGAS 2000 geographic/UTM. A supported WKT/PROJ definition in a
PRJ or the TIFF crop dialog can supply another CRS. Projections that require datum
grid files are not automatically downloaded; prepare those datasets in a supported
CRS with GIS software when accurate datum transformations require such grids.

A TIFF without georeferencing can still be annotated and exported as COCO/YOLO.
GeoJSON explicitly rejects annotated assets without a transform or known CRS,
and rejects invalid coordinates. It never silently omits those annotations.
Unannotated images do not block an otherwise valid export. Legacy `.plgm` files
without the new optional affine field retain their original north-up mapping.

## Verification

```bash
npm ci
npx tsc --noEmit
npm run lint
npm test
```

Tests generate real TIFF byte streams (including a Deflate-compressed pyramid,
internal masks and an unrelated page), exercise the actual geotiff.js decoder,
and check affine mapping, native window sampling, NoData/alpha, 16-bit colour,
sidecar matching, memory/range guards, cancellation, mixed-CRS export and legacy
references. Browser-only FileReader/canvas download boundaries are adapted in
Node tests. These tests do not replace a browser interaction test or a benchmark
with a user's large orthomosaic.
