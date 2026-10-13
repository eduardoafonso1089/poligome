# Validação local do SAM 3 — 13/10/2026

O checkpoint real carregou, treinou um LoRA de decoder e passou na comparação
com o caminho interativo oficial. O experimento sintético melhorou Dice, mas
não demonstrou economia de cliques a IoU 0,90. Não há ainda estudo de velocidade
com anotadores humanos nem validação CUDA neste computador.

## Ambiente e checkpoint

- Windows 10 Home, Intel i5-9300H, 4 núcleos/8 threads, aproximadamente 11,85 GiB
  de RAM. Havia cerca de 1,8 GiB livres no início.
- GTX 1050, 3.072 MiB, capacidade 6.1, driver 555.99. O runtime existente usa
  PyTorch **2.10.0+cpu**, torchvision 0.25.0+cpu, Python 3.12.10; CUDA indisponível.
  Todos os resultados abaixo são **CPU, float32**.
- SAM 3 0.1.0, revisão `8f0b7f4d4e7eda2ed606ebde6702c93359ad01da`.
- Arquivo original `C:\Users\lucas\Downloads\sam3.pt`: 3.450.062.241 bytes,
  SHA-256 `9999e2341ceef5e136daa386eecb55cb414446a00ac2b55eb2dfd2f7c3cf8c9e`.
- Código inicial: `5b6abd4c1da36f98347cc0c302735041ae977ec9`, branch
  `feature/adaptive-sam-lora`. O checkpoint e o runtime de produção não foram alterados.

## Treino e comparação HTTP

O runner enviou 24 imagens sintéticas de núcleos, com grupos separados. O split
congelado tinha 14 imagens/160 instâncias de treino, 4/36 de validação interna e
6/66 de holdout, em 6 grupos independentes. Uma semente, `1234`; decoder LoRA
rank 8, alpha 16, dropout 0,05, 28 alvos e 94.208 parâmetros treináveis, 6 épocas,
learning rate 0,0003. A melhor época foi a sexta; média de 66,79 segundos por época.

| Medida no holdout | Original | Adaptado |
| --- | ---: | ---: |
| Dice primário por imagem, média de caixa e ponto | 0,7360 | 0,8113 |
| Dice com caixa | 0,8858 | 0,8842 |
| IoU com caixa | 0,8150 | 0,8128 |
| Dice com ponto | 0,5862 | 0,7384 |
| IoU com ponto | 0,5127 | 0,6507 |
| Dice com caixa perturbada | 0,8397 | 0,8375 |
| NoC90 simulado, máximo 3 cliques | 2,3030 | 2,3788 |
| Falha em atingir IoU 0,90 até 3 cliques | 57,58% | 59,09% |

Delta Dice primário: **+0,07532**, IC exploratório por bootstrap de grupos
`[+0,02526; +0,12663]`, 500 reamostragens. O veredicto do avaliador foi
`improved`, baseado em Dice. Delta NoC90: **+0,07576**, IC
`[-0,05000; +0,17808]`. Portanto, esse veredicto **não comprova economia de
cliques ou tempo**. Os cliques são simulados; o teto de três cliques limita a interpretação.

O envio/extração das 24 imagens levou 1.752,3 segundos. Flips, comparações e
curva de aprendizado acrescentaram tempo; a sessão original passou de uma hora.
O monitor observou pico residente de aproximadamente 4,43 GiB e comprometido de
9,07 GiB no processo do conector. Esses tempos não são tempo humano de anotação.

**Limitação do primeiro comando:** treino e comparação terminaram, mas o CLI
falhou ao imprimir a seta `→` no console Windows cp1252, antes de executar sua
etapa de ativação/desativação. Não considerar esse CLI completo como aprovado.
A última cópia monitorada de `sam3-run.json` continua com estado
`evaluating/learning_curve`; o log do CLI registra que o treino chegou a
`completed` antes da exceção. Não alteramos o JSON para inventar um estado final.
Foi preservado o pacote exportado de 405.553 bytes, SHA-256
`b2071e28a4d780ea5b430d096372f74bd003cb3170248af98107555b38d16f57`.

O runtime original também não tinha `scikit-image`: o SAM 3 emitia aviso e
pulava seu pós-processamento interativo de componentes em CPU. A comparação
acima não valida esse pós-processamento completo. O teste suplementar abaixo
resolveu a dependência e tratou sua ausência como erro.

## Validação suplementar com o modelo real

