# Prompt para o Codex local — SAM 3, exportação e continuidade do Adaptive AI

Cole o bloco abaixo no Codex aberto na pasta do repositório Poligome, no
computador que contém `C:\Users\lucas\Downloads\sam3.pt`.

```text
Você é responsável por implementar a exportação/importação e a continuidade
de uso dos modelos adaptados do Poligome e validar o SAM 3/Adaptive AI no meu
computador usando o checkpoint real. Execute o trabalho, corrija problemas
confirmados e registre evidências. Não termine apenas com um plano.

CONTEXTO E ESCOPO
- Repositório: eduardoafonso1089/poligome.
- Branch: feature/adaptive-sam-lora. Trabalhe nela; não faça merge na main e
  não publique o site.
- Checkpoint real: C:\Users\lucas\Downloads\sam3.pt.
- No WSL2, o caminho correspondente é
  /mnt/c/Users/lucas/Downloads/sam3.pt.
- O LoRA do SAM 3 ajusta somente o decoder interativo de cliques e caixas.
  O backbone permanece congelado e o recurso não treina a busca por texto.
- O produto mostra gráficos, métricas e exemplos. O usuário decide ativar,
  manter o modelo anterior ou coletar mais dados. Não reintroduza um veredito
  automático de “convergiu”, “generaliza” ou “treino bem-sucedido”.

1. INSPECIONAR E PREPARAR
- Leia AGENTS.md, se existir, e:
  docs/adaptive-ai.md
  docs/adaptive-ai-review.md
  docs/adaptive-ai-next-steps.md
  scripts/adaptive-sam3-checkpoint.py
  scripts/adaptive-smoke.py
- Confira git status, remotes e a branch. Preserve mudanças locais existentes.
  Atualize a branch por fast-forward quando possível; não use reset --hard,
  limpeza de arquivos ou force push para resolver divergências.
- Confirme que o checkpoint existe e calcule SHA-256. Não baixe outro arquivo
  e o apresente como se fosse o meu checkpoint.
- Identifique Windows nativo ou WSL2, Python/venv, RAM, GPU, VRAM, versão do
  driver e disponibilidade real de CUDA/MPS. Registre torch/torchvision/SAM 3
  e a revisão do SAM 3 que o instalador do Poligome fixa.
- Use o ambiente SAM 3 do instalador quando disponível. Se faltarem
  dependências, prepare um venv isolado compatível com o instalador. Não
  atualize às cegas o ambiente de produção nem troque as revisões fixadas.
- Não altere configurações de segurança do Windows nem desative antivírus.

1A. IMPLEMENTAR EXPORTAÇÃO, IMPORTAÇÃO E RETOMADA COM FOCO EM UX

Objetivo: uma pessoa treina hoje, fecha o programa e continua amanhã; também
leva aquele modelo para outro computador ou usa-o em um novo dataset sem
repetir o treino. Implemente esse fluxo, não apenas sua documentação.

- Inspecione primeiro o armazenamento atual. Os adaptadores e o estado ativo
  já são persistidos pelo conector; o .plgm preserva a identidade do projeto.
  Confirme quais partes da retomada já funcionam antes de criar outro sistema.
- Apresente o modelo por nome escolhido pelo usuário, modelo base, data e
  versão. Evite obrigar o usuário a compreender run_id, fingerprints ou nomes
  de camadas para escolher um modelo. Esses detalhes podem ficar em avançado.
- No painel, ofereça ações claras: “Exportar modelo adaptado”, “Importar
  modelo adaptado”, “Usar neste projeto”, “Desativar” e “Voltar ao anterior”.
  Ações destrutivas não podem ser confundidas com desativação.
- O formato padrão deve ser um pacote portátil compacto do adaptador LoRA,
  com os tensores e metadados suficientes para aplicar sobre o modelo base
  correto: versão do formato, família/ID, fingerprint do checkpoint base,
  estratégia, rank/alpha, camadas e formas, nome/versão e integridade do
  pacote. Escolha uma extensão e documente seu contrato.
- Explique no produto em linguagem simples que esse pacote requer o SAM base
  correspondente. Não apresente um adaptador isolado como checkpoint
  autossuficiente. Não duplique por padrão vários GB de pesos base.
- Se oferecer um checkpoint completo com LoRA incorporado, use uma ação
  separada com estimativa de tamanho. Implemente a fusão de pesos de forma
  compatível com o carregador oficial, sem serializar wrappers/código Python,
  e comprove paridade da inferência. Só disponibilize essa opção se ela tiver
  sido realmente implementada e validada para o SAM 3. Caso contrário,
  entregue a exportação compacta funcional e registre a opção completa como
  pendente, sem fingir que existe.
- Exportar não deve alterar o adaptador ativo, interromper a inferência nem
  apagar a rodada. Imagens, máscaras e dados privados não entram no pacote
  compacto. Resultados antigos podem ser incluídos como proveniência da
  origem, sem nomes/caminhos privados e sem virarem métricas do novo dataset.
- Importar deve validar limites de tamanho e conteúdo, hashes, versão,
  metadados, nomes/formas das camadas e compatibilidade antes de tocar no
  modelo vivo. Evite path traversal e execução de código serializado;
  mantenha carregamento seguro dos tensores. Uma importação inválida precisa
  deixar o modelo atual intacto e explicar a incompatibilidade ao usuário.
- Uma importação deve criar um item/versionamento local próprio sem exigir
  que o projeto ou diretório de treino originais ainda existam. Não basta
  copiar um run_id que dependa de arquivos na máquina de origem.
- Ao usar o adaptador em outro dataset, preserve o projeto e o modelo de
  origem. A aplicação no novo projeto deve ser uma escolha explícita.
  Mostre “ainda não avaliado neste projeto” até haver comparação nele;
  não reutilize Dice/IC anteriores como prova de desempenho no novo domínio.
- Aplicar em outro dataset deve funcionar para inferência sem exigir treino.
  Se oferecer novo ajuste a partir do importado, explicite a inicialização,
  preserve a versão anterior e crie outra versão. Não esconda risco de
  esquecimento nem misture validação de origem e destino. Retreinar do modelo
  base e continuar um adaptador são operações diferentes.
- Retomada: salve o projeto, encerre navegador e conector, inicie novamente
  e reabra o .plgm. O usuário precisa identificar o modelo usado, suas
  configurações e as anotações preservadas, e conseguir continuar. Se o
  modelo não estiver disponível, ofereça importação ou instalação do base
  correspondente, com explicação clara; não troque silenciosamente de modelo.
- Trocar de projeto deve informar qual adaptador está realmente em uso pelo
  conector e permitir selecionar explicitamente o modelo daquele projeto.
  Evite mostrar “SAM original” quando um adaptador de outro projeto está
  afetando as previsões.
- Considere uma opção “Salvar projeto com modelo adaptado” para um .plgm
  portátil, se a arquitetura suportar incorporar o pacote compacto. A
  exportação/importação independente deve funcionar mesmo sem essa opção.
- Permita nomes duplicados com identificação de versão/data; trate cancelamento
  de download/importação, conector offline, falta de espaço e pacote inválido.
  Não dependa de caminhos fixos de Windows para a portabilidade do pacote.

Critérios de aceitação adicionais, com o meu SAM 3 real:
A. Treinar → nomear → exportar → desativar → importar em armazenamento isolado
   novo → usar → repetir cliques/caixas. A inferência deve corresponder à do
   adaptador exportado, na mesma precisão/dispositivo e tolerância justificada.
B. Exportar → importar em outro projeto/dataset → segmentar sem novo treino.
   O projeto original permanece íntegro; o destino não herda sua validação.
C. Salvar .plgm → fechar navegador/conector → reabrir → continuar anotando
   com o modelo escolhido, sem perda de máscaras/configuração.
D. Pacote corrompido, base diferente, versão não suportada e tentativa de
   caminhos maliciosos são recusados sem alterar o modelo ativo.
E. Se houver exportação completa com pesos fundidos, carregá-la pelo caminho
   oficial e comparar com base + adaptador. Sem essa prova, não marque a opção
   de checkpoint completo como concluída.
F. As ações devem ser testadas com cliques reais no navegador, nos quatro
   idiomas e em viewport móvel/desktop; explique o fluxo como a um usuário
   que conhece anotação, mas não conhece LoRA.

2. PRIMEIRO TESTE REAL EM CONECTOR ISOLADO
- Com o Python do venv SAM 3, execute:

  python scripts/adaptive-sam3-checkpoint.py --checkpoint "C:\Users\lucas\Downloads\sam3.pt" --out resultados-adaptive/sam3-local

- No WSL2, use o caminho /mnt/c/... e o Python do ambiente SAM 3.
- Esse script usa porta e pasta de dados isoladas, confirma a família SAM 3
  e roda um treino curto com núcleos sintéticos, comparação, ativação,
  desativação e reversão. Leia o código e os logs em vez de presumir sucesso.
- Confirme que o resultado registra model_id=sam3-concepts, family=sam3,
  dispositivo efetivo e o fingerprint do checkpoint treinado.
- Confira que carregar não deixou pesos importantes sem inicializar. Erros
  de chaves/formas incompatíveis devem ser diagnosticados, não ignorados com
  strict=False genérico. Pesos aleatórios não validam meu checkpoint.
- Se a carga falhar, preserve o traceback e investigue a causa. Se houver OOM,
  registre em qual etapa, RAM/VRAM e configuração. Não declare que passou
  porque o script terminou, uma exceção foi capturada ou o teste foi pulado.

3. PARIDADE E ISOLAMENTO DO LoRA
- Use o checkpoint real para comparar o caminho interativo do Poligome com
  o predict_inst oficial, nas mesmas imagens, prompts e precisão.
- Teste clique positivo, positivo + negativo e caixa em imagens quadradas
  e retangulares. Compare logits/máscaras com tolerância numérica justificada;
  não exija igualdade bit a bit entre backends ou precisões diferentes.
- Confira que o adaptador recém-inicializado não altera a saída do base.
- Verifique que somente lora_A/lora_B previstas recebem gradientes e mudam;
  os pesos originais, o backbone e o decoder de conceitos não devem mudar.
- Compare busca por texto antes e depois de ativar o LoRA usando o mesmo
  conceito e threshold, no mesmo device/precisão. Registre qualquer diferença.
- Desativar deve restaurar a saída original no mesmo ambiente. Teste reverter
  para o adaptador anterior e reabrir o conector reaplicando o adaptador ativo.
- Teste arquivo corrompido, modelo base incompatível e rodada incompleta:
  devem ser recusados sem deixar a inferência parcialmente modificada.
- A opção encoder_decoder deve ficar indisponível para SAM 3 e ser recusada
  também pela API. Não implemente LoRA no encoder do SAM 3 neste trabalho.

4. QUALIDADE DO TREINO E ESTATÍSTICA
- Reproduza o domínio de núcleos sintéticos dos helpers do repositório com
  SAM 3 pré-treinado. Caso existam imagens reais com máscaras e autorização
  nesta máquina, faça uma avaliação adicional e identifique sua origem.
- Separe grupos de origem inteiros entre gradiente, validação interna e
  avaliação final. Fixe e registre essa divisão. Não trate várias máscaras
  de uma lâmina/paciente como várias origens independentes.
- Compare original e candidato no mesmo holdout e com os mesmos prompts.
  Registre: loss de treino/validação por época; Dice, IoU e Boundary IoU;
  época restaurada; resultado de clique/caixa/caixa perturbada; ganho por
  imagem; bootstrap agrupado; número de grupos; NoC e taxa de falha juntos;
  parâmetros treináveis; estratégia; precisão; tempo e RAM/VRAM de pico.
- Se houver recursos, use três sementes com a mesma divisão. Separe variação
  entre treinos da incerteza do holdout. Se isso não rodar, registre uma única
  semente e sua limitação.
- Não ajuste hiperparâmetros com base no holdout e depois o apresente como
  teste independente. Se fizer ajustes após observar resultados, classifique
  como exploratórios; uma confirmação científica exige novas origens.
- Não prometa “X imagens serão suficientes”. Uma projeção de curva é
  exploratória e não substitui novos dados nem mede variância entre treinos.
- Um resultado pequeno, negativo ou inconclusivo também é válido: relate-o
  sem escolher apenas exemplos favoráveis. O sistema não precisa diagnosticar
  convergência para o usuário decidir se o adaptador é útil.

5. UI/UX REAL, PELO NAVEGADOR
- Suba o site local da branch e um conector de teste isolado com meu SAM 3.
  Aponte o site local para ele. Use um perfil de navegador limpo.
- Use Playwright ou o navegador disponível para interagir com a interface.
  Não substitua esta etapa por screenshots de HTML renderizado no servidor
  ou por respostas de API mockadas.
- Importe um projeto de teste com imagens e máscaras. Verifique:
  abrir/reabrir o painel, sincronizar, excluir a última máscara,
  anotações modificadas ainda não enviadas e mudança de projeto;
  configurações do treino, progresso, cancelamento e erros;
  comparação e exemplos, incluindo o tipo de prompt usado em cada exemplo;
  ativação explícita, desativação, reversão e troca de modelo;
  escolha de candidato fraco vinculada à rodada selecionada;
  sugestões de imagens e abertura da imagem correta no editor;
  ausência da opção de encoder no SAM 3.
- Antes de ativar e depois de ativar, execute o mesmo clique/caixa no editor
  com o modelo real. Registre máscara/área/IoU/Dice quando houver referência.
  Verifique que /predict identifica o adaptador correto e invalida o cache
  quando necessário. Confirme restauração após desativar.
- Teste o texto do SAM 3 antes/depois. A busca por texto não deve ser atribuída
  ao aprendizado do LoRA interativo.
- Teste pt/en/fr/es e viewport de aproximadamente 390 px e desktop. Procure
  overflow, controles inacessíveis, mensagens enganosas e erros no console.
- Não use meus projetos reais para treinar, ativar ou apagar dados sem que
  eles tenham sido explicitamente escolhidos para o teste. Gere fixtures
  sintéticas para o fluxo padrão.

6. GPU E CPU
- Se houver GPU compatível, valide o device efetivo com os logs e consumo.
  Não chame uma rodada em CPU de validação CUDA.
- Confira BF16 nativo quando disponível; em CUDA sem BF16 nativo, verifique
  o fallback do backbone/inferência e o treino do decoder em FP32. Não
  introduza treino FP16 sem tratar estabilidade e GradScaler.
- Teste CPU separadamente se RAM/tempo permitirem. Um modo não executado
  fica como pendência, sem extrapolar resultados de outro hardware.

7. CORREÇÕES E VERIFICAÇÃO
- Corrija somente problemas confirmados dentro deste escopo. Para cada bug,
  acrescente um teste de regressão do comportamento.
- Se mudar public/poligome-sam-adaptive.py ou public/poligome-sam-local.py,
  atualize os SHA-256 correspondentes nos instaladores Bash, PowerShell e BAT
  que os fixam. Rode os testes que conferem esses hashes.
- Preserve a paridade dos textos em pt/en/fr/es.
- Rode typecheck, suíte JS, suíte Python e testes dos instaladores. Registre
  testes pulados e diferenças entre testes de arquitetura aleatória,
  backend pré-treinado e UI real.
- No WSL2/Bash:
  POLIGOME_ADAPTIVE_PYTHON=/caminho/venv-sam3/bin/python bash tests/adaptive.test.sh
  POLIGOME_TEST_SAM3=1 /caminho/venv-sam3/bin/python tests/adaptive-lora.test.py -k Sam3IntegrationTests
  npm run typecheck
  npm run test:unit
  bash tests/sam-installers.test.sh
- No Windows nativo, use o Python do venv diretamente e PowerShell para os
  testes nativos disponíveis; Bash pode rodar via WSL2. Não confunda testar
  contratos de scripts com instalar e executar nativamente no Windows.

8. ENTREGAR
- Grave resultados e logs em resultados-adaptive/sam3-local/.
- Crie docs/adaptive-sam3-local-validation.md com os testes de exportação,
  importação, retomada e reutilização em outro dataset, além de ambiente, checkpoint/revisão,
  configuração, tabelas medidas, falhas/correções, evidências do navegador e
  limitações. Diferencie inferência original, inferência adaptada e texto.
- Inclua um comando reproduzível para cada execução relevante e um resumo
  legível do JSON. Não versione checkpoints nem dados privados.
- Faça commit e push das correções/documentação na branch
  feature/adaptive-sam-lora depois de verificar. Não force push, não faça
  merge na main e não publique o site.
- Na resposta final, diga claramente o que passou, o que falhou, o que não
  rodou, se houve ganho observado e quais dados/hardware sustentam isso.
  Nenhum número deve ser inventado ou reaproveitado de outra rodada como
  se tivesse sido medido nesta.
```
