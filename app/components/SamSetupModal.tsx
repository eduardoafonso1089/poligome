"use client";

import { useEffect, useRef, useState } from "react";
import { containModalFocus } from "../lib/modal-focus";
import {
  AlertTriangle, Check, Cpu, Download, ExternalLink, Gauge, HardDrive,
  KeyRound, Laptop, Layers, Link2, Network, Plus, PowerOff, ScanSearch, Server, ShieldCheck, Sparkles, Terminal, WandSparkles, X,
} from "lucide-react";
import { fill, type Language } from "../lib/i18n";
import { getAiCopy } from "../lib/ai-copy";
import { getSamCopy, type SamCopy } from "../lib/sam-copy";
import { localizeSamModel, translateSamText } from "../lib/sam-models-i18n";
import { SAM_MODELS, getSamModel } from "../lib/sam-models";
import { BYOM_MODEL_ID_PATTERN } from "../lib/sam-models";
import type { ByomModel, SamModelDefinition } from "../lib/sam-models";
import type { RuntimeManifest } from "../lib/runtime-client";
import {
  AutomaticGuidePanel, ConnectionsPanel, ContainerModelPanel, HowItWorksPanel, RuntimeModelPanel,
} from "./AiHubPanels";

type ConnectionState = "idle" | "checking" | "loading" | "ready" | "error" | "offline";

type ByomWriteOutcome = { ok: true } | { ok: false; detail: string };

/** As três abas da central: como a pessoa usa a IA, e não como ela roda. */
export type AiHubTab = "assisted" | "automatic" | "connections";

type Props = {
  language?: Language;
  /** A aba aberta; quem abre a central decide por onde ela começa. */
  tab: AiHubTab;
  onTabChange: (tab: AiHubTab) => void;
  /** Onde o Automático abre; "runtime" leva direto ao passo a passo de instalação. */
  initialAutomaticView?: "guide" | "runtime";
  selectedModelId: string;
  loadedModelId: string | null;
  connectionState: ConnectionState;
  /** Se o SAM carregado está sendo usado para anotar, e não apenas carregado. */
  samActive: boolean;
  runtimeLabel: string;
  /** O que o conector respondeu ao recusar a última troca de modelo, se recusou. */
  loadError: string | null;
  /** O que o conector tem instalado, por modelo, com o motivo de quem falta. */
  availability: readonly { model_id: string; installed: boolean; unavailable_reason?: string | null }[];
  /** Onde mora o conector que respondeu, para desfazer confusão de duas instalações na mesma porta. */
  connectorHost: { host: string; appDir: string } | null;
  endpoint: string;
  /** Modelos BYOM anunciados pelo conector; vazio quando não há contêiner registrado. */
  byomModels: readonly ByomModel[];
  byomBusy: boolean;
  /** O Poligome Runtime: onde atende, se respondeu e o modelo que serve. */
  runtime: { state: "checking" | "ready" | "offline"; endpoint: string; manifest: RuntimeManifest | null; setEndpoint: (value: string) => void; refresh: () => void };
  onSelectModel: (modelId: string) => void;
  /** Abre o diálogo de pré-anotação já com este modelo: "runtime" ou o id de um contêiner. */
  onPreannotate: (modelKey: string) => void;
  /** Devolve o desfecho para que o formulário possa manter o que foi digitado e mostrar o motivo. */
  onRegisterByomModel: (entry: { modelId: string; name: string; port: number; notes?: string }) => Promise<ByomWriteOutcome>;
  onRemoveByomModel: (modelId: string) => void;
  /** Deixa de usar o SAM para anotar, para voltar às ferramentas manuais. */
  onUnselectAll: () => void;
  onEndpointChange: (endpoint: string) => void;
  onRecheckConnector: () => void;
  onConnect: () => void;
  onClose: () => void;
};

/**
 * Texto traduzido com trechos de código: o que vem entre crases vira `<code>`.
 * Uma frase continua inteira em cada idioma, em vez de picada em pedaços.
 */
