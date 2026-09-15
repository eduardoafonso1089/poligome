# Editor architecture

The editor refactor on `refactor/editor-architecture` uses the canonical stack directly at `/annotate`. The previous legacy route, bridge and annotation adapters have been removed.

## Core rules

- Native source-image pixels are the single canonical geometry space.
- Viewport size, zoom, pan, pinch and device dimensions never rewrite annotation geometry.
- `EditorAnnotation[]` is the only editor annotation model.
- Polygon/polyline vertices have stable IDs.
- Project persistence is V4 only and declares `coordinate_space: "image-pixels"`.
- Previous `.plgm` manifests are not migrated.
- CVAT and Label Studio were architectural references only; no third-party source code was copied.

## Coordinate spaces

The active editor uses two relevant spaces:

1. browser screen pixels;
2. source-image pixels.

`app/editor/viewport/svg-image-space.ts` converts client coordinates into image pixels by inverting the SVG screen CTM, with a bounding-rectangle fallback for environments without SVG CTM support.

`EditorCanvas` uses the current image dimensions as its SVG viewBox. There is no fixed `1000×650` annotation space in the canonical editor. Screen-space controls such as handles and touch targets are converted into image units at render time so they keep a stable visual size across zoom levels and image resolutions.

## Annotation model

`app/editor/models/annotation-model.ts` defines the active representation. Polygon and line geometry use stable `Vertex[]`; boxes use `x`, `y`, `width`, `height` and optional rotation; points use `x` and `y`. Every coordinate is expressed in source-image pixels.

There is no legacy annotation adapter in the active codebase.

## Project format V4

The `.plgm` manifest is strictly V4:

```json
{
  "version": 4,
  "coordinate_space": "image-pixels"
}
```

The canonical APIs are `savePoligomeProjectV4()` and `openPoligomeProjectV4()`. V3 and older manifests are rejected instead of migrated.

Projects can be saved in complete or annotations-only mode. In annotations-only mode the persisted asset IDs remain authoritative and assets reopen as missing. `app/editor/session/image-assets.ts` provides canonical re-linking by basename while preserving those IDs, validating dimensions for ordinary images, refusing ambiguous duplicate-name matches and restoring tiled raster runtime sources without moving annotations to new assets.

## Viewport and touch

`app/editor/viewport/viewport-controller.ts` owns viewport size, image size, zoom and scroll. `app/editor/viewport/use-touch-navigation.ts` arbitrates mobile gestures:

- one-finger pan in the Hand tool;
- two-finger pinch + pan in any tool;
- second touch cancels an active edit/draw gesture before navigation owns it;
- discrete touch drawing commits on pointer-up, preventing stray points when pinch starts.

Pan and pinch mutate viewport state only.

## State and interactions

`app/editor/state/editor-state.ts` owns annotations, undo/redo, selection, selected vertex, dirty/saved state and gesture transactions. It also owns canonical annotation ordering, batch reclassification and atomic batch replacement.

Reordering is constrained to annotations belonging to the same asset. Batch reclassification is a single undoable editor operation. Merge/split can replace multiple annotations in one history snapshot. Continuous drag, resize, rotation and polygon transform use gesture transactions so one pointer interaction creates one undo step.

## Rendering

Rendering is composed under `app/editor/layers` and `app/editor/canvas`. The rendering stack has no dependency on flat `pts`, index-based vertex identity or legacy `w/h` box fields.

## Import/export

Internal geometry remains in image pixels.

- COCO uses image pixels directly and exports `info.version: "1.0"` independently from the internal `.plgm` schema version.
- COCO import scales only when the document dimensions differ from the loaded image dimensions.
- Selective COCO import plans records against loaded image basenames, then lets the user filter geometry types and individual annotation records before labels or geometry are materialized.
- YOLO normalization happens only at export using the actual asset width/height.
- GeoJSON projects image pixels through raster/georeference metadata.
- Flat coordinate arrays are allowed only at external format boundaries.

`app/editor/session/editor-session-io.ts` is the canonical project/demo/import/export boundary.

