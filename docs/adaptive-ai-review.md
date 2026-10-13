# Adaptive AI — revisão de UI/UX e metodologia

Revisão iniciada em 13/10/2026 na branch `feature/adaptive-sam-lora`, a partir
do commit `683f35a`. A orientação de produto é apresentar evidências e deixar
a escolha do adaptador com o usuário.

## Decisão de produto

O painel não declara que o treino “convergiu” nem que a generalização foi
comprovada. Ele mostra:

- loss e Dice de treino, loss/Dice/IoU de validação por época;
- época restaurada e seu resultado na validação interna;
- resultados pareados do candidato e da referência no conjunto de avaliação;
- comparação por clique, caixa, caixa perturbada, classe e tamanho;
- frações de imagens com ganho ou perda, exemplos de máscaras e cliques simulados;
- limitações da avaliação e projeções exploratórias da curva de aprendizado.

O usuário escolhe manter o modelo atual, experimentar o candidato ou anotar
mais dados. Ativar, desativar e reverter são ações explícitas. Um candidato
sem ganho demonstrado pode ser experimentado depois de revisar os resultados;
essa escolha fica vinculada à rodada selecionada. Compatibilidade do modelo,
integridade dos pesos e conclusão da rodada continuam obrigatórias.

Early stopping continua sendo um mecanismo para limitar custo e restaurar um
checkpoint escolhido na validação interna. Os diagnósticos heurísticos ficam
nos registros para depuração, sem servir de veredito na interface.

## O que está correto na abordagem LoRA

