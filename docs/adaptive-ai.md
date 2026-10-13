# Adaptive AI — SAM 2.1 + LoRA no seu computador

O Adaptive AI ajusta o SAM às imagens de um projeto a partir das máscaras que a
pessoa aprovou. O ajuste é um **adaptador LoRA**: um arquivo pequeno, aplicado
por cima do modelo carregado, que pode ser ligado, desligado e revertido sem
tocar no checkpoint original. Tudo roda no conector local; imagens e máscaras
não saem da máquina.

O ciclo é:

```
anotar → avaliar o dataset → treinar LoRA → validar → comparar
       → ativar (opcional) → anotar mais → reavaliar
```

Este documento explica o que foi implementado, por que cada decisão foi tomada
e o que ainda **não** foi validado.

---

## 1. Arquitetura

```
navegador (poligome.com)                         conector local (127.0.0.1:7860)
───────────────────────                          ───────────────────────────────
AdaptiveAiPanel ── adaptive-client ── HTTP ──▶  poligome-sam-local.py
  │  (aba "Adaptive AI" da central de IA)          │  /predict usa o modelo vivo
  └─ adaptive-dataset: o que é "aprovado"          │  + LoRA ativo (se houver)
                                                   └─ poligome-sam-adaptive.py
                                                      ├─ ProjectStore (disco)
                                                      ├─ prontidão e divisão
                                                      ├─ TrainingJob (thread)
                                                      ├─ comparação estatística
                                                      └─ ativação / reversão
```

| Peça | Arquivo | Papel |
| --- | --- | --- |
| Extensão do conector | `public/poligome-sam-adaptive.py` | LoRA, dados, treino, avaliação, rotas `/adaptive/*` |
| Ganchos no conector | `public/poligome-sam-local.py` | carrega a extensão se o arquivo estiver ao lado; reaplica o adaptador ao subir; anuncia o adaptador em `/predict` e `/health`; recusa `/load` durante um treino |
| Regras de aprovação | `app/lib/adaptive-dataset.ts` | classifica cada anotação, agrupa nomes em sequência, calcula fingerprints |
| Cliente | `app/lib/adaptive-client.ts` | API e sincronização incremental |
| Interface | `app/components/AdaptiveAiPanel.tsx` | a aba Adaptive AI |
| Textos | `app/lib/adaptive-copy.ts` | pt, en, fr, es |
| Identidade do projeto | `app/lib/project.ts` | `adaptive_project_id` no `.plgm` |

**Por que uma extensão separada?** O conector continua um arquivo único e
idêntico em comportamento quando a extensão não existe (ou com
`POLIGOME_ADAPTIVE=0`): nenhuma rota `/adaptive` é criada e `/predict` não
muda. Isso foi verificado contra um conector real. Os instaladores copiam o
arquivo ao lado do conector com pino SHA-256; uma falha nesse passo só avisa.

**Assincronia.** O treino roda numa thread do próprio conector, sobre uma
**cópia nova do modelo base** construída a partir do checkpoint. O modelo que
atende o editor não é tocado durante o treino, as segmentações continuam
funcionando e uma falha no treino não afeta o modelo em uso. Há no máximo uma
rodada por conector. A interface acompanha por polling (`GET .../runs/{id}`).

---

## 2. Modelos compatíveis

| Modelo | Adaptive AI |
| --- | --- |
| SAM 2.1 Tiny, Small, Base+, Large | sim |
| MedSAM2 (todas as variantes) | sim — são SAM 2.1 Tiny ajustados |
| SAM 3 | sim, **só cliques e caixas** — LoRA no mask decoder do modo interativo |
| BYOM (contêiner) | **não** |
| Poligome Runtime (nativo) | **não** |

**SAM 3.** Para pontos e caixas o SAM 3 usa um "modo interativo"
(`predict_inst`): o backbone de ~840 M de parâmetros produz um
`sam2_backbone_out`, e um `sam_prompt_encoder` + `sam_mask_decoder` no estilo do
SAM 2 transforma prompts em máscaras. O `Sam3Segmenter` reproduz esse caminho sem
`inference_mode`, e o LoRA entra nas 28 projeções de atenção desse decoder
(`inst_interactive_predictor.model.sam_mask_decoder…`). O backbone fica
congelado e **não é copiado**: o treino usa uma cópia só do preditor interativo
e o backbone do modelo vivo, sob o lock do preditor, o que poupa ~3,4 GB. A busca
por texto (conceitos) usa outro decoder e **não muda**; a interface diz isso.
LoRA no encoder do SAM 3 é recusado (`strategy_unsupported`): em CPU ele seria
inviável, e o ganho esperado não foi medido.

