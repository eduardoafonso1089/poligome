"use client";

import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import type { Asset, Label } from "../../lib/types";
import { getCopy, storedLanguage, storedTheme, type Language } from "../../lib/i18n";
import { translateErrorCode } from "../../lib/error-message";
import type { EditorAnnotation } from "../models/annotation-model";
import type { BoxCorner } from "../layers/box-layer";
import { createEditorDemo, openEditorProject, saveEditorProject } from "../session/editor-session-io";
import { loadLocalImageAssets, relinkMissingAssets } from "../session/image-assets";
import { CocoImportControl, type CocoImportHandle } from "../import/coco-import-control";
import { RasterImportControl, type RasterImportResult } from "../import/raster-import-control";
import { ExportControls } from "../export/export-controls";
import { useEditorState } from "../state/use-editor-state";
import { useAnnotationIndex } from "../state/annotation-index";
import { useCanvasInteractions } from "../interactions/use-canvas-interactions";
import { useAdvancedVectorInteractions, type AdvancedVectorResult } from "../interactions/use-advanced-vector-interactions";
import { EditorCanvas } from "../canvas/editor-canvas";
import { DrawingDraftLayer } from "../drawing/drawing-draft-layer";
import { useDrawingInteractions, type DrawingTool } from "../drawing/use-drawing-interactions";
import { AdvancedVectorDraftLayer } from "../layers/advanced-vector-draft-layer";
import { useEditorViewport } from "../viewport/use-editor-viewport";
import { useTouchNavigation } from "../viewport/use-touch-navigation";
import { clientPointToImage, screenPixelsToImageUnits } from "../viewport/svg-image-space";
import { CogTiledLayer } from "../raster/cog-tiled-layer";
import { demoRouteTarget } from "../session/demo-route";
import { importCocoDocument, type CocoDocumentInput } from "../import/coco-document-import";
import { assetAsDataUrl } from "../../lib/sam";
import { connectorBaseUrl, fetchHealth, DEFAULT_SAM_ENDPOINT } from "../../lib/sam-connector";
import { Check, Crosshair, ListRestart, LoaderCircle, Minus, Plus, Settings2, Sparkles, Square, X } from "lucide-react";
import { requestSamAnnotations } from "../models/model-output";
import type { SamBoxPrompt, SamPrompt } from "../../lib/types";

type SamInteractionMode = "points" | "box" | "text";
import type { PolygonAnnotation } from "../models/annotation-model";
import { QualityReviewPanel } from "../review/quality-review-panel";
import { setAssetReviewScore, setLabelReviewScore } from "../review/quality-review-model";
import { EditorManagementPanels } from "../panels/editor-management-panels";
import { createLabel as createPanelLabel, ensureUnlabeledLabel, moveItemById, recolorLabel, renameLabel, stackAnnotationsByLabel, UNLABELED_ID } from "../panels/panel-model";
import { selectRange } from "../selection/selection-model";
import { commandFromKeyboard, isEditableShortcutTarget, type VectorTool } from "../commands/editor-shortcuts";
import { simplifyPolygonAnnotation, unionPolygonAnnotations } from "../geometry/vector-operations";
import { PreRefactorStatus, PreRefactorToolbar, PreRefactorTopbar, type PreRefactorChromeProps } from "../presentation/pre-refactor-chrome";
import {
  DemoTutorialChrome,
  DemoTutorialOverlay,
  annotationIntersectsDemoRoof,
  isTutorialModelPoint,
  tutorialEditBox,
  tutorialEditBoxChanged,
  tutorialModelSuggestion,
  tutorialSuccessTitle,
  tutorialWrongDraw,
  type DemoTutorialStep,
  type DemoTutorialToolPrompt,
} from "../demo/pre-refactor-demo-tutorial";
import exact from "../presentation/pre-refactor-canonical.module.css";

const EMPTY_LABELS: Label[] = [{ id: UNLABELED_ID, name: "Sem label", color: "#929a95", key: "" }];
const EMPTY_ANNOTATIONS: EditorAnnotation[] = [];

type MousePanState = { pointerId: number; x: number; y: number } | null;

function labelsMatch(current: Label[], next: Label[]) {
  return current === next || (current.length === next.length && current.every((label, index) => {
    const candidate = next[index];
    return label.id === candidate?.id && label.name === candidate.name && label.color === candidate.color && label.key === candidate.key;
  }));
}

