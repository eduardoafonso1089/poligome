"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle, Boxes, Check, Cpu, Download, ExternalLink, Gauge, HardDrive,
  KeyRound, Laptop, Link2, Network, Pencil, Plus, PowerOff, Server, ShieldCheck, Sparkles, Terminal, Trash2, X,
} from "lucide-react";
import { getCopy, type Language } from "../lib/i18n";
import { LocalConnectionExplainer } from "./LocalConnectionExplainer";
import { SAM_MODELS, getSamModel } from "../lib/sam-models";
import { BYOM_MODEL_ID_PATTERN, describeByomModel } from "../lib/sam-models";
import type { ByomModel, SamModelDefinition } from "../lib/sam-models";

type ConnectionState = "idle" | "checking" | "loading" | "ready" | "error" | "offline";

type ByomWriteOutcome = { ok: true } | { ok: false; detail: string };

type Props = {
  /** O painel é escrito em português; o idioma vale para o que vem do i18n. */
  language?: Language;
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
  /** Modelo BYOM escolhido para anotar, ou null quando o SAM é quem está em uso. */
  byomModelId: string | null;
  byomBusy: boolean;
  onSelectModel: (modelId: string) => void;
  onSelectByomModel: (modelId: string | null) => void;
  onRunByomModel: (modelId: string) => void;
  /** Devolve o desfecho para que o formulário possa manter o que foi digitado e mostrar o motivo. */
  onRegisterByomModel: (entry: { modelId: string; name: string; port: number; notes?: string }) => Promise<ByomWriteOutcome>;
  onRemoveByomModel: (modelId: string) => void;
  /** Desliga SAM e BYOM de uma vez, para voltar às ferramentas manuais. */
  onUnselectAll: () => void;
  anyModelSelected: boolean;
  onEndpointChange: (endpoint: string) => void;
  onConnect: () => void;
  onClose: () => void;
};

const capabilityLabels = {
  imageSegmentation: "Imagem",
  videoSegmentation: "Vídeo",
  pointPrompts: "Pontos",
  negativePointPrompts: "Pontos negativos",
  boxPrompts: "Caixas",
  maskPrompts: "Máscara anterior",
  textPrompts: "Texto",
  exemplarPrompts: "Exemplares",
  automaticMaskGeneration: "Máscaras automáticas",
  multimaskCandidates: "Múltiplas alternativas",
  interactiveRefinement: "Refinamento",
  instanceSegmentation: "Instâncias",
  conceptSegmentation: "Conceitos",
  videoTracking: "Tracking",
  multiObjectTracking: "Multiobjeto",
  bidirectionalPropagation: "Propagação bidirecional",
} as const;

function statusLabel(state: ConnectionState, modelMatches: boolean) {
  if (state === "checking") return "Verificando o conector local…";
  if (state === "loading") return "Modelo carregando…";
  if (state === "error") return "O conector foi encontrado, mas o modelo falhou ao carregar";
  if (state === "ready" && modelMatches) return "Modelo selecionado pronto";
  if (state === "ready") return "Outro modelo está carregado; usar este vai trocá-lo";
  return "Conector não encontrado";
}

function benchmarkSummary(model: SamModelDefinition) {
  if (model.benchmark.kind === "sam2-video") {
    return {
      value: `${model.benchmark.fps} FPS de vídeo`,
      label: `${model.benchmark.hardware} · VOS`,
      details: `SA-V ${model.benchmark.saVJAndF} · MOSE ${model.benchmark.moseJAndF} · LVOS ${model.benchmark.lvosV2JAndF} J&F. ${model.benchmark.software}`,
    };
  }
  if (model.benchmark.kind === "sam3-image-concepts") {
    return {
      value: `${model.benchmark.latencyMs} ms`,
      label: model.benchmark.hardware,
      details: "Imagem com mais de 100 objetos, segundo o benchmark publicado pela Meta",
    };
  }
  return {
    value: "Sem número comparável",
    label: model.benchmark.hardware,
    details: model.benchmark.notes[0],
  };
}

const BYOM_STEPS = [
  {
    title: "1. Baixe o exemplo e troque o predict()",
    body:
      "Os botões de Arquivos do BYOM, logo acima, trazem o Dockerfile, o serve.py e a CLI do seu sistema — baixe esses três. O serve.py já implementa o contrato inteiro — /ping, /invocations e a serialização COCO — então o que sobra para você é a função predict(). Rode os comandos seguintes na pasta onde os arquivos caíram.",
    command: "cd ~/Downloads   # a pasta em que o navegador salvou os arquivos",
  },
  {
    title: "2. Construa a imagem",
    body:
      "O Dockerfile de exemplo já declara a porta 8080, cria /opt/ml/model e inicia com serve. Use o seu próprio se preferir, desde que respeite o contrato. O ponto final é o diretório do Dockerfile, e não um nome de arquivo.",
    command: "docker build -t meu-modelo .",
  },
  {
    title: "3. Registre o modelo",
    body:
      "O registro grava um arquivo em ~/.poligome-sam/byom. O identificador precisa começar com byom- para nunca colidir com um modelo oficial. Repetir o register com outro --model-id, outra --port e outro --env faz a mesma imagem servir a vários modelos: é assim que o exemplo entrega dois.",
    command: "bash poligome-byom-macos-linux.sh register --model-id byom-meu-modelo --image meu-modelo --name \"Meu modelo\" --port 8080",
  },
  {
    title: "4. Suba o contêiner",
    body:
      "O comando publica a porta apenas em 127.0.0.1 e espera o /ping responder antes de declarar sucesso. Se o contêiner morrer antes disso, as últimas linhas do log aparecem na saída. Depois do /ping o modelo aparece na lista ao lado.",
    command: "bash poligome-byom-macos-linux.sh start --model-id byom-meu-modelo",
  },
  {
    title: "5. Depois de reiniciar, suba de novo",
    body:
      "Os contêineres são criados sem política de reinício, então reiniciar o computador ou o Docker os deixa parados. O registro sobrevive, o processo não — e o editor descobre o que está no ar, mas não pode ligar nada. Repetir o start é seguro: ele não sobe um segundo contêiner se o /ping já responde. Para que um contêiner volte junto com o Docker, marque-o uma vez com docker update --restart unless-stopped.",
    command: "bash poligome-byom-macos-linux.sh start --model-id byom-meu-modelo",
  },
] as const;

/**
 * A aba "Como funciona" existe porque a pergunta que ela responde — para onde vai
 * a minha imagem — vem antes de escolher modelo, e estava repetida em duas telas.
 * Num lugar só, e primeiro na lista, ela é achável sem atrapalhar quem já sabe.
 */