BYOM e Runtime são caixas-pretas que o conector não carrega. A extensão confere
a família do modelo e procura as camadas-alvo pelo nome; se não encontrar,
recusa (`unsupported_model`) em vez de presumir compatibilidade.

---

## 3. Onde entra o LoRA

### Camadas

| Estratégia | Camadas-alvo (SAM 2.1 Tiny) | Parâmetros treináveis |
| --- | --- | --- |
| `decoder` | `q/k/v/out_proj` de toda atenção do mask decoder (self-attention, token→imagem, imagem→token e atenção final) — 28 camadas | ≈ 0,24% |
| `encoder_decoder` | as 28 acima + `attn.qkv` e `attn.proj` dos **últimos 4 blocos** do encoder Hiera — 36 camadas | ≈ 0,52% (201.728 de 39,2 M) |
| `auto` (padrão) | `decoder` em CPU, `encoder_decoder` em GPU | — |

Todo o resto fica congelado (`requires_grad=False`): encoder de prompts,
cabeças de máscara e de IoU, MLPs, normalizações e os demais blocos do encoder.

### A decisão, e a alternativa que foi descartada

O pedido sugeria começar pelo encoder. A escolha final foi **decoder por
padrão, encoder opcional**, pelos seguintes motivos:

- **Custo.** Com o encoder congelado, as features de cada imagem são
  calculadas uma vez e guardadas; o treino só passa pelo decoder. Medido aqui
  (CPU de 4 núcleos, 14 imagens de treino): **≈ 12 s por época** no
  `decoder` contra **≈ 49 s** no `encoder_decoder`. Para quem usa o SAM em
  CPU — o caso comum do Poligome — isso decide se o recurso é usável.
- **Pouco dado.** Com 20–40 imagens, menos graus de liberdade reduzem o risco
  de decorar o treino.
- **Quando o encoder vale a pena.** Mudança de domínio forte (raio-X, SAR,
  microscopia) mora nas features da imagem, que o decoder não altera. Por isso
  o `encoder_decoder` existe e é o padrão em GPU. O ponto de corte (últimos 4
  blocos, os de atenção global do Hiera) adapta as features de mais alto nível
  sem pagar o backprop do encoder inteiro.

Com B inicializado em zero, o modelo adaptado é **idêntico ao base** antes do
primeiro passo — verificado em teste contra o `SAM2ImagePredictor` oficial
(diferença máxima < 1e-4 nos logits).

### Formulação

Cada camada linear `W` vira `y = W x + b + (α/r) · B A dropout(x)`, com
`A ∈ R^{r×in}` (Kaiming) e `B ∈ R^{out×r}` (zeros). Padrões: `r = 8`,
`α = 16`, dropout 0,05.

---

## 4. Armazenamento e versionamento

Tudo fica em `~/.poligome-sam/adaptive/` (dentro do WSL, no Windows via WSL):

```
adaptive/
  active.json                 adaptador ativo: projeto, rodada, modelo base, fingerprint
  fingerprints.json           sha256 dos checkpoints base (cache por tamanho e data)
  projects/<projeto>/
    project.json              sal do sorteio da divisão
    items/<chave>/            imagem enviada, máscaras PNG, item.json
    embeddings/<modelo>/      embedding agregado do SAM por imagem (cache)
    split.json                atribuição congelada treino/holdout
    snapshots/<snap>.json     o dataset exato de cada rodada (hashes, lados, grupos)
    history.jsonl             ativações, desativações, rejeições, reversões
    runs/<rodada>/
      run.json                registro completo (ver abaixo)
      metrics.jsonl           uma linha por época
      events.jsonl            log estruturado (preparo, OOM, early stop, falhas)
      adapter.pt              pesos LoRA da melhor época
      comparison.json         comparação no holdout
      example-NN.png          exemplos visuais
```

**`adapter.pt`** é um `torch.save` de um dicionário só com tensores e texto:
`format: "poligome-lora"`, `format_version: 1`, metadados em JSON (projeto,
rodada, modelo base e fingerprint, estratégia, rank, alpha, camadas-alvo,
melhor época) e os tensores `<camada>.lora_A/lora_B`. É lido com
`torch.load(weights_only=True)`, que recusa código serializado.

