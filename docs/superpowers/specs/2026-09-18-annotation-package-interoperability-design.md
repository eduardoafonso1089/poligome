# Annotation Package Interoperability Design

## Goal

Make Poligome export annotation-only COCO and YOLO packages that follow their
public conventions closely enough to interoperate with other conforming tools,
and make Poligome able to re-import those packages without embedding images.

The import flow must associate annotations with images already loaded in the
editor and clearly report images that cannot be matched or are ambiguous.

## Product constraints

- Poligome never exports image bytes in COCO, YOLO, or `.plgm` files.
- Images remain local browser inputs and are referenced by name/path only.
- New `.plgm` files are always annotation-only.
- Existing `.plgm` files that contain bundled images remain readable for
  backwards compatibility, but the application no longer creates them.
- All new UI and messages are localized in Portuguese, English, French, and
  Spanish.

## Standards contract

### COCO

Each split is stored in `annotations/instances_<split>.json`. The JSON document
uses the conventional top-level `info`, `images`, `categories`, and
`annotations` arrays. Images preserve their original `file_name`, width, and
height. Categories use stable numeric IDs. Annotations use pixel-space COCO
fields including `bbox` as `[x, y, width, height]`, polygon `segmentation`,
`area`, `iscrowd`, and keypoints where applicable.

The importer also continues accepting a standalone COCO `.json` file and scans
external ZIPs for compatible COCO JSON documents rather than requiring the
exact Poligome folder name.

### YOLO

Each dataset root contains:

- `data.yaml`, with zero-based `names` and split references;
- `train.txt`, `val.txt`, and optional `test.txt`, listing expected image paths;
- `labels/<split>/<image-stem>.txt`;
- `classes.txt` as a compatibility convenience;
- a README explaining that image files must be supplied separately.

Detection rows use `class x_center y_center width height`. Segmentation rows use
`class x1 y1 ... xn yn`. Coordinates are normalized to `[0, 1]`.

YOLO requires the label stem to match the image stem. The exporter therefore
preserves the original image stem instead of adding a Poligome sequence prefix.
Unsafe path components are removed without changing the basename. If two
loaded assets would produce the same label path, export stops with a localized
collision error instead of silently renaming either file.

When the user selects both geometries, the archive contains two independent,
standard dataset roots: `bbox/` and `polygon/`. Each has its own `data.yaml`,
split lists, labels, and README.

An optional `poligome-manifest.json` may describe package version, geometry
mode, split membership, original asset identity, filename, and dimensions. It
is supplemental metadata: standard files remain authoritative, other tools can
ignore it, and the importer must not require it.

## Split behavior

Ratios are editable and normalized before assignment. Test is optional.

- Random strategy shuffles assets and assigns integer image counts with a
  largest-remainder allocation so the requested ratios are respected.
- Balanced strategy treats each image as indivisible, orders images by instance
  count, and greedily assigns each one to the split with the largest remaining
  instance deficit relative to the requested ratios. Image-count deficits break
  ties, and zero-annotation images are assigned by image-count deficit.

This balances total instances, as requested, rather than attempting per-class
stratification. The ZIP manifest and standard split files record the result so
all format roots use the same split membership.

## Package detection and parsing

The annotation import input accepts `.json` and `.zip`.

For ZIP input it:

1. rejects unsafe or malformed archive entries;
2. detects COCO documents by their JSON structure;
3. detects YOLO roots from conventional `data.yaml`, `data.yml`,
   `dataset.yaml`, or `dataset.yml` names;
4. recognizes separate `bbox/` and `polygon/` roots;
5. reads class names from YAML, falling back to `classes.txt`;
6. follows split list files when present and otherwise uses conventional
   `images/<split>` to `labels/<split>` mapping;
7. classifies a YOLO row with five tokens as a box and a row with at least three
   coordinate pairs as a polygon;
8. reports malformed or unsupported rows without importing them as another
   geometry type.

ZIPs may contain images, but this importer ignores their bytes. They are only
path evidence for matching to images already loaded in Poligome.

## Image matching

Matching is case-insensitive and normalizes slash direction and harmless `./`
prefixes. Candidates are resolved in this order:

1. exact normalized path from the standard format;
2. exact original filename;
3. exact basename, only if it identifies one loaded asset.

The optional manifest may restore an exact Poligome asset reference but never
overrides a contradictory standard filename. Duplicate loaded filenames,
duplicate package paths, or multiple possible matches are marked ambiguous and
are never resolved arbitrarily.

Warnings are counted per referenced image, not per annotation. The import modal
shows matched, missing, ambiguous, and invalid totals and lists representative
filenames. The user can import the matched subset. If nothing matches, import is
disabled and the warning remains actionable.

COCO coordinates are scaled from declared source dimensions to the loaded
asset dimensions. YOLO coordinates are denormalized with the loaded asset
dimensions.

## Import review UI

The existing annotation-selection modal becomes format-neutral while retaining
category/annotation selection. It shows:

- detected format and split roots;
- selectable geometry types;
- matched annotation candidates;
- a localized warning panel for unmatched, ambiguous, or invalid image
  references;
- completion feedback containing imported annotation and skipped-image counts.

Backdrop pointer handling follows the fixed export modal behavior so clicks
inside the dialog do not close it.

## Removing image export

The project-save UI no longer asks between annotations and images. Saving a
project invokes the annotation-only writer directly. The public project save
API no longer exposes `"complete"` as a valid write mode, and image bundling
helpers are removed from the write path.

The read path keeps recognizing legacy `bundled_path` data and creating local
object URLs when opening old projects. Copy and help text state consistently
that exported files contain annotations and image references only.

## Error handling

User-visible errors receive localized codes/messages for:

- unsupported or malformed annotation ZIP;
- duplicate YOLO label path;
- missing class declarations;
- invalid normalized coordinates;
- image-name collision or ambiguous match;
- no matching images;
- partially imported packages.

Parsing is fail-soft at the item level: malformed entries are skipped and
reported when the remaining package is safe to import. Structural failures that
make interpretation unsafe reject the package before any state mutation.

## Testing

Automated coverage includes:

- standards-shaped COCO and YOLO archive snapshots;
- bbox, polygon, and separated `both` YOLO exports;
- random and instance-balanced split properties, custom ratios, and optional
  test split;
- exact filename preservation and duplicate-stem rejection;
- round-trip import for Poligome COCO and YOLO ZIPs;
- import of external standards-conforming fixtures without a manifest;
- warnings for missing and ambiguous images;
- malformed paths, rows, YAML, and JSON;
- annotation-only `.plgm` saves and legacy bundled-project reads;
- localized UI text and modal click behavior.

The full test suite, type checking, and production build must pass before the
branch is handed off.