function HowItWorks({ language }: { language: Language }) {
  return <div className="byom-panel">
    <section className="sam-model-hero">
      <div><span className="family byom">Local</span></div>
      <h3>Como funciona</h3>
      <p>
        O Poligome não manda imagem para servidor nenhum. Quem carrega o modelo e roda a inferência é um programa que
        fica na sua máquina, e a página só conversa com ele. O desenho abaixo é o caminho inteiro.
      </p>
    </section>

    <LocalConnectionExplainer copy={getCopy(language)} />

    <section className="byom-steps">
      <h4>O que o Poligome faz e o que fica com você</h4>
      <article>
        <b>A página encontra, nunca liga</b>
        <p>
          Ao abrir o editor e a cada volta de foco, a página procura o conector em 127.0.0.1:7860 e adota o que já
          estiver carregado. Nenhuma página web pode criar processo nem subir contêiner — é regra do navegador. Por
          isso o terminal do instalador precisa ficar aberto, ou, no Linux, o serviço de usuário faz esse papel.
        </p>
      </article>
      <article>
        <b>Trocar de modelo não reinstala nada</b>
        <p>
          Escolher outro SAM na lista ao lado e confirmar recarrega o conector no ambiente da família pedida. O que
          não estiver instalado é recusado com o motivo, em vez de falhar no meio. A escolha fica gravada, então o
          próximo arranque sobe o mesmo modelo.
        </p>
      </article>
      <article>
        <b>SAM e BYOM convivem</b>
        <p>
          Os dois podem ficar ativos ao mesmo tempo, e o botão do topo mostra os dois. São caminhos independentes: o
          SAM segmenta o objeto que você aponta — por clique, por caixa, ou por texto no SAM 3 — o BYOM anota a
          imagem inteira de uma vez, e as máscaras de um não alteram nem
          substituem as do outro. Desselecionar todos apenas deixa de usá-los para anotar — nada é desinstalado e o
          conector segue conectado.
        </p>
      </article>
    </section>

    <section className="sam-privacy">
      <ShieldCheck size={16} />
      <div>
        <b>Inferência local</b>
        <p>
          Imagens e prompts ficam no computador. O contêiner do BYOM só é aceito em 127.0.0.1 ou localhost: um
          endereço remoto tiraria as imagens da sua máquina, que é justamente o que o Poligome evita.
        </p>
      </div>
    </section>
  </div>;
}