**`run.json`** contém: id e data da rodada, projeto, modelo base (id, família,
dispositivo, sha256 do checkpoint), configuração pedida e resolvida, LoRA
(estratégia, rank, alpha, camadas, parâmetros treináveis), snapshot e id do
holdout, tamanhos de treino / validação interna / holdout, métricas por época,
melhor época, diagnóstico, sha256 do adaptador, comparação, estado de ativação,
tempos e erro (se houver).

**Compatibilidade.** Ativar exige: rodada concluída, mesmo `model_id` **e**
mesmo sha256 do checkpoint base, sha256 do `adapter.pt` igual ao registrado,
metadados apontando para a mesma rodada e projeto, e formas de tensor batendo
camada a camada. Qualquer divergência é recusada com um código explícito
(`incompatible_base`, `adapter_corrupt`, `adapter_mismatch`).

**Isolamento.** Cada projeto Poligome ganha um id aleatório
(`p-<uuid>`), salvo no `.plgm` como `adaptive_project_id`. Ids, chaves de
imagem, ids de rodada e nomes de exemplo são validados por expressão regular
antes de virar caminho. As respostas da API não trazem caminhos locais. O
conector é um processo do usuário do sistema operacional; o isolamento entre
pessoas é o do próprio sistema (pastas de usuário diferentes).

---

## 5. O que conta como dado aprovado

O editor não tem um botão "aprovar"; a regra é explícita e aplicada duas vezes
(navegador e conector):

| Anotação | Entra no treino? | Origem registrada |
| --- | --- | --- |
| Polígono desenhado ou resultado do SAM salvo pela pessoa | sim | `manual` |
| Predição automática (Runtime/BYOM) editada | sim | `corrected_prediction` |
| Predição automática intacta com nota 4–5 | sim | `reviewed_prediction` |
| Predição automática intacta sem nota | **não** | — |
| Nota 1–2 na anotação ou na imagem | **não** | — |
| Caixa, linha, ponto | **não** (não é máscara) | — |
| Máscara < 16 px², imagem ausente, raster em mosaico (COG) | **não** | — |

O conector rasteriza os polígonos (com buracos) na resolução da imagem enviada
— a mesma que o SAM recebe no editor (lado máximo 1600 px) — e recusa de novo
qualquer origem fora das três aceitas. Anotação não precisa ser exaustiva: o
SAM é treinado por instância com um prompt, então objetos não anotados na mesma
imagem não viram "fundo" errado.

**Limitação conhecida:** um resultado do SAM aceito pela pessoa é indistinguível
de um polígono desenhado. Treinar em saídas aceitas do próprio SAM pode reforçar
vieses dele; o efeito é limitado porque a pessoa aceitou (e pode ter corrigido)
a máscara, mas é por isso que o holdout precisa ser bom.

---

## 6. Como a prontidão é decidida

`POST /adaptive/projects/{p}/assess` devolve um **estado**, os **motivos** e
os **componentes**. Não há "probabilidade de sucesso": os componentes são
contagens comparadas a alvos de referência, e a interface diz isso.

### Imagens independentes

Duas imagens são o mesmo grupo quando:

1. o nome indica a mesma sequência (`exame07_corte_012`, `video3-frame-0041`;
   prefixos de câmera como `IMG_1234` não agrupam) — desligável na interface;
2. são quase duplicatas: correlação ≥ 0,97 entre miniaturas 32×32
   normalizadas, ou dHash de 64 bits a ≤ 6 bits **com** correlação ≥ 0,9.

O dHash sozinho foi descartado depois de um erro real na validação: em campos
de microscopia com iluminação desigual ele codifica quase só o gradiente de luz,
e lâminas diferentes caíam a ≤ 6 bits umas das outras (16 lâminas viraram 9
grupos). A miniatura dessas imagens tem correlação de 0,1 a 0,5, então exigir as
duas coisas separa cópia de "mesma luz".

A união é transitiva (union-find). A regra é conservadora de propósito: unir
demais só reduz a contagem; unir de menos vaza dados.

**Embeddings do SAM.** Na chegada de cada imagem o conector guarda a média e o
desvio espaciais do `image_embed` (512 valores), calculados **sem** LoRA. Eles
estimam a **diversidade** (Vendi score — número efetivo de imagens distintas,
Friedman & Dieng 2023 — sobre os embeddings padronizados no projeto). Eles
**não** são usados para declarar duplicata: o cosseno entre embeddings
agregados não é calibrado — com pesos aleatórios do SAM 2.1, todas as imagens
ficam acima de 0,985 e seriam unidas num grupo só. O limiar existe em
`ReadinessConfig.embedding_min_cosine`, desligado por padrão.

### Componentes e estados