## Native COG rendering

Native tiled COG assets use the full source-raster dimensions as the logical image extent. The renderer plans only visible tiles plus one-tile overscan, uses the existing GeoTIFF overview/range machinery, cancels obsolete reads and keeps a bounded 64-entry LRU tile cache.

`ViewportController.maxZoom()` scales dynamically for large rasters so native-resolution and deep-zoom inspection remain possible without changing annotation geometry.

## Route

```text
/annotate
  CanonicalEditorWorkbench
  -> EditorState
  -> EditorCanvas
  -> ViewportController
```

`/annotate-next`, `/anotar`, `legacy-page.tsx`, `EditorArchitectureBridge` and `legacy-annotation-adapter.ts` have been removed.

## Application parity

The agreed merge-target product surface has been restored on the canonical architecture:

- image panel: search, select, reorder, delete and confirmation-protected destructive actions;
- annotation panel: hide/show, delete, asset-local reorder, select-all and Shift/Ctrl/Cmd list selection;
- class management: quick label creation, rename, color, hide/show, protected localized unlabeled class, delete with reclassification, active class selection and batch reclassification;
- project lifecycle: new project, unsaved-work protection, rename, complete/annotations-only save, open and missing-image re-link;
- Quality/Review, including image/annotation/class scores and source-pixel dataset summaries;
- advanced vector operations: snapping, simplify, duplicate, union/merge, split, polygon-hole creation, reshape and source-pixel polygon scale/rotation transform;
- keyboard shortcuts for tools, advanced vector editing, history, delete, draft finish/cancel and label keys;
- selective COCO import by geometry type and individual annotation record;
- PT/EN/FR/ES internationalization for the active canonical editor surface;
- canonical visual/interface structure using the shared Poligome visual tokens.

The pre-merge decision is **GO**. Detailed evidence and remaining non-blocking UX differences are recorded in `docs/PRE_MERGE_AUDIT.md`.

Cephalometric-landmark import is not part of Poligome and must not be ported into the canonical editor.

### Product decisions recorded on 2026-09-12

- **D1 — merge strategy: option B.** Application parity was completed on `refactor/editor-architecture`; the legacy annotator was not restored as the production `/annotate` route.
- **D2 — parity scope.** Quality/Review is retained as an important platform capability. Cephalometric landmarks are explicitly out of scope.
- **SAM integration.** SAM is not a merge blocker for this refactor branch. Its canonical implementation will be integrated from a separate branch. `app/lib/sam.ts` and its local connector assets must therefore not be deleted as orphaned legacy during this refactor.

## Interface structure

The outer browser UI is described throughout this documentation as the **editor interface structure**. It is ordinary web interface composition and does not introduce an additional runtime layer or local process.

The canonical editor reuses the application-wide design tokens from `app/globals.css` (`--paper`, `--surface`, `--line`, `--green`, `--canvas-bg`, and related tokens) rather than defining a separate theme. Editor-specific composition lives in:

- `app/editor/editor-interface.module.css` for management, vector and review surfaces;
- `app/editor/presentation/pre-refactor-canonical.module.css` for the editor chrome;
- `app/annotate/exact-pre-refactor-refinements.module.css` and its companions for
  the `/annotate` route frame and responsive layout.

The goal is to preserve the Poligome visual identity without re-coupling the canonical editor to the legacy annotator DOM. Inline styles are reserved for values that are genuinely runtime-derived, such as canvas position/size, class colors and metric widths.

## Management panels

The canonical management surface lives under `app/editor/panels`.

- `panel-model.ts` contains pure operations for image ordering and class lifecycle;
- `editor-management-panels.tsx` renders the responsive image, annotation and class panels;
- hiding an annotation or class is transient UI state and never rewrites geometry;
- deleting an image deletes only annotations owned by that asset and requires confirmation from the management UI;
- deleting a class preserves its annotations by moving them to the protected `unlabeled` class and requires confirmation;
- annotation deletion from panel controls is confirmation-protected, while keyboard Delete remains undoable through editor history;
- annotation reorder never crosses asset boundaries;
- batch class changes are recorded through `EditorState`, so one batch operation corresponds to one undo step.

