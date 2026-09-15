# Poligome

Free, local-first data annotation for AI. Annotate images in
the browser — no account, no upload, no server holding your dataset.

Poligome runs entirely in the tab. Images and annotations are processed on
your own machine, and the dataset you export never passes through a backend. AI
assistance is optional and also local: the SAM connector and the GeoTIFF
converter run on your computer, not in the cloud.

> [!IMPORTANT]
> **Status of `refactor/editor-architecture`:** the canonical source-pixel editor is active at
> `/annotate`. Image/annotation/class management, Quality/Review, advanced vector operations,
> keyboard shortcuts, selective COCO import and the active editor internationalization surface
> are restored on the canonical architecture. The local SAM UI is intentionally not part of this
> branch's merge target; it will be integrated from its dedicated branch after this refactor.

## Image annotator

| | Route | What it does | Exports |
|---|---|---|---|
| **Computer vision** | `/annotate` | Boxes, polygons, masks, polylines, and keypoints, with vector editing, snapping, per-class visibility, quality/review and large-raster navigation | COCO, YOLO, GeoJSON, portable project |

Projects can be saved as a `.plgm` annotation file containing classes,
geometries, layout metadata, and image references. Image bytes are never
exported. When reopening the project, select the original images with the same
names. Older `.plgm` files that already contain bundled images remain readable.

The landing page also offers a one-click computer-vision demo. Its three
synthetic aerial photographs are bundled with the public frontend and arrive
with boxes, polygons, a polyline, a keypoint, and localized classes ready to
edit or export. No example dataset is processed or stored by a backend.

COCO and YOLO exports are annotation-only ZIP archives. Their dialog supports
editable train/validation/test proportions, an optional test split, random
assignment, or balancing by total instance count.

COCO writes conventional `annotations/instances_<split>.json` documents with
image filenames, dimensions, categories, boxes, polygons, and keypoints. YOLO
writes `data.yaml`, split image-reference lists, `classes.txt`, and conventional
`labels/<split>/<image-stem>.txt` files. Bounding boxes and polygons are separate
YOLO tasks; choosing both creates independent `bbox/` and `polygon/` datasets.

The annotation importer accepts standalone COCO JSON as well as COCO and YOLO
ZIPs that follow those conventions. Load the original images first. Poligome
matches standard image paths and filenames, imports the matched subset, and
warns about missing or ambiguous images instead of guessing. ZIPs may contain
images from another tool, but Poligome ignores those bytes during annotation
import.

## Geospatial input

The refactored image annotator opens GeoTIFF and Cloud Optimized GeoTIFF files directly. COGs can be rendered natively as a tiled raster without a PNG intermediary, while the crop workflow remains available. Annotations over georeferenced assets can be exported as GeoJSON.

Files that are not proper COGs still open, but the reader has to transfer far
more than it needs. The local converter below turns them into real COGs.

## Local helpers

Two optional connectors run on your own machine. Both are self-contained
installers downloaded from the app, and neither sends anything to a server.

**Local SAM** — AI pre-annotation. The connector and installers remain in the repository, but the canonical editor UI for SAM is being developed on a separate branch and is not a blocker for merging `refactor/editor-architecture`.

**Local COG converter** — for large rasters. `public/poligome-cog-windows.bat`
and `public/poligome-cog-macos-linux.sh` install rasterio and rio-cogeo and
start a converter on `http://127.0.0.1:7861`. Converting in the browser is not
an option for the files that need it most: the process has to read the whole
raster and build the overview pyramid, and a gigapixel GeoTIFF does not fit in a
tab's memory. The converter also serves the finished COG with Range support, so
the app reads the result by tiles without downloading it again. The manual route
is `public/poligome-cog-local.py`.

Both connectors speak the same HTTP contract, described in
[Local connector API](docs/LOCAL_CONNECTOR_API.md): discovery, blobs, synchronous
operations, jobs and errors are the same whether the helper runs as a plain process or
as a container.

Both connectors only accept browser requests from the official Poligome origins
and local development by default. A trusted self-hosted instance can set
`POLIGOME_ALLOWED_ORIGIN_REGEX` to an anchored regular expression for its own
origins. Keep both services bound to loopback; they are not public APIs.

## Interface

The landing page and canonical editor share Portuguese, English, French and Spanish preferences plus light, dark and system themes. The canonical editor uses the same global visual tokens as the rest of Poligome, while editor-specific layout classes live under `app/editor` so visual cleanup does not reintroduce coupling to the legacy annotator DOM.

## Development

Requirements: Node.js `>=22.13.0`.

```bash
npm ci
npm run dev
```

The npm scripts target Linux and use `flock` and GNU `timeout`. On Windows, run
Vite directly — see [REINSTALL_WINDOWS.md](REINSTALL_WINDOWS.md) for the full
path, including the workaround for networks that block the npm registry.

## Project layout

```
app/page.tsx          landing
app/annotate/         image annotator route
app/editor/           canonical editor architecture and interface
app/lib/              shared project, raster, SAM and i18n utilities
public/               local connector installers, favicon and cursors
docs/PLATFORM.md      hosting platform, bindings, and auth notes
docs/LOCAL_CONNECTOR_API.md  HTTP contract between the browser and the local helpers
```

The stack is React 19 and Next 16 running on
[vinext](https://github.com/cloudflare/vinext) with Vite, Tailwind CSS 4,
OpenLayers for map rendering, and optional Cloudflare D1 through Drizzle.

## Platform and deployment

Hosting details, Cloudflare bindings, workspace auth headers, and the optional
ChatGPT sign-in helpers inherited from the starter live in
[docs/PLATFORM.md](docs/PLATFORM.md).

## Contributing and security

Contributions are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md), follow
the [code of conduct](CODE_OF_CONDUCT.md), and use the issue templates for bugs
and feature proposals. Please report vulnerabilities privately as described in
[SECURITY.md](SECURITY.md).

## License

Poligome — data annotation for AI
Copyright (C) 2026 Eduardo Afonso

This program is free software, distributed under the
[GNU Affero General Public License, version 3](LICENSE) (`AGPL-3.0-only`).
You may use, study, modify, and redistribute it, provided that any derivative
version stays under the same license.

Because Poligome is a web application, **section 13** of the AGPL applies:
anyone who modifies this program and offers it for use over a network must make
the corresponding source code available to the people using it — in practice,
exposing a link to the source in the instance's own interface.

Merely using Poligome, including a hosted instance, places no obligation on you,
and the datasets you export are not derivative works of the program.

No warranty; see [LICENSE](LICENSE) for the full terms and [NOTICE](NOTICE) for
ownership and contribution credits.

### Commercial license

The AGPL asks derivative work to stay open, and asks a modified network instance to offer
its source to the people using it. If that does not fit your case — embedding Poligome in a
closed product, or running a modified instance without publishing the changes — a separate
commercial license is available from the copyright holder. Write to
eduardoafonso1089@gmail.com describing the intended use.

The Poligome name and logos are not covered by the AGPL: the license grants rights over the
code, not over the identity. See [NOTICE](NOTICE).

### Georeferenced rasters

See [Raster import and export](docs/RASTER_WORKFLOW.md) for supported formats,
sidecars, memory limits, coordinate handling and verification instructions.