| Componente | Referência (configurável) |
| --- | --- |
| imagens aprovadas | ≥ 6 |
| máscaras aprovadas | ≥ 15 |
| imagens independentes | mínimo 12, alvo 24 |
| grupos no holdout | mínimo 4, alvo 6 |
| máscaras no holdout | ≥ 10 |
| diversidade efetiva (Vendi) | informativo |

| Estado | Quando |
| --- | --- |
| `collecting` — coletando dados | abaixo dos mínimos de volume ou de independência |
| `collect_more` — coletar mais exemplos | poucos independentes **e** redundância > 40% |
| `insufficient_validation` | volume suficiente, mas holdout pequeno demais |
| `potentially_sufficient` | mínimos atingidos, alvos não |
| `ready` — pronto para treino experimental | alvos atingidos |
| `retrain_useful` / `retrain_not_needed` | já houve rodada concluída (ver §10) |
| `unsupported_model` | modelo carregado não é SAM 2 |

A faixa de 20–40 imagens é uma referência prática, não uma garantia; o estado
só libera um **experimento**, cujo resultado é decidido pela comparação.

Lacunas listadas à parte: classes com < 5 máscaras, classes ausentes do holdout,
faixas de tamanho sem exemplos, redundância alta e imagens em quarentena.

---

## 7. Divisão treino / validação / holdout

Três conjuntos, sempre por **grupo inteiro**:

| Conjunto | Uso | Escolha |
| --- | --- | --- |
| **holdout** | só a comparação final entre modelos | ~25% dos grupos (mín. 4, nunca mais da metade), por hash com sal do projeto |
| **validação interna** | early stopping e escolha da época | ~20% dos grupos de treino (mín. 2), sorteados por rodada |
| **treino** | gradiente | o resto |

A separação entre validação interna e holdout é deliberada: escolher a melhor
época no mesmo conjunto que decide a promoção daria um resultado otimista. O
holdout nunca é visto durante o treino.

**Congelamento.** Na primeira rodada a atribuição é gravada em `split.json` e
nunca muda. Itens novos herdam o lado do seu grupo; grupos novos vão para o
holdout até ele ter o mínimo de grupos e depois por sorteio com a fração alvo.
Se uma imagem nova liga um grupo de treino a um de holdout, o holdout é
preservado e os membros de treino desse grupo ficam em **quarentena** (fora de
tudo). Com isso, rodadas sucessivas são comparadas sobre um holdout estável, e
o id do holdout (`hs-…`) vai no registro: quando ele cresce, a interface avisa
que números de rodadas diferentes não são diretamente comparáveis.

Quando os grupos não bastam para holdout e validação interna, o sistema diz
`insufficient_validation` em vez de inventar uma métrica.

---

## 8. O treino

| Item | Implementação |
| --- | --- |
| Pré-processamento | o mesmo do `SAM2ImagePredictor`: redimensiona para 1024×1024, normaliza (ImageNet) |
| Prompts simulados | 50% caixa com ruído de 5% do lado; 25% um clique positivo amostrado com peso pela distância à borda; 25% 1–2 positivos + 1 negativo junto ao objeto. Reprodutíveis pela semente da época |
| Saída | uma máscara por prompt (`multimask_output=False`), como o editor pede |
| Loss | BCE + Dice suave na resolução do decoder (256×256) + 0,05 × erro da cabeça de IoU |
| Aumento | só no treino: espelho horizontal (padrão), vertical (desligado: errado para fotos), brilho/contraste ±10% (só `encoder_decoder`; no `decoder` as features são fixas e só o espelho entra) |
| Otimizador | AdamW, weight decay 0,01, clip de gradiente 1,0, warmup linear de 10% e cosseno até 10% da taxa |
| Taxa | automática: 3e-4 (`decoder`) ou 2e-4 (`encoder_decoder`) |
| Épocas | automático: até 40 (`decoder`) ou 20 (`encoder_decoder`), com early stopping |
| Lote | `batch_size` imagens por passo, até 8 instâncias por imagem |
| Early stopping | para quando o Dice da validação interna não melhora ≥ 0,002 por 5 épocas (mín. 3 épocas); restaura a melhor |
| Melhor checkpoint | a melhor época (pode ser a 0 — então o adaptador é a identidade e a interface diz isso) |
| Logs | `metrics.jsonl` por época, `events.jsonl` com eventos |
| Memória | features do modo `decoder` em float16 na RAM, com orçamento `POLIGOME_ADAPTIVE_CACHE_MB` (2048): acima dele cai primeiro a cópia espelhada, depois o cache |
| Falta de memória | o passo é refeito com metade das instâncias por imagem; se falhar de novo, a rodada termina como `out_of_memory` |
| Loss não finita | rodada termina como `non_finite_loss` |
| Cancelamento | verificado entre imagens; a rodada vira `cancelled` (medido: ~2 s) e não pode ser ativada |
| Conector encerrado | rodadas em andamento viram `interrupted` na próxima subida |
| Troca de modelo | `/load` é recusado enquanto há treino |
| Segurança do modelo em uso | o treino usa uma cópia nova; o adaptador ativo e o modelo vivo não mudam |