function Rich({ text }: { text: string }) {
  return <>{text.split(/(`[^`]+`)/).map((part, index) => part.startsWith("`") && part.endsWith("`") && part.length > 1
    ? <code key={index}>{part.slice(1, -1)}</code>
    : part)}</>;
}

const CAPABILITY_KEYS = {
  imageSegmentation: "capImage",
  videoSegmentation: "capVideo",
  pointPrompts: "capPoints",
  negativePointPrompts: "capNegativePoints",
  boxPrompts: "capBoxes",
  maskPrompts: "capMask",
  textPrompts: "capText",
  exemplarPrompts: "capExemplars",
  automaticMaskGeneration: "capAutoMasks",
  multimaskCandidates: "capMultimask",
  interactiveRefinement: "capRefine",
  instanceSegmentation: "capInstances",
  conceptSegmentation: "capConcepts",
  videoTracking: "capTracking",
  multiObjectTracking: "capMultiObject",
  bidirectionalPropagation: "capBidirectional",
} as const satisfies Record<string, keyof SamCopy>;

function statusLabel(sc: SamCopy, state: ConnectionState, modelMatches: boolean) {
  if (state === "checking") return sc.stChecking;
  if (state === "loading") return sc.stLoading;
  if (state === "error") return sc.stError;
  if (state === "ready" && modelMatches) return sc.stReady;
  if (state === "ready") return sc.stOtherLoaded;
  return sc.stOffline;
}

function benchmarkSummary(sc: SamCopy, model: SamModelDefinition) {
  if (model.benchmark.kind === "sam2-video") {
    return {
      value: fill(sc.benchFps, { fps: model.benchmark.fps ?? "—" }),
      label: `${model.benchmark.hardware} · VOS`,
      details: `SA-V ${model.benchmark.saVJAndF} · MOSE ${model.benchmark.moseJAndF} · LVOS ${model.benchmark.lvosV2JAndF} J&F. ${model.benchmark.software}`,
    };
  }
  if (model.benchmark.kind === "sam3-image-concepts") {
    return { value: `${model.benchmark.latencyMs} ms`, label: model.benchmark.hardware, details: sc.benchSam3 };
  }
  return { value: sc.benchNone, label: model.benchmark.hardware, details: model.benchmark.notes[0] };
}

function ByomPanel({
  language,
  models,
  onRegister,
}: {
  language: Language;
  models: readonly ByomModel[];
  onRegister: (entry: { modelId: string; name: string; port: number; notes?: string }) => Promise<ByomWriteOutcome>;
}) {
  const sc = getSamCopy(language);
  const [draftId, setDraftId] = useState("byom-");
  const [draftName, setDraftName] = useState("");
  const [draftPort, setDraftPort] = useState("8080");
  // Esta aba não desenha o bloco de estado do conector, então a falha do registro
  // precisa aparecer aqui: sem isto o botão limpava os campos e não dizia nada.
  const [importError, setImportError] = useState("");
  const [importing, setImporting] = useState(false);
  const portNumber = Number(draftPort);
  const canRegister =
    BYOM_MODEL_ID_PATTERN.test(draftId.trim().toLowerCase())
    && Number.isInteger(portNumber) && portNumber >= 1 && portNumber <= 65535;
  const steps = [
    { title: sc.byomStep1Title, body: sc.byomStep1Body, command: `cd ~/Downloads   ${sc.byomStep1Comment}` },
    { title: sc.byomStep2Title, body: sc.byomStep2Body, command: "docker build -t meu-modelo ." },
    { title: sc.byomStep3Title, body: sc.byomStep3Body, command: "bash poligome-byom-macos-linux.sh register --model-id byom-meu-modelo --image meu-modelo --name \"Meu modelo\" --port 8080" },
    { title: sc.byomStep4Title, body: sc.byomStep4Body, command: "bash poligome-byom-macos-linux.sh start --model-id byom-meu-modelo" },
    { title: sc.byomStep5Title, body: sc.byomStep5Body, command: "bash poligome-byom-macos-linux.sh start --model-id byom-meu-modelo" },
  ];

  return <div className="byom-panel">
    <section className="sam-model-hero">
      <div><span className="family byom">BYOM</span><span className="experimental">{sc.byomBadge}</span></div>
      <h3>{sc.byomTitle}</h3>
      <p>{sc.byomIntro}</p>
      <p><Rich text={sc.byomSagemaker} /></p>
    </section>

    <section className="byom-steps">
      <h4>{sc.byomBefore}</h4>
      <article><b>{sc.byomDockerTitle}</b><p>{sc.byomDockerBody}</p></article>
      <article><b>{sc.byomConnectorTitle}</b><p><Rich text={sc.byomConnectorBody} /></p></article>
      <article>
        <b>{sc.byomWindowsTitle}</b>
        <p><Rich text={sc.byomWindowsBody} /></p>
        <code>{"wsl bash poligome-byom-macos-linux.sh list\npowershell -ExecutionPolicy Bypass -File .\\poligome-byom-windows.ps1 list"}</code>
      </article>
    </section>

    <section className="byom-contract">
      <h4>{sc.byomContract}</h4>
      <table>
        <tbody>
          <tr><th>{sc.byomPort}</th><td><Rich text={sc.byomPortValue} /></td></tr>
          <tr><th>{sc.byomCommand}</th><td><code>docker run &lt;image&gt; serve</code></td></tr>
          <tr><th>{sc.byomHealth}</th><td><Rich text={sc.byomHealthValue} /></td></tr>
          <tr><th>{sc.byomInference}</th><td><Rich text={sc.byomInferenceValue} /></td></tr>
          <tr><th>{sc.byomWeights}</th><td><Rich text={sc.byomWeightsValue} /></td></tr>
          <tr><th>{sc.byomDescription}</th><td><Rich text={sc.byomDescriptionValue} /></td></tr>
        </tbody>
      </table>
      <p className="byom-io">
        <b>{sc.byomInput}</b> <Rich text={sc.byomInputValue} />
        <br />
        <b>{sc.byomOutput}</b> <Rich text={sc.byomOutputValue} />
        <br />
        <b>{sc.byomErrors}</b> <Rich text={sc.byomErrorsValue} />
      </p>
      <p className="byom-import-hint"><Rich text={sc.byomMetadataHint} /></p>
    </section>

    {/* Os arquivos vêm antes do passo a passo porque o primeiro passo é baixá-los. */}
    <section className="sam-install-panel">
      <div><b>{sc.byomFiles}</b><p>{sc.byomFilesBody}</p></div>
      <div className="sam-install-actions">
        <a className="primary" href="/poligome-byom-macos-linux.sh" download><Download size={15} /><span><strong>{sc.byomCliUnix}</strong><small>register · start · status · logs</small></span></a>
        {/* Sem este botão, quem instalou o SAM pelo caminho nativo de Windows não
            tinha como obter a CLI que escreve no registro que o conector dele lê. */}
        <a href="/poligome-byom-windows.ps1" download><Download size={15} /><span><strong>{sc.byomCliNative}</strong><small>{sc.byomCliNativeHint}</small></span></a>
        <a href="/byom/Dockerfile" download><Download size={15} /><span><strong>{sc.byomDockerfile}</strong><small>{sc.byomDockerfileHint}</small></span></a>
        <a href="/byom/serve.py" download><Download size={15} /><span><strong>{sc.byomServe}</strong><small>{sc.byomServeHint}</small></span></a>
      </div>
      <code>{"bash poligome-byom-macos-linux.sh --help\npowershell -ExecutionPolicy Bypass -File .\\poligome-byom-windows.ps1 help"}</code>
    </section>

    <section className="byom-steps">
      <h4>{sc.byomExamples}</h4>
      <article>
        <b>{sc.byomRepoTitle}</b>
        <p>{sc.byomRepoBody}</p>
        <code>bash public/poligome-byom-macos-linux.sh examples</code>
      </article>
      <article>
        <b>{sc.byomFilesOnlyTitle}</b>
        <p>{sc.byomFilesOnlyBody}</p>
        <code>{"docker build -t poligome-byom-exemplo .\nbash poligome-byom-macos-linux.sh register --model-id byom-otsu --image poligome-byom-exemplo --name \"Exemplo Otsu\" --port 8080 --env METHOD=otsu\nbash poligome-byom-macos-linux.sh register --model-id byom-watershed --image poligome-byom-exemplo --name \"Exemplo Watershed\" --port 8081 --env METHOD=watershed\nbash poligome-byom-macos-linux.sh start --model-id byom-otsu\nbash poligome-byom-macos-linux.sh start --model-id byom-watershed"}</code>
      </article>
      <article>
        <b>{sc.byomCheckTitle}</b>
        <p>{sc.byomCheckBody}</p>
        <code>{"bash poligome-byom-macos-linux.sh list\nbash poligome-byom-macos-linux.sh logs --model-id byom-otsu"}</code>
      </article>
    </section>

    <section className="byom-steps">
      <h4>{sc.byomSteps}</h4>
      {/* Os comandos abaixo são os de bash. Quem instalou pelo caminho nativo de
          Windows precisa saber que os mesmos passos existem lá, com o mesmo nome,
          antes de tentar rodar bash no PowerShell e achar que o BYOM não serve. */}
      <p className="byom-import-hint"><Rich text={sc.byomStepsShell} /></p>
      {steps.map((step) => <article key={step.title}>
        <b>{step.title}</b>
        {step.body && <p>{step.body}</p>}
        <code>{step.command}</code>
      </article>)}
    </section>

    <section className="byom-registered">
      <h4>{sc.byomImportTitle}</h4>
      <p className="byom-import-hint"><Rich text={sc.byomImportHint} /></p>
      <div className="byom-import">
        <label>{sc.byomFieldId}<input value={draftId} onChange={(event) => setDraftId(event.target.value)} placeholder="byom-meu-modelo" spellCheck={false} /></label>
        <label>{sc.byomFieldName}<input value={draftName} onChange={(event) => setDraftName(event.target.value)} placeholder={sc.byomNamePlaceholder} /></label>
        <label>{sc.byomFieldPort}<input type="number" min={1} max={65535} value={draftPort} onChange={(event) => setDraftPort(event.target.value)} /></label>
        <button
          className="byom-add"
          disabled={!canRegister || importing}
          onClick={async () => {
            setImportError("");
            setImporting(true);
            const outcome = await onRegister({ modelId: draftId.trim().toLowerCase(), name: draftName.trim(), port: portNumber });
            setImporting(false);
            // Limpar só no sucesso: quem errou a porta corrige o que digitou em
            // vez de reescrever tudo.
            if (outcome.ok) { setDraftId("byom-"); setDraftName(""); }
            else setImportError(outcome.detail);
          }}
        >
          {importing ? <Gauge className="spin" size={14} /> : <Plus size={14} />}{importing ? sc.byomImporting : sc.byomImport}
        </button>
      </div>
      {!canRegister && draftId.trim() !== "byom-" && <p className="byom-reason"><Rich text={sc.byomIdRule} /></p>}
      {importError && <p className="byom-reason">{fill(sc.byomImportFailed, { detail: importError })}</p>}

      <p className="byom-import-hint">{models.length === 0
        ? <Rich text={sc.byomNoneRegistered} />
        : models.length === 1 ? sc.byomOneRegistered : fill(sc.byomManyRegistered, { n: models.length })}</p>
    </section>

    <section className="byom-limits">
      <AlertTriangle size={15} />
      <div><b>{sc.byomEmptyTitle}</b><p><Rich text={sc.byomEmptyBody} /></p></div>
    </section>

    <section className="sam-privacy"><ShieldCheck size={16} /><div><b>{sc.privacyTitle}</b><p><Rich text={sc.byomPrivacy} /></p></div></section>
  </div>;
}

export default function SamSetupModal({
  language = "pt",
  tab,
  onTabChange,
  initialAutomaticView = "guide",
  selectedModelId,
  loadedModelId,
  connectionState,
  samActive,
  runtimeLabel,
  loadError,
  availability,
  connectorHost,
  endpoint,
  byomModels,
  byomBusy,
  runtime,
  onSelectModel,
  onPreannotate,
  onRegisterByomModel,
  onRemoveByomModel,
  onUnselectAll,
  onEndpointChange,
  onRecheckConnector,
  onConnect,
  onClose,
}: Props) {
  const ai = getAiCopy(language);
  const sc = getSamCopy(language);
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => dialogRef.current ? containModalFocus(dialogRef.current) : undefined, []);
  // O que a área de detalhe mostra em cada aba. No Assistido, "model" é a ficha
  // do SAM escolhido à esquerda; no Automático, o guia vem primeiro porque a
  // primeira pergunta ali é qual dos dois tipos serve.
  const [assistedView, setAssistedView] = useState<"how" | "model">("model");
  const [automaticView, setAutomaticView] = useState<"guide" | "runtime" | "container" | "docs">(initialAutomaticView);
  const [viewedContainerId, setViewedContainerId] = useState<string | null>(null);
  // Forçar CPU era só uma variável de ambiente citada no meio de um parágrafo. A
  // página não roda o instalador, mas pode escrever o comando certo por sistema —
  // que é a única parte difícil para quem não mexe com terminal.
  const [forceCpu, setForceCpu] = useState(false);
  // Um sistema por vez. Três caminhos lado a lado obrigavam o usuário a descobrir
  // qual era o dele antes de ler qualquer instrução.
  const [installOs, setInstallOs] = useState<"unix" | "wsl" | "native">("unix");

  /**
   * Esc fecha o catálogo, como em qualquer diálogo.
   *
   * Na captura e parando a propagação porque o editor também escuta Esc na
   * janela: sem isso a tecla fechava o desenho em andamento por baixo do modal —
   * e, antes desta tela ter a sua, só fazia isso, sem fechar nada.
   */
  useEffect(() => {
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKeydown, true);
    return () => window.removeEventListener("keydown", onKeydown, true);
  }, [onClose]);

  const viewedContainer = byomModels.find((candidate) => candidate.model_id === viewedContainerId) ?? null;
  const samInUse = samActive && connectionState === "ready";
  // Só a ficha de um SAM tem o que confirmar no rodapé; o resto é texto, e as
  // fichas do Automático trazem o próprio botão.
  const showFooterAction = tab === "assisted" && assistedView === "model";
  const model = localizeSamModel(getSamModel(selectedModelId) ?? SAM_MODELS[0], language);
  const installedIds = new Set(availability.filter((entry) => entry.installed).map((entry) => entry.model_id));
  // Só vale dizer "ainda não instalado" quando o conector respondeu: sem ele a
  // lista chega vazia e todo modelo pareceria faltando.
  const selectedAvailability = availability.find((entry) => entry.model_id === model.id) ?? null;
  const needsInstall = selectedAvailability !== null && !selectedAvailability.installed;
  const benchmark = benchmarkSummary(sc, model);
  const modelMatches = connectionState === "ready" && loadedModelId === model.id;
  const pythonNotes = "notes" in model.requirements.python ? model.requirements.python.notes : null;
  const cudaTested = "tested" in model.requirements.cuda ? model.requirements.cuda.tested : null;
  // O que o editor realmente envia e desenha hoje. Fora desta lista, a capacidade
  // é do modelo upstream e não tem como ser alcançada por esta interface.
  const integratedCapabilities = new Set([
    "imageSegmentation", "pointPrompts", "negativePointPrompts", "boxPrompts",
    "interactiveRefinement", "textPrompts", "conceptSegmentation",
  ]);
  // Instâncias só contam onde há texto: é a busca por texto que devolve um objeto
  // por instância. Com ponto ou caixa sai sempre uma máscara só.
  if (model.capabilities.textPrompts) integratedCapabilities.add("instanceSegmentation");
  const upstreamCapabilities = Object.entries(model.capabilities).filter(([, enabled]) => enabled).map(([key]) => key);
  const labelOf = (key: string) => sc[CAPABILITY_KEYS[key as keyof typeof CAPABILITY_KEYS]] ?? key;
  const availableCapabilities = upstreamCapabilities.filter((key) => integratedCapabilities.has(key)).map(labelOf);
  const pendingCapabilities = upstreamCapabilities.filter((key) => !integratedCapabilities.has(key)).map(labelOf);
  // Cada sistema escreve a variável de ambiente à sua maneira, e errar a sintaxe é
  // o tipo de detalhe que faz o usuário desistir achando que o produto não serve.
  // Nenhum dos scripts guarda a escolha: cada um lê POLIGOME_DEVICE do ambiente
  // e, sem ela, volta para `auto`. Então o prefixo precisa acompanhar também os
  // comandos de religar e de serviço, senão marcar a caixa vale só na instalação.
  const unixCpuPrefix = forceCpu ? "POLIGOME_DEVICE=cpu " : "";
  const unixCommand = `${unixCpuPrefix}bash poligome-sam-macos-linux.sh ${model.id}`;
  const windowsCommand = `${forceCpu ? "set POLIGOME_DEVICE=cpu && " : ""}poligome-sam-windows.bat ${model.id}`;
  // A forma completa, com powershell -File: digitar só o nome do .ps1 é recusado
  // pela política de execução, e dois cliques abrem o Bloco de Notas. Mostrar o
  // atalho seria entregar um comando que não roda.
  const nativeWindowsCommand =
    `${forceCpu ? "$env:POLIGOME_DEVICE='cpu'; " : ""}powershell -ExecutionPolicy Bypass -File .\\poligome-sam-windows-native.ps1 ${model.id}`;

  /**
   * O passo a passo por sistema.
   *
   * Antes daqui a tela entregava três botões e um comando solto, e nunca dizia o
   * que fazer com o arquivo baixado: em que pasta ele caiu, como abrir um
   * terminal ali, nem que a janela precisa ficar aberta. Quem não mexe com
   * terminal parava no primeiro passo — e o BYOM, que é o caminho mais técnico,
   * era o único que tinha um passo a passo numerado.
   */
  const installPaths = {
    unix: {
      label: sc.osUnix,
      file: "poligome-sam-macos-linux.sh",
      href: "/poligome-sam-macos-linux.sh",
      steps: [
        { title: sc.stepDownloadTitle, body: sc.stepDownloadUnix, command: null },
        { title: sc.stepUnixTerminalTitle, body: sc.stepUnixTerminalBody, command: "cd ~/Downloads" },
        { title: sc.stepUnixRunTitle, body: sc.stepUnixRunBody, command: unixCommand },
        { title: sc.stepUnixKeepTitle, body: sc.stepUnixKeepBody, command: null },
        { title: sc.stepBackTitle, body: sc.stepBackBody, command: null },
      ],
    },
    wsl: {
      label: sc.osWsl,
      file: "poligome-sam-windows.bat",
      href: "/poligome-sam-windows.bat",
      steps: [
        { title: sc.stepDownloadTitle, body: sc.stepDownloadWin, command: null },
        { title: sc.stepWslClickTitle, body: sc.stepWslClickBody, command: null },
        { title: sc.stepWslTypeTitle, body: sc.stepWslTypeBody, command: String.raw`cd %USERPROFILE%\Downloads` + "\n" + windowsCommand },
        { title: sc.stepWslKeepTitle, body: sc.stepWslKeepBody, command: null },
        { title: sc.stepBackTitle, body: sc.stepBackBody, command: null },
      ],
    },
    native: {
      label: sc.osNative,
      file: "poligome-sam-windows-native.ps1",
      href: "/poligome-sam-windows-native.ps1",
      steps: [
        { title: sc.stepDownloadTitle, body: sc.stepDownloadWin, command: null },
        { title: sc.stepNativeOpenTitle, body: sc.stepNativeOpenBody, command: null },
        { title: sc.stepNativeFolderTitle, body: sc.stepNativeFolderBody, command: String.raw`cd $env:USERPROFILE\Downloads` },
        { title: sc.stepNativeRunTitle, body: sc.stepNativeRunBody, command: nativeWindowsCommand },
        { title: sc.stepNativeKeepTitle, body: sc.stepNativeKeepBody, command: null },
        { title: sc.stepBackTitle, body: sc.stepBackBody, command: null },
      ],
    },
  } as const;
  const chosenPath = installPaths[installOs];

  return <div
    className="modal-backdrop sam-catalog-backdrop"
    // Só o clique no fundo fecha; um arrasto que termina fora do painel, ou um
    // clique dentro dele, não pode derrubar a tela no meio de um formulário.
    onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
  >
    <section ref={dialogRef} tabIndex={-1} className="sam-catalog-modal" role="dialog" aria-modal="true" aria-labelledby="sam-catalog-title">
      <header>
        <div><span><Sparkles size={21} /></span><div><h2 id="sam-catalog-title">{ai.hubTitle}</h2><p>{ai.hubSubtitle}</p></div></div>
        <button onClick={onClose} aria-label={ai.close}><X size={21} /></button>
      </header>

      {/* As abas dizem como a pessoa usa a IA, e não como ela roda: o runtime e
          o conector moram em Conexões, que só abre quem quer saber. */}
      <nav className="ai-hub-tabs" role="tablist" aria-label={ai.hubTitle}>
        {([
          ["assisted", WandSparkles, ai.tabAssisted, ai.tabAssistedHint],
          ["automatic", ScanSearch, ai.tabAutomatic, ai.tabAutomaticHint],
          ["connections", Network, ai.tabConnections, ai.tabConnectionsHint],
        ] as const).map(([key, Icon, label, hint]) => <button
          key={key}
          role="tab"
          aria-selected={tab === key}
          className={tab === key ? "active" : ""}
          onClick={() => onTabChange(key)}
        ><Icon size={16} /><span><b>{label}</b><small>{hint}</small></span></button>)}
      </nav>

      <div className={`sam-catalog-body${tab === "connections" ? " single" : ""}`}>
        {tab === "assisted" && <aside className="sam-model-list" aria-label={ai.modelsList}>
          <section>
            <h3>{ai.listStartHere}</h3>
            <button
              className={assistedView === "how" ? "active" : ""}
              aria-pressed={assistedView === "how"}
              onClick={() => setAssistedView("how")}
            >
              <span><b>{ai.howTitle}</b><small>{ai.howHint}</small></span>
              <em><Network size={13} /></em>
            </button>
          </section>

          {(["sam2", "medsam2", "sam3"] as const).map((family) => <section key={family}>
            <h3>{family === "sam2" ? ai.familySam2 : family === "medsam2" ? ai.familyMedsam2 : ai.familySam3}</h3>
            {SAM_MODELS.filter((candidate) => candidate.family === family).map((candidate) => <button
              key={candidate.id}
              className={candidate.id === model.id && assistedView === "model" ? "active" : ""}
              aria-pressed={candidate.id === model.id && assistedView === "model"}
              onClick={() => { setAssistedView("model"); onSelectModel(candidate.id); }}
            >
              <span><b>{translateSamText(candidate.name, language)}</b><small>{candidate.parameters.label} · {candidate.checkpoint.approximateSizeLabel}</small></span>
              {/* "Em uso" é o que está carregado agora, e não o que você está olhando.
                  "Instalado" vem do conector e evita escolher um modelo que ainda
                  precisa ser baixado sem saber disso antes de clicar. */}
              {candidate.id === loadedModelId && samInUse
                ? <em className="in-use">{ai.inUse}</em>
                : installedIds.has(candidate.id)
                  ? <em className="installed"><Check size={11} />{ai.installed}</em>
                  : <em>{candidate.recommended ? ai.recommended : candidate.experimental ? ai.experimental : candidate.version}</em>}
            </button>)}
          </section>)}
        </aside>}

        {tab === "automatic" && <aside className="sam-model-list" aria-label={ai.modelsList}>
          <section>
            <h3>{ai.listStartHere}</h3>
            <button className={automaticView === "guide" ? "active" : ""} aria-pressed={automaticView === "guide"} onClick={() => setAutomaticView("guide")}>
              <span><b>{ai.autoGuideTitle}</b><small>{ai.autoGuideHint}</small></span>
              <em><Sparkles size={13} /></em>
            </button>
          </section>

          <section>
            <h3>{ai.autoNativeSection}</h3>
            <button className={automaticView === "runtime" ? "active" : ""} aria-pressed={automaticView === "runtime"} onClick={() => setAutomaticView("runtime")}>
              {runtime.state === "ready" && runtime.manifest
                ? <><span><b>{runtime.manifest.name}</b><small>{runtime.manifest.id} · {runtime.manifest.version}</small></span><em className="byom-up">{ai.stateUp}</em></>
                : <><span><b>{ai.autoNativeOffline}</b><small>{ai.autoNativeOfflineHint}</small></span><em><Layers size={13} /></em></>}
            </button>
          </section>

          <section>
            <h3>{ai.autoMineSection}</h3>
            {byomModels.map((candidate) => <button
              key={candidate.model_id}
              className={automaticView === "container" && candidate.model_id === viewedContainerId ? "active" : ""}
              aria-pressed={automaticView === "container" && candidate.model_id === viewedContainerId}
              onClick={() => { setAutomaticView("container"); setViewedContainerId(candidate.model_id); }}
            >
              <span><b>{candidate.name}</b><small>{candidate.model_id}</small></span>
              <em className={candidate.ready ? "byom-up" : "byom-down"}>{candidate.ready ? ai.stateUp : ai.stateDown}</em>
            </button>)}
            <button className={automaticView === "docs" ? "active" : ""} aria-pressed={automaticView === "docs"} onClick={() => setAutomaticView("docs")}>
              <span><b>{ai.autoAddModel}</b><small>{ai.autoAddModelHint}</small></span>
              <em><Plus size={13} /></em>
            </button>
          </section>
        </aside>}

        <div className="sam-model-detail">
          {tab === "connections" ? <ConnectionsPanel
            copy={ai}
            connector={{
              state: connectionState === "ready" || connectionState === "loading" || connectionState === "error" ? "ready" : connectionState === "offline" ? "offline" : "checking",
              endpoint,
              host: connectorHost?.host ?? null,
              serving: runtimeLabel || loadedModelId || "—",
              onEndpoint: onEndpointChange,
              onRetry: onRecheckConnector,
            }}
            runtime={{
              state: runtime.state,
              endpoint: runtime.endpoint,
              serving: runtime.manifest ? `${runtime.manifest.name} ${runtime.manifest.version}` : "",
              onEndpoint: runtime.setEndpoint,
              onRetry: runtime.refresh,
            }}
            containers={byomModels}
            onShowInstall={() => { onTabChange("assisted"); setAssistedView("model"); }}
            onShowAddModel={() => { onTabChange("automatic"); setAutomaticView("docs"); }}
            onShowRuntimeInstall={() => { onTabChange("automatic"); setAutomaticView("runtime"); }}
          />
          : tab === "automatic" ? (
            automaticView === "runtime" ? <RuntimeModelPanel
              copy={ai}
              manifest={runtime.state === "ready" ? runtime.manifest : null}
              endpoint={runtime.endpoint}
              onPreannotate={() => onPreannotate("runtime")}
              onOpenConnections={() => onTabChange("connections")}
            />
            : automaticView === "container" && viewedContainer ? <ContainerModelPanel
              copy={ai}
              model={viewedContainer}
              busy={byomBusy}
              onPreannotate={onPreannotate}
              onRemove={(modelId) => { setAutomaticView("guide"); onRemoveByomModel(modelId); }}
              onSave={onRegisterByomModel}
            />
            : automaticView === "docs" ? <ByomPanel language={language} models={byomModels} onRegister={onRegisterByomModel} />
            : <AutomaticGuidePanel copy={ai} />
          )
          : assistedView === "how" ? <HowItWorksPanel language={language} />
          : <>
          <section className="sam-model-hero">
            <div><span className={`family ${model.family}`}>{model.family === "sam2" ? "SAM 2.1" : model.family === "medsam2" ? "MedSAM2" : model.family.toUpperCase()}</span>{model.experimental && <span className="experimental">{sc.experimental}</span>}</div>
            <h3>{model.name}</h3>
            <p>{model.description}</p>
            <div className="sam-model-facts">
              <span><HardDrive size={14} /><b>{model.checkpoint.approximateSizeLabel}</b><small>{sc.factCheckpoint}</small></span>
              <span><Cpu size={14} /><b>{model.parameters.label}</b><small>{sc.factParams}</small></span>
              <span><ShieldCheck size={14} /><b>{model.license.name}</b><small>{sc.factLicense}</small></span>
            </div>
          </section>

          {model.experimental && <section className="sam-license-warning"><AlertTriangle size={17} /><div><b>{sc.licenseWarning}</b><p>{model.license.notes}</p></div></section>}

          {/* Quem ainda não usa este modelo vem aqui para instalá-lo: o passo a
              passo vem primeiro, e a ficha técnica fica recolhida abaixo. */}
          {!modelMatches && <>
            <section className="sam-install-panel">
              <div><b>{sc.installTitle}</b><p>{sc.installBody}</p></div>
              {needsInstall && <p className="sam-needs-install"><AlertTriangle size={14} /><span><b>{fill(sc.needsInstall, { name: model.name })}</b> {sc.needsInstallBody}</span></p>}
              <div className="sam-os-picker" role="tablist" aria-label={sc.osPicker}>
                {(["unix", "wsl", "native"] as const).map((key) => <button
                  key={key}
                  role="tab"
                  aria-selected={installOs === key}
                  className={installOs === key ? "active" : ""}
                  onClick={() => setInstallOs(key)}
                >{installPaths[key].label}</button>)}
              </div>
              {installOs === "unix" && model.family === "sam3" && <p className="sam-manual-note">{sc.sam3NoMac}</p>}
              {installOs === "native" && model.family === "sam3" && <p className="sam-manual-note">{sc.sam3Native}</p>}

              <ol className="sam-steps">
                {chosenPath.steps.map((step, index) => <li key={step.title}>
                  <b>{step.title}</b>
                  {step.body && <p>{step.body}</p>}
                  {index === 0
                    ? <a className="sam-step-download" href={chosenPath.href} download><Download size={14} />{fill(sc.download, { file: chosenPath.file })}</a>
                    : step.command ? <code>{step.command}</code> : null}
                </li>)}
              </ol>
              {/* Escolher CPU deixou de ser folclore de variável de ambiente: o
                  controle fica aqui e reescreve os três comandos acima com a
                  sintaxe certa de cada sistema. */}
              {model.family !== "sam3" && <label className="sam-device-choice">
                <input type="checkbox" checked={forceCpu} onChange={(event) => setForceCpu(event.target.checked)} />
                <span><b>{sc.cpuTitle}</b><small>{sc.cpuBody}</small></span>
              </label>}
              {/* Depois de instalado, o caminho de volta é outro e mais curto. Ele
                  muda por sistema como o de instalação, então acompanha a aba. */}
              <div className="sam-relaunch">
                <b>{sc.relaunchTitle}</b>
                {installOs === "unix" && <>
                  <p>{sc.relaunchUnix}</p>
                  <a className="sam-step-download" href="/poligome-sam-start-macos-linux.sh" download><Download size={14} />{fill(sc.download, { file: "poligome-sam-start-macos-linux.sh" })}</a>
                  <code>{`cd ~/Downloads
  ${unixCpuPrefix}bash poligome-sam-start-macos-linux.sh`}</code>
                  <p>{sc.relaunchService}</p>
                  <a className="sam-step-download" href="/poligome-sam-service-linux.sh" download><Download size={14} />{fill(sc.download, { file: "poligome-sam-service-linux.sh" })}</a>
                  <code>{`${unixCpuPrefix}bash poligome-sam-service-linux.sh install`}</code>
                </>}
                {installOs === "wsl" && <>
                  <p>{sc.relaunchWsl}</p>
                  <a className="sam-step-download" href="/poligome-sam-start-windows.bat" download><Download size={14} />{fill(sc.download, { file: "poligome-sam-start-windows.bat" })}</a>
                  {/* Dois cliques não carregam variável de ambiente, e sem ela o
                      iniciador volta para `auto`. Quem escolheu CPU precisa do
                      comando, não do atalho. */}
                  {forceCpu && <>
                    <p>{sc.relaunchWslCpu}</p>
                    <code>{String.raw`cd %USERPROFILE%\Downloads` + "\n" + "set POLIGOME_DEVICE=cpu && poligome-sam-start-windows.bat"}</code>
                  </>}
                </>}
                {installOs === "native" && <>
                  <p>{sc.relaunchNative}</p>
                  <code>{nativeWindowsCommand}</code>
                </>}
              </div>
              <p className="sam-manual-note">{model.family === "sam3" ? sc.sam3GpuOnly : sc.oldGpuNote}</p>
              <details className="sam-uninstall sam-platform-details">
                <summary>{sc.platformDetails}</summary>
                <p><b>Linux:</b> {model.platformSupport.linux.notes}</p>
                <p><b>Windows:</b> {model.platformSupport.windows.notes}</p>
                <p><b>macOS:</b> {model.platformSupport.macos.notes}</p>
              </details>

              {/* Onde isso fica e como sair: um instalador que não diz como se
                  desfazer obriga o usuário a caçar gigabytes pelo disco. Tudo mora
                  numa pasta só por sistema, então apagar a pasta desinstala. */}
              <details className="sam-uninstall">
                <summary>{sc.uninstallTitle}</summary>
                <p><Rich text={sc.uninstallBody} /></p>
                <table>
                  <tbody>
                    <tr>
                      <th>{sc.uninstallUnix}</th>
                      <td><code>~/.poligome-sam</code><br /><code>rm -rf ~/.poligome-sam</code></td>
                    </tr>
                    <tr>
                      <th>{sc.uninstallNative}</th>
                      <td><code>{String.raw`%USERPROFILE%\.poligome-sam`}</code><br /><code>{String.raw`rmdir /s /q "%USERPROFILE%\.poligome-sam"`}</code></td>
                    </tr>
                    <tr>
                      <th>{sc.uninstallWsl}</th>
                      <td><Rich text={sc.uninstallWslBody} /></td>
                    </tr>
                  </tbody>
                </table>
                <p><Rich text={sc.uninstallService} /></p>
              </details>
            </section>

          </>}

          <section className={`sam-runtime-status ${loadError ? "error" : connectionState} ${!loadError && connectionState === "ready" && !modelMatches ? "mismatch" : ""}`}>
            <span />
            <div>
              <b>{loadError ? sc.stSwitchRefused : statusLabel(sc, connectionState, modelMatches)}</b>
              {loadError && <small>{loadError}</small>}
              {runtimeLabel && <small>{loadError ? fill(sc.stStillUp, { label: runtimeLabel }) : runtimeLabel}</small>}
              {/* A dica sobre CUDA só serve quando o modelo existe e quebrou ao
                  carregar. Para um modelo que nem foi baixado ela mandava o
                  usuário investigar a placa de vídeo sem motivo. */}
              {!loadError && connectionState === "error" && <small>{sc.stErrorHint}</small>}
              {!loadError && connectionState === "ready" && !modelMatches && <small><Rich text={fill(sc.stMismatchHint, { id: model.id })} /></small>}
              {/* Duas instalações disputam a mesma porta 7860 e só uma atende.
                  Sem esta linha, quem instalou nos dois caminhos via a lista do
                  outro e concluía que o registro tinha sumido. */}
              {connectorHost && <small className="sam-connector-origin">
                {sc.stHost} <b>{connectorHost.host}</b>{connectorHost.appDir ? <> · <code>{connectorHost.appDir}</code></> : null}
              </small>}
            </div>
          </section>


          {/* Dois grupos, e não uma lista só com visto verde em tudo. A lista
              única mostrava "Vídeo ✓ Tracking ✓" e só depois, em prosa, dizia que
              nada daquilo funciona aqui — quem lê de relance sai achando que o
              editor faz vídeo. */}
          <section className="sam-capabilities">
            <h4>{sc.capsHere}</h4>
            <div>{availableCapabilities.map((capability) => <span key={capability}><Check size={11} />{capability}</span>)}</div>
            {pendingCapabilities.length > 0 && <>
              <h4 className="pending">{sc.capsPending}</h4>
              <div className="pending">{pendingCapabilities.map((capability) => <span key={capability}>{capability}</span>)}</div>
            </>}
            {model.capabilities.videoSegmentation && <p>{sc.capsVideoNote}</p>}
          </section>

          <details className="sam-advanced sam-tech-details">
            <summary>{sc.samTechDetails}</summary>
            {model.citation && <section className="sam-citation">
              <h4>{sc.citation}</h4>
              <p>{model.citation.authors} <b>{model.citation.title}</b>. {model.citation.venue}, {model.citation.year}.</p>
              <a href={model.citation.url} target="_blank" rel="noreferrer"><ExternalLink size={12} />{sc.readPaper}</a>
            </section>}

            {model.futureCapabilities.map((future) => <section className="sam-future-note" key={future.name}>
              <Sparkles size={16} />
              <div><b>{fill(sc.futureTitle, { name: future.name })}</b><p>{future.description}</p><small>{fill(sc.futureNote, { speedup: future.benchmark.speedupAt128Objects, hardware: future.benchmark.hardware })}</small></div>
            </section>)}

            <section className="sam-requirements-grid">
              <article><span><Terminal size={15} /></span><div><b>{sc.reqStack}</b><p>Python {model.requirements.python.minimum}+ · PyTorch {model.requirements.pytorch.minimum}+{model.requirements.pytorch.torchvisionMinimum ? ` · Torchvision ${model.requirements.pytorch.torchvisionMinimum}+` : ""}.{pythonNotes ? ` ${pythonNotes}` : ""}</p></div></article>
              <article><span><Cpu size={15} /></span><div><b>{sc.reqCompute}</b><p>{model.requirements.compute.notes}</p></div></article>
              <article className={model.requirements.cuda.required ? "critical" : ""}><span><Server size={15} /></span><div><b>{sc.reqCuda}</b><p>{model.requirements.cuda.required ? fill(sc.cudaRequired, { version: model.requirements.cuda.minimum ?? "" }) : sc.cudaOptional}{cudaTested ? fill(sc.cudaTested, { version: cudaTested }) : ""}</p></div></article>
              <article><span><Laptop size={15} /></span><div><b>{sc.reqSystem}</b><p>{model.requirements.operatingSystem.official}. {model.requirements.operatingSystem.notes}</p></div></article>
              <article><span><HardDrive size={15} /></span><div><b>{sc.reqMemory}</b><p>{model.requirements.vram.notes} {model.requirements.ram.notes}</p></div></article>
              <article className={model.requirements.access.type === "gated" ? "critical" : ""}><span><KeyRound size={15} /></span><div><b>{sc.reqAccess}</b><p>{model.requirements.access.notes}</p></div></article>
            </section>

            <section className="sam-benchmark">
              <div><Gauge size={18} /><span><b>{benchmark.value}</b><small>{benchmark.label}</small></span></div>
              <p>{benchmark.details}</p>
              <em>{sc.benchDisclaimer} {model.benchmark.notes[0]}</em>
            </section>

            <div className="sam-official-links"><a href={model.officialSources.repository} target="_blank" rel="noreferrer"><ExternalLink size={12} />{sc.officialRepo}</a><a href={model.officialSources.checkpoint} target="_blank" rel="noreferrer"><ExternalLink size={12} />{sc.officialCheckpoint}</a></div>
          </details>

          {modelMatches && <details className="sam-advanced">
            <summary>{sc.installTitle}</summary>
            <section className="sam-install-panel">
              <div><b>{sc.installTitle}</b><p>{sc.installBody}</p></div>
              {needsInstall && <p className="sam-needs-install"><AlertTriangle size={14} /><span><b>{fill(sc.needsInstall, { name: model.name })}</b> {sc.needsInstallBody}</span></p>}
              <div className="sam-os-picker" role="tablist" aria-label={sc.osPicker}>
                {(["unix", "wsl", "native"] as const).map((key) => <button
                  key={key}
                  role="tab"
                  aria-selected={installOs === key}
                  className={installOs === key ? "active" : ""}
                  onClick={() => setInstallOs(key)}
                >{installPaths[key].label}</button>)}
              </div>
              {installOs === "unix" && model.family === "sam3" && <p className="sam-manual-note">{sc.sam3NoMac}</p>}
              {installOs === "native" && model.family === "sam3" && <p className="sam-manual-note">{sc.sam3Native}</p>}

              <ol className="sam-steps">
                {chosenPath.steps.map((step, index) => <li key={step.title}>
                  <b>{step.title}</b>
                  {step.body && <p>{step.body}</p>}
                  {index === 0
                    ? <a className="sam-step-download" href={chosenPath.href} download><Download size={14} />{fill(sc.download, { file: chosenPath.file })}</a>
                    : step.command ? <code>{step.command}</code> : null}
                </li>)}
              </ol>
              {/* Escolher CPU deixou de ser folclore de variável de ambiente: o
                  controle fica aqui e reescreve os três comandos acima com a
                  sintaxe certa de cada sistema. */}
              {model.family !== "sam3" && <label className="sam-device-choice">
                <input type="checkbox" checked={forceCpu} onChange={(event) => setForceCpu(event.target.checked)} />
                <span><b>{sc.cpuTitle}</b><small>{sc.cpuBody}</small></span>
              </label>}
              {/* Depois de instalado, o caminho de volta é outro e mais curto. Ele
                  muda por sistema como o de instalação, então acompanha a aba. */}
              <div className="sam-relaunch">
                <b>{sc.relaunchTitle}</b>
                {installOs === "unix" && <>
                  <p>{sc.relaunchUnix}</p>
                  <a className="sam-step-download" href="/poligome-sam-start-macos-linux.sh" download><Download size={14} />{fill(sc.download, { file: "poligome-sam-start-macos-linux.sh" })}</a>
                  <code>{`cd ~/Downloads
  ${unixCpuPrefix}bash poligome-sam-start-macos-linux.sh`}</code>
                  <p>{sc.relaunchService}</p>
                  <a className="sam-step-download" href="/poligome-sam-service-linux.sh" download><Download size={14} />{fill(sc.download, { file: "poligome-sam-service-linux.sh" })}</a>
                  <code>{`${unixCpuPrefix}bash poligome-sam-service-linux.sh install`}</code>
                </>}
                {installOs === "wsl" && <>
                  <p>{sc.relaunchWsl}</p>
                  <a className="sam-step-download" href="/poligome-sam-start-windows.bat" download><Download size={14} />{fill(sc.download, { file: "poligome-sam-start-windows.bat" })}</a>
                  {/* Dois cliques não carregam variável de ambiente, e sem ela o
                      iniciador volta para `auto`. Quem escolheu CPU precisa do
                      comando, não do atalho. */}
                  {forceCpu && <>
                    <p>{sc.relaunchWslCpu}</p>
                    <code>{String.raw`cd %USERPROFILE%\Downloads` + "\n" + "set POLIGOME_DEVICE=cpu && poligome-sam-start-windows.bat"}</code>
                  </>}
                </>}
                {installOs === "native" && <>
                  <p>{sc.relaunchNative}</p>
                  <code>{nativeWindowsCommand}</code>
                </>}
              </div>
              <p className="sam-manual-note">{model.family === "sam3" ? sc.sam3GpuOnly : sc.oldGpuNote}</p>
              <details className="sam-uninstall sam-platform-details">
                <summary>{sc.platformDetails}</summary>
                <p><b>Linux:</b> {model.platformSupport.linux.notes}</p>
                <p><b>Windows:</b> {model.platformSupport.windows.notes}</p>
                <p><b>macOS:</b> {model.platformSupport.macos.notes}</p>
              </details>

              {/* Onde isso fica e como sair: um instalador que não diz como se
                  desfazer obriga o usuário a caçar gigabytes pelo disco. Tudo mora
                  numa pasta só por sistema, então apagar a pasta desinstala. */}
              <details className="sam-uninstall">
                <summary>{sc.uninstallTitle}</summary>
                <p><Rich text={sc.uninstallBody} /></p>
                <table>
                  <tbody>
                    <tr>
                      <th>{sc.uninstallUnix}</th>
                      <td><code>~/.poligome-sam</code><br /><code>rm -rf ~/.poligome-sam</code></td>
                    </tr>
                    <tr>
                      <th>{sc.uninstallNative}</th>
                      <td><code>{String.raw`%USERPROFILE%\.poligome-sam`}</code><br /><code>{String.raw`rmdir /s /q "%USERPROFILE%\.poligome-sam"`}</code></td>
                    </tr>
                    <tr>
                      <th>{sc.uninstallWsl}</th>
                      <td><Rich text={sc.uninstallWslBody} /></td>
                    </tr>
                  </tbody>
                </table>
                <p><Rich text={sc.uninstallService} /></p>
              </details>
            </section>

          </details>}

          <section className="sam-privacy"><ShieldCheck size={16} /><div><b>{sc.privacyTitle}</b><p>{sc.samPrivacy}</p></div></section>
          </>}
        </div>
      </div>

      <footer>
        {/* O estado do conector só diz respeito ao Assistido; nas outras abas o
            que importa está na própria ficha, e em Conexões. */}
        {tab === "assisted" && <span className={`sam-footer-status ${loadError ? "error" : connectionState}`} aria-live="polite">
          <em />
          <span>
            <b>{loadError ? sc.stSwitchRefused : statusLabel(sc, connectionState, modelMatches)}</b>
            {loadError ? <small>{loadError}</small> : runtimeLabel ? <small>{runtimeLabel}</small> : null}
            {!loadError && connectionState === "offline" && <small>{sc.stOfflineHint}</small>}
          </span>
        </span>}
        <button onClick={onClose}>{ai.close}</button>
        {tab === "assisted" && samInUse && <button className="unselect-all" title={sc.unselectHint} onClick={onUnselectAll}>
          <PowerOff size={14} />{sc.unselect}
        </button>}
        {showFooterAction && <button className="connect" disabled={connectionState === "checking" || connectionState === "loading"} onClick={onConnect}>
          {connectionState === "checking" || connectionState === "loading" ? <Gauge className="spin" size={15} /> : <Link2 size={15} />}
          {connectionState === "loading"
            ? sc.btnLoading
            : modelMatches
              ? sc.btnUse
              : connectionState === "ready"
                ? sc.btnLoad
                : sc.btnVerify}
        </button>}
      </footer>
    </section>
  </div>;
}
