"use client";

import { useState } from "react";
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

type Props = {
  /** O painel é escrito em português; o idioma vale para o que vem do i18n. */
  language?: Language;
  selectedModelId: string;
  loadedModelId: string | null;
  connectionState: ConnectionState;
  /** Se o SAM carregado está sendo usado para anotar, e não apenas carregado. */
  samActive: boolean;
  runtimeLabel: string;
  endpoint: string;
  /** Modelos BYOM anunciados pelo conector; vazio quando não há contêiner registrado. */
  byomModels: readonly ByomModel[];
  /** Modelo BYOM escolhido para anotar, ou null quando o SAM é quem está em uso. */
  byomModelId: string | null;
  byomBusy: boolean;
  onSelectModel: (modelId: string) => void;
  onSelectByomModel: (modelId: string | null) => void;
  onRunByomModel: (modelId: string) => void;
  onRegisterByomModel: (entry: { modelId: string; name: string; port: number; notes?: string }) => void;
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
      "Os três botões de Arquivos do BYOM, logo acima, trazem a CLI, o Dockerfile e o serve.py. O serve.py já implementa o contrato inteiro — /ping, /invocations e a serialização COCO — então o que sobra para você é a função predict(). Rode os comandos seguintes na pasta onde os arquivos caíram.",
    command: "cd ~/Downloads   # a pasta em que o navegador salvou os três arquivos",
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
    command: "bash poligome-byom-macos-linux.sh register --model-id byom-meu-modelo --image meu-modelo --name \"Meu modelo\" --port 8080 --env METHOD=otsu",
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
          SAM segmenta o que você clica, o BYOM anota a imagem inteira, e as máscaras de um não alteram nem
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
  onSave: (entry: { modelId: string; name: string; port: number; notes: string }) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(model.name);
  const [port, setPort] = useState(String(Number(model.endpoint.split(":").at(-1)) || 8080));
  const [notes, setNotes] = useState(model.notes);
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
          onClick={() => { onSave({ modelId: model.model_id, name: name.trim(), port: portNumber, notes: notes.trim() }); setEditing(false); }}
        >
          <Check size={13} />Salvar
        </button>
      </div>
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
  onRegister: (entry: { modelId: string; name: string; port: number; notes?: string }) => void;
}) {
  const [draftId, setDraftId] = useState("byom-");
  const [draftName, setDraftName] = useState("");
  const [draftPort, setDraftPort] = useState("8080");
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
        <b>No Windows, tudo isso vive dentro do WSL2</b>
        <p>
          Não há <code>.bat</code> para o BYOM porque não é preciso: o conector já roda no WSL2. A CLI é a mesma,
          chamada de lá, e o registro fica no home da distribuição, não em <code>C:\Users</code>. O Docker precisa
          responder de dentro dessa distribuição — pela integração WSL do Docker Desktop ou por um Docker instalado
          nela.
        </p>
        <code>{"wsl bash poligome-byom-macos-linux.sh list"}</code>
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
        <a className="primary" href="/poligome-byom-macos-linux.sh" download><Download size={15} /><span><strong>CLI do BYOM</strong><small>register · start · status · logs</small></span></a>
        <a href="/byom/Dockerfile" download><Download size={15} /><span><strong>Dockerfile de exemplo</strong><small>python:3.12-slim, porta 8080</small></span></a>
        <a href="/byom/serve.py" download><Download size={15} /><span><strong>serve.py de exemplo</strong><small>/ping e /invocations prontos</small></span></a>
      </div>
      <code>bash poligome-byom-macos-linux.sh --help</code>
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
          disabled={!canRegister}
          onClick={() => {
            onRegister({ modelId: draftId.trim().toLowerCase(), name: draftName.trim(), port: portNumber });
            setDraftId("byom-"); setDraftName("");
          }}
        >
          <Plus size={14} />Importar
        </button>
      </div>
      {!canRegister && draftId.trim() !== "byom-" && <p className="byom-reason">O identificador precisa começar com <code>byom-</code> e usar apenas letras minúsculas, números, ponto, hífen ou sublinhado.</p>}

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
  const selectedByomModel = byomModels.find((candidate) => candidate.model_id === byomModelId) ?? null;
  // Só o tutorial não tem o que confirmar: é texto. Um modelo, BYOM ou SAM,
  // sempre oferece o botão de usar no canto do rodapé.
  const showFooterAction = byomView !== "docs" && byomView !== "how";
  const model = getSamModel(selectedModelId) ?? SAM_MODELS[0];
  const benchmark = benchmarkSummary(model);
  const modelMatches = connectionState === "ready" && loadedModelId === model.id;
  const pythonNotes = "notes" in model.requirements.python ? model.requirements.python.notes : null;
  const cudaTested = "tested" in model.requirements.cuda ? model.requirements.cuda.tested : null;
  const activeCapabilities = Object.entries(model.capabilities)
    .filter(([, enabled]) => enabled)
    .map(([capability]) => capabilityLabels[capability as keyof typeof capabilityLabels]);
  const unixCommand = `bash poligome-sam-macos-linux.sh ${model.id}`;
  const windowsCommand = `poligome-sam-windows.bat ${model.id}`;
  const nativeWindowsCommand = `poligome-sam-windows-native.ps1 ${model.id}`;
  const windowsPlatformLabel = "Windows · WSL2";
  const unixPlatformLabel = model.family === "sam3"
    ? "Linux · NVIDIA CUDA"
    : "Linux · macOS (Apple Silicon) · WSL2";

  return <div className="modal-backdrop sam-catalog-backdrop">
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
                  sem essa distinção não dá para ver que SAM e BYOM estão ativos juntos. */}
              {candidate.id === loadedModelId && connectionState === "ready" && samActive
                ? <em className="in-use">em uso</em>
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
            onRun={onRunByomModel}
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

          <section className="sam-capabilities">
            <h4>Capacidades do modelo upstream</h4>
            <div>{activeCapabilities.map((capability) => <span key={capability}><Check size={11} />{capability}</span>)}</div>
            <p><b>Integrado agora:</b> pontos positivos/negativos e caixas em todos os modelos; texto e múltiplas instâncias no SAM 3. Vídeo, máscara anterior, geração automática e exemplares combinados ainda não fazem parte deste editor.</p>
            {model.capabilities.videoSegmentation && <p>O modelo suporta vídeo, mas esta versão do editor integra apenas imagens. Timeline e tracking entrarão em uma etapa própria.</p>}
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
            <div><b>Instalar o modelo selecionado</b><p>O instalador cria um ambiente separado por família e baixa apenas o checkpoint escolhido.</p></div>
            <div className="sam-install-actions">
              <a className="primary" href="/poligome-sam-macos-linux.sh" download><Download size={15} /><span><strong>{unixPlatformLabel}</strong><small>{unixCommand}</small></span></a>
              <a className={model.family === "sam3" ? "limited" : ""} href="/poligome-sam-windows.bat" download><Download size={15} /><span><strong>{windowsPlatformLabel}</strong><small>{windowsCommand}</small></span></a>
              <a href="/poligome-sam-windows-native.ps1" download><Download size={15} /><span><strong>Windows nativo · sem WSL2</strong><small>{nativeWindowsCommand}</small></span></a>
            </div>
            <code>{unixCommand}</code>
            <p className="sam-manual-note">O conector é um processo local e precisa estar rodando sempre que você usar IA: fechar o terminal ou reiniciar o computador o derruba, e o editor consegue encontrá-lo sozinho, nunca ligá-lo. No Linux, <code>poligome-sam-service-linux.sh install</code> o sobe no login e dispensa esse passo.</p>
            <div className="sam-launch-actions"><span>Já instalado?</span><a href="/poligome-sam-start-macos-linux.sh" download>Baixar iniciador {unixPlatformLabel}</a><a href="/poligome-sam-start-windows.bat" download>Baixar iniciador {windowsPlatformLabel}</a></div>
            <p className="sam-manual-note">
              {model.family === "sam3"
                ? <>O SAM 3 só roda em GPU NVIDIA: o conector recusa CPU e Metal para esta família.</>
                : <>Sem GPU, o modelo roda em CPU sozinho. Se a sua GPU for reconhecida mas não aguentar o modelo, force a escolha com <code>POLIGOME_DEVICE=cpu</code> antes do instalador ou do iniciador.</>}
            </p>
            <p className="sam-platform-note"><b>Linux:</b> {model.platformSupport.linux.notes} <b>Windows:</b> {model.platformSupport.windows.notes} <b>macOS:</b> {model.platformSupport.macos.notes}</p>
          </section>

          <section className={`sam-runtime-status ${connectionState} ${connectionState === "ready" && !modelMatches ? "mismatch" : ""}`}>
            <span />
            <div><b>{statusLabel(connectionState, modelMatches)}</b>{runtimeLabel && <small>{runtimeLabel}</small>}{connectionState === "error" && <small>Revise o checkpoint, a versão do CUDA e as dependências; depois reinicie o conector.</small>}{connectionState === "ready" && !modelMatches && <small>Clique em “Carregar este modelo” para trocar o conector para <code>{model.id}</code>, sem reiniciar nada à mão.</small>}</div>
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