Todos os hiperparâmetros podem ser passados em `config` (validados com limites)
e a interface expõe os principais em "Configuração avançada".

---

## 9. Convergência: aprendendo ou decorando?

A cada época: loss de treino, loss/Dice/IoU/IoU de borda na validação interna,
Dice de treino (sobre lotes aumentados). A **época 0** é o modelo antes do
treino, medido no mesmo conjunto — é o ponto de partida dos gráficos.

O painel mostra as métricas e a época restaurada, sem declarar convergência ou overfitting. O usuário interpreta as curvas e escolhe se quer usar o adaptador. Early stopping continua limitando o custo e restaurando uma época selecionada na validação interna; isso não demonstra generalização. As losses de treino e validação usam prompts e aumentos diferentes.

Há um diagnóstico heurístico nos registros internos para depuração (só com validação interna, nunca com a loss de treino sozinha):

| Estado | Critério |
| --- | --- |
| `in_progress` | menos de 3 épocas de treino avaliadas |
| `overfitting` | loss de validação ≥ 5% acima do seu mínimo por 3 épocas seguidas, enquanto a de treino caiu, e a melhor época ficou ≥ 3 épocas atrás |
| `improving` | Dice de validação subiu ≥ `min_delta` dentro da janela de `patience` |
| `inconclusive` | ganho acumulado sobre a época 0 ≤ oscilação da curva (desvio-padrão das últimas 5 épocas) |
| `converged` | sem melhora na janela e loss de treino estável (< 2% em 3 épocas) |
| falha | estado da rodada: `failed` com código |

**Métrica de borda.** Boundary IoU (Cheng et al., 2021), com faixa de 2% da
diagonal. Justificativa: em objetos grandes, Dice e IoU quase não mudam quando
o contorno fino piora, e é justamente o contorno que a pessoa corrige à mão.

---

## 10. Como saber se o LoRA melhorou o SAM

### O que é comparado

- **A** — o adaptador ativo deste projeto, se houver; senão, o SAM original.
- **B** — o candidato (melhor época restaurada).
- Quando A é um adaptador, B também é comparado ao SAM original.

Mesmo holdout, mesmas instâncias, mesmos prompts determinísticos:

| Protocolo | Prompt |
| --- | --- |
| `box` | caixa exata da máscara |
| `point` | um clique no ponto mais interno (máximo da transformada de distância) |
| `box_jitter` | caixa com ruído de 10% do lado, semente fixa |

### Métricas

- Dice, IoU e IoU de borda por instância, agregados **por imagem** (média das
  instâncias); a métrica principal é o Dice por imagem, média de `box` e `point`.
- Diferença absoluta e relativa, com **IC 95% por bootstrap agrupado**
  (reamostra grupos inteiros, 2000 reamostragens, semente fixa).
- Fração de imagens que melhoraram / pioraram / ficaram iguais (tolerância 1 ponto).
- Por classe e por tamanho (pequeno < 1% da imagem, médio, grande > 10%), com
  IC exploratório: piora ≥ 2 pontos com IC inteiro abaixo de zero, ≥ 3 instâncias
  e ≥ 4 origens recebe uma marca interna de regressão; com poucas origens
  fica apenas como possível piora. A agregação é por imagem também nesses
  subgrupos. Na interface, intervalos de subgrupos com menos de 4 origens são
  substituídos por uma indicação de dados insuficientes.
- **Segmentação interativa simulada:** começa no clique central e, a cada
  passo, clica no ponto mais interno do maior erro (positivo se falta, negativo
  se sobra), reenviando todos os pontos como o editor faz. Mede NoC@85 e NoC@90
  (cliques até 85%/90% de IoU, teto de 8) e a taxa de falha. **Não representa o
  esforço humano real**, e a interface diz isso — não existem logs reais de
  interação no Poligome.
- Até 6 exemplos visuais (maiores ganhos, maiores perdas, um típico), com a
  anotação aprovada em branco.

### A decisão

