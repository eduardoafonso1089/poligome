# Adaptive AI — validação experimental

> Relatório histórico do commit `683f35a`. A interface e alguns critérios foram
> revisados depois desta medição; veja [a revisão atual](adaptive-ai-review.md).
> Os números abaixo não são uma nova medição do código revisado.

Este relatório responde, com medições, às perguntas que importam antes de
confiar no Adaptive AI:

1. O LoRA melhora o SAM **pré-treinado** num domínio em que ele erra?
2. O treino converge, e o sistema percebe quando ele começa a decorar?
3. Quantas imagens é preciso anotar, e a estimativa do sistema acerta?
4. A interface leva uma pessoa do início ao fim sem conhecimento de ML?

Todos os números vêm de execuções reais, reproduzíveis com
`scripts/adaptive-experiments.py` e com o teste de interface descrito no fim.

## Configuração

| Item | Valor |
| --- | --- |
| Modelo | SAM 2.1 Hiera Tiny, pesos oficiais (espelho da Ultralytics no GitHub Releases, chaves e formas idênticas ao checkpoint da Meta) |
| Hardware | CPU de 4 núcleos, 15 GB de RAM, sem GPU; CPU dividida com outros processos durante as medições |
| Domínio | campos de microscopia **sintéticos** (`tests/helpers/adaptive_fixtures.nuclei_image`): núcleos que se tocam, borrão, iluminação desigual, ruído. Cada "lâmina" tem coloração, luz e tamanho próprios; campos da mesma lâmina são um grupo |
| Por que esse domínio | é o caso clássico em que um clique no SAM pega o aglomerado inteiro em vez de um núcleo. A convenção do dataset (um núcleo por instância) é exatamente o tipo de coisa que um adaptador deveria aprender |
| Dados | 16 lâminas × 3 campos = 48 imagens 256×256, 479 núcleos |
| Configuração de treino | a automática: estratégia `decoder` (CPU), rank 8, alpha 16, taxa 3e-4, até 40 épocas, early stopping com paciência 5 |

Nenhum dado real foi usado. A validação com imagens reais e com GPU fica para
quem tiver os dois (ver "O que não foi validado").

## 1. O LoRA melhorou o SAM pré-treinado?

Divisão por lâmina, feita pelo próprio sistema: 30 imagens (10 lâminas) de
treino, 6 (2 lâminas) de validação interna para o early stopping, 12 (4 lâminas,
135 núcleos) de avaliação final, nunca vistas no treino nem na escolha da época.

| Prompt | Métrica | SAM original | SAM + LoRA | Diferença |
| --- | --- | --- | --- | --- |
| Um clique | Dice | 49,9% | **80,9%** | **+31,0** |
| Um clique | IoU | 41,3% | 72,0% | +30,7 |
| Um clique | IoU de borda | 40,4% | 71,3% | +30,9 |
| Caixa | Dice | 87,4% | 88,3% | +0,9 |
| Caixa imprecisa (±10%) | Dice | 84,8% | 85,0% | +0,2 |

- **Métrica principal** (Dice por imagem, média de caixa e clique): 68,6% → 84,6%,
  **+16,0 pontos, IC 95% [+12,8; +18,6]** por bootstrap reamostrando lâminas.
- **100%** das imagens de avaliação melhoraram; nenhuma piorou.
- **Cliques simulados até 90% de IoU:** 6,06 → 5,21. IoU depois do primeiro
  clique: 0,42 → 0,71. Ainda assim, 52% dos núcleos não chegam a 90% em 8
  cliques (62% antes): núcleos pequenos e borrados têm um teto baixo de IoU.
- **Decisão do sistema:** *Melhorou* — o IC inteiro fica acima de zero e do
  efeito mínimo, sem regressão em subgrupo.

Leitura: o ganho está quase todo no clique único, que era o problema. Com caixa
o SAM original já acertava, e o adaptador não estragou isso.

**Limite desta medição:** são só 4 lâminas de avaliação. O IC é estreito porque
o efeito é grande e consistente, não porque a amostra seja grande.

