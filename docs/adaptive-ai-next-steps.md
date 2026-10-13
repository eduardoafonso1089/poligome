# Adaptive AI — o que falta

Estado em 2026-10-13, branch `feature/adaptive-sam-lora`. O fluxo completo
funciona e foi validado com o SAM 2.1 Tiny pré-treinado (ver
[adaptive-ai-validation.md](adaptive-ai-validation.md)). Falta:

| # | Tarefa | Precisa de | Como |
| --- | --- | --- | --- |
| 1 | Experimentos `half`, `overfit`, `encoder` e preencher as seções 3 ("A estimativa acerta?"), 4 e 5 do relatório | CPU (horas) ou GPU (minutos) | `scripts/adaptive-finish.sh` |
| 2 | Validar SAM 3 com pesos reais | `sam3.pt` aprovado pela Meta | conector com `sam3-concepts` + `adaptive-smoke.py --domain nuclei` |
| 3 | Validar GPU (CUDA, bfloat16) e MPS | máquina com GPU | mesmo script do item 1 |
| 4 | Instalador nativo do Windows instalando a extensão | Windows | rodar `poligome-sam-windows-native.ps1` e conferir `poligome-sam-adaptive.py` ao lado do conector |
| 5 | Validar com imagens reais de um domínio | dataset com permissão | fluxo normal pela interface |
| 6 | Melhorias de segunda etapa | — | ver o fim deste arquivo |

## Script

`scripts/adaptive-finish.sh` roda os itens 1–3 e grava os resultados em
`resultados-adaptive/`:

```bash
# SAM 2.1 Tiny (pesos oficiais) — experimentos que faltam
bash scripts/adaptive-finish.sh experiments /caminho/sam2.1_hiera_tiny.pt

# SAM 3 com o checkpoint aprovado (conector precisa estar no ar com sam3-concepts)
bash scripts/adaptive-finish.sh sam3-smoke http://127.0.0.1:7860

# testes (Python precisa de torch; SAM 3 é opcional e lento)
bash scripts/adaptive-finish.sh tests
```

No Windows, rode dentro do WSL2, onde o conector do SAM fica instalado.

## Prompt para continuar com um LLM

Cole o texto abaixo num assistente de código com acesso ao repositório e aos
arquivos de resultado:

```text
Você está no repositório Poligome, branch feature/adaptive-sam-lora. Leia
docs/adaptive-ai.md, docs/adaptive-ai-validation.md e
docs/adaptive-ai-next-steps.md antes de mudar qualquer coisa.

Tarefa: completar a validação do Adaptive AI (LoRA no SAM) sem inventar números.

1. Leia resultados-adaptive/results.json (gerado por
   scripts/adaptive-finish.sh experiments). Para cada experimento (main, half,
   overfit, encoder) extraia: épocas (loss de treino, loss e Dice de validação),
   best_epoch, diagnosis.state, comparison.primary (médias, mean_delta, ci_low,
   ci_high), comparison.protocols e learning_curve.
2. Preencha em docs/adaptive-ai-validation.md as seções marcadas "Pendente":
   - "A estimativa acerta?": compare a projeção da curva do experimento half
     (learning_curve.projection e o ajuste fit a, b, c avaliado no número de
     grupos de treino do main) com o Dice real do main
     (comparison.primary.candidate_mean). Diga se o valor real caiu dentro da
     faixa projetada.
   - "Overfitting": tabela por época do experimento overfit e o diagnóstico que
     o sistema deu; diga se o estado "overfitting" apareceu e se a melhor época
     restaurada foi anterior ao fim.
   - "LoRA também no encoder": compare encoder_decoder com decoder (main) no
     mesmo holdout, com tempo por época.
3. Se resultados-adaptive/sam3-smoke.json existir, acrescente uma seção "SAM 3
   com pesos reais" com os números dele.
4. Não altere código salvo para corrigir um bug que os resultados revelarem; se
   corrigir, adicione um teste em tests/adaptive-lora.test.py ou
   tests/adaptive-ai.test.mjs e rode `bash tests/adaptive.test.sh` e
   `npm run test:unit`.
5. Se mudar public/poligome-sam-adaptive.py ou public/poligome-sam-local.py,
   atualize os pinos SHA-256 nos instaladores (o teste
   "installers pin the adaptive module they download" e
   tests/sam-installers.test.sh apontam o que falta).
6. Faça commit na branch feature/adaptive-sam-lora. Não faça merge na main.

Regras: números só do results.json; quando um resultado for fraco ou
inconclusivo, escreva isso. Textos de interface existem em pt, en, fr e es
(app/lib/adaptive-copy.ts) e o teste de paridade exige os quatro.
```

## Segunda etapa (não começada)

- **Seleção por incerteza**: além da cobertura, priorizar imagens em que o
  adaptador ativo discorda de si mesmo entre caixa e clique, ou em que o IoU
  previsto é baixo.
- **Anotações suspeitas**: instâncias com loss alta persistente no treino,
  listadas para revisão em vez de usadas cegamente.
- **Logs reais de interação**: registrar (localmente) quantos cliques e
  correções cada máscara exigiu, para trocar os cliques simulados por medida
  real.
- **Várias sementes na curva de aprendizado**: hoje cada ponto é um treino só;
  2–3 sementes dariam a variância de treino diretamente.
- **Sugestões x lâmina nova**: no teste, a cobertura por embeddings pôs uma
  lâmina nova só em 6º lugar. Vale testar embeddings não agregados (ou do
  adaptador ativo) e medir precisão@k em mais domínios.
