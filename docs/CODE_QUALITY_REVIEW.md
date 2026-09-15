# Revisão de código — boas práticas, clean code e otimizações

Revisão estática completa de `app/`, `tests/`, `scripts/` e da configuração do
projeto. Escrita originalmente sobre `e816c74` e **revalidada contra o `main`
em `6b7304f`** (após o PR #14). As duas divergências que o PR #14 introduziu
estão registradas em **E1** (já resolvido) e **E7** (novo achado).

Este documento levanta o que encontrei, com arquivo e linha, o impacto e a
correção sugerida. Cada item traz uma nota de risco de mudança de comportamento.

## Estado em 2026-09-15

Parte do plano já foi executada. Os itens abaixo estão marcados no corpo do
documento; o resto continua valendo como escrito.

| PR | O que entrou | Itens fechados |
|---|---|---|
| **#15** | memoização, código morto, lockfile | F1, F2, F3, F4, F5, F6, F7, B2, B3, B4 (parte) |
| **#16** | os três que mudam comportamento | E2, E3, E5 (parte), D4 |
| **Onda 2** | camadas de teste, guardas em lint, CI em tiers | G1a, G1b, G2, G3, G4, G5 |

`main` passou de 209 para 318 testes. A **Onda 2 está concluída**: as asserções
sobre texto-fonte foram substituídas por testes que renderizam os componentes,
as guardas de arquitetura viraram regras de ESLint, e o que ainda precisa olhar
o código-fonte passa por `tests/helpers/source.mjs`, que normaliza espaços em
branco — rodar um formatador nos dois arquivos gigantes não quebra mais o CI.
A **Onda 3** (A1/A4, quebrar `canonical-editor-workbench.tsx` e
`pre-refactor-chrome.tsx`) é o próximo passo, e agora está destravada.

## Sumário executivo

O código está, em geral, acima da média: sem `any`, sem `@ts-ignore`, sem
`eslint-disable`, praticamente sem `console`, `strict` ligado, modelos puros
(`panel-model.ts`, `editor-state.ts`, `tile-plan.ts`) bem separados da UI e um
espaço canônico de coordenadas bem definido e documentado.

Os problemas concentram-se em quatro frentes:

1. **Sedimentação dos refactors anteriores.** Nomes de módulos e de CSS guardam
   a história dos PRs (`pre-refactor-*`, `premerge-*`, `exact-pre-refactor-*`,
   `legacy-*`, `canonical-*`) em vez da responsabilidade. Junto vieram 1.237
   linhas de CSS morto (1.185 em oito módulos órfãos + 52 arrastadas por um
   componente que ninguém renderiza).
2. **Um componente-Deus.** `canonical-editor-workbench.tsx` tem 1.074 linhas,
   23 `useState`, 9 `useRef`, 6 `useEffect`, 8 `useCallback`, 6 `useMemo` e 54
   funções locais.
3. **Memoização anulada por um objeto literal.** `imageSize` é recriado a cada
   render do workbench e entra nas dependências de quase todo `useCallback` dos
   hooks de interação. Com isso a `memo` de `AnnotationLayer` nunca acerta e
   todas as anotações re-renderizam a cada `pointermove` e a cada scroll.
4. **Testes acoplados ao texto-fonte.** 26 dos 62 arquivos de teste fazem
   `fs.readFile` + regex sobre o código ou sobre a documentação. Eles quebram em
   refactors inofensivos e passam mesmo quando o comportamento quebra — o
   `VectorToolbar` morto é a prova disso.

A ordem de ataque está na seção **[Ordem de correção](#ordem-de-correção)**, no
fim do documento: 29 itens em 5 ondas, por risco crescente e dependência, mais
os que precisam de decisão antes de virar tarefa.

---

## A. Arquitetura e estrutura

### A1 — `canonical-editor-workbench.tsx` é um componente-Deus (1.074 linhas)

`app/editor/workbench/canonical-editor-workbench.tsx`

23 `useState`, 9 `useRef`, 6 `useEffect`, 8 `useCallback`, 6 `useMemo` e 54
funções locais. Ele acumula:
ciclo de vida do projeto, importação de imagens/COCO/raster, gerenciamento de
classes, visibilidade transitória, tutorial do demo, roteamento de ponteiro,
atalhos de teclado, operações vetoriais e a montagem de todas as props de chrome
e de painéis.

Sugestão — extrair hooks coesos, sem mudar a árvore renderizada:

| Hook | Responsabilidade | Origem aproximada |
|---|---|---|
| `useProjectSession` | assets, labels, `projectName`, `saveMode`, `sessionDirty`, object URLs, abrir/salvar/novo | linhas 216–400, 690–710 |
| `useDemoTutorial` | máquina de 5 passos do tutorial | 226–230, 253–335 |
| `useCanvasRouting` | `routePointerDown/Move/Up/Cancel` + pan com mouse | 786–870 |
| `useEditorShortcuts` | listener global de teclado | 712–742 |
| `buildChromeProps` | montagem do objeto `chromeProps` | 872–940 |

Risco de comportamento: **baixo**, é movimentação pura — desde que a ordem dos
hooks e os efeitos sejam preservados.

### A2 — Tutorial do demo embutido no workbench

O tutorial guiado (`demoTutorialStep`, `advanceDemoToEdit`, `advanceDemoToModel`,
`exploreDemoModels`, `exitDemoTutorial`, mais um `useEffect` que inspeciona
anotações) ocupa ~120 linhas do workbench para uma funcionalidade opcional de
onboarding. Deveria viver ao lado de `app/editor/demo/`.

### A3 — Acoplamento por `CustomEvent` global

Cinco pontos de comunicação entre componentes passam pelo `window`:

```
app/editor/workbench/canonical-editor-workbench.tsx:318,909  poligome:open-sam
app/editor/workbench/canonical-editor-workbench.tsx:932,933  poligome:open-images / open-right
app/editor/panels/editor-management-panels.tsx:84,85,87,88   poligome:open-images / open-right
app/editor/presentation/pre-refactor-chrome.tsx:42           poligome:open-sam
```

O workbench já passa ~30 props para `EditorManagementPanels`; abrir uma gaveta
por evento global é acoplamento invisível, com nomes de evento repetidos como
string literal em dois arquivos e sem tipagem. Sugestão: props (`imagesPanelOpen`
+ `onImagesPanelOpenChange`) ou um pequeno contexto. Se os eventos ficarem,
centralizar os nomes em um módulo de constantes tipadas.

### A4 — `pre-refactor-chrome.tsx` é ilegível

67 linhas físicas, **linha máxima de 4.521 caracteres**, várias declarações por
linha, JSX inteiro em uma linha só. Exemplo (linha 36):

```tsx
const [fileOpen, setFileOpen] = useState(false); const [editing, setEditing] = useState(false); const [draft, setDraft] = ...
```

Não é um arquivo pequeno: são 13 hooks e cinco superfícies (topbar, menu
Arquivo, toolbar, status, modais de preferências e SAM) comprimidas. Sugestão:
formatar e dividir em `EditorTopbar`, `FileMenu`, `EditorToolbar`,
`EditorStatusBar`, `PreferencesDialog`, `SamDialog`. Risco: **baixo** (formatação
e extração), mas veja G1 — há testes que fazem regex sobre este arquivo.

### A5 — Nomes que contam a história dos PRs, não a responsabilidade

`pre-refactor-chrome`, `pre-refactor-canonical.module.css`,
`pre-refactor-demo-tutorial`, `premerge-panel-refinement.module.css`,
`exact-pre-refactor-final.module.css`, `legacy-controls.module.css`,
`canonical-editor-workbench`. Depois do merge, "pre-refactor" e "premerge" não
significam nada para quem chega. Sugestão de renomeação: `editor-chrome`,
`editor-canonical.module.css`, `demo-tutorial`, `panel-refinements.module.css`,
`editor-workbench`.

### A6 — `editor-session-io.ts` é repasse puro

As três funções só encaminham para `project.ts` e `demo.ts` sem lógica própria.
É uma costura documentada (e verificada por
`tests/editor-architecture-boundaries.test.mjs`), então é defensável — mas vale
registrar que é uma camada sem valor além do nome.

### A7 — Documentação divergente do código

`docs/EDITOR_ARCHITECTURE.md` afirma duas coisas que não são mais verdade:

- linha 163: "`app/editor/vector/vector-toolbar.tsx` emits the corresponding
  commands" — o componente não é renderizado por ninguém (ver B1);
- seção "Interface structure": "`app/annotate/annotate-interface.module.css`
  para o frame da rota `/annotate`" — o arquivo não é importado por ninguém
  (ver B2).

---

## B. Código morto

### B1 — `VectorToolbar` nunca é renderizado

`app/editor/vector/vector-toolbar.tsx` (65 linhas) exporta `VectorToolbar`, que
não aparece em nenhum JSX. A barra vetorial real está dentro de
`pre-refactor-chrome.tsx`. O arquivo sobrevive porque dois testes leem o seu
texto-fonte (`tests/project-lifecycle-parity.test.mjs:7`,
`tests/editor-interface-structure.test.mjs:29`) e a documentação o cita.

Consequência em cascata: `app/editor/legacy-controls.module.css` (52 linhas) só
é importado por esse componente morto.

> **Não remover — decisão registrada.** Depois do PR #14 (ver E7),
> `VectorToolbar` passou a ser o único lugar do repositório que liga `onMerge` a
> um botão. O autor confirmou que a retirada do botão é temporária, então esse
> arquivo fica como referência de fiação até o merge voltar. Apagá-lo não muda
> nada em runtime, mas destrói essa referência. O mesmo vale para `onMerge` e
> `canMerge`, que por isso ficam fora da lista de exports mortos em B4.

### B2 — Oito CSS modules órfãos (1.185 linhas) — ✅ REMOVIDOS (#15)

Nenhum import em todo o repositório (verificado com busca em `app/`, `tests/`,
`scripts/`, `docs/`):

| Arquivo | Linhas |
|---|---|
| `app/annotate/annotate-interface.module.css` | 435 |
| `app/annotate/premerge-header-layout.module.css` | 289 |
| `app/annotate/premerge-tool-icons.module.css` | 136 |
| `app/annotate/premerge-header-icons.module.css` | 110 |
| `app/annotate/annotate-drawer-state.module.css` | 97 |
| `app/annotate/premerge-brand.module.css` | 63 |
| `app/annotate/premerge-final-polish.module.css` | 47 |
| `app/annotate/premerge-review-visibility.module.css` | 8 |

`annotate-interface` e `annotate-drawer-state` aparecem apenas dentro de uma
asserção negativa de teste (`assert.doesNotMatch(page, /annotate-interface…/)`)
e da documentação. Risco de remoção: **nenhum** para o runtime; ajustar o teste e
a doc junto.

### B3 — Modelo legado em `app/lib/types.ts` — ✅ REMOVIDO (#15)

```ts
export type Tool = "select" | "pan" | ... ;        // sem nenhum uso
export type Annotation = { ...; w?: number; h?: number; pts?: number[]; holes?: number[][] };
```

`Annotation` é exatamente o modelo plano que `docs/EDITOR_ARCHITECTURE.md`
declara removido ("no dependency on flat `pts` … or legacy `w/h` box fields").
Nenhum arquivo importa nenhum dos dois. Mantê-los convida a reintroduzir o
modelo antigo.

### B4 — Exports sem nenhum consumidor — ✅ REMOVIDOS (#15), menos os do merge

| Símbolo | Arquivo |
|---|---|
| `cloneAnnotation`, `annotationVertices`, `replaceAnnotationVertices` | `app/editor/models/annotation-model.ts` |
| `vertexById` | `app/editor/models/vertex-model.ts` |
| `createPolyline`, `createVerticesFromFlat` | `app/editor/models/annotation-factory.ts` |
| `isRasterSidecar` | `app/lib/georeference.ts` |

`verticesFromFlatPoints` e `flatPointsFromVertices` (`vertex-model.ts`) só têm
uso em `tests/vertex-model.test.mjs` e `tests/editor-layers.test.mjs` — ou seja,
são testes que testam código que o produto não usa.

**Não remover**: `app/lib/sam.ts` e `app/editor/models/model-output.ts` estão
dormentes por decisão registrada em `docs/EDITOR_ARCHITECTURE.md` (integração do
SAM vem de outro branch).

### B5 — Exports que deveriam ser privados

Usados apenas dentro do próprio arquivo: `clampImagePoint`
(`svg-image-space.ts`), `verticesToFlat` (`annotation-export.ts`),
`verticesBounds` (`annotation-geometry.ts`), `annotationPixelArea`
(`quality-review-model.ts`), `reorderItemById` e `nextLabelColor`
(`panel-model.ts`), `annotationIntersectsRect` (`selection-model.ts`),
`createVertices` (`annotation-factory.ts`), `RECORTE_LADO_MAX`,
`RECORTE_MP_MAX`, `medeFaixa` (`cog.ts`). Reduzir a superfície pública deixa
claro o que é contrato e o que é detalhe.

### B6 — Restos do template inicial

- `app/chatgpt-auth.ts` — 4 exports, zero importadores.
- `db/index.ts` + `db/schema.ts` (schema "intentionally empty") + `drizzle.config.ts`.
- `drizzle-orm` está em **`dependencies`** (não `devDependencies`) e nenhum
  módulo de `app/` o importa.
- `examples/`, `.openai/hosting.json`.
- `app/texto/page.tsx` — stub de 7 linhas com `<meta http-equiv="refresh">` e
  texto em português fixo, sem i18n. Se a rota deve existir, use
  `redirect()` do Next; se não, remova.

Isso contradiz o README, que descreve o produto como local-first sem backend.

---

## C. Duplicação (DRY)

### C1 — Fórmula do shoelace implementada quatro vezes

```
app/editor/geometry/vector-operations.ts:27   ringArea
app/editor/export/annotation-export.ts:10     polygonArea
app/editor/review/quality-review-model.ts:40  ringArea
app/lib/sam.ts:130                            polygonArea
```

Mesma matemática, quatro cópias. Uma única `ringArea` em `geometry/` atenderia
todas. Risco: **baixo** — as três primeiras são idênticas até no `Math.abs`.

### C2 — `downloadBlob` duplicado byte a byte

`app/lib/project.ts:33` e `app/editor/export/export-files.ts:8` são idênticos,
inclusive o `window.setTimeout(..., 1500)` mágico. Extrair para
`app/lib/download.ts`.

### C3 — Helpers de nome/tamanho duplicados

- `safeSize` idêntico em `app/lib/editor-viewport.ts:5` e
  `app/editor/viewport/svg-image-space.ts:3`.
- `safeBaseName` existe em `project.ts:47` e `export-files.ts:22` com
  **implementações diferentes** sob o mesmo nome (uma normaliza NFD e
  minusculiza, a outra não) — armadilha clássica.
- `baseName` (`coco-document-import.ts:40`) e `normalizedName`
  (`image-assets.ts:30`) são a mesma função com nomes diferentes.

### C4 — `boxCorners` / `annotationBounds` duplicados com semântica divergente — ◐ PARCIAL (#16)

> A divergência de semântica acabou: `boxCorners` agora deriva de
> `boxCornerPoints`, fonte única. As cópias em `pre-refactor-demo-tutorial.tsx`
> continuam lá e agora podem ser deduplicadas sem mudar comportamento.


`app/editor/demo/pre-refactor-demo-tutorial.tsx:56,74` reimplementa ambos. A
versão do demo **considera a rotação da caixa**; a canônica
(`annotation-geometry.ts:19`) **não**. Ver E2.

### C5 — `BrandLockup`

Duplicado em `app/page.tsx:9` e `app/editor/presentation/pre-refactor-chrome.tsx:23`
(só muda a altura padrão, 34 vs 30).

### C6 — Paleta de cores duplicada

`IMPORT_COLORS` (`coco-document-import.ts:36`) é exatamente os 8 primeiros
valores de `PALETTE` (`panel-model.ts:59`).

### C7 — `Math.min(...xs)` para bounding box em quatro lugares

`annotation-geometry.ts:13`, `annotation-export.ts:47`,
`pre-refactor-demo-tutorial.tsx:78,84`, `canonical-editor-workbench.tsx:645`.
Além de duplicado, o spread tem limite de argumentos (ver E5).

---

## D. Consistência e convenções

### D1 — Identificadores em português no meio de um código em inglês

`app/lib/cog.ts` e `app/lib/sam.ts` usam português:
`RECORTE_LADO_MAX`, `RECORTE_MP_MAX`, `JanelaRaster`, `MetadadosCog`,
`SessaoRaster`, `assinaturaTiff`, `primeirosBytes`, `ehArquivoTiff`,
`leMetadados`, `medeFaixa`, `largura`, `altura`, `origemX`, `escalaX`,
`semDado`, `perfil`, `SAM_LADO_MAX`, `ImagemParaSam`, `carregaImagem`.

E isso **vaza para a camada canônica do editor**:

```ts
app/editor/raster/tiled-raster-asset.ts:17   geoReference(source, session.largura, session.altura, …)
app/editor/raster/cog-tiled-layer.tsx:7      import { leMetadados, …, type SessaoRaster } from "../../lib/cog";
app/editor/raster/cog-tiled-layer.tsx:137    const sourceWidth = asset.width ?? session.largura;
```

O resto do repositório (inclusive a UI, que já é traduzida por `i18n.ts`) é todo
em inglês. Renomear é puramente mecânico. Risco: **baixo**, mas mexe em muitos
arquivos — vale um PR isolado.

### D2 — Estilo de aspas e ausência de formatador

`app/lib/cog.ts`, `app/lib/georeference.ts` e `app/lib/projections.ts` usam
aspas simples; todo o resto usa duplas. O ESLint (`eslint.config.mjs`) só
estende `next/core-web-vitals` e `next/typescript` — nenhuma regra estilística e
nenhum Prettier. Daí virem as linhas de 4.500 caracteres do A4.

### D3 — Números mágicos

| Valor | Ocorrências | Significado |
|---|---|---|
| `92` | 8× em `canonical-editor-workbench.tsx` (linhas 101, 219, 289, 305, 313, 478, 509, 929) | zoom de "ajustar à tela" |
| `24` | 4× em `editor-state.ts` (70, 238, 329, 342) | tamanho do histórico de undo |
| `#929a95` | 3× (`canonical-editor-workbench.tsx:51,127`, `editor-canvas.tsx:86`) | cor de fallback |
| `1500` | 2× (`project.ts:40`, `export-files.ts:15`) | atraso de limpeza do object URL |
| `1000 × 650` | `use-editor-viewport.ts:24`, `pre-refactor-demo-tutorial.tsx:52`, `canonical-editor-workbench.tsx:296`, `globals.css` (`aspect-ratio:1000/650`) | o espaço normalizado que a arquitetura declara removido |
| `13, 4, 22, 28, 20, 4.6` | `canonical-editor-workbench.tsx:130, 636, 641, 755–760` | raios de handle em px de tela |

Extrair para constantes nomeadas (`FIT_ZOOM = 92`, `HISTORY_LIMIT = 24`,
`FALLBACK_LABEL_COLOR`, `OBJECT_URL_RELEASE_MS`, `HANDLE_SIZES`).

### D4 — GeoJSON exporta propriedades em português — ✅ RENOMEADO (#16)

> **Decisão do autor (2026-09-15):** as chaves foram para o inglês, contra a
> recomendação registrada abaixo. Está feito, com o de-para documentado em
> `docs/RASTER_WORKFLOW.md`, justificativa no golden e aviso de breaking change
> no commit. O texto original fica como registro do trade-off avaliado.
>
> Correção ao texto abaixo: ele fala em inconsistência com COCO e YOLO, e não
> existia uma. As chaves do COCO são ditadas pela especificação e o YOLO não tem
> chave nenhuma — o GeoJSON era o único dos três com propriedades livres.


`app/editor/export/export-files.ts:128-137` grava `classe`, `classe_id`, `cor`,
`forma`, `rotacao`, `recorte`, `origem` — enquanto COCO e YOLO usam nomes em
inglês. É um **contrato de dados público**: mudar quebra consumidores
existentes. Recomendação: não mudar agora; documentar em
`docs/RASTER_WORKFLOW.md` e, se for padronizar, fazê-lo com versionamento
explícito.

### D5 — Três convenções de erro coexistindo

1. `app/lib/project.ts` lança **mensagens já traduzidas** (`copy.errProjectFormat`).
2. `app/lib/cog.ts` lança **códigos** (`throw new Error('rasterRangeRequired')`),
   resolvidos por `translateErrorCode` (`app/lib/error-message.ts`).
3. `app/lib/sam.ts:38` lança uma frase crua em português
   (`"falha ao carregar a imagem"`), que nunca será traduzida.

O padrão (2) é o melhor e está documentado no próprio `error-message.ts`.
Uniformizar. Cuidado: `tests/export-error-localization.test.mjs` e
`tests/localized-error-message.test.mjs` cobrem esse comportamento.

### D6 — `i18n.ts`: 759 linhas, formatação inconsistente

95 linhas com mais de 200 caracteres; indentação mistura 0, 2 e 4 espaços
(compare as linhas 9–27 com a 36, que começa na coluna 0); comentários em
português e inglês no mesmo arquivo. Sugestão: um arquivo por idioma
(`app/lib/i18n/pt.ts`, `en.ts`, `fr.ts`, `es.ts`) com um barrel que preserve a
API atual (`getCopy`, `storedLanguage`, `fill`). Ver também F15.

### D7 — Estilo de laço

`app/editor/raster/tile-plan.ts:61,62` usa `row++`/`col++`; todo o resto usa
`index += 1`.

---

## E. Riscos de correção (levantados, não corrigidos)

### E1 — Bug de tradução: francês misturado com português — ✅ RESOLVIDO no `main`

`app/editor/presentation/pre-refactor-chrome.tsx:19`

```ts
// antes
fr: ["Sélectionnez l'outil Boîte", "Cliquez sur l'outil mis en évidence para começar."],
```

"para começar" era português. Corrigido em `82d2556` ("Move multi-selection to
mobile toolbar"), que entrou no `main` pelo PR #14 — ou seja, já estava
resolvido quando esta revisão foi escrita contra `e816c74`. Mantido aqui como
registro.

### E7 — A união de polígonos ficou sem porta de entrada na interface — ✅ DECISÃO CONFIRMADA

Encontrado ao verificar o PR #14 (`6b7304f`, já no `main`).

> **Confirmado pelo autor (2026-09-15):** o botão de união foi retirado de
> propósito, "por enquanto". Não é regressão. Como a remoção é declarada
> temporária, `VectorToolbar`, `onMerge` e `canMerge` **permanecem no código**
> como referência de fiação para quando o merge voltar — ver a ressalva em B1 e
> a exclusão de B4 abaixo.

O commit `82d2556` removeu o botão Merge da toolbar e reaproveitou o lugar — e o
mesmo ícone `Combine` — para o botão de seleção múltipla em touch:

```diff
-<ToolButton title={copy.merge} disabled={!props.canMerge} onClick={props.onMerge}><Combine size={18} /></ToolButton>
+{props.touchMode && <ToolButton title={copy.multipleSelection} ... ><Combine size={18} /></ToolButton>}
```

A remoção foi **deliberada** — o próprio PR diz "falha esperada porque a toolbar
ainda contém Merge" e o teste `mobile-toolbar-deduplication.test.mjs` passou a
exigir `assert.doesNotMatch(toolbar, /onClick=\{props\.onMerge\}/)`.

O efeito colateral é que, no `main` de hoje:

- `mergeSelected()` continua implementado (`canonical-editor-workbench.tsx:669`);
- `canMerge` continua sendo calculado (linha 894) e `onMerge` continua sendo
  passado (linha 914);
- `onMerge` sobrevive em `PreRefactorChromeProps` apenas como declaração de tipo
  — **nenhum elemento renderizado o chama**;
- o único componente que ainda liga `onMerge` a um botão é `VectorToolbar`, que
  não é montado em lugar nenhum (ver B1);
- não existe atalho de teclado para merge (`editor-shortcuts.ts` cobre
  V/H/B/P/F/L/K/O/X/R/T, sem merge).

Ou seja: `unionPolygonAnnotations` e toda a máquina de merge continuam no
código, cobertas por testes, mas **o usuário não tem como acionar a união de
polígonos**. `docs/EDITOR_ARCHITECTURE.md` ainda lista "union/merge" entre as
operações vetoriais avançadas restauradas.

Isso é decisão de produto, não de código: pode ser intencional (liberar espaço
na toolbar, com o merge voltando em outro lugar num próximo passo) ou um efeito
não percebido. **Precisa de uma decisão antes de qualquer limpeza** — enquanto
não houver, `VectorToolbar` não deve ser apagado (B1) e `onMerge`/`canMerge` não
devem entrar na lista de exports mortos (B4).

### E2 — `annotationBounds` ignora a rotação da caixa — ✅ CORRIGIDO (#16)

`app/editor/geometry/annotation-geometry.ts:19-24` devolve o retângulo
não rotacionado para `type === "box"`. Já `exportBounds`
(`annotation-export.ts:42`) rotaciona os cantos antes de calcular o AABB.

Efeito: a seleção por marquee (`annotationIntersectsRect` →
`annotationBounds`) usa uma caixa errada para caixas rotacionadas — a mesma
anotação tem dois "bounds" diferentes dependendo de quem pergunta. A versão do
tutorial do demo (C4) usa a semântica rotacionada, o que confirma a divergência.
Unificar muda comportamento de seleção, então precisa de teste dedicado antes.

### E3 — `MIN_VERTEX_DISTANCE` é um limiar fixo em pixels de imagem — ✅ CORRIGIDO (#16)

`app/editor/geometry/annotation-geometry.ts:5` — `= 10`, usado para rejeitar
vértices sobrepostos e arestas curtas. Todo o resto do editor converte limiares
de tela para unidades de imagem via `screenPixelsToImageUnits`. Consequência:
num raster de 40.000 px o limiar é invisível; numa miniatura de 200 px ele
bloqueia edições legítimas. Coerente com a disciplina de coordenadas seria
recebê-lo como parâmetro derivado do zoom.

### E4 — `localStorage` sem `try/catch`

`app/lib/i18n.ts:741,747` (leitura) e
`canonical-editor-workbench.tsx:207` / `pre-refactor-chrome.tsx:44` (escrita)
acessam `localStorage` sem proteção. `app/layout.tsx` faz isso **com** `try/catch`
e comenta explicitamente o motivo ("covers browsers that deny storage access").
Em Safari privado ou com armazenamento bloqueado, o acesso lança e derruba o
render.

### E5 — `Math.min(...array)` com vetor grande — ◐ PARCIAL (#16)

> `verticesBounds` e `exportBounds` passaram a usar varredura única. O padrão
> ainda existe em `canonical-editor-workbench.tsx:655-658`,
> `polygon-transform.ts:10-11`, `quality-review-model.ts:82-84`,
> `pre-refactor-demo-tutorial.tsx:79-86` e `sam.ts:175`.


`annotation-geometry.ts:13-17`, `annotation-export.ts:46-48` e
`canonical-editor-workbench.tsx:645-650` usam spread sobre as coordenadas. Acima
de ~65 mil argumentos o motor lança `RangeError: too many arguments`. É
alcançável importando máscaras COCO densas. Trocar por um laço de uma passada
também elimina duas alocações de array por chamada.

### E6 — `rdp` recursivo com fatiamento

`vector-operations.ts:156-165` — recursão com `slice()` em cada nível.
Complexidade de alocação desnecessária e risco de estouro de pilha em polígonos
muito densos. Versão iterativa com índices (pilha explícita) resolve os dois.

---

## F. Performance

### F1 — O listener global de teclado é reinstalado a cada render — ✅ CORRIGIDO (#15)

`canonical-editor-workbench.tsx:712-742`

```ts
}, [activePolygon, advanced, asset, drawing, editor, interactions, labels, selectedIds, tool, vectorTool]);
```

`editor` (`useEditorState`), `drawing`, `advanced` e `interactions` devolvem um
**objeto literal novo a cada render**, e `selectedIds` é um array novo. O efeito
roda em todo render, ou seja: `removeEventListener` + `addEventListener` a cada
`pointermove` durante um arraste. Correção: guardar os handlers em um `ref`
atualizado por efeito e registrar o listener uma única vez (`[]`).

### F2 — A `memo` de `AnnotationLayer` nunca acerta — ✅ CORRIGIDO (#15)

`app/editor/layers/annotation-layer.tsx:41` envolve o componente em `memo` — a
única memoização de render do editor. Ela nunca acerta, por três motivos
encadeados:

**1. `imageSize` é um objeto literal novo a cada render.**

```ts
// canonical-editor-workbench.tsx:100
const imageSize = { width: asset?.width ?? 1, height: asset?.height ?? 1 };
```

Sem `useMemo`. Esse objeto é passado para `useCanvasInteractions`,
`useDrawingInteractions` e `useAdvancedVectorInteractions`, e entra nas
dependências de praticamente todos os `useCallback` desses hooks
(`use-canvas-interactions.ts:79, 91, 120, 165, ...`). Ou seja: `beginAnnotationDrag`,
`moveAnnotation`, `moveVertex`, `insertVertex`, `resizeMove`, `rotateStart`,
`transformMove`, `selectAtCanvas`, `moveCanvasSelection` e
`finishCanvasSelection` são **recriados a cada render**. Os `useCallback` ali
não estão memoizando nada.

**2. `selectedIds` também é recalculado inline** (`use-canvas-interactions.ts:51`):
vira um array novo sempre que não há seleção múltipla, e alimenta as
dependências de `beginAnnotationDrag`.

**3. Os ternários no JSX** (`canonical-editor-workbench.tsx:1022-1038`,
`selecting ? interactions.X : noopY`) criam mais uma camada de identidades
novas.

Resultado: **todas** as anotações da imagem ativa re-renderizam a cada
`pointermove`, a cada scroll do canvas e a cada mudança de mensagem de status.
Num projeto com centenas de polígonos, é o custo mais visível do editor.

Correção, em ordem de retorno: `useMemo` no `imageSize` (uma linha, resolve a
maior parte), `useMemo` no `selectedIds`, e agrupar os handlers num objeto
estável em vez dos ternários. `useEditorViewport` já faz a coisa certa ao
depender de `[image.height, image.width]` em vez do objeto — o mesmo cuidado
falta nos hooks de interação.

### F3 — `EditorCanvas` reconstrói Map e Set a cada render — ✅ CORRIGIDO (#15)

`app/editor/canvas/editor-canvas.tsx:60-62` — `new Map(props.labels.map(…))` e
`new Set(props.selectedIds)` em todo render, e o componente não é `memo`.

### F4 — Cursor SVG gerado por vértice, por render — ✅ CORRIGIDO (#15)

`app/editor/layers/vertex-handles.tsx:135` chama `vertexMoveCursor` dentro do
`map` dos vértices. Cada chamada monta uma string SVG e roda
`encodeURIComponent` sobre ela (`cursorSvg`, linha 27). Num polígono de 500
vértices são 500 data-URIs construídas **a cada render** — e, durante um arraste
de vértice, há um render por `pointermove`. Correção: `useMemo` sobre
`vertices` (as direções só mudam quando a geometria muda) ou cache por
`vertex.id` + posição dos vizinhos.

### F5 — Exportação COCO é O(anotações × (imagens + classes)) — ✅ CORRIGIDO (#15)

`app/editor/export/annotation-export.ts:52-53`

```ts
const imageIndex = assets.findIndex((asset) => asset.id === annotation.asset);
const categoryIndex = labels.findIndex((label) => label.id === annotation.label);
```

Isso roda **por anotação**. Com 50 mil anotações e 5 mil imagens são ~250
milhões de comparações, síncronas, na thread da UI. Correção: `buildCocoDocument`
(`export-files.ts:27`) monta dois `Map` uma vez e os passa adiante.

### F6 — Exportação YOLO filtra o array inteiro por imagem — ✅ CORRIGIDO (#15)

`export-files.ts:57-60` — `annotations.filter(...)` dentro do laço de imagens:
O(imagens × anotações). Agrupar por asset uma vez antes do laço.

### F7 — `rasterTransform` recalculado por anotação no GeoJSON — ✅ CORRIGIDO (#15)

`export-files.ts:105` chama `rasterTransform(geo)` dentro do `map` de
anotações, enquanto a projeção de CRS logo acima (linha 104) **é** cacheada num
`Map`. Inconsistência fácil de corrigir: cachear o transform por asset.

### F8 — `isValidRing` é O(n²) na thread da UI

`vector-operations.ts:71-85` testa todos os pares de arestas. É chamada em
`simplifyPolygonAnnotation`, `canAddPolygonHole`, `annotationsFromMultiPolygon`
(união e corte) e em cada candidato de `reshapePolygonAnnotation`. Para
polígonos com milhares de vértices (importações COCO) isso congela a interface.
Correção barata: rejeição prévia por AABB de cada par de arestas antes de chamar
`segmentIntersection`; correção completa: varredura por linha (sweep line).

### F9 — `snapPointToAnnotations` varre tudo duas vezes por `pointermove`

`vector-operations.ts:115-150` — primeira passada por todos os vértices de todas
as anotações visíveis, segunda passada por todas as arestas quando nenhum
vértice qualifica. Roda a cada movimento de ponteiro com snap ligado. Correção:
uma passada só (acumulando o melhor vértice e a melhor aresta) e, para datasets
densos, um grid espacial construído uma vez por gesto.

### F10 — Inversão da CTM repetida no mesmo evento

`app/editor/viewport/svg-image-space.ts:31` faz
`svg.getScreenCTM().inverse()` + `createSVGPoint()` a cada chamada. Durante um
arraste de vértice, `routePointerMove` (workbench:800) e `interactions.moveVertex`
→ `eventPoint` chamam a função **duas ou três vezes para o mesmo evento**.
Correção: calcular a matriz inversa uma vez por gesto (ou por evento) e
reaproveitar; `createSVGPoint` também está deprecado em favor de `DOMPoint`.

### F11 — `portableAssets` carrega todas as imagens em memória ao mesmo tempo

`app/lib/project.ts:125-142` — `Promise.all` sobre os assets, cada um fazendo
`fetch(src)` + `response.blob()`. O pico de memória é o dataset inteiro. Para um
app que se propõe a lidar com rasters grandes, vale limitar a concorrência
(2–4 por vez) ou transmitir direto para o JSZip.

### F12 — `cocoGeometryTypes` materializa anéis só para contar

`app/editor/import/coco-import.ts:132` chama
`coordinatesFromRing(ring, 1, 1).length >= 3`, alocando o array completo de
coordenadas apenas para testar o tamanho. Num planejamento de importação com
milhares de máscaras isso dobra o custo. Basta validar `length % 2 === 0 &&
length >= 6`.

### F13 — Painéis com trabalho O(n·m) por render

`app/editor/panels/editor-management-panels.tsx:113`

```ts
const activeSelectedIds = selectedIds.filter((id) => activeAssetAnnotations.some((a) => a.id === id));
```

O mesmo padrão aparece no `useEffect` da linha 99. E `toggleAllAnnotations`
(linha 156) dispara N chamadas separadas a `onToggleAnnotationVisibility`, cada
uma reconstruindo o `Set` inteiro — O(n²) de alocação para "ocultar todas".
Correção: `Set` para os lookups e uma ação em lote para o toggle.

### F14 — Reducer com varreduras redundantes

- `editor-state.ts:175` — `selectIds.filter(id => annotations.some(...))` é
  O(n·m); um `Set` dos ids resolve.
- `editor-state.ts:308-312` — `findIndex` seguido de um `map` completo; com o
  índice em mãos, dá para copiar e substituir em uma posição.

### F15 — Os quatro idiomas vão para o cliente sempre

`app/lib/i18n.ts` exporta um `Record<Language, …>` com ~180 chaves × 4 idiomas
num único módulo estático. Todo usuário baixa as quatro traduções. Dividir por
idioma (D6) e carregar sob demanda cortaria ~75% desse payload — mas isso torna
`getCopy` assíncrono, então é uma mudança maior, só vale a pena com medição.

### F16 — `ViewportController` aloca estados intermediários

`viewport-controller.ts:57-72` — `setViewport`, `setImage` e `setZoom` fazem
três spreads sequenciais de `this.state` cada um. Calcular o próximo estado uma
vez e atribuir uma vez é mais barato e mais legível.

---

## G. Testes e CI

### G1 — 26 dos 62 arquivos de teste testam o texto-fonte, não o comportamento

Arquivos que fazem `fs.readFile` + `assert.match` sobre código:

```
annotation-import-control, application-parity-docs, basic-annotation-layers,
canonical-workbench-i18n, canvas-interactions, default-stroke, demo-route,
destructive-panel-confirmations, dormant-module-policy,
editor-architecture-boundaries, editor-canvas, editor-interface-structure,
editor-layers, editor-preferences, editor-session-io, editor-viewport,
editor-visual-parity, export-error-localization, mobile-toolbar-deduplication,
no-normalized-editor-space, project-image-relink, project-lifecycle-parity,
project-save-mode-ui, raster-import-control, snap-wiring,
touch-navigation-canonical
```

Exemplo (`editor-interface-structure.test.mjs:19`):

```js
assert.match(chrome, /className="topbar"/);
```

Isso falha se alguém trocar a classe por um CSS module, e passa se a topbar
parar de funcionar. É o padrão "change-detector test": cria atrito em refactors
legítimos sem detectar regressão real. A prova está em B1 — dois testes protegem
um componente que ninguém renderiza.

Alguns desses testes são **guardas de arquitetura legítimos** (proibir imports
cruzados, proibir `window.` em módulos puros): esses podem virar regras de
ESLint (`no-restricted-imports`) ou `dependency-cruiser`, que é onde essa
verificação pertence. O resto deveria virar teste de comportamento sobre a
função exportada.

### G2 — Três testes fazem asserção sobre prosa da documentação

`dormant-module-policy.test.mjs` verifica que `EDITOR_ARCHITECTURE.md` contém a
frase "must therefore not be deleted as orphaned legacy";
`application-parity-docs.test.mjs` e `editor-interface-structure.test.mjs` fazem
o mesmo com README e a doc de arquitetura. São travas de documentação, não
testes — e, como A7 mostra, elas não impedem a doc de ficar desatualizada onde
a regex não olha.

### G3 — `playwright` é uma dependência não declarada

Oito scripts (~1.400 linhas) importam `playwright`:

```
scripts/{demo-entry,editor-interaction,editor-advanced-interaction,image-reorder,
mobile-command-interaction,mobile-full-interaction,mobile-restored-demo-state,
mobile-toolbar-layout}-audit.mjs
```

Ele não está no `package.json`. O CI instala com
`npm install --no-save playwright@1.55.0`
(`.github/workflows/editor-interaction-audit.yml:27`), ou seja: versão fixada
numa string de YAML, fora do lockfile, e os audits não rodam localmente.
`CONTRIBUTING.md` manda rodar `npm run lint && npm test` e não menciona os
audits. Correção: declarar `@playwright/test` em `devDependencies` e adicionar
um script `npm run audit`.

### G4 — Sem `typecheck`, sem cobertura, ciclo lento

`npm test` roda `npm run build` antes dos testes (`package.json:15`), então
qualquer execução de teste unitário paga um build completo do Vinext. Não há
script `typecheck` (o `tsc` só roda dentro do build) nem coleta de cobertura
(`node --test --experimental-test-coverage` já resolveria).

### G5 — Gatilhos de CI apontando para branches antigos

`.github/workflows/editor-refactor.yml:4-8` ainda dispara em
`refactor/editor-architecture` e `fix/cloudflare-next-build`.

---

## H. Ferramental

### H3 — O lockfile fixava tarballs num mirror de terceiros — ✅ CORRIGIDO (#15)

22 das 752 entradas `resolved` do `package-lock.json` apontavam para
`registry.npmmirror.com`, que entrou junto com as árvores de `ol` e `geotiff`:
`ol`, `geotiff/pako`, `rbush`, `pbf`, `earcut`, `numcodecs`, `zarrita`,
`zstddec` e companhia.

Além do problema de reprodutibilidade e de cadeia de suprimentos — o projeto
buscava bytes de um espelho que ninguém escolheu conscientemente — isso
inviabilizava o `npm ci` em qualquer rede que só libere o registro oficial. Foi
exatamente o que travou a validação desta revisão por três tentativas.

Só as URLs mudaram; nenhum `integrity` foi tocado, então cada tarball continua
sendo verificado contra o mesmo sha512. A instalação é a prova: 565 pacotes
resolvidos do registro oficial contra hashes inalterados.

### H1 — ESLint mínimo demais para o tamanho do código

`eslint.config.mjs` só estende `next/core-web-vitals` e `next/typescript`. Nada
impede os problemas encontrados aqui. Sugestões de baixo atrito:

- `@typescript-eslint/no-unused-vars` com `argsIgnorePattern: "^_"` (hoje o
  código usa `void local;` em `project.ts:134` para contornar isso);
- `max-lines` e `max-lines-per-function` como *warning* (pegaria A1 e A4);
- `no-restricted-imports` para as fronteiras de arquitetura (substitui metade
  do G1);
- `knip` ou `ts-prune` no CI para B4/B5 — os itens de código morto deste
  documento foram todos encontrados por varredura mecânica, dá para automatizar;
- Prettier (ou `eslint --fix` com regras estilísticas) para D2/D6/A4.

### H2 — `tsconfig`

`target: "ES2017"` (padrão do Next) com `engines: node >= 22.13` e um app
inteiramente moderno no browser — `async`/`await` e spread ainda são
transpilados sem necessidade. Subir para `ES2022` reduz bundle, **mas muda a
saída emitida**, então precisa de verificação visual e do build de Pages antes
de mudar.

Flags de rigor que valeriam a pena, todas com custo de migração:
`noUncheckedIndexedAccess` (o código já usa muito `array[i]` sem guarda — ver
`vector-operations.ts:ringArc`), `noImplicitOverride`, `noFallthroughCasesInSwitch`.

---

## Ordem de correção

A ordem abaixo não é por gravidade: é por **risco crescente e dependência**.
Cada onda só depende das anteriores, e cada item traz quem o protege hoje —
porque em 26 dos 62 arquivos de teste a proteção é uma regex sobre o
texto-fonte, e é isso que decide se uma correção é barata ou cara.

Legenda de esforço: **P** ≤ 1h · **M** meio dia · **G** ≥ 1 dia.

---

### Onda 0 — Fazer agora (baixo risco, ganho imediato) — ✅ CONCLUÍDA no PR #15

Nada aqui muda estrutura; tudo é verificável pelo suíte atual sem tocar em
nenhum teste.

| # | Item | Arquivo | Esforço | Como verificar |
|---|---|---|---|---|
| 1 | **F2 — `useMemo` no `imageSize`** | `canonical-editor-workbench.tsx:100` | **P** | Nenhum teste referencia `imageSize` no workbench (só `editor-canvas.test.mjs:11`, que olha outro arquivo). É a maior relação ganho/risco do documento: uma linha destrava a `memo` de `AnnotationLayer`. |
| 2 | ~~**E1 — tradução francesa quebrada**~~ | — | — | **Já corrigido no `main`** por `82d2556` (PR #14). Nada a fazer. |
| 3 | **F5/F6/F7 — exportações O(n·m)** | `annotation-export.ts:52-53`, `export-files.ts:57-60,105` | **M** | Coberto por testes **de comportamento** reais (`canonical-export-files`, `yolo-export`, `georeference-export`, `rotated-box`) **e** pelo golden cross-branch `scripts/check-export-parity.mjs`, que compara a saída contra a do `main`. É a área mais bem protegida do repositório: dá para otimizar com confiança. |
| 4 | **E4 — `try/catch` no `localStorage`** | `i18n.ts:741,747`, `canonical-editor-workbench.tsx:207`, `pre-refactor-chrome.tsx:44` | **P** | `app/layout.tsx:12` já tem o padrão pronto para copiar. Corrige crash em Safari privado. |
| 5 | **G5 — gatilhos de CI obsoletos** | `.github/workflows/editor-refactor.yml:4-8` | **P** | Remover `refactor/editor-architecture` e `fix/cloudflare-next-build`. |
| 6 | **G3 — declarar `playwright`** | `package.json`, `editor-interaction-audit.yml:27` | **P** | Mover para `devDependencies` com a versão do lockfile e adicionar `npm run audit`. Hoje 1.400 linhas de audit não rodam localmente. |

**Por que primeiro:** os itens 1 e 3 são os dois únicos ganhos de performance
grandes que não exigem refactor nenhum, e ambos estão fora do alcance das
regexes dos testes.

---

### Onda 1 — Limpeza (risco zero em runtime) — ◐ em boa parte feita no PR #15

Só remoção. Reduz em ~1.400 linhas o que a Onda 3 teria de refatorar.
Entraram os itens 7, 9, 10 e 12. Ficaram de fora o 8 (`VectorToolbar`, em espera
por E7) e o 11 (restos do template).

| # | Item | Esforço | Observação |
|---|---|---|---|
| 7 | **B2 — 8 CSS modules órfãos** (1.185 linhas) | **P** | Ajustar junto a asserção negativa em `editor-interface-structure.test.mjs:15` e a menção em `EDITOR_ARCHITECTURE.md` (**A7**). |
| 8 | **B1 — `VectorToolbar` + `legacy-controls.module.css`** (117 linhas) | **P** | Exige editar `project-lifecycle-parity.test.mjs:7,26-27` e `editor-interface-structure.test.mjs:29` — os dois testes que hoje protegem código morto. Substituir por asserção sobre a toolbar real em `pre-refactor-chrome.tsx`. |
| 9 | **B3 — tipos `Annotation` e `Tool` legados** | **P** | Zero importadores. Contradizem a invariante documentada do modelo canônico. |
| 10 | **B4/B5 — exports mortos e exports que deveriam ser privados** | **P** | `verticesFromFlatPoints`/`flatPointsFromVertices` só têm uso em teste: decidir entre remover código + teste, ou assumir como API pública. |
| 11 | **B6 — restos do template** (`chatgpt-auth.ts`, `db/`, `drizzle.config.ts`, `drizzle-orm` em `dependencies`, `app/texto/page.tsx`) | **M** | Confirmar antes que o deploy Cloudflare não depende do binding D1. |
| 12 | **A7 — corrigir a documentação** | **P** | Fecha as duas divergências que os itens 7 e 8 expõem. |

---

### Onda 2 — Destravar os testes (pré-requisito da Onda 3) — ✅ CONCLUÍDA

Sem isto, qualquer refactor estrutural quebrava o CI **por motivo errado**.
Como foi feito:

- **13 (G1a)** — as guardas viraram regras em `eslint.config.mjs`
  (`no-restricted-imports` com `allowTypeImports`, `no-restricted-globals`,
  `no-restricted-syntax`). `tests/architecture-guards.test.mjs` alimenta o
  ESLint com código que quebra cada fronteira de propósito, para provar que a
  regra ainda dispara.
- **14 (G1b)** — 26 suítes de regex viraram quatro camadas: unitária,
  de componente (`react-dom/server`, com hooks de módulo que carregam CSS
  modules), de build e funcional (Playwright). O que sobrou de asserção sobre
  fonte passa por `tests/helpers/source.mjs`, que colapsa espaços em branco —
  e a própria guarda falha se algum teste voltar a ler `app/` direto.
- **15 (G2)** — `tests/repository-invariants.test.mjs` importa os módulos
  dormentes em vez de procurar frases no README.
- **16 (G4)** — `typecheck`, `test:unit`, `test:build`, `test:coverage` e
  `test:audit` separados; o CI virou dois jobs (estático e build) mais o de
  auditoria.

| # | Item | Esforço | Detalhe |
|---|---|---|---|
| 13 | **G1a — guardas de arquitetura viram lint** | **M** | `editor-architecture-boundaries.test.mjs` e `no-normalized-editor-space.test.mjs` verificam imports proibidos e uso de `window.`/`document.` em módulos puros. Isso é trabalho de `no-restricted-imports` no ESLint, e ali funciona melhor (roda no editor, não só no CI). |
| 14 | **G1b — asserções de formatação viram testes de comportamento** | **G** | As piores são as que fixam espaçamento literal, p. ex. `project-lifecycle-parity.test.mjs:14` exige `onRenameProject: (name: string) => { setProjectName(name); setSessionDirty(true); }` na mesma linha. Rodar um formatador no workbench quebra o CI hoje. |
| 15 | **G2 — travas de documentação** | **P** | `dormant-module-policy.test.mjs` e `application-parity-docs.test.mjs` fazem regex em prosa de README/doc. A intenção (proteger o SAM de limpeza) é legítima; o mecanismo não é teste. Um `CODEOWNERS` ou um comentário no topo dos arquivos resolve. |
| 16 | **G4 — script `typecheck` e ciclo rápido** | **P** | `npm test` roda `npm run build` antes (`package.json:15`). Separar `test:unit` sem build e adicionar `typecheck: tsc --noEmit`. |

**Arquivos mais travados hoje** (quantos testes fazem regex sobre eles):
`canonical-editor-workbench.tsx` — 10; `pre-refactor-chrome.tsx` — 6;
`use-editor-viewport.ts` — 3. Não por acaso, são exatamente os arquivos da
Onda 3.

---

### Onda 3 — Render e estrutura (o refactor de verdade)

| # | Item | Esforço | Detalhe |
|---|---|---|---|
| ~~17~~ | ~~**F1 — listener de teclado**~~ | — | ✅ feito no #15. |
| ~~18~~ | ~~**F3/F4 — `Map`/`Set` e cursor SVG**~~ | — | ✅ feito no #15. |
| 19 | **A4 — quebrar `pre-refactor-chrome.tsx`** | **G** | Formatar (linha de 4.521 caracteres) e dividir em 6 componentes. Depende do item 14. |
| 20 | **A1/A2 — extrair hooks do workbench** | **G** | `useProjectSession`, `useDemoTutorial`, `useCanvasRouting`, `useEditorShortcuts`. Depende do item 14. |
| 21 | **A3 — trocar `CustomEvent` global por props** | **M** | Fazer junto do item 20, enquanto a fronteira workbench↔painéis já está aberta. |
| 22 | **F8/F9/F10 — geometria e ponteiro** | **G** | `isValidRing` O(n²), `snapPointToAnnotations` em duas passadas, CTM invertida 2–3× por evento. Precisam de benchmark antes e depois; `scripts/benchmark-cog.mjs` serve de modelo. |

---

### Onda 4 — Consistência (muito arquivo, zero semântica)

Deixar por último de propósito: são os PRs que mais poluem o histórico e menos
mudam o produto. Fazer um item por PR, depois da Onda 2.

| # | Item | Esforço |
|---|---|---|
| 23 | **H1 — regras de ESLint** (`no-unused-vars`, `max-lines`, `no-restricted-imports`, `knip`/`ts-prune`, Prettier) | **M** |
| 24 | **C1–C7 — deduplicação** (`ringArea` ×4, `downloadBlob` ×2, `safeBaseName` divergente, `BrandLockup`, paletas) | **M** |
| 25 | **D3 — números mágicos** (`92` ×8, `24` ×4, `#929a95` ×3, `1000×650`) | **P** |
| 26 | **D1 — identificadores em português** em `cog.ts`/`sam.ts` e o vazamento para `app/editor/raster/` | **M** |
| 27 | **D5 — unificar o padrão de erro** em códigos + `translateErrorCode` | **M** |
| 28 | **D2/D6/D7 — aspas, `i18n.ts` por idioma, estilo de laço** | **M** |
| 29 | **A5 — renomear os módulos `pre-refactor-*`/`premerge-*`** | **P** |

---

### Precisa de decisão antes (não agendado)

| Item | Por quê |
|---|---|
| **E2 — `annotationBounds` ignora rotação** | Unificar com `exportBounds` **muda o comportamento da seleção por marquee** em caixas rotacionadas. Precisa decidir qual semântica é a correta e escrever o teste antes. |
| **E3 — `MIN_VERTEX_DISTANCE` fixo em pixels de imagem** | Torná-lo relativo ao zoom muda quando o editor aceita um vértice. É correção de design, não de bug. |
| **E5/E6 — `Math.min(...)` e `rdp` recursivo** | Limites teóricos (>65k vértices). Confirmar se é alcançável com dados reais antes de gastar tempo. |
| **F11 — concorrência no `portableAssets`** | Medir o pico de memória num projeto grande antes de limitar. |
| **F15 — i18n sob demanda** | Torna `getCopy` assíncrono. Só com medição de bundle. |
| **H2 — `target: ES2022`** | Muda a saída emitida; exige verificação visual e o build de Pages. |

### Fora de escopo por decisão registrada

- **D4** — nomes em português nas propriedades do GeoJSON: é contrato de dados
  público; mudar quebra consumidores. Documentar, não alterar.
- **`app/lib/sam.ts` e `app/editor/models/model-output.ts`** — dormentes por
  decisão em `docs/EDITOR_ARCHITECTURE.md`; a integração vem de outro branch.

---

### Resumo em uma linha

~~Comece pelo item 1 e pelo item 3~~ — feitos. **O próximo passo é a Onda 2:**
converter os testes de grep, porque são eles que hoje impedem quebrar os dois
arquivos gigantes. Um deles chega a exigir que uma arrow function inteira fique
na mesma linha, então até rodar um formatador falha o CI.