A implementação congela os parâmetros originais e treina matrizes de baixa
ordem nas projeções de atenção. A inicialização com B igual a zero mantém a
função original antes do primeiro passo. Os testes verificam identidade,
parâmetros treináveis, serialização e reversão. Isso corresponde ao mecanismo
básico de [LoRA](https://arxiv.org/abs/2106.09685), mas não garante vantagem
em qualquer domínio ou com qualquer quantidade de dados.

Separar por origem, preservar um holdout e selecionar épocas numa validação
interna diferente desse holdout são decisões adequadas. Comparar modelos com
as mesmas imagens e prompts também reduz a variação da comparação pareada.
Treinar em máscaras de objetos anotados individualmente evita tratar como
fundo objetos presentes na imagem que não foram anotados.

## Problemas confirmados e correções

| Problema | Correção |
| --- | --- |
| Diagnóstico retornava `converged` mesmo com loss de treino instável | fallback agora é inconclusivo; estabilidade usa a amplitude das últimas losses e uma janela completa. O diagnóstico não é apresentado como conclusão ao usuário |
| Três ou mais objetos de uma única origem podiam receber marca de regressão significativa | exige pelo menos quatro origens para essa marca interna; na interface, subgrupos pequenos mostram falta de origens em lugar de um IC aparentemente preciso |
| Subgrupos pesavam cada objeto, enquanto a métrica principal pesava cada imagem | subgrupos passam a agregar por imagem antes do bootstrap por origem |
| Último lote incompleto dividia o gradiente pelo tamanho máximo do lote | divide pela quantidade real de imagens daquele lote, no treino principal e nos pontos da curva |
| NoC limitado ao máximo podia ocultar aumento de falhas | indicador interno também considera o aumento da taxa de falha@90; a taxa continua visível para a decisão do usuário |
| Um ganho médio relevante com IC quase encostado em zero recebia a mesma indicação interna de um ganho claramente relevante | limite inferior precisa atingir o efeito mínimo para essa indicação; continua sendo evidência exploratória |
| “Meia base” reduzia treino + validação, deixando 4 contra 10 grupos de gradiente | preserva a validação interna e o holdout e reduz apenas os grupos que recebem gradiente; confere a identidade do holdout e a quantidade efetiva de grupos |
| Script anunciava experimentos em GPU, mas construía tudo em CPU | argumento `--device` e variável `POLIGOME_ADAPTIVE_DEVICE` propagados ao modelo e ao serviço |
| Painel podia herdar análise, rodada e consentimento ao trocar projeto ou conector | sessão React identificada por projeto e endereço do conector |
| Treino podia começar com anotações locais ainda não sincronizadas | bloqueia início até sincronizar e orienta a enviar/analisar |
| Excluir a última máscara impedia sincronizar sua remoção | permite sincronizar remoções mesmo sem máscaras locais restantes |
| Escolha de um candidato fraco persistia ao selecionar outra rodada | escolha vinculada ao ID da rodada |
| Smoke chamado “SAM 3” podia testar o SAM 2 que estivesse carregado | valida explicitamente a família e registra modelo/dispositivo no resultado |
| Teste opcional de SAM 3 podia ignorar o pacote instalado porque o import anterior às correções de CPU falhava | detecta instalação sem importar antes das correções do conector; uma falha real aparece como falha |
| Autocast do SAM 3 pressupunha BF16 em qualquer CUDA | BF16 somente com suporte nativo; backbone congelado e inferência usam FP16 como alternativa. Treino sem BF16 fica em FP32. Hardware CUDA ainda exige validação real |

## Limites que não são resolvidos por um veredito automático

**Quantidade de dados.** Os mínimos de prontidão são referências operacionais.
Não são uma estimativa universal do número de imagens necessário. A unidade
independente pode ser paciente, exame, lâmina ou sessão de aquisição. Nomes e
similaridade visual são pistas, não prova de independência; em dados reais é
necessário definir a origem corretamente.

**Holdout reutilizado.** Se o usuário escolhe rodadas, hiperparâmetros ou
quantidade de anotações a partir dos resultados nele, esse conjunto participa
da seleção. O bootstrap de uma rodada não corrige essa adaptação. Para uma
conclusão científica, selecionar o adaptador antes de observar um teste externo
e confirmá-lo em novas origens com anotações independentes. Ver
[Generalization in Adaptive Data Analysis and Holdout Reuse](https://arxiv.org/abs/1506.02629).

**Poucas origens.** Quatro lâminas com muitas máscaras continuam sendo quatro
origens. Dois mil reamostragens não criam novos indivíduos. O IC agrupado é
exploratório; sua cobertura nominal não foi calibrada neste regime. Subgrupos
não têm ajuste por comparações múltiplas e funcionam como descrição de casos
a revisar. A média principal dá peso igual às imagens; origens com mais campos
pesam mais. Uma média por paciente/lâmina seria outro estimando.

**Curva de aprendizado.** Cada ponto é um treino de uma única semente e um
subconjunto particular. Resíduos do ajuste não medem variância entre treinos.
Os percentis 10–90 das extrapolações são uma faixa exploratória condicionada
a esses pontos, não um intervalo de previsão calibrado. Uma lei de potência
com três parâmetros e apenas três pontos não sustenta uma estimativa precisa
da quantidade de dados necessária. Para estudar isso: repetir sementes e
subconjuntos, reservar validação para escolher a coleta e medir resultados
futuros em um teste externo.

**Referência de anotação.** O alvo é a máscara aceita pela pessoa. Melhorar Dice
contra ela pode significar aprender o estilo de anotação, não descobrir uma
verdade independente. Aceitar repetidamente saídas do próprio SAM pode reforçar
seus erros. Uma avaliação científica precisa de referência revisada
independentemente.

**Prompts e esforço.** Caixas exatas e cliques no ponto mais interno usam a
máscara de referência para definir o prompt. São protocolos reprodutíveis,
mas favoráveis e diferentes do uso humano. NoC é limitado ao máximo de
cliques e deve ser lido junto com a taxa de falha. Só logs ou um estudo de
usuários medem esforço e tempo de correção reais.

**Escopo.** Núcleos sintéticos demonstram um modo de falha, sem comprovar
transferência para imagens reais. No SAM 3, LoRA atua no decoder interativo de
pontos/caixas; não treina a segmentação por texto. Decoder versus encoder neste
script é uma comparação exploratória: épocas, taxa e aumentos diferem. Não
é uma ablação que isole apenas a posição do LoRA.

## Verificação

Os cenários de navegador usam componentes/CSS reais com respostas de API
controladas. Seus números são fixtures, não medidas de qualidade do modelo.

- Auditoria completa da IA: **34/34** cenários no Chromium, incluindo SAM por
  pontos/caixas/texto, troca de modelo, erros, cancelamento, BYOM e Runtime.
- Adaptive AI: **21/21** cenários, incluindo sincronização, dados desatualizados, exclusão da última máscara,
  isolamento de projeto/conector, troca de modelo, adaptador incompatível, ativação explícita, desativação, reabertura,
  escolha de candidato fraco e layouts em pt/en/fr/es a 390 e 1366 px.
- Os testes Python incluem gradientes reais, serialização, serviço e arquitetura
  SAM 2.1 Tiny. A arquitetura aleatória não mede qualidade pré-treinada.

Typecheck passou. A suíte de unidade JS passou com **500 testes** e **1 skip**.
A suíte Python passou com **65 testes** e **2 skips**, e os **12 testes de estatística/gradiente/precisão** passaram novamente após a revisão final (os dois de integração
completa SAM 3, executados separadamente na tentativa documentada abaixo).
Os testes dos instaladores SAM também passaram. Não foi executado o instalador
nativo em Windows nem teste de hardware CUDA/MPS.

## Reprodução com SAM 2.1 pré-treinado

Nova rodada, separada do relatório histórico: núcleos sintéticos em 48 campos
de 16 lâminas, com 10 lâminas para gradiente, 2 para validação interna e 4
(12 campos) para comparação. Restaurada a época 10 após 15 épocas.

| Dice no conjunto de comparação | SAM original | Adaptador |
| --- | --- | --- |
| Principal (caixa + clique) | 73.9% | 86.6% |
| Um clique | 59.5% | 83.9% |
| Caixa | 88.4% | 89.2% |

Ganho principal observado: **12.7 pontos**, faixa de bootstrap
nominal 95% **9.2–16.2 pontos**. Há apenas quatro
origens na comparação: não interpretar essa faixa como garantia de cobertura
ou de desempenho em outro domínio. Os cliques são simulados. Dados extraídos
de [adaptive-ai-review-main.json](adaptive-ai-review-main.json), sem incorporar
números do experimento anterior.

A rodada principal e sua curva complementar foram concluídas. Os pontos
medidos da curva foram:

| Grupos de gradiente | Dice no mesmo holdout |
| --- | --- |
| 0 | 73.9% |
| 2 | 81.3% |
| 5 | 84.1% |
| 8 | 85.4% |
| 10 | 86.6% |

A extrapolação para 20 grupos foi de 87,9%, com faixa exploratória do ajuste
86,1–89,7%. Isso não mede a variância entre sementes nem garante desempenho
com novas imagens.

O ambiente reiniciou durante os experimentos complementares: `half` foi
interrompido e `overfit`/`encoder` não produziram resultados completos nesta
revisão. Métricas parciais não foram tratadas como resultados finais. Para
continuar sem refazer a rodada principal, preserve o diretório de resultados
e rode `--only half overfit encoder` com o mesmo checkpoint e dispositivo.

## SAM 3 com o checkpoint local

Esta sessão não consegue abrir `C:\Users\lucas\Downloads\sam3.pt` no
computador do usuário. A tentativa de integração completa da arquitetura foi
encerrada por limite de memória, com outro experimento ativo; não é um teste
concluído nem uma comprovação de funcionamento dos pesos reais.

No computador que contém o arquivo, use o Python do ambiente SAM 3:

```powershell
python scripts/adaptive-sam3-checkpoint.py --checkpoint "C:\Users\lucas\Downloads\sam3.pt"
```

No WSL2, use `/mnt/c/Users/lucas/Downloads/sam3.pt`. O script inicia um conector
isolado, confirma SAM 3, exercita treino/avaliação/ativação/desativação/reversão
e grava `sam3-smoke.json` e o log. Ele não usa o projeto nem o adaptador ativos
do conector habitual. O lançamento com pesos reais, GPU e instalador nativo
Windows continua dependente de execução nesse ambiente.