Foi criada uma venv isolada em `work/sam3-validation-venv`, compartilhando os
pacotes existentes do SAM 3 por `.pth` e instalando `scikit-image==0.25.2` com
`numpy<2`. Os instaladores agora incluem e verificam essa dependência. Sua
[distribuição oficial](https://pypi.org/project/scikit-image/0.25.2/)
oferece wheel para Windows/Python 3.12.

`scripts/adaptive-sam3-parity.py` terminou com `passed: true` em 302,609 segundos:

- Carregamento auditado: 1.465 entradas esperadas e recebidas, sem chaves
  ausentes/inesperadas; 860.055.224 parâmetros do modelo base.
- Seis casos: imagem quadrada e retangular, ponto, positivo+negativo e caixa.
  IoU das máscaras **1,0 em todos**; maior diferença de logits
  `1,81198e-5`, tolerância `1e-3`. O pós-processamento oficial de buracos e
  pequenos componentes foi aplicado igualmente nos dois caminhos.
- LoRA recém-injetado preserva exatamente a saída; somente decoder, 28 alvos,
  94.208 parâmetros treináveis. Estratégia com encoder é recusada.
- Três passos de otimização sobre **uma imagem sintética em cache** alteraram
  os 56 tensores LoRA e preservaram o hash de todos os parâmetros originais.
  Isso valida mecânica de treino, não generalização.
- Busca textual `dark shapes`, limiar 0,1: sete detecções idênticas antes/depois
  do LoRA interativo.
- Exportar/importar preservou logits; novo diretório e projeto não herdaram
  métricas. Seis pacotes inválidos foram recusados mantendo o modelo ativo.
- Recriar o serviço no mesmo modelo restaurou o adaptador; desativar restaurou
  exatamente a previsão base. Essa recriação não equivale a reabrir um projeto
  no navegador ou reiniciar todo o processo.
- O pacote treinado pela sessão HTTP foi importado em uma instância nova do
  modelo e armazenamento: logits iguais à aplicação direta de seus tensores.
  O `adapter.pt` temporário original não foi preservado; não alegamos comparação
  independente com esse arquivo nativo perdido.

## Correções e regressões

- UTF-8 explícito no smoke e seus subprocessos. Regressão executa o CLI real
  sob `PYTHONIOENCODING=cp1252`, com respostas HTTP controladas: testa console e
  arquivo JSON, não qualidade do SAM 3.
- Encerramento do runner Windows remove apenas sua árvore de processos;
  regressão real verifica liberação de socket e arquivo por filhos da venv.
- Seleção da melhor época separada da paciência: após superar o ganho mínimo
  da base, mantém o maior Dice inclusive ganhos pequenos, sem reiniciar a
  paciência indevidamente. Ganhos abaixo do mínimo mantêm o adaptador identidade.
- `/predict` registra dispositivo, fingerprint da base e adaptador efetivo
  sob o lock de inferência. Busca textual SAM 3 não recebe atribuição ao LoRA.
- Pós-processamento CPU oficial testado com preenchimento de buraco e remoção
  de pequeno componente. Ambos falhavam por dependência ausente e passaram
  na venv isolada corrigida.

Resultados de regressão: suíte Python adaptive, **75 testes, 4 skips**;
os skips cobrem SAM 2 ausente e arquitetura SAM 3 opcional. Regressões de
metadata (2), pós-processamento (2) e runner/console (2) passaram separadamente.
Typecheck e testes JS específicos passaram. A execução ampla inicial de JS
teve 499 aprovados, 1 skip e 1 falha no fixture de instalação Linux executado
em Windows; não é uma suíte ampla inteiramente verde. Os contratos shell de
instaladores passaram no Ubuntu/WSL; os probes nativos de Windows passaram.

## Reproduzir e consultar evidências

Usar uma venv com as dependências dos instaladores e o checkpoint real:

```powershell
python scripts/adaptive-sam3-checkpoint.py --checkpoint C:\Users\lucas\Downloads\sam3.pt --device cpu --out resultados-adaptive/sam3-local
python scripts/adaptive-sam3-parity.py --checkpoint C:\Users\lucas\Downloads\sam3.pt --out resultados-adaptive/sam3-local/parity.json --portable-adapter resultados-adaptive/sam3-local/sam3-local-test.plora
python tests/sam3-checkpoint-runner.test.py
python tests/sam3-cpu-postprocessing.test.py
python tests/sam-prediction-metadata.test.py
```

Os artefatos locais em `resultados-adaptive/sam3-local/` não são versionados:
`environment.json`, `dataset-snapshot.json`, `sam3-run.json`, `checkpoint-test.log`,
`resource-samples.json`, `parity.json`, `parity-environment.json`, `parity.log`,
`sam3-local-test.plora` e logs de regressões. Pesos não entram no Git.
O CLI de seis épocas completo não foi repetido depois da correção de console;
a regressão de console e os testes reais suplementares validam etapas distintas.

Para medir produtividade humana, usar o fluxo descrito em
[Medição de esforço](adaptive-annotation-effort.md). Um teste automatizado do
editor com o conector real valida registro/atribuição, não velocidade humana.