export function CanonicalEditorWorkbench() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [labels, setLabels] = useState<Label[]>([]);
  // Os três tipos de prompt que o conector aceita. O modo existe porque arrastar
  // uma caixa e clicar um ponto são o mesmo gesto no mesmo pixel: sem escolher
  // antes, um cancela o outro.
  const [samMode, setSamMode] = useState<SamInteractionMode>("points");
  const [samPrompts, setSamPrompts] = useState<SamPrompt[]>([]);
  const [samBoxStart, setSamBoxStart] = useState<{ x: number; y: number } | null>(null);
  const [samBox, setSamBox] = useState<SamBoxPrompt | null>(null);
  const [samText, setSamText] = useState("");
  const [samThreshold, setSamThreshold] = useState(0.5);
  // Lista, e não uma máscara só: uma busca por texto devolve um objeto por
  // resultado, e é justamente isso que faz valer a pena escrever a busca.
  const [samPreviews, setSamPreviews] = useState<PolygonAnnotation[]>([]);
  const [samLoading, setSamLoading] = useState(false);
  const [samNegative, setSamNegative] = useState(false);
  // O que o modelo carregado aceita agora, dito pelo próprio conector: o catálogo
  // descreve o modelo escolhido, e escolhido não é o mesmo que carregado.
  const [samCapabilities, setSamCapabilities] = useState<readonly string[]>([]);
  // null enquanto a sondagem não voltou: dizer "não encontrado" antes de ter
  // procurado acusaria o usuário de um problema que talvez não exista.
  const [samConnectorFound, setSamConnectorFound] = useState<boolean | null>(null);
  const [activeLabel, setActiveLabel] = useState("");
  const [tool, setTool] = useState<DrawingTool>("select");
  const [vectorTool, setVectorTool] = useState<VectorTool>(null);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [addToSelection, setAddToSelection] = useState(false);
  const [coordinatesGuide, setCoordinatesGuide] = useState(false);
  const [cursorPoint, setCursorPoint] = useState<{ x: number; y: number } | null>(null);
  const [mousePanning, setMousePanning] = useState(false);
  const [current, setCurrent] = useState("");
  const [projectName, setProjectName] = useState(() => getCopy(storedLanguage()).newProject);
  const [language, setLanguage] = useState<Language>("pt");
  const [strokePx, setStrokePx] = useState(1);
  const [hiddenAnnotationIds, setHiddenAnnotationIds] = useState<Set<string>>(() => new Set());
  const [hiddenLabelIds, setHiddenLabelIds] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(false);
  const [sessionDirty, setSessionDirty] = useState(false);
  const [message, setMessage] = useState("");
  const [demoTutorialStep, setDemoTutorialStep] = useState<DemoTutorialStep | null>(null);
  const [demoTutorialToolPrompt, setDemoTutorialToolPrompt] = useState<DemoTutorialToolPrompt>(null);
  const objectUrls = useRef<string[]>([]);
  const projectInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const annotationImportRef = useRef<CocoImportHandle>(null);
  const relinkInputRef = useRef<HTMLInputElement>(null);
  const idCounter = useRef(0);
  const demoQueryHandled = useRef(false);
  const demoAnnotationsRef = useRef<EditorAnnotation[]>([]);
  const mousePanRef = useRef<MousePanState>(null);
  const editor = useEditorState();
  const annotationIndex = useAnnotationIndex(editor.annotations);
  const copy = getCopy(language);
  const asset = assets.find((item) => item.id === current) ?? assets[0] ?? null;
  // A fresh object here would invalidate every interaction callback that lists
  // imageSize as a dependency, which in turn defeats the memo on AnnotationLayer.
  const imageWidth = asset?.width ?? 1;
  const imageHeight = asset?.height ?? 1;
  const imageSize = useMemo(() => ({ width: imageWidth, height: imageHeight }), [imageWidth, imageHeight]);
  const viewport = useEditorViewport({ image: imageSize, initialZoom: 92 });

  const makeId = useCallback((prefix: string) => {
    idCounter.current += 1;
    const random = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : Math.random().toString(36).slice(2);
    return `${prefix}-${random}-${idCounter.current}`;
  }, []);

  const activeAssetAnnotations = useMemo(
    () => asset ? annotationIndex.byAsset.get(asset.id) ?? EMPTY_ANNOTATIONS : EMPTY_ANNOTATIONS,
    [asset, annotationIndex.byAsset],
  );
  const visibleAnnotations = useMemo(
    () => stackAnnotationsByLabel(
      activeAssetAnnotations.filter((annotation) => !hiddenAnnotationIds.has(annotation.id) && !hiddenLabelIds.has(annotation.label)),
      labels,
    ),
    [activeAssetAnnotations, hiddenAnnotationIds, hiddenLabelIds, labels],
  );
  const selectedIds = useMemo(
    () => editor.selection.multiSelected.length ? editor.selection.multiSelected : editor.selection.selected ? [editor.selection.selected] : [],
    [editor.selection.multiSelected, editor.selection.selected],
  );
  const assetById = useMemo(() => new Map(assets.map((item) => [item.id, item])), [assets]);
  const selectedPolygons = useMemo(
    () => editor.annotations.filter((annotation): annotation is Extract<EditorAnnotation, { type: "polygon" }> => selectedIds.includes(annotation.id) && annotation.type === "polygon"),
    [editor.annotations, selectedIds],
  );
  const activePolygon = editor.selectedAnnotation?.type === "polygon" && editor.selectedAnnotation.asset === asset?.id ? editor.selectedAnnotation : null;
  const activeColor = labels.find((label) => label.id === activeLabel)?.color ?? "#929a95";
  const projectDirty = sessionDirty || !editor.saved;
  const missingImageCount = assets.filter((item) => item.missing).length;
  const snapTolerance = screenPixelsToImageUnits(13, imageSize, viewport.layout.width);
  const snap = useMemo(
    () => ({ enabled: snapEnabled, tolerance: snapTolerance, annotations: visibleAnnotations }),
    [snapEnabled, snapTolerance, visibleAnnotations],
  );

  const interactions = useCanvasInteractions({
    svgRef: viewport.canvasRef,
    imageSize,
    state: editor.state,
    dispatch: editor.dispatch,
    makeId,
    activeAssetId: current || null,
    activeAnnotations: activeAssetAnnotations,
    addToSelection,
    renderedWidth: viewport.layout.width,
    snap,
  });
  const addAnnotationWithFallbackLabel = useCallback((annotation: EditorAnnotation) => {
    if (labels.some((label) => label.id === annotation.label)) {
      editor.addAnnotation(annotation);
      return;
    }
    const fallbackLabels = ensureUnlabeledLabel(labels, copy.unlabeled);
    setLabels(fallbackLabels);
    setActiveLabel(UNLABELED_ID);
    setSessionDirty(true);
    editor.addAnnotation({ ...annotation, label: UNLABELED_ID });
  }, [copy.unlabeled, editor, labels]);
  const drawing = useDrawingInteractions({
    svgRef: viewport.canvasRef,
    imageSize,
    tool,
    assetId: current || null,
    labelId: activeLabel,
    makeId,
    addAnnotation: addAnnotationWithFallbackLabel,
    snap,
  });

  const vectorResultMessage = useCallback((result: AdvancedVectorResult) => {
    const messages: Record<AdvancedVectorResult, string> = {
      "hole-added": copy.toastReshapeAdded,
      "hole-invalid": copy.toastReshapeCross,
      "split-done": copy.toastSplitDone,
      "split-invalid": copy.toastSplitNeedsCross,
      "reshape-added": copy.toastReshapeAdded,
      "reshape-removed": copy.toastReshapeRemoved,
      "reshape-mixed": copy.toastReshapeMixed,
      "reshape-crossings": copy.toastReshapeCross,
      "reshape-direction": copy.toastReshapeAddDirection,
    };
    setMessage(messages[result]);
  }, [copy]);

  const advanced = useAdvancedVectorInteractions({
    svgRef: viewport.canvasRef,
    imageSize,
    tool: vectorTool,
    activePolygon,
    makeId,
    dispatch: editor.dispatch,
    snap,
    onResult: vectorResultMessage,
  });

  const touch = useTouchNavigation({
    tool,
    zoom: viewport.state.zoom,
    panBy: viewport.panBy,
    pinchPan: viewport.pinchPan,
    cancelEditing: () => { interactions.cancel(); advanced.cancel(); },
    cancelDrawing: drawing.cancelDraft,
  });

  const replaceObjectUrls = useCallback((next: string[]) => {
    objectUrls.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrls.current = next;
  }, []);
  useEffect(() => () => objectUrls.current.forEach((url) => URL.revokeObjectURL(url)), []);
  useEffect(() => {
    const stored = storedLanguage();
    setLanguage(stored);
    setMessage(getCopy(stored).ready);
    document.documentElement.dataset.theme = storedTheme();
  }, []);

  function changeLanguage(next: Language) {
    setLanguage(next);
    localStorage.setItem("poligome-language", next);
    setMessage(getCopy(next).ready);
  }

  function resetInteractionState() {
    setTool("select");
    setVectorTool(null);
    setAddToSelection(false);
    setCursorPoint(null);
    drawing.cancelDraft();
    advanced.cancel();
    editor.dispatch({ type: "clear-selection" });
    viewport.zoomTo(92);
  }

  function resetTransientVisibility() {
    setHiddenAnnotationIds(new Set());
    setHiddenLabelIds(new Set());
  }

  function resetDemoTutorial() {
    demoAnnotationsRef.current = [];
    setDemoTutorialStep(null);
    setDemoTutorialToolPrompt(null);
  }

  function resetProjectState() {
    replaceObjectUrls([]);
    setAssets([]);
    setLabels([]);
    setActiveLabel("");
    setCurrent("");
    setProjectName(copy.newProject);
    editor.replaceAnnotations([], true);
    resetTransientVisibility();
    resetDemoTutorial();
    setSessionDirty(false);
    resetInteractionState();
  }

  function startNewProject() {
    const hasCurrentData = assets.length > 0 || editor.annotations.length > 0 || projectDirty;
    if (hasCurrentData && !window.confirm(copy.replaceUnsavedWithNewProject)) return;
    resetProjectState();
    setMessage(copy.newProjectReady);
  }

  async function loadDemo(requestedLanguage: Language = language) {
    setLoading(true);
    try {
      const demo = await createEditorDemo(requestedLanguage);
      replaceObjectUrls(demo.objectUrls);
      setAssets(demo.assets);
      setLabels(demo.labels);
      setActiveLabel(demo.labels[0]?.id ?? EMPTY_LABELS[0].id);
      setCurrent(demo.assets[0]?.id ?? "");
      setProjectName(demo.name);
      demoAnnotationsRef.current = demo.annotations;
      editor.replaceAnnotations([], true);
      resetTransientVisibility();
      setSessionDirty(false);
      resetInteractionState();
      setDemoTutorialStep(0);
      setDemoTutorialToolPrompt("box");
      setMessage(getCopy(requestedLanguage).demoReady);
    } catch (error) {
      setMessage(translateErrorCode(error, copy, copy.demoError));
    } finally {
      setLoading(false);
    }
  }

  /**
   * Encerra o tutorial sem repor o conjunto de anotações da demo.
   *
   * O exitDemoTutorial troca tudo pelas anotações prontas, o que é certo para o
   * botão de sair, e errado quando o que acabou de chegar é o resultado de um
   * modelo: ele seria descartado junto.
   */
  function leaveDemoTutorial() {
    setDemoTutorialStep(null);
    setDemoTutorialToolPrompt(null);
  }

  function exitDemoTutorial() {
    if (demoAnnotationsRef.current.length) {
      editor.replaceAnnotations([...demoAnnotationsRef.current], editor.saved);
      setCurrent("demo-urban");
      setTool("select");
      setVectorTool(null);
      setAddToSelection(false);
      setCursorPoint(null);
      viewport.zoomTo(92);
    }
    setDemoTutorialStep(null);
    setDemoTutorialToolPrompt(null);
  }

  function advanceDemoToEdit() {
    const park = assets.find((item) => item.id === "demo-park");
    const parkSize = { width: park?.width ?? 1000, height: park?.height ?? 650 };
    const reference = demoAnnotationsRef.current.find((annotation) => annotation.id === "demo-b4");
    const box = tutorialEditBox(reference, parkSize);
    editor.replaceAnnotations(box ? [box] : [], editor.saved);
    setCurrent("demo-park");
    if (box) editor.setSelection({ selected: box.id, multiSelected: [box.id], anchorId: box.id });
    setDemoTutorialToolPrompt("select");
    setDemoTutorialStep(2);
    viewport.zoomTo(92);
  }

  function advanceDemoToModel() {
    editor.replaceAnnotations([], editor.saved);
    setCurrent("demo-rural");
    setDemoTutorialToolPrompt(null);
    setDemoTutorialStep(4);
    viewport.zoomTo(92);
  }

  function exploreDemoModels() {
    exitDemoTutorial();
    window.dispatchEvent(new CustomEvent("poligome:open-sam"));
  }

  /**
   * Roda um contêiner BYOM sobre a imagem aberta e ingere o COCO devolvido.
   *
   * O pedido sai daqui, e não do modal, porque é aqui que a imagem existe: o
   * catálogo só sabe qual modelo você escolheu. O resultado entra somado ao que
   * já havia, pelo mesmo caminho de um COCO importado à mão.
   */
  const runByomModel = useCallback(async (modelId: string) => {
    if (!asset) { setMessage(copy.imageNotLoaded); return; }
    // Mesmo motivo do acceptSamMask: o tutorial da demo removeria a primeira
    // anotação devolvida pelo contêiner.
    leaveDemoTutorial();
    const stored = (() => { try { return localStorage.getItem("poligome-sam-endpoint"); } catch { return null; } })();
    const base = connectorBaseUrl(stored || DEFAULT_SAM_ENDPOINT);
    if (!base) { setMessage(copy.errSamUnreachable); return; }
    setMessage(`${modelId}: anotando…`);
    try {
      const { url } = await assetAsDataUrl(asset, copy);
      const response = await fetch(`${base}/byom/annotate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model_id: modelId, image: url, file_name: asset.name }),
        signal: AbortSignal.timeout(300_000),
      });
      if (!response.ok) {
        // O conector escreve estes detalhes para quem está anotando; passam como estão.
        const body = await response.json().catch(() => null) as { detail?: unknown } | null;
        setMessage(typeof body?.detail === "string" ? body.detail : `${modelId}: HTTP ${response.status}`);
        return;
      }
      const body = await response.json() as { coco?: CocoDocumentInput };
      if (!body.coco) { setMessage(`${modelId}: resposta sem documento COCO.`); return; }
      const result = importCocoDocument(body.coco, assets, labels, makeId, { unlabeledName: copy.unlabeled });
      if (!result.annotations.length) { setMessage(`${modelId}: nenhuma anotação devolvida.`); return; }
      applyCocoImport({
        labels: result.labels,
        annotations: result.annotations,
        append: true,
        message: `${modelId}: ${result.annotations.length} ${result.annotations.length === 1 ? "anotação" : "anotações"}.`,
      });
    } catch {
      setMessage(copy.errSamUnreachable);
    }
  }, [applyCocoImport, asset, assets, copy, labels, makeId]);

  useEffect(() => {
    const run = (event: Event) => {
      const modelId = (event as CustomEvent<{ modelId?: string }>).detail?.modelId;
      if (typeof modelId === "string") void runByomModel(modelId);
    };
    window.addEventListener("poligome:run-byom", run);
    return () => window.removeEventListener("poligome:run-byom", run);
  }, [runByomModel]);

  /**
   * Pergunta ao conector o que o modelo carregado aceita.
   *
   * Vem do conector, e não do catálogo, porque o catálogo descreve o modelo que
   * você escolheu na tela e aqui o que importa é o que está carregado: oferecer
   * "Texto" sobre um SAM 2.1 seria prometer algo que o pedido recusaria.
   */
  useEffect(() => {
    if (tool !== "sam") return;
    let cancelled = false;
    const stored = (() => { try { return localStorage.getItem("poligome-sam-endpoint"); } catch { return null; } })();
    const base = connectorBaseUrl(stored || DEFAULT_SAM_ENDPOINT);
    // A escrita fica no retorno da promessa, e não no corpo do efeito: um setState
    // síncrono aqui dispara uma renderização em cascata por nada.
    void (base ? fetchHealth(base) : Promise.resolve(null)).then((health) => {
      if (cancelled) return;
      setSamConnectorFound(health !== null);
      setSamCapabilities(Array.isArray(health?.capabilities) ? health.capabilities : []);
    });
    return () => { cancelled = true; };
  }, [tool]);

  // Um modo que o modelo carregado não aceita não vale — trocar de modelo pelo
  // painel deixaria a barra em “Texto” sobre um SAM 2.1. Derivado, e não corrigido
  // por efeito: assim não existe um quadro em que o modo errado valeu.
  const activeSamMode: SamInteractionMode =
    samMode === "points" || !samCapabilities.length
      || samCapabilities.includes(samMode === "box" ? "box" : "text")
      ? samMode
      : "points";

  /**
   * Cada clique com a ferramenta SAM acrescenta um prompt e repete a predição com
   * todos eles: é assim que um ponto negativo corrige o que o positivo pegou
   * demais. A máscara fica como proposta até o usuário salvar, do mesmo jeito que
   * um rascunho de polígono — errar um clique não pode sujar a lista.
   */
  const runSam = useCallback(async ({ prompts, box, text }: {
    prompts?: SamPrompt[];
    box?: SamBoxPrompt | null;
    text?: string;
  }) => {
    if (!asset) return;
    if (!prompts?.length && !box && !text?.trim()) { setSamPreviews([]); return; }
    const stored = (() => { try { return localStorage.getItem("poligome-sam-endpoint"); } catch { return null; } })();
    setSamLoading(true);
    try {
      const annotations = await requestSamAnnotations({
        makeId,
        asset,
        label: activeLabel,
        endpoint: stored || DEFAULT_SAM_ENDPOINT,
        prompts,
        box,
        text,
        threshold: samThreshold,
        copy,
      });
      setSamPreviews(annotations);
      if (text?.trim() && !annotations.length) setMessage(copy.errSamNoPolygon);
    } catch (error) {
      setSamPreviews([]);
      setMessage(error instanceof Error ? error.message : copy.errSamUnreachable);
    } finally {
      setSamLoading(false);
    }
  }, [activeLabel, asset, copy, makeId, samThreshold]);

  function addSamPrompt(point: { x: number; y: number }, negative: boolean) {
    const next: SamPrompt[] = [...samPrompts, { x: point.x, y: point.y, label: negative ? 0 : 1 }];
    setSamPrompts(next);
    void runSam({ prompts: next });
  }

  /** Limpa prompts e proposta sem tocar no modo nem no texto já digitado. */
  function clearSamPrompts() {
    setSamPrompts([]);
    setSamBoxStart(null);
    setSamBox(null);
    setSamPreviews([]);
  }

  function restartSam() {
    clearSamPrompts();
    setSamText("");
    setSamNegative(false);
    setMessage(copy.samRestarted);
  }

  /**
   * Trocar de modo apaga o que estava montado: um ponto não sobrevive a virar
   * caixa, e deixá-lo no ar faria a próxima predição misturar dois pedidos.
   */
  function chooseSamMode(mode: SamInteractionMode) {
    if (mode === samMode) return;
    clearSamPrompts();
    setSamNegative(false);
    setSamMode(mode);
  }

  function runSamText() {
    const query = samText.trim();
    if (!query) { setMessage(copy.samDescribeConcept); return; }
    void runSam({ prompts: [], box: null, text: query });
  }

  function acceptSamMask() {
    if (!samPreviews.length) return;
    // O tutorial da demo apaga o que não for a caixa pedida sobre o telhado, e
    // isso incluía a primeira máscara do SAM — justamente o que o usuário
    // instalou o conector para ver. Quem chegou até aqui já passou do tutorial:
    // encerrá-lo sem repor as anotações da demo preserva a máscara.
    leaveDemoTutorial();
    editor.appendAnnotations(samPreviews, true);
    const total = samPreviews.length;
    clearSamPrompts();
    setSessionDirty(true);
    setMessage(total > 1 ? `${total} ${copy.imageAnnotations}. ${copy.samSavedToolActive}` : copy.samSavedToolActive);
  }

  useEffect(() => {
    if (demoQueryHandled.current || typeof window === "undefined") return;
    demoQueryHandled.current = true;
    const target = demoRouteTarget(window.location.href);
    if (target === null) return;
    window.history.replaceState(window.history.state, "", target);
    void loadDemo(storedLanguage());
  }, []);

  useEffect(() => {
    if (demoTutorialToolPrompt === "box" && tool === "box") setDemoTutorialToolPrompt(null);
    if (demoTutorialToolPrompt === "select" && tool === "select") setDemoTutorialToolPrompt(null);
  }, [demoTutorialToolPrompt, tool]);

  useEffect(() => {
    if (demoTutorialStep === 0) {
      const drawn = editor.annotations.find((annotation) => annotation.asset === "demo-urban");
      if (drawn && annotationIntersectsDemoRoof(drawn, imageSize)) {
        setDemoTutorialStep(1);
        setMessage(tutorialSuccessTitle[language]);
      } else if (drawn) {
        editor.replaceAnnotations(editor.annotations.filter((annotation) => annotation.id !== drawn.id), false);
        setDemoTutorialToolPrompt("box");
        setMessage(tutorialWrongDraw[language]);
      }
    }
    if (demoTutorialStep === 2) {
      const box = editor.annotations.find((annotation) => annotation.id === "demo-b4");
      if (tutorialEditBoxChanged(box, imageSize)) {
        setDemoTutorialStep(3);
      }
    }
  }, [demoTutorialStep, editor.annotations, imageSize.height, imageSize.width, language]);

  async function openProject(file: File) {
    setLoading(true);
    try {
      const loaded = await openEditorProject(file, copy);
      replaceObjectUrls(loaded.objectUrls);
      setAssets(loaded.assets);
      setLabels(loaded.labels);
      setActiveLabel((loaded.labels[0] ?? EMPTY_LABELS[0]).id);
      setCurrent(loaded.assets.find((item) => !item.missing)?.id ?? loaded.assets[0]?.id ?? "");
      setProjectName(loaded.projectName);
      editor.replaceAnnotations(loaded.annotations, true);
      resetTransientVisibility();
      resetDemoTutorial();
      setSessionDirty(false);
      resetInteractionState();
      setMessage(`${copy.projectOpened}: ${file.name}${loaded.missingImages ? ` · ${loaded.missingImages} ${copy.projectImagesNeedReload}` : ""}`);
    } catch (error) {
      setMessage(translateErrorCode(error, copy, copy.projectOpenError));
    } finally {
      setLoading(false);
    }
  }

  async function addImages(files: File[]) {
    if (!files.length) return;
    setLoading(true);
    try {
      const loaded = await loadLocalImageAssets(files, makeId);
      objectUrls.current.push(...loaded.objectUrls);
      if (loaded.assets.length) {
        setAssets((items) => [...items, ...loaded.assets]);
        if (!current) setCurrent(loaded.assets[0].id);
        setSessionDirty(true);
      }
      setMessage(`${copy.importImages}: ${loaded.assets.length}${loaded.rejected.length ? ` · ${loaded.rejected.length}` : ""}.`);
    } finally {
      setLoading(false);
    }
  }

  async function relinkProjectImages(files: File[]) {
    if (!files.length || !missingImageCount) return;
    setLoading(true);
    try {
      const result = await relinkMissingAssets(assets, files);
      objectUrls.current.push(...result.objectUrls);
      if (result.restoredIds.length) {
        setAssets(result.assets);
        setSessionDirty(true);
        if (!current || assets.find((item) => item.id === current)?.missing) setCurrent(result.restoredIds[0]);
        setMessage(`${result.restoredIds.length} ${copy.projectImagesRestored}${result.rejected.length ? ` · ${result.rejected.length} ${copy.projectImagesNeedReload}` : ""}`);
      } else {
        setMessage(`${copy.imageMissingHint}${result.rejected.length ? ` · ${result.rejected.length}` : ""}`);
      }
    } finally {
      setLoading(false);
    }
  }

  function applyRasterImport(result: RasterImportResult) {
    if (result.objectUrl) objectUrls.current.push(result.objectUrl);
    setAssets((items) => [...items, result.asset]);
    setCurrent(result.asset.id);
    setSessionDirty(true);
    setMessage(result.message);
    resetInteractionState();
  }

  function applyCocoImport(result: { labels: Label[]; annotations: EditorAnnotation[]; append?: boolean; message: string }) {
    if (result.append) {
      startTransition(() => {
        setLabels((currentLabels) => labelsMatch(currentLabels, result.labels) ? currentLabels : result.labels);
        if (!result.labels.some((label) => label.id === activeLabel)) setActiveLabel(result.labels[0]?.id ?? EMPTY_LABELS[0].id);
        editor.appendAnnotations(result.annotations, false);
        setSessionDirty(true);
        setMessage(result.message);
      });
      return;
    }
    setLabels(result.labels);
    if (!result.labels.some((label) => label.id === activeLabel)) setActiveLabel(result.labels[0]?.id ?? EMPTY_LABELS[0].id);
    editor.replaceAnnotations(result.annotations, false);
    setSessionDirty(true);
    setMessage(result.message);
    resetTransientVisibility();
    resetDemoTutorial();
    drawing.cancelDraft();
    advanced.cancel();
    setVectorTool(null);
    setTool("select");
    setAddToSelection(false);
  }

  function chooseTool(next: DrawingTool) {
    // Sair da ferramenta SAM descarta os prompts e a proposta: guardá-los faria a
    // máscara reaparecer numa ferramenta que não a produziu.
    if (next !== "sam" && (samPrompts.length || samBox || samPreviews.length)) clearSamPrompts();
    if (next !== tool) drawing.cancelDraft();
    advanced.cancel();
    setVectorTool(null);
    setTool(next);
    if (next !== "select") {
      setAddToSelection(false);
      editor.dispatch({ type: "clear-selection" });
    }
    if (next === "pan") setCursorPoint(null);
  }

  function chooseVectorTool(next: VectorTool) {
    drawing.cancelDraft();
    interactions.cancel();
    advanced.cancel();
    setAddToSelection(false);
    setTool("select");
    setVectorTool(next);
  }

  function selectAsset(id: string) {
    if (!assets.some((item) => item.id === id)) return;
    drawing.cancelDraft();
    advanced.cancel();
    setVectorTool(null);
    setAddToSelection(false);
    setCursorPoint(null);
    setCurrent(id);
    editor.dispatch({ type: "clear-selection" });
    viewport.zoomTo(92);
  }

  function stepImage(delta: number) {
    if (!asset || !assets.length) return;
    const index = assets.findIndex((item) => item.id === asset.id);
    const next = Math.max(0, Math.min(assets.length - 1, index + delta));
    selectAsset(assets[next].id);
  }

  function moveAsset(id: string, delta: -1 | 1) {
    setAssets((items) => {
      const next = moveItemById(items, id, delta);
      if (next !== items) setSessionDirty(true);
      return next;
    });
  }

  function deleteAssets(ids: string[]) {
    const removedIds = new Set(ids);
    const removedAssets = assets.filter((item) => removedIds.has(item.id));
    if (!removedAssets.length) return;
    const index = assets.findIndex((item) => item.id === current);
    const annotationIds = editor.annotations.filter((annotation) => removedIds.has(annotation.asset)).map((annotation) => annotation.id);
    if (annotationIds.length) editor.deleteAnnotations(annotationIds);
    const remaining = assets.filter((candidate) => !removedIds.has(candidate.id));
    setAssets(remaining);
    setHiddenAnnotationIds((currentHidden) => new Set([...currentHidden].filter((annotationId) => !annotationIds.includes(annotationId))));
    if (current && removedIds.has(current)) {
      setCurrent(remaining[Math.min(index, Math.max(0, remaining.length - 1))]?.id ?? "");
      editor.dispatch({ type: "clear-selection" });
      viewport.zoomTo(92);
    }
    removedAssets.filter((item) => item.src.startsWith("blob:")).forEach((item) => {
      objectUrls.current = objectUrls.current.filter((url) => url !== item.src);
      URL.revokeObjectURL(item.src);
    });
    setSessionDirty(true);
  }

  function deleteAsset(id: string) { deleteAssets([id]); }

  function selectAnnotationFromPanel(id: string, modifiers: { shift: boolean; additive: boolean }) {
    if (modifiers.shift) {
      editor.setSelection(selectRange(activeAssetAnnotations, editor.selection, id, modifiers.additive));
      return;
    }
    editor.dispatch({ type: modifiers.additive ? "toggle-selection" : "select-single", id });
  }

  function selectAllActiveAnnotations() {
    const ids = activeAssetAnnotations.map((annotation) => annotation.id);
    editor.setSelection({ selected: ids.at(-1) ?? null, multiSelected: ids, anchorId: ids[0] ?? null });
  }

  function toggleAnnotationVisibility(id: string) {
    setHiddenAnnotationIds((currentHidden) => {
      const next = new Set(currentHidden);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleLabelVisibility(id: string) {
    setHiddenLabelIds((currentHidden) => {
      const next = new Set(currentHidden);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function deleteAnnotations(ids: string[]) {
    if (!ids.length) return;
    editor.deleteAnnotations(ids);
    setHiddenAnnotationIds((currentHidden) => new Set([...currentHidden].filter((id) => !ids.includes(id))));
  }

  function deleteCurrentSelection() {
    if (editor.selectedVertex) {
      editor.dispatch({ type: "delete-vertex", annotationId: editor.selectedVertex.annotationId, vertexId: editor.selectedVertex.vertexId });
      return;
    }
    deleteAnnotations(selectedIds);
  }

  function finishActiveDraft() {
    if (vectorTool === "hole") advanced.finishHole();
    else drawing.finishDraft();
  }

  function removeLastDraftPoint() {
    if (vectorTool === "hole") advanced.removeLastPoint();
    else drawing.removeLastPoint();
  }

  function cancelActiveDraft() {
    drawing.cancelDraft();
    advanced.cancel();
  }

  function clearAllAnnotations() {
    const ids = editor.annotations.map((annotation) => annotation.id);
    if (!ids.length) return;
    if (!window.confirm(`${copy.confirmDeleteAnnotations}\n${copy.deleteAnnotationsWarning}`)) return;
    deleteAnnotations(ids);
    setMessage(`${ids.length} ${copy.annotationsDeleted}`);
  }

  function batchReclassify(ids: string[], labelId: string) {
    if (!ids.length || !labels.some((label) => label.id === labelId)) return;
    editor.dispatch({ type: "reclassify-annotations", ids, labelId });
  }

  function createLabel(name: string, color: string) {
    const id = makeId("label");
    const next = createPanelLabel(labels, id, name, color);
    if (next === labels) return;
    setLabels(next);
    setActiveLabel(id);
    setSessionDirty(true);
  }

  function changeLabelName(id: string, name: string) {
    setLabels((items) => {
      const next = renameLabel(items, id, name);
      if (next !== items) setSessionDirty(true);
      return next;
    });
  }

  function changeLabelColor(id: string, color: string) {
    setLabels((items) => {
      const next = recolorLabel(items, id, color);
      if (next !== items) setSessionDirty(true);
      return next;
    });
  }

  function moveLabel(id: string, delta: -1 | 1) {
    setLabels((items) => {
      const next = moveItemById(items, id, delta);
      if (next !== items) setSessionDirty(true);
      return next;
    });
  }

  function deleteLabel(id: string) {
    if (id === UNLABELED_ID || !labels.some((label) => label.id === id)) return;
    const affected = editor.annotations.filter((annotation) => annotation.label === id).map((annotation) => annotation.id);
    const remainingLabels = labels.filter((label) => label.id !== id);
    const nextLabels = affected.length ? ensureUnlabeledLabel(remainingLabels, copy.unlabeled) : remainingLabels;
    if (affected.length) editor.dispatch({ type: "reclassify-annotations", ids: affected, labelId: UNLABELED_ID });
    setLabels(nextLabels);
    setHiddenLabelIds((currentHidden) => {
      const next = new Set(currentHidden);
      next.delete(id);
      return next;
    });
    if (activeLabel === id) setActiveLabel(nextLabels[0]?.id ?? "");
    setSessionDirty(true);
  }

  function simplifySelected() {
    if (!selectedPolygons.length) return;
    const simplified = selectedPolygons
      .map((polygon) => {
        const source = assetById.get(polygon.asset);
        const polygonImage = { width: Number(source?.width) || imageSize.width, height: Number(source?.height) || imageSize.height };
        const tolerance = screenPixelsToImageUnits(4, polygonImage, viewport.layout.width);
        return simplifyPolygonAnnotation(polygon, tolerance);
      })
      .filter((polygon, index) => polygon !== selectedPolygons[index]);
    if (!simplified.length) return;
    editor.dispatch({ type: "replace-annotations-by-id", annotations: simplified });
    setMessage(copy.toastSimplified);
  }

  function duplicatePolygon(source: Extract<EditorAnnotation, { type: "polygon" }>): EditorAnnotation {
    const id = makeId("copy");
    const offset = screenPixelsToImageUnits(22, imageSize, viewport.layout.width);
    const xs = source.vertices.map((vertex) => vertex.x);
    const ys = source.vertices.map((vertex) => vertex.y);
    let dx = Math.max(...xs) + offset <= imageSize.width ? offset : -offset;
    let dy = Math.max(...ys) + offset <= imageSize.height ? offset : -offset;
    if (Math.min(...xs) + dx < 0) dx = 0;
    if (Math.min(...ys) + dy < 0) dy = 0;
    return {
      ...source,
      id,
      vertices: source.vertices.map((vertex, index) => ({ id: `${id}:outer:v${index}`, x: vertex.x + dx, y: vertex.y + dy })),
      holes: source.holes.map((hole, holeIndex) => hole.map((vertex, vertexIndex) => ({ id: `${id}:hole-${holeIndex}:v${vertexIndex}`, x: vertex.x + dx, y: vertex.y + dy }))),
    };
  }

  function duplicateSelected() {
    if (!selectedPolygons.length) return;
    const duplicates = selectedPolygons.map(duplicatePolygon);
    editor.dispatch({ type: "replace-annotations-batch", removeIds: [], annotations: duplicates, selectIds: duplicates.map((duplicate) => duplicate.id) });
    setMessage(copy.toastDuplicated);
  }

  function mergeSelected() {
    if (selectedPolygons.length < 2) return;
    const sameLabel = selectedPolygons.every((polygon) => polygon.label === selectedPolygons[0].label);
    if (!sameLabel) { setMessage(copy.toastMergeSameClass); return; }
    const merged = unionPolygonAnnotations(selectedPolygons, makeId);
    if (merged.length !== 1) { setMessage(copy.toastMergeFailed); return; }
    editor.dispatch({ type: "replace-annotations-batch", removeIds: selectedPolygons.map((polygon) => polygon.id), annotations: merged, selectIds: merged.map((polygon) => polygon.id) });
    setMessage(copy.toastMerged);
  }

  function reviewAsset(score: number) {
    if (!asset) return;
    setAssets((items) => setAssetReviewScore(items, asset.id, score));
    setSessionDirty(true);
  }

  function reviewLabel(score: number) {
    if (!labels.some((label) => label.id === activeLabel)) return;
    setLabels((items) => setLabelReviewScore(items, activeLabel, score));
    setSessionDirty(true);
  }

  function reviewAnnotation(score: number) {
    if (!editor.selectedAnnotation) return;
    editor.dispatch({ type: "replace-annotation", annotation: { ...editor.selectedAnnotation, reviewScore: score } });
  }

  async function saveProject() {
    if (!assets.length) return;
    setLoading(true);
    try {
      const name = await saveEditorProject(projectName, assets, labels, editor.annotations, copy);
      editor.markSaved();
      setSessionDirty(false);
      setMessage(`${copy.projectSaved}: ${name}`);
    } catch (error) {
      setMessage(translateErrorCode(error, copy, copy.projectSaveError));
    } finally {
      setLoading(false);
    }
  }

  // The handler closes over render-scoped state, so it is refreshed on every commit
  // while the window listener itself is registered once. Re-subscribing per render
  // meant add/removeEventListener ran at pointermove rate during a drag.
  const keydownRef = useRef<(event: KeyboardEvent) => void>(() => undefined);
  const handleKeydown = (event: KeyboardEvent) => {
    if (isEditableShortcutTarget(event.target)) return;
    const command = commandFromKeyboard(event);
    if (!command) return;
    if (["undo", "redo", "delete", "finish-draft", "escape"].includes(command.type)) event.preventDefault();
    if (command.type === "undo") { editor.undo(); return; }
    if (command.type === "redo") { editor.redo(); return; }
    if (command.type === "delete") {
      if (editor.selectedVertex) deleteCurrentSelection();
      else if (vectorTool === "hole" && advanced.canRemoveLastPoint) advanced.removeLastPoint();
      else if (drawing.canRemoveLastPoint) drawing.removeLastPoint();
      else deleteAnnotations(selectedIds);
      return;
    }
    if (command.type === "finish-draft") { finishActiveDraft(); return; }
    if (command.type === "escape") {
      cancelActiveDraft(); interactions.cancel(); setVectorTool(null); setAddToSelection(false);
      if (tool !== "select") setTool("select"); else editor.dispatch({ type: "clear-selection" });
      return;
    }
    if (command.type === "tool") { if (asset && !asset.missing) chooseTool(command.tool); return; }
    if (command.type === "vector-tool") { if (activePolygon) chooseVectorTool(command.tool); return; }
    if (command.type === "label-key") {
      const label = labels.find((item) => item.key === command.key);
      if (label) setActiveLabel(label.id);
    }
  };

  useEffect(() => { keydownRef.current = handleKeydown; });

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => keydownRef.current(event);
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, []);

  const noopElement = useCallback((_event: ReactPointerEvent<SVGElement>) => undefined, []);
  const noopAnnotation = useCallback((_event: ReactPointerEvent<SVGElement>, _annotation: EditorAnnotation) => undefined, []);
  const noopVertex = useCallback((_event: ReactPointerEvent<SVGElement>, _annotation: EditorAnnotation, _id: string) => undefined, []);
  const noopInsert = useCallback((_event: ReactPointerEvent<SVGElement>, _annotation: EditorAnnotation, _id: string, _x: number, _y: number) => undefined, []);
  const noopResize = useCallback((_event: ReactPointerEvent<SVGElement>, _annotation: EditorAnnotation, _corner: BoxCorner) => undefined, []);

  const imageIndex = asset ? assets.findIndex((item) => item.id === asset.id) : -1;
  const selecting = tool === "select" && !vectorTool;
  const vectorEditing = Boolean(vectorTool);
  const panning = tool === "pan";
  const stageTool = vectorTool ?? tool;
  const markerRadius = screenPixelsToImageUnits(4.6, imageSize, viewport.layout.width);
  const lineThickness = screenPixelsToImageUnits(strokePx, imageSize, viewport.layout.width);
  const touchRadius = screenPixelsToImageUnits(22, imageSize, viewport.layout.width);
  const boxTouchRadius = screenPixelsToImageUnits(28, imageSize, viewport.layout.width);
  const boxRotationTouchRadius = screenPixelsToImageUnits(20, imageSize, viewport.layout.width);
  const guideUnit = screenPixelsToImageUnits(1, imageSize, viewport.layout.width);
  const guideLabelWidth = 132 * guideUnit;
  const guideLabelHeight = 22 * guideUnit;
  const guideLabelX = cursorPoint ? Math.max(0, Math.min(imageSize.width - guideLabelWidth, cursorPoint.x + 9 * guideUnit)) : 0;
  const guideLabelY = cursorPoint ? Math.max(0, Math.min(imageSize.height - guideLabelHeight, cursorPoint.y + 9 * guideUnit)) : 0;
  const canvasCursor = panning ? (touch.navigating || mousePanning ? "grabbing" : "grab") : vectorEditing || !selecting ? "crosshair" : "default";
  const overlay = <>
    <DrawingDraftLayer draft={drawing.draft} color={activeColor} lineThickness={lineThickness} />
    {/* As máscaras aparecem tracejadas porque ainda são proposta: só o salvar as
        torna anotação. Uma busca por texto propõe várias de uma vez. */}
    {samPreviews.map((preview) => <polygon
      key={preview.id}
      className="sam-mask-preview"
      points={preview.vertices.map((vertex) => `${vertex.x},${vertex.y}`).join(" ")}
      fill={`${activeColor}26`}
      stroke={activeColor}
      strokeWidth={lineThickness}
      strokeDasharray="10 6"
      vectorEffect="non-scaling-stroke"
      pointerEvents="none"
    />)}
    {samBox && <rect
      className="sam-box-prompt"
      x={samBox.x}
      y={samBox.y}
      width={samBox.w}
      height={samBox.h}
      fill={`${activeColor}16`}
      stroke={activeColor}
      strokeWidth={lineThickness}
      strokeDasharray="9 6"
      vectorEffect="non-scaling-stroke"
      pointerEvents="none"
    />}
    {samPrompts.map((prompt, index) => <g key={`sam-prompt-${index}`} className={`sam-prompt ${prompt.label === 1 ? "positive" : "negative"}`}>
      <circle cx={prompt.x} cy={prompt.y} r={6 * guideUnit} strokeWidth={2 * guideUnit} vectorEffect="non-scaling-stroke" />
      <line x1={prompt.x - 3 * guideUnit} y1={prompt.y} x2={prompt.x + 3 * guideUnit} y2={prompt.y} strokeWidth={2 * guideUnit} vectorEffect="non-scaling-stroke" />
      {prompt.label === 1 && <line x1={prompt.x} y1={prompt.y - 3 * guideUnit} x2={prompt.x} y2={prompt.y + 3 * guideUnit} strokeWidth={2 * guideUnit} vectorEffect="non-scaling-stroke" />}
    </g>)}
    <AdvancedVectorDraftLayer draft={advanced.draft} color={activeColor} lineThickness={lineThickness} />
    <DemoTutorialOverlay step={demoTutorialStep} toolPrompt={demoTutorialToolPrompt} imageSize={imageSize} />
    {coordinatesGuide && cursorPoint && <g className="coordinate-guide" pointerEvents="none">
      <line x1={cursorPoint.x} y1={0} x2={cursorPoint.x} y2={imageSize.height} stroke="rgba(255,255,255,.82)" strokeWidth={guideUnit} vectorEffect="non-scaling-stroke" />
      <line x1={0} y1={cursorPoint.y} x2={imageSize.width} y2={cursorPoint.y} stroke="rgba(255,255,255,.82)" strokeWidth={guideUnit} vectorEffect="non-scaling-stroke" />
      <g transform={`translate(${guideLabelX} ${guideLabelY})`}>
        <rect width={guideLabelWidth} height={guideLabelHeight} rx={4 * guideUnit} fill="rgba(12,15,14,.86)" stroke="rgba(139,227,189,.9)" strokeWidth={guideUnit} />
        <text x={7 * guideUnit} y={15 * guideUnit} fill="#fff" fontSize={11 * guideUnit} fontFamily="system-ui, sans-serif">X {Math.round(cursorPoint.x)} · Y {Math.round(cursorPoint.y)}</text>
      </g>
    </g>}
  </>;

  function routePointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    const imagePoint = clientPointToImage(event.currentTarget, event.clientX, event.clientY, imageSize);
    if (demoTutorialStep === 4 && current === "demo-rural" && isTutorialModelPoint(imagePoint, imageSize)) {
      event.preventDefault();
      const id = makeId("annotation");
      const reference = demoAnnotationsRef.current.find((annotation) => annotation.id === "demo-c3");
      const suggestion = tutorialModelSuggestion(reference, id);
      if (suggestion) {
        editor.addAnnotation(suggestion, true);
        setDemoTutorialStep(5);
      }
      return;
    }
    if ((panning && event.button === 0) || event.button === 1) {
      event.preventDefault();
      mousePanRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
      setMousePanning(true);
      event.currentTarget.setPointerCapture?.(event.pointerId);
      return;
    }
    if (coordinatesGuide) setCursorPoint(imagePoint);
    if (tool === "sam") {
      // Arrastar uma caixa e clicar um ponto são o mesmo gesto: o modo escolhido
      // no painel decide qual dos dois este toque é.
      if (activeSamMode === "box") {
        setSamBoxStart(imagePoint);
        setSamBox({ ...imagePoint, w: 0, h: 0, label: 1 });
        event.currentTarget.setPointerCapture?.(event.pointerId);
        return;
      }
      // Shift ou botão direito marcam o que deve ficar de fora, sem trocar de modo.
      if (activeSamMode === "points") addSamPrompt(imagePoint, samNegative || event.button === 2 || event.shiftKey);
      return;
    }
    if (vectorEditing) advanced.onPointerDown(event);
    else if (selecting) interactions.selectAtCanvas(event);
    else drawing.onPointerDown(event);
  }

  function routePointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const pan = mousePanRef.current;
    if (pan?.pointerId === event.pointerId) {
      const dx = event.clientX - pan.x;
      const dy = event.clientY - pan.y;
      if (dx || dy) viewport.panBy(dx, dy);
      pan.x = event.clientX;
      pan.y = event.clientY;
      return;
    }
    if (coordinatesGuide && event.pointerType !== "touch") setCursorPoint(clientPointToImage(event.currentTarget, event.clientX, event.clientY, imageSize));
    if (tool === "sam" && samBoxStart) {
      const point = clientPointToImage(event.currentTarget, event.clientX, event.clientY, imageSize);
      setSamBox({
        x: Math.min(samBoxStart.x, point.x),
        y: Math.min(samBoxStart.y, point.y),
        w: Math.abs(point.x - samBoxStart.x),
        h: Math.abs(point.y - samBoxStart.y),
        label: 1,
      });
      return;
    }
    if (vectorEditing) advanced.onPointerMove(event);
    else if (selecting) interactions.moveCanvasSelection(event);
    else drawing.onPointerMove(event);
  }

  function routePointerUp(event: ReactPointerEvent<SVGSVGElement>) {
    const pan = mousePanRef.current;
    if (pan?.pointerId === event.pointerId) {
      mousePanRef.current = null;
      setMousePanning(false);
      return;
    }
    if (tool === "sam" && samBoxStart) {
      setSamBoxStart(null);
      // Uma caixa de dois pixels é um clique que escorregou, não um pedido: mandá-la
      // ao modelo devolveria uma máscara sem relação com o que o usuário queria.
      if (!samBox || samBox.w < 8 || samBox.h < 8) { setSamBox(null); return; }
      void runSam({ box: samBox, prompts: samPrompts });
      return;
    }
    if (vectorEditing) advanced.onPointerUp(event);
    else if (selecting) interactions.finishCanvasSelection(event);
    else drawing.onPointerUp(event);
  }

  function routePointerCancel() {
    mousePanRef.current = null;
    setMousePanning(false);
    if (vectorEditing) advanced.cancel();
    else if (selecting) interactions.cancel();
    else drawing.cancelDraft();
  }

  function routePointerMoveCapture(event: ReactPointerEvent<SVGSVGElement>) {
    touch.onPointerMoveCapture(event);
    if (event.isPropagationStopped()) return;
    if (interactions.moveVertex(event)) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function routePointerUpCapture(event: ReactPointerEvent<SVGSVGElement>) {
    touch.onPointerUpCapture(event);
    if (event.isPropagationStopped()) return;
    if (interactions.finishVertex(event)) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function finishWithContextMenu(event: ReactMouseEvent<SVGSVGElement>) {
    event.preventDefault();
    if ((vectorTool === "hole" && advanced.canFinish) || drawing.canFinish) finishActiveDraft();
  }

  function finishWithDoubleClick(event: ReactMouseEvent<SVGSVGElement>) {
    if ((vectorTool === "hole" && advanced.canFinish) || drawing.canFinish) {
      event.preventDefault();
      finishActiveDraft();
    }
  }

  const chromeProps = {
    projectName,
    assetsCount: assets.length,
    annotationsCount: editor.annotations.length,
    language,
    loading,
    dirty: projectDirty,
    hasAsset: Boolean(asset && !asset.missing),
    hasAssets: assets.length > 0,
    imageIndex,
    zoom: viewport.state.zoom,
    tool,
    vectorTool,
    snapEnabled,
    touchMode: touch.touchMode,
    addToSelection,
    coordinatesGuide,
    canFinishDraft: vectorTool === "hole" ? advanced.canFinish : drawing.canFinish,
    canRemoveDraftPoint: vectorTool === "hole" ? advanced.canRemoveLastPoint : drawing.canRemoveLastPoint,
    hasDraft: drawing.hasDraft || advanced.hasDraft,
    canSimplify: selectedPolygons.length >= 1,
    canDuplicate: selectedPolygons.length >= 1,
    canMerge: selectedPolygons.length >= 2,
    canEditPolygon: Boolean(activePolygon),
    canUndo: editor.history.length > 0,
    canRedo: editor.redoHistory.length > 0,
    hasSelection: selectedIds.length > 0,
    strokePx,
    statusMessage: asset ? (message || `${activeAssetAnnotations.length} ${copy.imageAnnotations}`) : copy.emptyProjectTitle,
    onHome: () => { if (!projectDirty || window.confirm(copy.confirmLeaveHome)) window.location.assign("/"); },
    onNewProject: startNewProject,
    onRenameProject: (name: string) => { setProjectName(name); setSessionDirty(true); },
    onDemo: () => { if (!projectDirty || window.confirm(copy.replaceUnsavedProject)) void loadDemo(); },
    onOpenProject: () => projectInputRef.current?.click(),
    onImportImages: () => imageInputRef.current?.click(),
    onSaveProject: () => void saveProject(),
    onLanguageChange: changeLanguage,
    onSamSettings: () => window.dispatchEvent(new CustomEvent("poligome:open-sam")),
    onTool: chooseTool,
    onVectorTool: chooseVectorTool,
    onSimplify: simplifySelected,
    onDuplicate: duplicateSelected,
    onMerge: mergeSelected,
    onToggleSnap: () => setSnapEnabled((value) => !value),
    onToggleCoordinatesGuide: () => { setCoordinatesGuide((value) => !value); setCursorPoint(null); },
    onToggleMultiSelect: () => { setAddToSelection((value) => !value); editor.dispatch({ type: "select-vertex", vertex: null }); },
    onFinishDrawing: finishActiveDraft,
    onRemoveLastPoint: removeLastDraftPoint,
    onCancelDrawing: cancelActiveDraft,
    onUndo: () => editor.undo(),
    onRedo: () => editor.redo(),
    onDelete: deleteCurrentSelection,
    onClearAnnotations: clearAllAnnotations,
    onSelectAllAnnotations: selectAllActiveAnnotations,
    onStrokeChange: setStrokePx,
    onZoomOut: () => viewport.zoomByRatio(1 / 1.1),
    onZoomIn: () => viewport.zoomByRatio(1.1),
    onFit: () => viewport.zoomTo(92),
    onPreviousImage: () => stepImage(-1),
    onNextImage: () => stepImage(1),
    onOpenImagesPanel: () => window.dispatchEvent(new CustomEvent("poligome:open-images")),
    onOpenRightPanel: () => window.dispatchEvent(new CustomEvent("poligome:open-right")),
  } satisfies PreRefactorChromeProps;

  return <main className="shell" aria-label={`${copy.appTitle}: ${projectName}`}>
    <input ref={projectInputRef} type="file" accept=".plgm,application/vnd.poligome.project+zip" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file && (!projectDirty || window.confirm(copy.replaceUnsavedProject))) void openProject(file); event.currentTarget.value = ""; }} />
    <input ref={imageInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/bmp,image/gif" multiple hidden onChange={(event) => { void addImages(Array.from(event.target.files ?? [])); event.currentTarget.value = ""; }} />
    <input ref={relinkInputRef} type="file" accept="image/*,.tif,.tiff" multiple hidden onChange={(event) => { void relinkProjectImages(Array.from(event.target.files ?? [])); event.currentTarget.value = ""; }} />

    <PreRefactorTopbar {...chromeProps} fileMenuExtras={<div className="canonical-file-extras">
      <RasterImportControl makeId={makeId} language={language} disabled={loading} onImported={applyRasterImport} onMessage={setMessage} />
      <ExportControls assets={assets} labels={labels} annotations={editor.annotations} language={language} disabled={loading} onMessage={setMessage} />
    </div>} />
    <CocoImportControl ref={annotationImportRef} assets={assets} labels={labels} annotations={editor.annotations} makeId={makeId} language={language} disabled={loading} showTrigger={false} onImported={applyCocoImport} />

    <div className="workspace">
      <EditorManagementPanels
        assets={assets}
        currentAssetId={asset?.id ?? ""}
        annotations={editor.annotations}
        annotationCountByAsset={annotationIndex.countByAsset}
        annotationCountByLabel={annotationIndex.countByLabel}
        activeAssetAnnotations={activeAssetAnnotations}
        labels={labels}
        activeLabelId={activeLabel}
        selection={editor.selection}
        hiddenAnnotationIds={hiddenAnnotationIds}
        hiddenLabelIds={hiddenLabelIds}
        copy={copy}
        loading={loading}
        onImportImages={() => imageInputRef.current?.click()}
        onImportAnnotations={() => annotationImportRef.current?.open()}
        onSelectAsset={selectAsset}
        onMoveAsset={moveAsset}
        onDeleteAsset={deleteAsset}
        onDeleteAssets={deleteAssets}
        onSelectAnnotation={selectAnnotationFromPanel}
        onMoveAnnotation={(id, delta) => editor.dispatch({ type: "reorder-annotation", id, delta })}
        onDeleteAnnotations={deleteAnnotations}
        onClearAnnotations={clearAllAnnotations}
        onToggleAnnotationVisibility={toggleAnnotationVisibility}
        onToggleLabelVisibility={toggleLabelVisibility}
        onSelectAllAnnotations={selectAllActiveAnnotations}
        onClearAnnotationSelection={() => editor.dispatch({ type: "clear-selection" })}
        onActiveLabelChange={setActiveLabel}
        onBatchReclassify={batchReclassify}
        onCreateLabel={createLabel}
        onMoveLabel={moveLabel}
        onRenameLabel={changeLabelName}
        onRecolorLabel={changeLabelColor}
        onDeleteLabel={deleteLabel}
        qualityContent={<QualityReviewPanel
          mode="quality"
          assets={assets}
          labels={labels}
          annotations={editor.annotations}
          activeAsset={asset}
          activeAnnotation={editor.selectedAnnotation}
          activeLabelId={activeLabel}
          copy={copy}
          language={language}
          onModeChange={() => undefined}
          onActiveLabelChange={setActiveLabel}
          onAssetReview={reviewAsset}
          onAnnotationReview={reviewAnnotation}
          onLabelReview={reviewLabel}
          onFocusAsset={selectAsset}
          onFocusLabel={setActiveLabel}
          showTabs={false}
        />}
        reviewContent={<QualityReviewPanel
          mode="review"
          assets={assets}
          labels={labels}
          annotations={editor.annotations}
          activeAsset={asset}
          activeAnnotation={editor.selectedAnnotation}
          activeLabelId={activeLabel}
          copy={copy}
          language={language}
          onModeChange={() => undefined}
          onActiveLabelChange={setActiveLabel}
          onAssetReview={reviewAsset}
          onAnnotationReview={reviewAnnotation}
          onLabelReview={reviewLabel}
          showTabs={false}
        />}
      />

      <section className={`editor ${touch.touchMode ? "touch-editor" : ""}`}>
        <div className="editor-controls"><PreRefactorToolbar {...chromeProps} projectName={/^Demo\b/.test(projectName) ? "Tutorial" : projectName} /></div>
        <div className={`stage ${stageTool}${mousePanning ? " panning" : ""}`}>
          <section ref={viewport.scrollRef} onScroll={viewport.onScroll} className={asset && !asset.missing ? exact.stageScroll : `${exact.stageScroll} ${exact.emptyStage}`}>
            <div style={{ position: "relative", width: viewport.layout.surfaceWidth, height: viewport.layout.surfaceHeight }}>
              <div style={{ position: "absolute", left: viewport.layout.left, top: viewport.layout.top, width: viewport.layout.width, height: viewport.layout.height }}>
                {asset?.raster?.mode === "tiled" ? <CogTiledLayer asset={asset} viewport={viewport.state} layout={viewport.layout} copy={copy} onError={setMessage} />
                  : asset?.src ? <img src={asset.src} alt={asset.name} draggable={false} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "fill", userSelect: "none", pointerEvents: "none" }} />
                  : <div className="empty-project"><span>{asset?.missing ? copy.imageMissingHint : copy.imageNotLoaded}</span>{asset?.missing && <button onClick={() => relinkInputRef.current?.click()}>{copy.reloadProjectImages}</button>}</div>}
                {asset && !asset.missing && <EditorCanvas
                  imageSize={imageSize}
                  svgRef={viewport.canvasRef}
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%", touchAction: "none", cursor: canvasCursor }}
                  annotations={visibleAnnotations}
                  labels={labels}
                  tool={tool}
                  selectedId={editor.selection.selected}
                  selectedIds={selectedIds}
                  selectedVertex={editor.selectedVertex}
                  selectionMarquee={interactions.selectionMarquee}
                  overlay={overlay}
                  lineThickness={lineThickness}
                  touchMode={touch.touchMode}
                  touchRadius={touchRadius}
                  markerRadius={markerRadius}
                  markerAspect={1}
                  boxTouchRadius={boxTouchRadius}
                  boxRotationTouchRadius={boxRotationTouchRadius}
                  onPointerDownCapture={touch.onPointerDownCapture}
                  onPointerMoveCapture={routePointerMoveCapture}
                  onPointerUpCapture={routePointerUpCapture}
                  onPointerCancelCapture={touch.onPointerCancelCapture}
                  onPointerDown={routePointerDown}
                  onPointerMove={routePointerMove}
                  onPointerUp={routePointerUp}
                  onPointerCancel={routePointerCancel}
                  onPointerLeave={() => setCursorPoint(null)}
                  onContextMenu={finishWithContextMenu}
                  onDoubleClick={finishWithDoubleClick}
                  onBeginAnnotationDrag={selecting ? interactions.beginAnnotationDrag : noopAnnotation}
                  onMoveAnnotation={selecting ? interactions.moveAnnotation : noopElement}
                  onFinishAnnotation={selecting ? interactions.finishAnnotation : noopElement}
                  onBeginVertexDrag={selecting ? interactions.beginVertexDrag : noopVertex}
                  onMoveVertex={selecting ? interactions.moveVertex : noopElement}
                  onFinishVertex={selecting ? interactions.finishVertex : noopElement}
                  onInsertVertex={selecting ? interactions.insertVertex : noopInsert}
                  onResizeStart={selecting ? interactions.resizeStart : noopResize}
                  onResizeMove={selecting ? interactions.resizeMove : noopElement}
                  onResizeEnd={selecting ? interactions.resizeEnd : noopElement}
                  onRotateStart={selecting ? interactions.rotateStart : noopAnnotation}
                  onTransformMove={selecting ? interactions.transformMove : noopElement}
                  onTransformEnd={selecting ? interactions.transformEnd : noopElement}
                />}
              </div>
            </div>
          </section>
          {/* Sem conector a ferramenta abria normal, e o usuário só descobria o
              problema depois de clicar e esperar. Avisar antes, com o caminho
              para resolver, é a diferença entre um erro e uma instrução. */}
          {tool === "sam" && samConnectorFound === false ? <div className="sam-controls sam-controls-offline">
            <span className="sam-prompt-count">{copy.errSamUnreachable}</span>
            <div className="sam-actions">
              <button className="accept" onClick={() => window.dispatchEvent(new CustomEvent("poligome:open-sam"))}><Settings2 size={14} />{copy.samOpenInstall}</button>
              <button aria-label={copy.samDeactivate} title={copy.samDeactivate} onClick={() => chooseTool("select")}><X size={15} /></button>
            </div>
          </div> : tool === "sam" && <div className="sam-controls">
            <div className="sam-mode">
              {/* Só aparece o que o modelo carregado aceita: oferecer texto num SAM 2.1
                  seria prometer o que o conector recusa na hora do pedido. */}
              <button className={activeSamMode === "points" ? "active" : ""} onClick={() => chooseSamMode("points")}><Crosshair size={13} />{copy.samModePoints}</button>
              {samCapabilities.includes("box") && <button className={activeSamMode === "box" ? "active" : ""} onClick={() => chooseSamMode("box")}><Square size={13} />{copy.samModeBox}</button>}
              {samCapabilities.includes("text") && <button className={activeSamMode === "text" ? "active" : ""} onClick={() => chooseSamMode("text")}><Sparkles size={13} />{copy.samModeText}</button>}
            </div>
            <div className="sam-mode-input">
              {activeSamMode === "points" && <>
                <button className={samNegative ? "" : "active positive"} onClick={() => setSamNegative(false)}><Plus size={13} />{copy.samInclude}</button>
                <button className={samNegative ? "active negative" : ""} onClick={() => setSamNegative(true)}><Minus size={13} />{copy.samExclude}</button>
              </>}
              {activeSamMode === "box" && <small>{copy.samBoxHint}</small>}
              {activeSamMode === "text" && <form className="sam-text-form" onSubmit={(event) => { event.preventDefault(); runSamText(); }}>
                <input
                  aria-label={copy.samTextLabel}
                  placeholder={copy.samTextPlaceholder}
                  value={samText}
                  onChange={(event) => { setSamPreviews([]); setSamText(event.target.value); }}
                />
                <button type="submit" disabled={!samText.trim() || samLoading}>{copy.samTextSubmit}</button>
                <label title={copy.samThresholdLabel}>
                  {copy.samThresholdShort} {Math.round(samThreshold * 100)}%
                  <input
                    aria-label={copy.samThresholdLabel}
                    type="range" min="0.1" max="0.95" step="0.05"
                    value={samThreshold}
                    onChange={(event) => { setSamPreviews([]); setSamThreshold(Number(event.target.value)); }}
                  />
                </label>
              </form>}
              <span className="sam-prompt-count">
                {samLoading
                  ? <><LoaderCircle className="spin" size={13} />{copy.samSegmenting}</>
                  : samPreviews.length
                    ? `${samPreviews.length} ${copy.samProposals}`
                    : activeSamMode === "points" ? `${samPrompts.length} ${copy.samPoints}` : ""}
              </span>
            </div>
            <div className="sam-actions">
              <button disabled={!samPrompts.length && !samBox && !samText && !samPreviews.length} onClick={restartSam}><ListRestart size={14} />{copy.samRestart}</button>
              <button className="accept" disabled={!samPreviews.length || samLoading} onClick={acceptSamMask}><Check size={14} />{copy.samSaveEdit}{samPreviews.length > 1 ? ` (${samPreviews.length})` : ""}</button>
              <button aria-label={copy.samConfigure} title={copy.samConfigure} onClick={() => window.dispatchEvent(new CustomEvent("poligome:open-sam"))}><Settings2 size={15} /></button>
              {/* Sem isto a barra não tinha saída: entrar na ferramenta era fácil e sair, não. */}
              <button aria-label={copy.samDeactivate} title={copy.samDeactivate} onClick={() => chooseTool("select")}><X size={15} /></button>
            </div>
          </div>}
        </div>
        <PreRefactorStatus {...chromeProps} />
      </section>
    </div>

    <DemoTutorialChrome
      step={demoTutorialStep}
      toolPrompt={demoTutorialToolPrompt}
      language={language}
      onNextToEdit={advanceDemoToEdit}
      onNextToModel={advanceDemoToModel}
      onExploreModels={exploreDemoModels}
      onClose={exitDemoTutorial}
    />
  </main>;
}