| Resultado | Regra |
| --- | --- |
| **Evidência insuficiente** | holdout com < 4 grupos ou < 10 máscaras; ou o IC cruza o efeito mínimo; ou mais de 25% das imagens pioraram; ou o NoC@90 piorou > 0,5 clique |
| **Melhorou** | IC inteiro > 0 **e** limite inferior ≥ efeito mínimo (1 ponto de Dice) **e** nenhuma regressão significativa **e** ≤ 25% de imagens piores **e** NoC@90 não piora > 0,5 **e** falha@90 não cresce > 5 pontos |
| **Não melhorou** | IC inteiro abaixo do efeito mínimo, ou regressão significativa em algum subgrupo |

Essas regras ficam nos registros como indicadores exploratórios, não como
vereditos de convergência ou generalização. A interface mostra resultados,
intervalos e exemplos; nenhuma ativação é automática. O usuário pode manter o
modelo atual, ativar um candidato compatível ou anotar mais dados. Candidatos
sem ganho demonstrado exigem uma escolha explícita na interface, vinculada à
rodada selecionada. Continuam bloqueados modelos incompatíveis, arquivos
corrompidos e rodadas não concluídas nem comparadas.

**Limites estatísticos.** Quatro a seis origens são poucas para garantir a
cobertura nominal do bootstrap. Os intervalos são exploratórios, condicionados
a uma rodada, às anotações disponíveis e aos prompts simulados. Os subgrupos
não têm correção por comparações múltiplas. Usar o holdout para escolher a rodada,
hyperparâmetros ou quantidade de dados transforma-o em conjunto de seleção.
Para uma conclusão científica, escolha o adaptador sem consultar um teste
externo e confirme em origens novas com anotações independentes.

**Viés residual a ter em mente:** o holdout é reutilizado entre rodadas para
manter a comparação justa; muitas rodadas sobre o mesmo holdout podem acabar
favorecendo, por acaso, o que funciona nele. A regra de efeito mínimo e o
recuo descrito abaixo limitam isso, mas não eliminam.

---

## 11. Ativação, inferência e reversão

- **Ativar**: com o lock do preditor, remove qualquer LoRA do modelo vivo,
  injeta o novo, carrega os pesos e **invalida o embedding em cache** (o
  conector reutiliza o embedding da última imagem; com o encoder adaptado ele
  ficaria errado). `/predict` passa a devolver `adapter: {project_id, run_id}`.
- **Desativar**: devolve as camadas originais (os mesmos objetos) — a previsão
  volta a ser bit a bit a do modelo original (verificado em teste e no smoke
  test por HTTP).
- **Reverter**: volta ao adaptador ativado antes do atual (do histórico do
  projeto); sem anterior, ao modelo original.
- **Rejeitar**: marca a rodada; ela não volta a ser oferecida como ativa.
- **Reinício do conector**: o adaptador ativo é reaplicado se o modelo base for
  o mesmo; trocar de modelo base desliga o adaptador (e voltar ao mesmo
  modelo o reaplica).

O conector serve um modelo para todas as abas; por isso há um adaptador ativo
por conector, e a interface avisa quando ele pertence a outro projeto.

---

## 12. Aprendizado contínuo

Depois de uma rodada concluída, a avaliação de prontidão passa a dizer se vale
outra:

- **dados novos**: grupos independentes de treino que não estavam no snapshot
  da última rodada; exige ≥ max(4, 25% dos grupos anteriores);
- **classes novas** desde a última rodada;
- **subgrupos fracos** na última comparação (Dice < 70%);
- **recuo**: se as duas últimas rodadas não melhoraram, o requisito de dados
  novos dobra;
- **custo**: estimado pelo tempo real por época da última rodada.

Nunca há treino automático. Cada rodada **retreina do modelo base sobre todo o
dataset acumulado** (não sobre o adaptador anterior, nem só sobre as imagens
novas). Isso reduz o risco de esquecimento dos exemplos retidos e acúmulo de erro entre rodadas;
como o holdout acumulado contém os exemplos antigos, uma piora neles aparece
como regressão contra o adaptador ativo e bloqueia a promoção.

### Quantas imagens anotar

A resposta vem em duas etapas:

1. **Antes de treinar** — a prontidão diz quantas imagens de origens novas
   faltam para as referências (independência e avaliação). É uma conta sobre
   alvos heurísticos, e o texto diz isso.