## 2. Convergência

Validação interna (2 lâminas) por época, com a época 0 = modelo original:

| Época | Loss treino | Loss validação | Dice validação |
| --- | --- | --- | --- |
| 0 | — | 0,412 | 63,9% |
| 2 | 0,281 | 0,350 | 69,7% |
| 4 | 0,220 | 0,234 | 78,8% |
| 6 | 0,174 | 0,191 | 82,6% |
| 8 | 0,163 | 0,183 | 83,1% |
| 10 | 0,170 | 0,197 | 82,0% |
| **12** | 0,168 | **0,167** | **84,5%** ★ |
| 14 | 0,180 | 0,173 | 84,0% |
| 16 | 0,167 | 0,171 | 84,2% |
| 17 | 0,145 | 0,178 | 83,6% |

- As duas losses caem juntas até a época ~12; depois a de treino continua
  oscilando para baixo e a de validação para de melhorar.
- O early stopping parou na época 17 (5 épocas sem melhora ≥ 0,2 ponto) e
  restaurou a época 12.
- Diagnóstico do sistema: **convergência** (sem melhora na janela, loss de
  treino estável), corretamente sem acusar overfitting.

O experimento de estresse (abaixo) mostra o outro lado: o que acontece quando o
treino começa a decorar.

## 3. Quantas imagens anotar?

Curva de aprendizado calculada pelo próprio sistema ao fim da rodada: o mesmo
treino refeito em frações das 10 lâminas de treino, medido no mesmo holdout.

| Lâminas de treino | Dice (holdout) | IC 95% |
| --- | --- | --- |
| 0 (SAM original) | 68,6% | 66,0–70,9 |
| 2 | 77,0% | 76,9–77,2 |
| 5 | 81,0% | 79,9–82,1 |
| 8 | 82,3% | 81,3–83,2 |
| 10 | 84,6% | 83,3–85,9 |

O sistema classifica a curva como **ainda subindo** e projeta cerca de 86% com o
dobro de lâminas. Duas observações honestas:

- Com 2 lâminas (6 imagens) o adaptador já ganha 8 pontos; a maior parte do
  ganho vem cedo. Isso é típico de LoRA sobre um modelo fundacional, e é por
  isso que o sistema permite experimentos a partir de ~12 origens.
- A primeira versão do estimador dizia "faltam 4 lâminas para +1 ponto (4 a 4)".
  Esse intervalo era falsamente preciso: cada ponto é um treino só e o bootstrap
  do holdout não via essa variação. O estimador passou a somar os resíduos do
  ajuste (wild bootstrap) para levar essa incerteza ao intervalo.

### A estimativa acerta?

**Pendente.** O experimento `half` (metade das lâminas de treino, mesmo
holdout, projetando o resultado com o dobro) estava rodando quando esta versão
foi fechada. Ver `docs/adaptive-ai-next-steps.md`.

## 4. Overfitting

**Pendente** (experimento `overfit`: 9 imagens, taxa 3e-3, sem early stopping
até a época 12). Ver `docs/adaptive-ai-next-steps.md`.

## 5. LoRA também no encoder

**Pendente** (experimento `encoder`). O caminho `encoder_decoder` foi validado
com pesos aleatórios pelo smoke test; falta a medição com pesos pré-treinados.

## 6. Interface, ponta a ponta

Teste no Chromium contra um conector real com o SAM 2.1 Tiny pré-treinado:
32 campos anotados (16 lâminas, 321 núcleos importados via COCO) e 12 campos sem
anotação (6 de lâminas conhecidas, 6 de 3 lâminas novas).