function ByomEntry({
  model,
  busy,
  onRun,
  onRemove,
  onSave,
}: {
  model: ByomModel;
  busy: boolean;
  onRun: (modelId: string) => void;
  onRemove: (modelId: string) => void;
  onSave: (entry: { modelId: string; name: string; port: number; notes: string }) => Promise<ByomWriteOutcome>;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(model.name);
  const [port, setPort] = useState(String(Number(model.endpoint.split(":").at(-1)) || 8080));
  const [notes, setNotes] = useState(model.notes);
  // Fechar a edição antes de saber se o registro foi gravado descartava a
  // correção e não dizia o motivo; agora a ficha só fecha quando deu certo.
  const [saveError, setSaveError] = useState("");
  const portNumber = Number(port);
  const canSave = Number.isInteger(portNumber) && portNumber >= 1 && portNumber <= 65535 && name.trim().length > 0;

  return <div className="byom-detail">
    <section className="sam-model-hero">
      <div>
        <span className="family byom">BYOM</span>
        <span className={model.ready ? "byom-state up" : "byom-state down"}>{model.ready ? "contêiner no ar" : "contêiner parado"}</span>
      </div>
      <h3>{model.name}</h3>
      <p>{model.model_id} · {model.endpoint}{model.image ? ` · imagem ${model.image}` : ""}</p>
    </section>

    {!model.ready && model.unavailable_reason && <p className="byom-reason">{model.unavailable_reason}</p>}

    {/* Explicação montada a partir do que o contêiner declara ou já devolveu. */}
    <p className="byom-summary">{describeByomModel(model)}</p>

    {model.metadata?.limitations && <section className="byom-limits">
      <AlertTriangle size={15} />
      <div><b>Limitações declaradas pelo modelo</b><p>{model.metadata.limitations}</p></div>
    </section>}

    {(model.metadata?.categories.length || Object.keys(model.metadata?.parameters ?? {}).length || Object.keys(model.env).length) ? <section className="byom-facts">
      {model.metadata?.categories.length ? <article><b>Classes exportadas</b><p>{model.metadata.categories.join(", ")}</p></article> : null}
      {Object.entries(model.metadata?.parameters ?? {}).length ? <article><b>Parâmetros do modelo</b><p>{Object.entries(model.metadata!.parameters).map(([key, value]) => `${key}=${value}`).join(" · ")}</p></article> : null}
      {Object.entries(model.env).length ? <article><b>Ambiente do contêiner</b><p>{Object.entries(model.env).map(([key, value]) => `${key}=${value}`).join(" · ")}</p></article> : null}
      {model.last_run ? <article><b>Última execução</b><p>{model.last_run.annotations} {model.last_run.annotations === 1 ? "anotação" : "anotações"}{model.last_run.categories.length ? ` · ${model.last_run.categories.join(", ")}` : ""}</p></article> : null}
    </section> : null}

    {model.notes && !editing && <p className="byom-note">{model.notes}</p>}

    {editing ? <div className="byom-edit">
      <label>Nome<input value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label>Porta<input type="number" min={1} max={65535} value={port} onChange={(event) => setPort(event.target.value)} /></label>
      <label className="byom-edit-notes">Anotação<textarea rows={3} value={notes} placeholder="Para que serve, em que dados foi treinado, o que revisar com atenção." onChange={(event) => setNotes(event.target.value)} /></label>
      <div className="byom-edit-actions">
        <button onClick={() => { setName(model.name); setNotes(model.notes); setEditing(false); }}>Cancelar</button>
        <button
          className="primary"
          disabled={!canSave}
          onClick={async () => {
            setSaveError("");
            const outcome = await onSave({ modelId: model.model_id, name: name.trim(), port: portNumber, notes: notes.trim() });
            if (outcome.ok) setEditing(false);
            else setSaveError(outcome.detail);
          }}
        >
          <Check size={13} />Salvar
        </button>
      </div>
      {saveError && <p className="byom-reason">Não foi possível salvar: {saveError}</p>}
    </div> : <div className="byom-entry-actions">
      <button className="byom-run" disabled={!model.ready || busy} onClick={() => onRun(model.model_id)}>
        {busy ? <Gauge className="spin" size={14} /> : <Sparkles size={14} />}
        {busy ? "Anotando…" : "Anotar a imagem atual"}
      </button>
      <button className="byom-icon" title="Editar nome, porta e anotação" onClick={() => setEditing(true)}>
        <Pencil size={14} />
      </button>
      <button className="byom-icon danger" title="Remover o registro; a imagem e o contêiner continuam no Docker" onClick={() => onRemove(model.model_id)}>
        <Trash2 size={14} />
      </button>
    </div>}
  </div>;
}

function ByomPanel({
  models,
  onRegister,
}: {
  models: readonly ByomModel[];
  onRegister: (entry: { modelId: string; name: string; port: number; notes?: string }) => Promise<ByomWriteOutcome>;
}) {
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

  return <div className="byom-panel">
    <section className="sam-model-hero">
      <div><span className="family byom">BYOM</span><span className="experimental">Contêiner local</span></div>
      <h3>Traga o seu próprio modelo</h3>
      <p>
        Diferente do SAM, aqui não se clica em nada: o contêiner recebe a imagem inteira e devolve um documento
        COCO já rotulado, com máscaras, caixas e pontos. O editor desenha tudo com as classes que o próprio modelo
        indicou, prontas para revisão.
      </p>
      <p>
        O empacotamento imita o do SageMaker, então um contêiner preparado para lá roda aqui com pouca ou nenhuma
        mudança: a imagem sobe com <code>serve</code>, escuta na porta 8080, responde <code>GET /ping</code> quando
        está pronta e recebe a inferência em <code>POST /invocations</code>. Os pesos ficam em{" "}
        <code>/opt/ml/model</code> e nunca passam pelo Poligome.
      </p>
    </section>

    <section className="byom-steps">
      <h4>Antes de começar</h4>
      <article>
        <b>Docker instalado e no ar</b>
        <p>
          O Poligome não instala nem inicia o Docker por você, e nenhuma página web pode subir um contêiner. A CLI
          abaixo confere isso antes de tentar qualquer coisa e diz o que falta.
        </p>
      </article>
      <article>
        <b>Conector do Poligome rodando</b>
        <p>
          O editor não fala direto com o contêiner: tudo passa pelo conector em <code>127.0.0.1:7860</code>. Com ele
          parado, o BYOM nem aparece nesta lista. É o mesmo conector do SAM, instalado pelo painel dos modelos.
        </p>
      </article>
      <article>
        <b>No Windows, chame a CLI do mesmo lado em que o conector está</b>
        <p>
          O registro do BYOM é um arquivo que o conector lê, então ele precisa ser gravado onde o conector procura.
          Instalou o SAM pelo <code>poligome-sam-windows.bat</code>? O conector mora dentro do WSL2: chame a CLI em
          bash, de dentro da distribuição, e o registro fica no home dela. Instalou pelo{" "}
          <code>poligome-sam-windows-native.ps1</code>? O conector é um processo comum do Windows: use a CLI de
          PowerShell abaixo, e o registro fica em <code>%USERPROFILE%\.poligome-sam\byom</code>. Os dois registros são
          independentes, e o Docker precisa responder do mesmo lado que o conector.
        </p>
        <code>{"wsl bash poligome-byom-macos-linux.sh list\npowershell -ExecutionPolicy Bypass -File .\\poligome-byom-windows.ps1 list"}</code>
      </article>
    </section>

    <section className="byom-contract">
      <h4>Contrato</h4>
      <table>
        <tbody>
          <tr><th>Porta</th><td><code>8080</code> dentro do contêiner</td></tr>
          <tr><th>Comando</th><td><code>docker run &lt;imagem&gt; serve</code></td></tr>
          <tr><th>Saúde</th><td><code>GET /ping</code> devolve 200 quando o modelo está carregado</td></tr>
          <tr><th>Inferência</th><td><code>POST /invocations</code> recebe a imagem, devolve COCO</td></tr>
          <tr><th>Pesos</th><td><code>/opt/ml/model</code>, igual ao SageMaker</td></tr>
          <tr><th>Descrição</th><td><code>GET /metadata</code>, opcional: classes, geometria, parâmetros e limitações</td></tr>
        </tbody>
      </table>
      <p className="byom-io">
        <b>Entrada:</b> <code>{"{ image, file_name, width, height }"}</code> — a imagem inteira, sem prompt nenhum.
        <br />
        <b>Saída:</b> COCO com <code>images</code>, <code>categories</code> e <code>annotations</code>. Cada anotação
        precisa de <code>segmentation</code>, <code>bbox</code> ou <code>keypoints</code>, e o <code>category_id</code>{" "}
        vira a classe da anotação no editor. <code>segmentation</code> só é aceita como lista de pontos{" "}
        <code>[x, y, x, y, …]</code>: RLE, o outro formato do COCO, é recusado. Sem geometria, o conector recusa a
        resposta inteira e diz qual anotação está incompleta.
        <br />
        <b>Erros:</b> responda <code>{"{ \"detail\": \"mensagem\" }"}</code> — o texto aparece na tela como está, então
        escreva para quem está anotando. Enquanto o modelo carrega, responda <code>/ping</code> com qualquer status
        diferente de <code>200</code>.
      </p>
      <p className="byom-import-hint">
        O <code>/metadata</code> é o que preenche a ficha do modelo aqui do lado antes da primeira execução: sem ele, a
        ficha só tem o que a última execução devolveu.
      </p>
    </section>

    {/* Os arquivos vêm antes do passo a passo porque o primeiro passo é baixá-los. */}
    <section className="sam-install-panel">
      <div><b>Arquivos do BYOM</b><p>O serve.py de exemplo devolve COCO com polígono, caixa e ponto central, sem GPU, e traz dois métodos escolhidos pela variável METHOD: otsu, que junta objetos encostados numa região só, e watershed, que os separa. Serve de molde: troque a função predict() e mantenha o resto.</p></div>
      <div className="sam-install-actions">
        <a className="primary" href="/poligome-byom-macos-linux.sh" download><Download size={15} /><span><strong>CLI do BYOM · Linux, macOS e WSL2</strong><small>register · start · status · logs</small></span></a>
        {/* Sem este botão, quem instalou o SAM pelo caminho nativo de Windows não
            tinha como obter a CLI que escreve no registro que o conector dele lê. */}
        <a href="/poligome-byom-windows.ps1" download><Download size={15} /><span><strong>CLI do BYOM · Windows nativo</strong><small>os mesmos comandos, em PowerShell</small></span></a>
        <a href="/byom/Dockerfile" download><Download size={15} /><span><strong>Dockerfile de exemplo</strong><small>python:3.12-slim, porta 8080</small></span></a>
        <a href="/byom/serve.py" download><Download size={15} /><span><strong>serve.py de exemplo</strong><small>/ping e /invocations prontos</small></span></a>
      </div>
      <code>{"bash poligome-byom-macos-linux.sh --help\npowershell -ExecutionPolicy Bypass -File .\\poligome-byom-windows.ps1 help"}</code>
    </section>

    <section className="byom-steps">
      <h4>Ver os dois exemplos funcionando antes de empacotar nada</h4>
      <article>
        <b>Com o repositório clonado</b>
        <p>
          Um comando constrói a imagem de exemplo e registra dois modelos a partir dela — byom-otsu na porta 8080 e
          byom-watershed na 8081. Chame-o pelo caminho dentro do repositório, da raiz: sem --path, ele procura o
          Dockerfile e os registros prontos na pasta byom ao lado do próprio script, que é public/byom. Esses
          registros não vêm nos botões de download acima. Reexecutar não sobrescreve um registro que você já tenha
          ajustado.
        </p>
        <code>bash public/poligome-byom-macos-linux.sh examples</code>
      </article>
      <article>
        <b>Só com os arquivos baixados</b>
        <p>
          Sem o repositório, o comando examples não tem de onde ler os registros e para dizendo isso. O caminho é
          construir a imagem uma vez e registrar dois modelos com METHOD diferente — que é exatamente o que o examples
          faz por dentro, e a razão de o register aceitar --env.
        </p>
        <code>{"docker build -t poligome-byom-exemplo .\nbash poligome-byom-macos-linux.sh register --model-id byom-otsu --image poligome-byom-exemplo --name \"Exemplo Otsu\" --port 8080 --env METHOD=otsu\nbash poligome-byom-macos-linux.sh register --model-id byom-watershed --image poligome-byom-exemplo --name \"Exemplo Watershed\" --port 8081 --env METHOD=watershed\nbash poligome-byom-macos-linux.sh start --model-id byom-otsu\nbash poligome-byom-macos-linux.sh start --model-id byom-watershed"}</code>
      </article>
      <article>
        <b>Conferir sem sair do terminal</b>
        <p>
          O list mostra imagem, contêiner e o código do /ping de cada registro. Aparecer na lista aqui do lado depende
          só de estar registrado — é o /ping 200 que muda o card de contêiner parado para no ar e libera a anotação.
          Quando ele não responde, o logs diz o motivo.
        </p>
        <code>{"bash poligome-byom-macos-linux.sh list\nbash poligome-byom-macos-linux.sh logs --model-id byom-otsu"}</code>
      </article>
    </section>

    <section className="byom-steps">
      <h4>Passo a passo do seu modelo</h4>
      {/* Os comandos abaixo são os de bash. Quem instalou pelo caminho nativo de
          Windows precisa saber que os mesmos passos existem lá, com o mesmo nome,
          antes de tentar rodar bash no PowerShell e achar que o BYOM não serve. */}
      <p className="byom-import-hint">
        Os comandos estão em bash, para Linux, macOS e WSL2. No Windows nativo os passos são os mesmos, com os mesmos
        nomes de comando e opções escritas ao estilo do PowerShell — troque{" "}
        <code>bash poligome-byom-macos-linux.sh register --model-id X --image Y</code> por{" "}
        <code>{String.raw`powershell -ExecutionPolicy Bypass -File .\poligome-byom-windows.ps1 register -ModelId X -Image Y`}</code>.
        A lista completa sai com <code>help</code>.
      </p>
      {BYOM_STEPS.map((step) => <article key={step.title}>
        <b>{step.title}</b>
        <p>{step.body}</p>
        <code>{step.command}</code>
      </article>)}
    </section>

    <section className="byom-registered">
      <h4>Importar um contêiner já em execução</h4>
      <p className="byom-import-hint">
        O contêiner precisa estar no ar antes — pela CLI acima ou com <code>docker run</code>. Importar aqui só
        declara onde ele está; o Poligome não executa Docker por conta própria.
      </p>
      <div className="byom-import">
        <label>Identificador<input value={draftId} onChange={(event) => setDraftId(event.target.value)} placeholder="byom-meu-modelo" spellCheck={false} /></label>
        <label>Nome<input value={draftName} onChange={(event) => setDraftName(event.target.value)} placeholder="Meu modelo" /></label>
        <label>Porta<input type="number" min={1} max={65535} value={draftPort} onChange={(event) => setDraftPort(event.target.value)} /></label>
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
          {importing ? <Gauge className="spin" size={14} /> : <Plus size={14} />}{importing ? "Importando…" : "Importar"}
        </button>
      </div>
      {!canRegister && draftId.trim() !== "byom-" && <p className="byom-reason">O identificador precisa começar com <code>byom-</code> e usar apenas letras minúsculas, números, ponto, hífen ou sublinhado.</p>}
      {importError && <p className="byom-reason">Não foi possível importar: {importError}</p>}

      {models.length === 0
        ? <p className="byom-import-hint">Nenhum contêiner registrado ainda. Assim que o <code>/ping</code> responder, o modelo aparece na lista à esquerda.</p>
        : <p className="byom-import-hint">{models.length === 1 ? "1 modelo registrado" : `${models.length} modelos registrados`} — a lista fica à esquerda, e clicar em um deles abre a ficha com o que ele exporta.</p>}
    </section>

    <section className="byom-limits">
      <AlertTriangle size={15} />
      <div>
        <b>Quando não aparece nada</b>
        <p>
          Lista vazia é quase sempre o conector parado, porque é ele quem enxerga o registro: suba-o pelo painel dos
          modelos e volte a esta aba. Modelo na lista mas marcado como parado é o contêiner caído — <code>logs</code>{" "}
          diz o motivo, e o mais comum é a porta já ocupada por outro contêiner. Registro apagado por engano não leva
          junto nem a imagem nem o contêiner: basta registrar de novo com o mesmo <code>--model-id</code>.
        </p>
      </div>
    </section>

    <section className="sam-privacy"><ShieldCheck size={16} /><div><b>Inferência local</b><p>O contêiner só é aceito em <code>127.0.0.1</code> ou <code>localhost</code>: um endereço remoto sairia da sua máquina, que é justamente o que o Poligome evita. A licença do modelo que você empacota é responsabilidade sua.</p></div></section>
  </div>;
}

export default function SamSetupModal({
  language = "pt",
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
  byomModelId,
  byomBusy,
  onSelectModel,
  onSelectByomModel,
  onRunByomModel,
  onRegisterByomModel,
  onRemoveByomModel,
  onUnselectAll,
  anyModelSelected,
  onEndpointChange,
  onConnect,
  onClose,
}: Props) {
  // O painel BYOM ocupa a área de detalhe no lugar da ficha do modelo, porque o
  // que interessa ali é a documentação do contrato e não um card comparável.
  const [byomView, setByomView] = useState<"docs" | "model" | "how" | null>(null);
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

  const selectedByomModel = byomModels.find((candidate) => candidate.model_id === byomModelId) ?? null;
  // Só o tutorial não tem o que confirmar: é texto. Um modelo, BYOM ou SAM,
  // sempre oferece o botão de usar no canto do rodapé.
  const showFooterAction = byomView !== "docs" && byomView !== "how";
  const model = getSamModel(selectedModelId) ?? SAM_MODELS[0];
  const installedIds = new Set(availability.filter((entry) => entry.installed).map((entry) => entry.model_id));
  // Só vale dizer "ainda não instalado" quando o conector respondeu: sem ele a
  // lista chega vazia e todo modelo pareceria faltando.
  const selectedAvailability = availability.find((entry) => entry.model_id === model.id) ?? null;
  const needsInstall = selectedAvailability !== null && !selectedAvailability.installed;
  const benchmark = benchmarkSummary(model);
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
  const labelOf = (key: string) => capabilityLabels[key as keyof typeof capabilityLabels];
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
      label: "Linux ou macOS",
      file: "poligome-sam-macos-linux.sh",
      href: "/poligome-sam-macos-linux.sh",
      steps: [
        { title: "Baixe o instalador", body: "É um arquivo de texto com os comandos da instalação. O navegador costuma guardá-lo em Downloads.", command: null },
        { title: "Abra o Terminal na pasta do download", body: "No Ubuntu, Ctrl+Alt+T abre o Terminal. No macOS, procure por “Terminal” no Spotlight. Depois entre na pasta:", command: "cd ~/Downloads" },
        { title: "Rode o instalador", body: "Ele baixa alguns gigabytes na primeira vez e vai mostrando o progresso. No fim escreve “Modelo … instalado, carregado e selecionado”.", command: unixCommand },
        { title: "Deixe esta janela do Terminal aberta", body: "É ela que mantém o conector no ar. Fechar a janela, ou reiniciar o computador, desliga a IA — o editor sabe procurá-la, mas não sabe ligá-la.", command: null },
        { title: "Volte a esta tela e clique em “Verificar e usar”", body: "O estado no rodapé desta janela vira verde quando o editor encontra o conector.", command: null },
      ],
    },
    wsl: {
      label: "Windows com WSL2",
      file: "poligome-sam-windows.bat",
      href: "/poligome-sam-windows.bat",
      steps: [
        { title: "Baixe o instalador", body: "O navegador costuma guardá-lo na pasta Downloads.", command: null },
        { title: "Dê dois cliques no arquivo baixado", body: "Abre uma janela preta com a lista dos modelos, numerada de 1 a 10. Digite o número e pressione Enter. O modelo desta ficha é o que está selecionado à esquerda.", command: null },
        { title: "Ou, se preferir digitar o comando", body: "Abra o Prompt de Comando, entre na pasta do download e chame o instalador com o identificador do modelo:", command: String.raw`cd %USERPROFILE%\Downloads` + "\n" + windowsCommand },
        { title: "Deixe a janela aberta", body: "A instalação acontece dentro do WSL2, e é essa janela que mantém o conector no ar. Fechar desliga a IA.", command: null },
        { title: "Volte a esta tela e clique em “Verificar e usar”", body: "O estado no rodapé desta janela vira verde quando o editor encontra o conector.", command: null },
      ],
    },
    native: {
      label: "Windows sem WSL2",
      file: "poligome-sam-windows-native.ps1",
      href: "/poligome-sam-windows-native.ps1",
      steps: [
        { title: "Baixe o instalador", body: "O navegador costuma guardá-lo na pasta Downloads.", command: null },
        { title: "Abra o PowerShell", body: "No menu Iniciar, digite “PowerShell” e abra. Não dê dois cliques no arquivo baixado: o Windows abre o Bloco de Notas em vez de executá-lo.", command: null },
        { title: "Entre na pasta do download", body: "É onde o navegador guardou o arquivo.", command: String.raw`cd $env:USERPROFILE\Downloads` },
        { title: "Rode o instalador", body: "O comando precisa ser este, inteiro: digitar só o nome do arquivo é recusado pela política de execução do Windows. Ele baixa alguns gigabytes na primeira vez.", command: nativeWindowsCommand },
        { title: "Deixe a janela do PowerShell aberta", body: "É ela que mantém o conector no ar. Fechar a janela, ou reiniciar o computador, desliga a IA.", command: null },
        { title: "Volte a esta tela e clique em “Verificar e usar”", body: "O estado no rodapé desta janela vira verde quando o editor encontra o conector.", command: null },
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
    <section className="sam-catalog-modal" role="dialog" aria-modal="true" aria-labelledby="sam-catalog-title">
      <header>
        <div><span><Sparkles size={21} /></span><div><h2 id="sam-catalog-title">Modelos Segment Anything</h2><p>Escolha o modelo conforme recursos, hardware e licença.</p></div></div>
        <button onClick={onClose} aria-label="Fechar"><X size={21} /></button>
      </header>

      <div className="sam-catalog-body">
        <aside className="sam-model-list" aria-label="Modelos disponíveis">
          <section>
            <h3>Comece por aqui</h3>
            <button
              className={byomView === "how" ? "active" : ""}
              aria-pressed={byomView === "how"}
              onClick={() => setByomView("how")}
            >
              <span><b>Como funciona</b><small>O conector local, o SAM e o BYOM num desenho</small></span>
              <em><Network size={13} /></em>
            </button>
          </section>

          {(["sam2", "medsam2", "sam3"] as const).map((family) => <section key={family}>
            <h3>{family === "sam2" ? "SAM 2.1 · recomendado" : family === "medsam2" ? "Domínio · imagem médica" : "SAM 3 · conceitos"}</h3>
            {SAM_MODELS.filter((candidate) => candidate.family === family).map((candidate) => <button
              key={candidate.id}
              className={candidate.id === model.id && byomView === null ? "active" : ""}
              aria-pressed={candidate.id === model.id && byomView === null}
              onClick={() => { setByomView(null); onSelectModel(candidate.id); }}
            >
              <span><b>{candidate.name}</b><small>{candidate.parameters.label} · {candidate.checkpoint.approximateSizeLabel}</small></span>
              {/* "Em uso" é o que está carregado agora, e não o que você está olhando:
                  sem essa distinção não dá para ver que SAM e BYOM estão ativos juntos.
                  "Instalado" vem do conector e evita escolher um modelo que ainda
                  precisa ser baixado sem saber disso antes de clicar. */}
              {candidate.id === loadedModelId && connectionState === "ready" && samActive
                ? <em className="in-use">em uso</em>
                : installedIds.has(candidate.id)
                  ? <em className="installed"><Check size={11} />instalado</em>
                  : <em>{candidate.recommended ? "Recomendado" : candidate.experimental ? "Experimental" : candidate.version}</em>}
            </button>)}
          </section>)}

          <section>
            <h3>BYOM · seu modelo</h3>
            {byomModels.map((candidate) => <button
              key={candidate.model_id}
              className={byomView === "model" && candidate.model_id === byomModelId ? "active" : ""}
              aria-pressed={byomView === "model" && candidate.model_id === byomModelId}
              onClick={() => { setByomView("model"); onSelectByomModel(candidate.model_id); }}
            >
              <span><b>{candidate.name}</b><small>{candidate.model_id}</small></span>
              {candidate.model_id === byomModelId && candidate.ready
                ? <em className="in-use">em uso</em>
                : <em className={candidate.ready ? "byom-up" : "byom-down"}>{candidate.ready ? "no ar" : "parado"}</em>}
            </button>)}
            <button
              className={byomView === "docs" ? "active" : ""}
              aria-pressed={byomView === "docs"}
              onClick={() => setByomView("docs")}
            >
              <span><b>Trazer meu modelo</b><small>Contêiner Docker · contrato e passo a passo</small></span>
              <em><Boxes size={13} /></em>
            </button>
          </section>
        </aside>

        <div className="sam-model-detail">
          {byomView === "how" ? <HowItWorks language={language} />
          : byomView === "docs" ? <ByomPanel models={byomModels} onRegister={onRegisterByomModel} />
          : byomView === "model" && selectedByomModel ? <ByomEntry
            model={selectedByomModel}
            busy={byomBusy}
            // Fechar junto: o resultado do BYOM são as anotações sobre a imagem, e
            // a mensagem que conta quantas vieram fica na barra de estado — tudo
            // atrás deste painel. Sem isso o botão parecia não ter feito nada.
            onRun={(modelId) => { onRunByomModel(modelId); onClose(); }}
            onRemove={(modelId) => { setByomView(null); onRemoveByomModel(modelId); }}
            onSave={onRegisterByomModel}
          /> : <>
          <section className="sam-model-hero">
            <div><span className={`family ${model.family}`}>{model.family === "sam2" ? "SAM 2.1" : model.family === "medsam2" ? "MedSAM2" : model.family.toUpperCase()}</span>{model.experimental && <span className="experimental">Experimental</span>}</div>
            <h3>{model.name}</h3>
            <p>{model.description}</p>
            <div className="sam-model-facts">
              <span><HardDrive size={14} /><b>{model.checkpoint.approximateSizeLabel}</b><small>checkpoint</small></span>
              <span><Cpu size={14} /><b>{model.parameters.label}</b><small>parâmetros</small></span>
              <span><ShieldCheck size={14} /><b>{model.license.name}</b><small>licença</small></span>
            </div>
          </section>

          {/* Dois grupos, e não uma lista só com visto verde em tudo. A lista
              única mostrava "Vídeo ✓ Tracking ✓" e só depois, em prosa, dizia que
              nada daquilo funciona aqui — quem lê de relance sai achando que o
              editor faz vídeo. */}
          <section className="sam-capabilities">
            <h4>O que dá para fazer com este modelo, aqui</h4>
            <div>{availableCapabilities.map((capability) => <span key={capability}><Check size={11} />{capability}</span>)}</div>
            {pendingCapabilities.length > 0 && <>
              <h4 className="pending">O modelo também faz, mas este editor ainda não usa</h4>
              <div className="pending">{pendingCapabilities.map((capability) => <span key={capability}>{capability}</span>)}</div>
            </>}
            {model.capabilities.videoSegmentation && <p>Vídeo é o maior deles: o modelo rastreia objetos ao longo dos quadros, e esta versão do editor abre apenas imagens.</p>}
          </section>

          {model.citation && <section className="sam-citation">
            <h4>Referência</h4>
            <p>{model.citation.authors} <b>{model.citation.title}</b>. {model.citation.venue}, {model.citation.year}.</p>
            <a href={model.citation.url} target="_blank" rel="noreferrer"><ExternalLink size={12} />Ler o artigo</a>
          </section>}

          {model.futureCapabilities.map((future) => <section className="sam-future-note" key={future.name}>
            <Sparkles size={16} />
            <div><b>{future.name} · disponível upstream</b><p>{future.description}</p><small>Ainda não integrado nem instalável por este editor. Referência oficial: {future.benchmark.speedupAt128Objects} em {future.benchmark.hardware}; o ganho depende da quantidade de objetos.</small></div>
          </section>)}

          <section className="sam-requirements-grid">
            <article><span><Terminal size={15} /></span><div><b>Stack</b><p>Python {model.requirements.python.minimum}+ · PyTorch {model.requirements.pytorch.minimum}+{model.requirements.pytorch.torchvisionMinimum ? ` · Torchvision ${model.requirements.pytorch.torchvisionMinimum}+` : ""}.{pythonNotes ? ` ${pythonNotes}` : ""}</p></div></article>
            <article><span><Cpu size={15} /></span><div><b>Processamento</b><p>{model.requirements.compute.notes}</p></div></article>
            <article className={model.requirements.cuda.required ? "critical" : ""}><span><Server size={15} /></span><div><b>CUDA</b><p>{model.requirements.cuda.required ? `Obrigatório: CUDA ${model.requirements.cuda.minimum}+` : "Opcional; GPU CUDA recomendada"}{cudaTested ? ` · teste oficial: ${cudaTested}` : ""}</p></div></article>
            <article><span><Laptop size={15} /></span><div><b>Sistema</b><p>{model.requirements.operatingSystem.official}. {model.requirements.operatingSystem.notes}</p></div></article>
            <article><span><HardDrive size={15} /></span><div><b>RAM e VRAM</b><p>{model.requirements.vram.notes} {model.requirements.ram.notes}</p></div></article>
            <article className={model.requirements.access.type === "gated" ? "critical" : ""}><span><KeyRound size={15} /></span><div><b>Acesso</b><p>{model.requirements.access.notes}</p></div></article>
          </section>

          <section className="sam-benchmark">
            <div><Gauge size={18} /><span><b>{benchmark.value}</b><small>{benchmark.label}</small></span></div>
            <p>{benchmark.details}</p>
            <em>Resultado de referência, não previsão para sua GPU. {model.benchmark.notes[0]}</em>
          </section>

          {model.experimental && <section className="sam-license-warning"><AlertTriangle size={17} /><div><b>Licença e acesso diferentes</b><p>{model.license.notes}</p></div></section>}

          <section className="sam-install-panel">
            <div><b>Instalar o modelo selecionado</b><p>O instalador cria um ambiente separado por família e baixa apenas o checkpoint escolhido. O checkpoint é só uma parte: o ambiente de uma família ocupa alguns gigabytes de bibliotecas, baixados uma vez e reaproveitados pelos outros modelos dela.</p></div>
            {needsInstall && <p className="sam-needs-install"><AlertTriangle size={14} /><span><b>{model.name} ainda não está instalado.</b> O conector está no ar, mas sem este checkpoint. Rode o comando do seu sistema, aqui embaixo, e volte a esta tela.</span></p>}
            <div className="sam-os-picker" role="tablist" aria-label="Sistema operacional">
              {(["unix", "wsl", "native"] as const).map((key) => <button
                key={key}
                role="tab"
                aria-selected={installOs === key}
                className={installOs === key ? "active" : ""}
                onClick={() => setInstallOs(key)}
              >{installPaths[key].label}</button>)}
            </div>
            {installOs === "unix" && model.family === "sam3" && <p className="sam-manual-note">O SAM 3 não roda no macOS: o pacote oficial exige CUDA, que a Apple não oferece. Neste caminho, só Linux.</p>}
            {installOs === "native" && model.family === "sam3" && <p className="sam-manual-note">O SAM 3 precisa de GPU NVIDIA com CUDA. Sem WSL2 isso depende do PyTorch CUDA para Windows, que o instalador confere antes de baixar.</p>}

            <ol className="sam-steps">
              {chosenPath.steps.map((step, index) => <li key={step.title}>
                <b>{step.title}</b>
                <p>{step.body}</p>
                {index === 0
                  ? <a className="sam-step-download" href={chosenPath.href} download><Download size={14} />Baixar {chosenPath.file}</a>
                  : step.command ? <code>{step.command}</code> : null}
              </li>)}
            </ol>
            {/* Escolher CPU deixou de ser folclore de variável de ambiente: o
                controle fica aqui e reescreve os três comandos acima com a
                sintaxe certa de cada sistema. */}
            {model.family !== "sam3" && <label className="sam-device-choice">
              <input type="checkbox" checked={forceCpu} onChange={(event) => setForceCpu(event.target.checked)} />
              <span>
                <b>Rodar em CPU, mesmo se houver placa de vídeo</b>
                <small>
                  Sem GPU o modelo já usa a CPU sozinho — isto é para quem tem placa e prefere não usá-la, ou tem
                  uma placa antiga demais para o modelo. Fica mais devagar, alguns segundos por clique. No Linux o
                  download também fica alguns gigabytes menor, porque o PyTorch de CPU não traz as bibliotecas da
                  NVIDIA. Marcar aqui só muda os comandos acima; o instalador ainda pergunta se encontrar uma placa
                  que não serve.
                </small>
              </span>
            </label>}
            {/* O comando de cada caminho já vai embaixo do seu próprio botão. Um
                único bloco aqui mostrava sempre o de Linux, inclusive para quem
                tinha acabado de baixar o instalador de Windows. */}
            {/* Depois de instalado, o caminho de volta é outro e mais curto. Ele
                muda por sistema como o de instalação, então acompanha a aba. */}
            <div className="sam-relaunch">
              <b>Da próxima vez, para religar sem reinstalar</b>
              {installOs === "unix" && <>
                <p>Baixe o iniciador uma vez e guarde-o junto do instalador. Ele sobe o conector com o modelo que já estava escolhido, sem baixar nada de novo.</p>
                <a className="sam-step-download" href="/poligome-sam-start-macos-linux.sh" download><Download size={14} />Baixar poligome-sam-start-macos-linux.sh</a>
                <code>{`cd ~/Downloads
${unixCpuPrefix}bash poligome-sam-start-macos-linux.sh`}</code>
                <p>No Linux dá para nunca mais pensar nisso: o serviço de usuário sobe o conector sozinho a cada login, e aí nenhuma janela precisa ficar aberta.</p>
                <a className="sam-step-download" href="/poligome-sam-service-linux.sh" download><Download size={14} />Baixar poligome-sam-service-linux.sh</a>
                <code>{`${unixCpuPrefix}bash poligome-sam-service-linux.sh install`}</code>
              </>}
              {installOs === "wsl" && <>
                <p>Baixe o iniciador uma vez e guarde-o junto do instalador. Dois cliques nele sobem o conector com o modelo que já estava escolhido, sem baixar nada de novo.</p>
                <a className="sam-step-download" href="/poligome-sam-start-windows.bat" download><Download size={14} />Baixar poligome-sam-start-windows.bat</a>
                {/* Dois cliques não carregam variável de ambiente, e sem ela o
                    iniciador volta para `auto`. Quem escolheu CPU precisa do
                    comando, não do atalho. */}
                {forceCpu && <>
                  <p>Como você marcou CPU, chame o iniciador pelo Prompt de Comando: dois cliques não levam a escolha junto.</p>
                  <code>{String.raw`cd %USERPROFILE%\Downloads` + "\n" + "set POLIGOME_DEVICE=cpu && poligome-sam-start-windows.bat"}</code>
                </>}
              </>}
              {installOs === "native" && <>
                <p>Este caminho não tem iniciador à parte, e não precisa: rodar o mesmo comando de novo reconhece o que já está instalado e só levanta o conector, em segundos.</p>
                <code>{nativeWindowsCommand}</code>
              </>}
            </div>
            <p className="sam-manual-note">
              {model.family === "sam3"
                ? <>O SAM 3 só roda em GPU NVIDIA: o conector recusa CPU e Metal para esta família.</>
                : <>Se a sua placa for antiga demais para o modelo, o instalador avisa e pergunta antes de baixar qualquer coisa — não é preciso descobrir isso sozinho. A opção acima vale também para o iniciador.</>}
            </p>
            <details className="sam-uninstall sam-platform-details">
              <summary>Detalhes de cada sistema</summary>
              <p><b>Linux:</b> {model.platformSupport.linux.notes}</p>
              <p><b>Windows:</b> {model.platformSupport.windows.notes}</p>
              <p><b>macOS:</b> {model.platformSupport.macos.notes}</p>
            </details>

            {/* Onde isso fica e como sair: um instalador que não diz como se
                desfazer obriga o usuário a caçar gigabytes pelo disco. Tudo mora
                numa pasta só por sistema, então apagar a pasta desinstala. */}
            <details className="sam-uninstall">
              <summary>Onde isso fica e como remover</summary>
              <p>
                Tudo o que o instalador cria — ambientes Python, checkpoints, o conector e os registros do BYOM —
                fica dentro de <b>uma pasta só</b>. Apagar essa pasta desinstala: nada é gravado no registro do
                Windows, em <code>/usr/local</code> ou em qualquer outro lugar do sistema. Pare o conector antes
                (feche a janela que o iniciou) e apague.
              </p>
              <table>
                <tbody>
                  <tr>
                    <th>Linux e macOS</th>
                    <td><code>~/.poligome-sam</code><br /><code>rm -rf ~/.poligome-sam</code></td>
                  </tr>
                  <tr>
                    <th>Windows nativo</th>
                    <td><code>{String.raw`%USERPROFILE%\.poligome-sam`}</code><br /><code>{String.raw`rmdir /s /q "%USERPROFILE%\.poligome-sam"`}</code></td>
                  </tr>
                  <tr>
                    <th>Windows por WSL2</th>
                    <td>
                      A instalação mora dentro da distribuição: <code>~/.poligome-sam</code>, apagada de lá com{" "}
                      <code>wsl rm -rf ~/.poligome-sam</code>. No Windows sobra só o atalho do iniciador em{" "}
                      <code>%LOCALAPPDATA%\PoligomeSAM</code>.
                    </td>
                  </tr>
                </tbody>
              </table>
              <p>
                No Linux, se você tiver instalado o serviço de usuário, desligue-o antes com{" "}
                <code>poligome-sam-service-linux.sh uninstall</code>. Os contêineres do BYOM são seus e continuam no
                Docker: <code>docker rm -f</code> e <code>docker rmi</code> cuidam deles.
              </p>
            </details>
          </section>

          <section className={`sam-runtime-status ${loadError ? "error" : connectionState} ${!loadError && connectionState === "ready" && !modelMatches ? "mismatch" : ""}`}>
            <span />
            <div>
              <b>{loadError ? "A troca de modelo não foi aceita" : statusLabel(connectionState, modelMatches)}</b>
              {loadError && <small>{loadError}</small>}
              {runtimeLabel && <small>{loadError ? `O conector segue no ar com ${runtimeLabel}.` : runtimeLabel}</small>}
              {/* A dica sobre CUDA só serve quando o modelo existe e quebrou ao
                  carregar. Para um modelo que nem foi baixado ela mandava o
                  usuário investigar a placa de vídeo sem motivo. */}
              {!loadError && connectionState === "error" && <small>Revise o checkpoint, a versão do CUDA e as dependências; depois reinicie o conector.</small>}
              {!loadError && connectionState === "ready" && !modelMatches && <small>Clique em “Carregar este modelo” para trocar o conector para <code>{model.id}</code>, sem reiniciar nada à mão.</small>}
              {/* Duas instalações disputam a mesma porta 7860 e só uma atende.
                  Sem esta linha, quem instalou nos dois caminhos via a lista do
                  outro e concluía que o registro tinha sumido. */}
              {connectorHost && <small className="sam-connector-origin">
                Atendendo de <b>{connectorHost.host}</b>{connectorHost.appDir ? <> · <code>{connectorHost.appDir}</code></> : null}
              </small>}
            </div>
          </section>

          <details className="sam-advanced">
            <summary>Configuração avançada</summary>
            <label>Endereço local<input type="url" value={endpoint} placeholder="http://127.0.0.1:7860/predict" onChange={(event) => onEndpointChange(event.target.value)} /></label>
            <div className="sam-official-links"><a href={model.officialSources.repository} target="_blank" rel="noreferrer"><ExternalLink size={12} />Repositório oficial</a><a href={model.officialSources.checkpoint} target="_blank" rel="noreferrer"><ExternalLink size={12} />Checkpoint oficial</a></div>
          </details>

          <section className="sam-privacy"><ShieldCheck size={16} /><div><b>Inferência local</b><p>Imagens e prompts ficam no computador. No SAM 3, a autenticação Hugging Face é usada somente pelo instalador local para obter o checkpoint.</p></div></section>
          </>}
        </div>
      </div>

      <footer>
        {/* O bloco de estado detalhado mora no fim da ficha do modelo, fora da
            tela na primeira abertura, e some nas abas do BYOM. Sem este resumo,
            apertar o botão principal com o conector parado não mudava nada que o
            usuário pudesse ver. */}
        <span className={`sam-footer-status ${loadError ? "error" : connectionState}`} aria-live="polite">
          <em />
          <span>
            <b>{loadError ? "A troca de modelo não foi aceita" : statusLabel(connectionState, modelMatches)}</b>
            {loadError ? <small>{loadError}</small> : runtimeLabel ? <small>{runtimeLabel}</small> : null}
            {!loadError && connectionState === "offline" && <small>Instale ou inicie o conector; o painel de instalação está nesta tela, em “Instalar o modelo selecionado”.</small>}
          </span>
        </span>
        <button onClick={onClose}>Fechar</button>
        {anyModelSelected && <button
          className="unselect-all"
          title="Deixa de usar SAM e BYOM para anotar. Nada é desinstalado nem sai da lista."
          onClick={() => { setByomView(null); onUnselectAll(); }}
        >
          <PowerOff size={14} />Desselecionar todos
        </button>}
        {showFooterAction && (byomView === "model" && selectedByomModel
          ? <button
              className="connect"
              disabled={!selectedByomModel.ready}
              title={selectedByomModel.ready ? undefined : "O contêiner deste BYOM está parado."}
              onClick={() => { onSelectByomModel(selectedByomModel.model_id); onClose(); }}
            >
              <Boxes size={15} />
              {byomModelId === selectedByomModel.model_id ? "Usar este modelo" : "Selecionar este modelo"}
            </button>
          : <button className="connect" disabled={connectionState === "checking" || connectionState === "loading"} onClick={onConnect}>
          {connectionState === "checking" || connectionState === "loading" ? <Gauge className="spin" size={15} /> : <Link2 size={15} />}
          {connectionState === "loading"
            ? "Carregando modelo…"
            : modelMatches
              ? "Usar este modelo"
              : connectionState === "ready"
                ? "Carregar este modelo"
                : "Verificar e usar"}
        </button>)}
      </footer>
    </section>
  </div>;
}