2. **Depois de cada rodada** — a **curva de aprendizado**: o mesmo treino é
   refeito do zero em 25%, 50% e 75% dos grupos de treino (subconjuntos
   aninhados, com as mesmas épocas da melhor época da rodada) e cada um é medido
   no holdout. Com o modelo original (0 grupos) e o candidato (100%), ajusta-se
   `erro(n) = a·n^(−b) + c` (Hestness et al., 2017). A incerteza combina
   bootstrap por grupo do holdout com os resíduos do ajuste em sinal aleatório
   (wild bootstrap), porque cada ponto é um treino só. A interface mostra a
   tendência (subindo, perto do platô, inconclusivo), a projeção com o dobro de
   grupos e "quantos grupos novos para +1 ponto", sempre como ordem de grandeza.
   Custa cerca de 1,5× o treino e pode ser desligada; a ativação não espera por
   ela.

### O que anotar a seguir

As imagens do projeto ainda sem anotação aprovada podem ser enviadas só para
análise (o conector guarda descritores e embedding, não a imagem). A ordem é por
cobertura: seleção gulosa de k-centros (core-set, Sener & Savarese 2018) no
espaço dos embeddings do SAM padronizados pelo projeto. A cada passo entra a
imagem mais distante de tudo que já está anotado ou já foi sugerido, então duas
imagens da mesma origem nova não ocupam os dois primeiros lugares. Quase cópias
de imagens anotadas vão para o fim. "Abrir" leva direto à imagem no editor.

Ainda não implementado: seleção por incerteza do modelo ativo, detecção de
anotações suspeitas e uso de logs reais de interação.

---

## 13. Como usar

1. Instale ou atualize o SAM pelo instalador (o Adaptive AI vem junto) e use
   **SAM 2.1** ou **MedSAM2**.
2. Anote normalmente. Polígonos que você desenha ou aceita do SAM contam;
   predições automáticas só contam depois de editadas ou com nota 4–5.
3. Abra **IA → Adaptive AI** e clique em **Enviar e analisar**. As imagens
   aprovadas vão para o conector local; só o que mudou é reenviado.
4. Leia o estado e os motivos. Com o mínimo atingido, **Iniciar rodada de
   treino**.
5. Acompanhe épocas, gráficos e diagnóstico. Ao fim, leia a comparação.
6. Se melhorou, **Ativar adaptador**. O SAM do Assistido passa a usá-lo.
7. **Desativar** ou **Reverter** a qualquer momento. Salve o projeto para que o
   `.plgm` guarde a identidade do Adaptive AI.

Por HTTP (para depuração):

```bash
curl -s http://127.0.0.1:7860/adaptive/status
curl -s -X POST http://127.0.0.1:7860/adaptive/projects/<projeto>/assess
curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"config":{"strategy":"decoder","max_epochs":10}}' \
  http://127.0.0.1:7860/adaptive/projects/<projeto>/runs
```

Variáveis de ambiente: `POLIGOME_ADAPTIVE=0` desliga a extensão (e o
instalador deixa de copiá-la); `POLIGOME_ADAPTIVE_CACHE_MB` limita o cache de
features (padrão 2048).

---

## 14. GPU, memória e tempo

O treino roda **no mesmo dispositivo do conector**: ele escolhe CUDA, depois
Apple MPS, e só então CPU (`POLIGOME_DEVICE` força a escolha). A interface mostra
"Treino em GPU NVIDIA (CUDA) com precisão mista bfloat16", "GPU Apple (MPS)" ou
"CPU". Em CUDA com suporte a bfloat16, treino e avaliação usam `torch.autocast`
em bfloat16, como o treino oficial do SAM 2 (`mixed_precision`, ligado por
padrão); em CPU e MPS ficam em float32. **Este caminho de GPU não pôde ser
executado aqui** (não havia GPU).

| | CPU | GPU (CUDA/MPS) |
| --- | --- | --- |
| Estratégia automática | `decoder` | `encoder_decoder` (SAM 3: sempre `decoder`) |
| Memória extra durante o treino | uma cópia do modelo base (Tiny ≈ 160 MB; Large ≈ 900 MB) + cache de features (≤ 2 GB por padrão) | idem em VRAM; o modelo do editor continua carregado ao lado |
| Envio de cada imagem | ~1,5 s (Tiny) para o embedding de diversidade; mais em modelos maiores | rápido |

Medido neste ambiente (4 núcleos, sem GPU, SAM 2.1 Tiny **com pesos
aleatórios**, 24 imagens sintéticas 256×192, 14 de treino):

| | `decoder` | `encoder_decoder` |
| --- | --- | --- |
| tempo por época | ≈ 12 s | ≈ 49 s |
| rodada completa (com comparação) | ≈ 2,6 min (4 épocas) | ≈ 2,6 min (2 épocas) |

