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

**Local SAM** — AI pre-annotation, plus BYOM for your own containerized model. The catalog, installers, and editor UI are described in [Local SAM](#local-sam) and [BYOM](#byom--bring-your-own-model) below.

**Local COG converter** supports large geospatial rasters. `public/poligome-cog-windows.bat` and `public/poligome-cog-macos-linux.sh` install the required Python packages and start the converter on `http://127.0.0.1:7861`. The manual service is `public/poligome-cog-local.py`.

Local connectors accept browser requests from the official Poligome origins and local development by default. A trusted self-hosted instance can set `POLIGOME_ALLOWED_ORIGIN_REGEX` to an anchored regular expression for its own origins.

## Run Poligome locally

Requirements: Git if you are cloning the repository. The installers require an
internet connection when they need to set up Node.js >= 22.13.0.

### Linux

```bash
git clone https://github.com/eduardoafonso1089/poligome.git
cd poligome
chmod +x install.sh
./install.sh
```

### Windows (PowerShell)

```powershell
git clone https://github.com/eduardoafonso1089/poligome.git
cd poligome
powershell -ExecutionPolicy Bypass -File .\install.ps1
npm run dev
```

Both installers validate the Node.js version and run `npm ci` using the lockfile as the dependency source of truth. If Node.js is missing or older than 22.13.0, the Linux installer downloads an official Node.js release to its user cache (without `sudo`), verifies its SHA-256 checksum, and prints the exact command needed to run the app with that cached runtime. The Windows installer first tries `winget`, then downloads and runs the official MSI installer. Windows may request administrator permission for the MSI fallback.

After the installer finishes, copy the `Run:` command it prints. With an already compatible Node.js, this is simply `npm run dev`; after a Linux download it prepends the cached Node.js directory to `PATH` for that command.

Manual installation is also available:

```bash
npm ci
npm run dev
```

For additional Windows troubleshooting, see [REINSTALL_WINDOWS.md](REINSTALL_WINDOWS.md).

## Local SAM

Poligome uses a FastAPI connector that runs on the user's computer; images and prompts are not sent to the Site. The **Enable local SAM** screen contains a catalog with requirements, license, checkpoint size, platform, and official benchmark — always paired with the hardware on which the figure was measured.

The complete guide, including Meta approval for SAM 3, is in [docs/sam.md](docs/sam.md). Read the **What requires manual action** section first: the connector is a local process, must be running whenever AI is used, and does not restart itself after the terminal is closed or the computer restarts. The editor finds a running connector, but no web page can start one. A user service solves this on Linux; there is not yet an equivalent on Windows or macOS.

Available models:

| Family | Variants | Use in this version | Main requirements |
| --- | --- | --- | --- |
| SAM 2.1 | Hiera Tiny, Small, Base+, Large | positive/negative points and boxes; Small is the default | Python 3.10+, PyTorch 2.5.1+, Torchvision 0.20.1+; CUDA recommended |
| MedSAM2 | General medical model, CT lesion, MRI liver lesion, echocardiogram, and the earlier 2411 weights | positive/negative points and boxes | same runtime as SAM 2.1; no additional environment |
| SAM 3 | Image and concepts | points, boxes, and text with multiple instances | Python 3.12+, PyTorch 2.7+, GPU and CUDA 12.6+; gated Hugging Face access |

SAM 2.1 also supports upstream video tracking. SAM 3.1, released by Meta on 2026-03-27, adds Object Multiplex for video, but it is not yet integrated or installed by Poligome. The current editor integrates images only and makes that distinction explicit.

Installation and startup:

- `public/poligome-sam-macos-linux.sh <model-id>` installs on Linux, supported macOS versions, or WSL2, then starts the selected model;
- `public/poligome-sam-windows.bat <model-id>` delegates installation to WSL2 while preserving the same menu and model ID;
- the `public/poligome-sam-start-macos-linux.sh` and `public/poligome-sam-start-windows.bat` launchers restart an existing installation and automatically resume an interrupted one;
- `public/poligome-sam-local.py` is the unified manual connector, with the `--model`, `--checkpoint`, `--model-config` (SAM 2 Hydra name), `--device`, `--port`, and `--app-dir` CLI options;
- `public/poligome-sam-service-linux.sh install` registers the connector as a systemd user service, so it starts at login and no terminal has to stay open (`status` and `uninstall` complete the lifecycle). On macOS and WSL2 without systemd, use the regular launcher.

Model switching happens in the interface itself: `GET /models` lists what is installed in `~/.poligome-sam`, and `POST /load {"model_id"}` reloads the connector in the requested family's virtual environment. Because each family has its own runtime, switching uses `execv` to replace the process while preserving its PID, terminal, and parent process, so installers waiting for the connector remain valid. The port is unavailable briefly while the modal follows `/health` until it is `ready`. Models that are not installed are rejected with HTTP 409 explaining what is missing instead of starting in a broken state.

The default endpoint is `http://127.0.0.1:7860/predict`. The connector validates the requested model, exposes state and capabilities at `/health`, detects the compatible device, and caches the current image representation to accelerate refinements. Browser requests accept only the official origin, development loopback origins, and additional origins declared through `POLIGOME_ALLOWED_ORIGINS`; the launchers configure this from `POLIGOME_SITE_URL`. MedSAM2 is a medical-image fine-tuning of SAM 2.1 Hiera Tiny, published by Bo Wang's group. It loads with the official `sam2.1_hiera_t.yaml` configuration and reuses the SAM 2.1 runtime, so installation costs only the 156 MB checkpoint. Note the license: the project code is Apache 2.0, but the official weights card restricts use to research and education, so commercial use is not authorized; the catalog shows this before installation. On ordinary photography it performs worse than standard SAM 2.1, and box prompts work better than points, reflecting how the model was trained. Beyond the general model, the official repository publishes fine-tunings by modality — `medsam2-ct-lesion` (CT lesion), `medsam2-mri-liver-lesion` (MRI liver lesion), and `medsam2-us-heart` (cardiac ultrasound) — plus the `medsam2-2411` base weights, retained only for reproducibility. They all start from the same SAM 2.1 Hiera Tiny, load with the same `sam2.1_hiera_t.yaml`, and occupy about 156 MB each, so adding one to an existing installation costs only the checkpoint download. The ultrasound fine-tuning was trained upstream on video; because this editor supports images only, it is used frame by frame. The research-and-education license restriction applies to all of them.

## BYOM — bring your own model

In addition to the official catalog, Poligome runs segmentation models that you package in a Docker container. Its purpose differs from SAM: there is no prompt. The container receives the entire image and returns an already-labeled COCO document; the editor draws masks, boxes, and points using the classes supplied by the model, ready for review.

The packaging mirrors Amazon SageMaker, so a container prepared for it runs here with little or no change: the image starts with `serve`, listens on port 8080, responds to `GET /ping` with 200 when ready, and receives inference at `POST /invocations`; weights reside at `/opt/ml/model`.

- `public/byom/serve.py` and `public/byom/Dockerfile` provide a runnable example with two methods selected by the `METHOD` variable: `otsu`, which merges touching objects into one region, and `watershed`, which separates them into distinct instances. Neither needs a GPU, and both return COCO with a polygon, box, and center point. Use it as a template: replace `predict()` with your model;
- `public/poligome-byom-macos-linux.sh` manages the lifecycle through `examples`, `build`, `register`, `start`, `stop`, `status`, `list`, `logs`, and `remove`. `examples` builds the image and registers the two versioned official models in `public/byom/examples` — `byom-otsu` and `byom-watershed` — from the same image, changing only `METHOD`. The image is not versioned because its tarball is about 347 MB, versus less than 4 MB for the entire history; instead, the Dockerfile base is pinned by digest, so rebuilding later produces the same image;
- registration writes `~/.poligome-sam/byom/<id>.json`. The connector does not load the model: it forwards to the container and validates the response before returning it to the editor, turning malformed COCO into a clear message instead of a distorted polygon;
- the identifier must begin with `byom-`, and the endpoint may only be `127.0.0.1` or `localhost`: a remote address would move images off the user's machine;
- `segmentation` becomes a polygon, `bbox` becomes a box, and `keypoints` becomes a point, with `categories[].name` defining the class.

The connector exposes `GET /byom/models`, which lists registered containers and their state; `POST /byom/register`, which imports or edits a registration; `DELETE /byom/models/{id}`, which removes one; and `POST /byom/annotate`, which runs one against an image. A container may implement `GET /metadata` to declare its classes; when it does not, the connector retains a summary of the last run and the interface explains the model from that. In the interface, the AI-model button at the top shows what is in use — `SAM 2.1`, `MedSAM2`, or `BYOM` with the container name, and both together when both are active because they are independent paths whose masks do not interfere — and **Bring my model** gathers the contract, guide, downloadable files, and registered containers. The complete guide is in [docs/byom.md](docs/byom.md), starting with **What requires manual action**: BYOM depends on the connector and container, and containers are created without a restart policy, so restarting the machine or Docker leaves them stopped — the registration survives, but the process does not.

SAM 2.1 checkpoints come from Meta's official downloads; SAM 3 requires requesting access at https://huggingface.co/facebook/sam3, waiting for manual approval, and running `hf auth login` locally. The flow was verified end to end with an approved account: downloading the 3.45 GB checkpoint, loading on CUDA, point and box prompts, and text prompts returning multiple concept instances. The installers invoke the Hugging Face CLI through its console script when usable and, when its shebang points to an interpreter that no longer exists — which happens if the app folder is renamed — fall back to the entry point resolved by the package itself.

The installers keep the Site URL and the public asset origin separate: `POLIGOME_SITE_URL` controls the page opened and CORS, while script updates use `https://raw.githubusercontent.com/eduardoafonso1089/epiaka/main/public` by default. The connector bootstrap uses an immutable public commit and verifies its SHA-256 checksum. `POLIGOME_ASSET_BASE_URL` can replace that HTTPS origin. During development or an offline Linux/macOS installation, `POLIGOME_CONNECTOR_PATH` explicitly accepts a local copy of the connector. The SAM 3 runtime pins `setuptools<81` while the upstream revision in use still depends on `pkg_resources`, and explicitly installs the dependencies used by the main import.

Selection is transactional: the chosen model remains in `pending-model.txt` during installation and is promoted to `selected-model.txt` only after its runtime, device, checkpoint, and exact-model `/health` pass validation. Launchers resume this pending state; incomplete checkpoints are not reused because all five artifacts are checked against their official sizes before activation.

Weights and dependencies are never written to the checkout: Linux, macOS, and WSL2 use `~/.poligome-sam/`. The `.gitignore` also blocks checkpoint formats, virtual environments, and model directories as an additional safeguard.

For memory safety, the service limits each image to 16 megapixels, processes at most four prediction bodies concurrently, and returns at most 64 SAM 3 instances. These values can be adjusted deliberately with `POLIGOME_MAX_IMAGE_PIXELS`, `POLIGOME_MAX_CONCURRENT_REQUESTS`, and `POLIGOME_SAM3_MAX_PREDICTIONS`; the SAM 3 minimum concept threshold uses `POLIGOME_SAM3_MIN_CONCEPT_THRESHOLD` and starts at `0.1`.

## Interface

Poligome supports Portuguese, English, French and Spanish, with light, dark and system themes.

## Development

Requirements: Node.js `>=22.13.0`.

```bash
npm ci
npm run dev
```

- `npm run install:ci`: perform the one bounded lockfile install
- `npm run dev`: start the Vite/Vinext development server
- `npm run build`: build and validate the deployable Sites artifact
- `npm run start`: start the built Vinext application
- `npm run typecheck`: run `tsc --noEmit` over the project
- `npm run test:unit`: run the Node test suite without building
- `npm run test:sam-installers`: exercise all five SAM installer paths with isolated mocks and sparse checkpoints
- `npm run test:byom`: exercise the BYOM lifecycle script against a mocked Docker
- `npm test`: typecheck, then run the unit, SAM installer and BYOM suites
- `npm run validate:artifact`: recheck an existing artifact's manifest and ESM `default.fetch` export
- `npm run db:generate`: generate Drizzle migrations after schema changes

The npm scripts target Linux and use `flock` and GNU `timeout`. On Windows, run
Vite directly — see [REINSTALL_WINDOWS.md](REINSTALL_WINDOWS.md) for the full
path, including the workaround for networks that block the npm registry.

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
