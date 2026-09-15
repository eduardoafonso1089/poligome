/** Shared fixtures for the component layer, so each test states only what it varies. */

export const CHROME_HANDLER_NAMES = [
  "onHome", "onNewProject", "onRenameProject", "onDemo", "onOpenProject", "onImportImages",
  "onSaveProject", "onLanguageChange", "onSamSettings", "onTool", "onVectorTool", "onSimplify",
  "onDuplicate", "onMerge", "onToggleSnap", "onToggleCoordinatesGuide", "onToggleMultiSelect",
  "onFinishDrawing", "onRemoveLastPoint", "onCancelDrawing", "onUndo", "onRedo", "onDelete",
  "onClearAnnotations", "onSelectAllAnnotations", "onStrokeChange", "onZoomOut", "onZoomIn",
  "onFit", "onPreviousImage", "onNextImage", "onOpenImagesPanel", "onOpenRightPanel",
];

export const LAYER_HANDLER_NAMES = [
  "onBeginAnnotationDrag", "onMoveAnnotation", "onFinishAnnotation", "onCancel",
  "onBeginVertexDrag", "onMoveVertex", "onFinishVertex", "onInsertVertex",
  "onResizeStart", "onResizeMove", "onResizeEnd", "onRotateStart", "onTransformMove", "onTransformEnd",
];

export const chromeProps = (overrides = {}) => ({
  projectName: "Projeto de teste",
  assetsCount: 3,
  annotationsCount: 7,
  language: "pt",
  loading: false,
  dirty: false,
  hasAsset: true,
  hasAssets: true,
  imageIndex: 0,
  zoom: 92,
  tool: "select",
  vectorTool: null,
  snapEnabled: true,
  touchMode: false,
  addToSelection: false,
  coordinatesGuide: false,
  canFinishDraft: false,
  canRemoveDraftPoint: false,
  hasDraft: false,
  canSimplify: false,
  canDuplicate: false,
  canMerge: false,
  canEditPolygon: false,
  canUndo: false,
  canRedo: false,
  hasSelection: false,
  strokePx: 1,
  statusMessage: "Pronta para anotar",
  ...overrides,
});

export const layerProps = (overrides = {}) => ({
  color: "#44c995",
  tool: "select",
  selected: false,
  primarySelected: false,
  selectedVertex: null,
  lineThickness: 2,
  touchMode: false,
  touchRadius: 20,
  markerRadius: 5,
  markerAspect: 1,
  boxTouchRadius: 28,
  boxRotationTouchRadius: 20,
  ...overrides,
});

export const polygon = (overrides = {}) => ({
  id: "poly", asset: "img", label: "class-a", type: "polygon", holes: [],
  vertices: [
    { id: "v0", x: 10, y: 10 },
    { id: "v1", x: 200, y: 10 },
    { id: "v2", x: 200, y: 160 },
    { id: "v3", x: 10, y: 160 },
  ],
  ...overrides,
});

export const box = (overrides = {}) => ({
  id: "box", asset: "img", label: "class-a", type: "box",
  x: 40, y: 50, width: 120, height: 80,
  ...overrides,
});

export const line = (overrides = {}) => ({
  id: "line", asset: "img", label: "class-b", type: "line",
  vertices: [{ id: "l0", x: 0, y: 0 }, { id: "l1", x: 90, y: 40 }, { id: "l2", x: 180, y: 0 }],
  ...overrides,
});

export const point = (overrides = {}) => ({
  id: "point", asset: "img", label: "class-b", type: "point", x: 70, y: 90, ...overrides,
});

export const labels = () => ([
  { id: "unlabeled", name: "Sem label", color: "#929a95", key: "" },
  { id: "class-a", name: "Edificação", color: "#6c8cff", key: "1" },
  { id: "class-b", name: "Veículo", color: "#ff8a65", key: "2" },
]);

export const assets = () => ([
  { id: "img", name: "quadra.jpg", src: "blob:a", width: 1200, height: 780 },
  { id: "img2", name: "parque.jpg", src: "blob:b", width: 1200, height: 780 },
]);