## Advanced vector editing

Canonical advanced geometry lives under `app/editor/geometry` and never uses a normalized editor extent.

- snapping prefers vertices inside the screen-derived tolerance and falls back to edge projection only when no vertex qualifies;
- simplification uses Ramer-Douglas-Peucker in source-image pixels and rejects invalid output rings;
- polygon union/difference is delegated to the existing `polygon-clipping` dependency while Poligome retains its own interaction and model semantics;
- split derives its cutter scale from the real image dimensions, including very large rasters;
- polygon holes are validated as fully contained, non-crossing rings;
- reshape consumes a source-pixel trace and preserves a valid canonical polygon;
- duplication creates a fresh annotation plus fresh outer/hole vertex IDs and adds one undoable editor operation;
- `polygon-transform.ts` scales and rotates outer and hole vertices around source-pixel bounds while preserving stable vertex IDs;
- transform pointer interaction uses `begin-gesture`/`commit-gesture`, so an entire scale/rotation gesture produces one undo entry;
- merge/split use `replace-annotations-batch`, so each operation creates one undo step.

`app/editor/interactions/use-advanced-vector-interactions.ts` owns hole/split/reshape/transform gestures, while `app/editor/vector/vector-toolbar.tsx` emits the corresponding commands. Box scale/rotation remains on its separate canonical box-resize/rotation path.

## Keyboard commands

`app/editor/commands/editor-shortcuts.ts` translates keyboard input into editor commands. Current canonical shortcuts include `V`, `H`, `B`, `P`, `F`, `L`, `K`, `O`, `X`, `R`, `T`, `Enter`, `Esc`, `Delete`/`Backspace`, `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z` and `Ctrl/Cmd+Y`. Unmodified class shortcut keys select their corresponding label.

Keyboard commands are ignored while an input, textarea, select or content-editable element owns focus.

## Quality and review

The canonical implementation lives under `app/editor/review`.

- `quality-review-model.ts` computes per-image instance balance, per-class instance counts and polygon/box areas directly in native source-image pixels;
- polygon holes are subtracted from segmentation area;
- points and lines contribute zero segmentation area;
- image, annotation and class review scores remain independent 1–5 values persisted by the V4 project model;
- `quality-review-panel.tsx` is the application panel for the quality/review surface.

Quality metrics must never reintroduce the removed `1000×650` normalization.

## Validation

`.github/workflows/editor-refactor.yml` runs Node 22.13, the verified Vinext build, the complete test suite, the i18n parity-debt gate, cross-branch export goldens, the demo-route smoke test and the COG benchmark.

The i18n debt allowlist must shrink whenever a canonical UI surface starts consuming keys previously used only by `main`. It is a regression/debt gate, not a merge-readiness signal. Remaining entries represent intentionally deferred legacy-interface affordances, additional status/help copy and SAM integration copy rather than a second editor runtime.

The pre-merge implementation head identified in `docs/PRE_MERGE_AUDIT.md` passed the complete workflow and the second audit found the branch `0` commits behind `main`.

## Core migration status

1. Canonical `EditorAnnotation` + stable `Vertex[]`. **Done.**
2. Canonical state, selection and gesture transactions. **Done.**
3. Canonical rendering and drawing. **Done.**
4. Canonical COCO/YOLO/GeoJSON I/O. **Done.**
5. Mobile pan and pinch navigation. **Done.**
6. Native source-image pixel geometry. **Done.**
7. Strict V4 project persistence and annotations-only image re-link. **Done.**
8. Replace `/annotate` with the canonical editor. **Done.**
9. Delete duplicate/legacy routes, bridge and annotation adapters. **Done.**
10. Remove only utilities proven to be legacy and behaviorally superseded. A module must not be deleted solely because its UI is being integrated from another branch. **Guarded cleanup, not blanket orphan deletion.**

Core migration and the agreed merge-target application parity are complete. The editor-architecture pre-merge audit is **GO**.
