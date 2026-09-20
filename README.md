# Poligome

Free, local-first data annotation for AI. Annotate images in the browser — no account, no dataset upload, and no Poligome server holding your images.

Poligome keeps the annotation workflow on your machine. Images and annotations are processed locally in the browser, while optional helpers and AI models can run as local services on the same computer.

## Image annotation

The image editor is available at `/annotate` and supports boxes, polygons, masks, polylines and keypoints, including vector editing, snapping, per-class visibility, quality/review tools and large-raster navigation.

Projects can be saved as `.plgm` files containing classes, geometries, layout metadata and image references. Image bytes are not included in newly exported projects. When reopening a project, select the original images with the same names. Older `.plgm` files that already contain bundled images remain readable.

The landing page also includes a one-click computer-vision demo with synthetic aerial images and example annotations ready to edit or export.

### Import and export

Poligome exports annotations as COCO, YOLO and GeoJSON, as well as portable `.plgm` projects.

COCO and YOLO exports are annotation-only ZIP archives. The export dialog supports train/validation/test proportions, an optional test split, random assignment and balancing by total instance count.

The importer accepts standalone COCO JSON and COCO or YOLO ZIP packages. Load the original images first; Poligome matches standard image paths and filenames and warns about missing or ambiguous images instead of guessing.

## Geospatial rasters

Poligome opens GeoTIFF and Cloud Optimized GeoTIFF (COG) files directly. COGs can be rendered as tiled rasters without converting the whole image to PNG, and annotations over georeferenced assets can be exported as GeoJSON.

Files that are not proper COGs can still be opened, but large rasters are more efficient after conversion. Poligome provides an optional local COG converter for this workflow.

See [Raster import and export](docs/RASTER_WORKFLOW.md) for supported formats, sidecars, memory limits, coordinate handling and verification instructions.

## Local AI and Poligome Runtime

Poligome is designed so AI-assisted annotation can run on the same computer as the dataset. The browser can communicate with a model service bound to loopback (`127.0.0.1`), receive inference results and use them as pre-annotations without sending the source images to a Poligome cloud service.

This model-service direction is called **Poligome Runtime**. The goal is to provide a plug-and-play local runtime with standard models and an extension path for users to connect their own models. Models may run in a local Python environment or a container; **Docker is not required to install or run the Poligome web interface**.

The repository already includes the Local SAM connector as an AI-oriented local helper. The broader Poligome Runtime for arbitrary user models is under development and is not presented as a completed feature.

## Local helpers

Optional helper services run on your own computer and bind to loopback rather than acting as public APIs.

**Local SAM** provides the local service and installers used for AI pre-annotation workflows. The implementation is available in `public/poligome-sam-local.py` together with Windows and macOS/Linux installers and launchers.

**Local COG converter** supports large geospatial rasters. `public/poligome-cog-windows.bat` and `public/poligome-cog-macos-linux.sh` install the required Python packages and start the converter on `http://127.0.0.1:7861`. The manual service is `public/poligome-cog-local.py`.

Local connectors accept browser requests from the official Poligome origins and local development by default. A trusted self-hosted instance can set `POLIGOME_ALLOWED_ORIGIN_REGEX` to an anchored regular expression for its own origins.

## Run Poligome locally

Requirements: **Node.js >= 22.13.0**, npm, and Git if you are cloning the repository.

### Linux

```bash
git clone https://github.com/eduardoafonso1089/poligome.git
cd poligome
chmod +x install.sh
./install.sh
npm run dev
```

### Windows (PowerShell)

```powershell
git clone https://github.com/eduardoafonso1089/poligome.git
cd poligome
powershell -ExecutionPolicy Bypass -File .\install.ps1
npm run dev
```

Both installers validate the Node.js version and run `npm ci` using the lockfile as the dependency source of truth. They do not silently install or upgrade Node.js.

Manual installation is also available:

```bash
npm ci
npm run dev
```

For additional Windows troubleshooting, see [REINSTALL_WINDOWS.md](REINSTALL_WINDOWS.md).

## Interface

Poligome supports Portuguese, English, French and Spanish, with light, dark and system themes.

## Development

Requirements: Node.js `>=22.13.0`.

```bash
npm ci
npm run dev
```

Useful checks include:

```bash
npm run typecheck
npm test
npm run lint
npm run build
```

Some development and build scripts use Bash utilities. Windows contributors can use a compatible shell environment when working with those scripts; the local setup itself is available through `install.ps1`.

## Project layout

```text
app/page.tsx          landing page
app/annotate/         image annotation route
app/editor/           editor components and interaction logic
app/lib/              shared project, raster, SAM and i18n utilities
app/raster/           raster-related route and UI
public/               local helper installers, services and static assets
docs/                 technical and workflow documentation
install.sh            Linux local setup
install.ps1           Windows local setup
```

The frontend stack includes React 19, Next 16, vinext, Vite, Tailwind CSS 4 and OpenLayers.

## Contributing and security

Contributions are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md), follow the [code of conduct](CODE_OF_CONDUCT.md), and use the issue templates for bugs and feature proposals. Please report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## License

Poligome — data annotation for AI  
Copyright (C) 2026 Eduardo Afonso

This program is free software, distributed under the [GNU Affero General Public License, version 3](LICENSE) (`AGPL-3.0-only`). You may use, study, modify and redistribute it provided that derivative versions comply with the license.

Because Poligome is a web application, **section 13** of the AGPL applies when a modified version is offered for use over a network. Merely using Poligome, including a hosted instance, does not place licensing obligations on datasets created or exported with the application.

No warranty; see [LICENSE](LICENSE) for the full terms and [NOTICE](NOTICE) for ownership and contribution credits.

### Commercial license

If AGPL requirements do not fit a use case — for example, embedding a modified Poligome in a closed product — a separate commercial license is available from the copyright holder. Contact `eduardoafonso1089@gmail.com` describing the intended use.

The Poligome name and logos are not covered by the AGPL; see [NOTICE](NOTICE).