Com o SAM 2.1 Tiny **pré-treinado**, 30 imagens 256×256 de treino, CPU de 4
núcleos dividida com outros processos: ≈ 97 s por época no `decoder`, incluindo a
validação interna; ver [adaptive-ai-validation.md](adaptive-ai-validation.md).

No modo `decoder` as features do holdout são calculadas uma vez e reaproveitadas
para o modelo original, o adaptador ativo, o candidato, os exemplos e cada
ponto da curva. Isso importa sobretudo no SAM 3 em CPU, onde cada codificação
leva perto de um minuto. Em GPU com pouca VRAM, prefira o `decoder` ou reduza
"Imagens por passo".

---

## 15. Limitações com datasets pequenos

- Com 4–6 grupos no holdout, o IC é largo: "evidência insuficiente" será o
  resultado mais comum, e isso é o comportamento correto.
- O conjunto de avaliação reflete o que foi anotado; se ele não representa as
  imagens futuras, o ganho medido também não.
- Anotações erradas aprovadas ensinam o erro. As notas de revisão 1–2 são o
  mecanismo para excluí-las.
- O agrupamento por nome e por quase-duplicata é heurístico. Sem metadados de
  paciente/exame, imagens correlacionadas com nomes e aparências diferentes
  podem escapar.
- Rasters em mosaico (COG) ficam de fora nesta versão.

---

## 16. Testes

| Comando | O que cobre |
| --- | --- |
| `bash tests/adaptive.test.sh` (ou `npm run test:adaptive`) | 51 testes Python: LoRA (criação, identidade, congelamento, remoção, salvar/carregar, formas), máscaras e prompts, store e validação, duplicatas e agrupamento, divisão e quarentena, bootstrap, decisão, convergência, treino real com modelo-brinquedo (métricas, aprendizado, early stopping, melhor checkpoint, comparação), ativação/desativação/reversão/reaplicação, adaptador adulterado, modelo incompatível, cancelamento, falha, OOM, treino único, rodadas interrompidas, rotas HTTP, e **SAM 2.1 Tiny real** (paridade com o preditor oficial e uma rodada completa) quando o pacote `sam2` está instalado |
| `npm run test:unit` | inclui `tests/adaptive-ai.test.mjs`: regras de aprovação, agrupamento, payload, sincronização, `.plgm`, paridade de traduções, e a interface renderizada com payloads gerados pelo backend real |
| `python scripts/adaptive-smoke.py --base http://127.0.0.1:7860` | smoke test por HTTP contra um conector real, com dados sintéticos |

O script Python procura um interpretador com torch, NumPy, OpenCV e Pillow (o
venv `sam2` do instalador serve); sem um, diz que pulou.

### O que foi verificado nesta implementação, e o que não foi

Verificado:

- 51 testes Python e 17 testes Node do Adaptive AI; suíte existente sem
  regressões (493 testes Node, instaladores, BYOM, typecheck, lint sem erros).
- Paridade numérica do caminho de treino com o `SAM2ImagePredictor` oficial.
- Smoke test por HTTP com o conector real e a arquitetura SAM 2.1 Tiny nas duas
  estratégias: envio, prontidão, treino com progresso real, comparação,
  exemplos, ativação (`/predict` anuncia o adaptador e recalcula o embedding),
  desativação devolvendo a previsão original idêntica, reversão, cancelamento
  em ~2 s, reaplicação após reinício, e conector sem a extensão inalterado.
- A interface no Chromium contra esse conector: importação, análise, treino,
  gráficos, comparação, exemplos, ativação, histórico, e o layout a 390 px sem
  rolagem horizontal.

**Não** verificado:

- **Pesos oficiais.** A política de rede deste ambiente bloqueou o download dos
  checkpoints (dl.fbaipublicfiles.com e Hugging Face). Todo treino aqui usou a
  arquitetura real com **pesos aleatórios**; os números acima (Dice indo de ~3%
  a ~46%) mostram que o pipeline aprende, **não** que o LoRA melhora o SAM
  pré-treinado. Esse é o primeiro experimento a fazer numa máquina com o
  checkpoint.
- **GPU.** Não havia GPU; CUDA e MPS não foram exercitados (o código usa só
  operações comuns e redimensiona em CPU por causa do MPS).
- **Dados reais** de qualquer domínio.
- **Windows nativo** (`poligome-sam-windows-native.ps1`): a instalação da
  extensão foi escrita, mas não executada.