| Etapa | O que aconteceu |
| --- | --- |
| Antes de treinar, clique num núcleo pequeno no meio de um aglomerado (`novo_vista_00`, núcleo de 364 px) | o SAM original devolveu **3061 px**, o aglomerado inteiro |
| Abrir Adaptive AI | "Próximo passo: envie e analise" |
| Enviar e analisar | "Dados potencialmente suficientes para um experimento"; com 10 lâminas (teste anterior), "coletar mais exemplos" e "anote cerca de 14 imagens de origens novas" |
| Sugerir imagens | 1º e 2º lugares: campos das lâminas novas 91 e 92; a lâmina nova 90 só em 6º–7º (a cobertura no espaço de embeddings não coincide perfeitamente com "lâmina nova") |
| "Abrir" numa sugestão | o painel fecha e a imagem sugerida abre no editor |
| Treino (CPU, até 8 épocas) | progresso real por época e por imagem, gráficos, "Treino em CPU" |
| Comparação | **Melhorou**: um clique 55,3% → 79,5% de Dice, caixa 91,0% → 91,1% (holdout de 8 imagens, 4 lâminas) |
| Ativar | "Em uso: adaptador da rodada 2026-10-13 16:35 UTC" |
| Mesmo clique depois de ativar | **445 px** (núcleo de 364 px): o SAM passou a segmentar o núcleo, não o aglomerado |
| Outros dois núcleos | 793 → 760 px (núcleo 855) e 313 → 308 px (núcleo 335): já estavam bons e continuaram |
| 390 px de largura | sem rolagem horizontal |
| Erros no console | só a sondagem do Poligome Runtime (porta 7861, não iniciado) |

## Erros que esta validação encontrou e corrigiu

| Achado | Consequência | Correção |
| --- | --- | --- |
| dHash confundia "mesma iluminação" com "mesma imagem" | 16 lâminas viravam 9 grupos e o projeto parecia sem dados | dHash só vale com miniatura parecida (correlação ≥ 0,9); teste de regressão |
| Reabrir o painel perdia a análise | o botão de treinar ficava desligado até reenviar tudo | o painel busca a análise salva no conector ao abrir e avisa se há anotações não enviadas |
| "Ativar" aparecia durante a curva de aprendizado, mas o conector recusava | ativação falhava em silêncio para quem não lia o erro | ativar é permitido assim que o adaptador está comparado; a curva continua em paralelo |
| A thread de treino podia sobrescrever uma ativação feita durante a curva | o histórico diria "inativo" com o adaptador ativo | a thread preserva o estado de ativação que está no disco; teste |
| Intervalo de "quantas imagens" falsamente estreito | promessa de precisão que não existe | wild bootstrap dos resíduos |
| "Coletar mais exemplos" falava em "quase iguais" quando o motivo era a mesma origem | mensagem enganosa | texto explica origem repetida ou quase cópia |
| Exemplos visuais: máscara azul sumia sobre núcleos roxos | comparação ilegível nesse domínio | preenchimento leve, contorno colorido, contorno da anotação com borda escura |

## O que não foi validado

- **Imagens reais.** O domínio é sintético; ele reproduz o modo de falha
  (aglomerados), não a variedade de um dataset real.
- **GPU** (CUDA e MPS) e a precisão mista bfloat16.
- **SAM 3 com pesos reais.** O checkpoint é restrito (gated) e não estava
  acessível aqui. O caminho do SAM 3 foi validado na arquitetura real com pesos
  aleatórios: paridade com `predict_inst` e uma rodada completa (treino,
  comparação, ativação, desativação). Para validar com pesos reais, ver
  "Reproduzir".
- Modelos maiores que o Tiny.

## Reproduzir

```bash
# experimentos (CPU: algumas horas; GPU: bem menos)
python scripts/adaptive-experiments.py --checkpoint sam2.1_hiera_tiny.pt --out resultados/

# smoke test contra um conector já no ar (SAM 2.1, MedSAM2 ou SAM 3)
python scripts/adaptive-smoke.py --base http://127.0.0.1:7860 --domain nuclei --images 24
```

Com o SAM 3 carregado no conector (por exemplo com o `sam3.pt` aprovado pela
Meta), o mesmo `adaptive-smoke.py --domain nuclei` exercita o caminho do SAM 3
com pesos reais.
