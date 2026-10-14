# Instalação e uso real no Ubuntu — SAM e BYOM

Teste realizado em 14/10/2026, pelo site público https://poligome.com.

**Atualização após a auditoria:** as duas falhas descritas abaixo foram
corrigidas no projeto local. A validação das correções está no fim deste
documento. O site público não foi atualizado nesta sessão.

**Resultado: instalação, segmentação, troca de SAM e BYOM funcionaram em CPU.
Há uma falha confirmada na persistência da escolha do SAM ao instalar outro
modelo: o próximo arranque pode usar um modelo diferente daquele confirmado
na interface. No Firefox, a permissão de rede local pendente foi apresentada
como conector desligado. Portanto, o fluxo não está completamente livre de
problemas.**

## Ambiente e método

- Ubuntu 24.04.4 LTS, x86_64; Intel Core i9-12900F; 32 GB de RAM.
- Python 3.12, Docker Engine 29.7.1, Chromium 151.0.7922.34 e Firefox 153.0,
  controlados por Playwright 1.55.0.
- Página pública, instaladores publicados, pesos oficiais, conector FastAPI e
  contêineres Docker reais. Nenhuma resposta de SAM ou BYOM foi simulada.
- Instalação nova do ambiente Python e dos checkpoints. Havia arquivos antigos
  do conector e registros BYOM, mas nenhum venv ou checkpoint instalado.
  O estado anterior foi copiado para
  `~/.poligome-sam.backup-ubuntu-audit-20261014` antes dos testes.
- Foram usados os dados de demonstração do próprio editor. As imagens e as
  respostas foram transmitidas somente aos serviços locais.
- O link de download do SAM foi acionado no navegador. A gravação do download
  por CDP falhou no controlador de testes; o mesmo arquivo público foi salvo
  com `curl`. Os comandos de instalação seguiram o guia exibido na interface.

O instalador SAM e a CLI BYOM publicados têm o mesmo SHA-256 dos arquivos
locais. O conector instalado também corresponde ao repositório, no commit
`96d4f79fa93538637c26244b5121072fe2b77b99`.

## Fluxos verificados

| Fluxo real | Resultado |
| --- | --- |
| Instalar SAM 2.1 Small com a opção CPU do guia | Ambiente Python, dependências, checkpoint e conector prontos |
| Detectar o conector e usar o modelo no site | Funcionou após permitir acesso à rede local no Chromium |
| Segmentar por clique e salvar | 7 anotações da demo → 8; contorno visível na imagem |
| Instalar Tiny com Small em execução | Reutilizou o runtime; o modelo em execução continuou disponível |
| Trocar Small → Tiny → Small pela interface | Cerca de 3–4 s por troca; CPU e anotações preservadas |
| Segmentar por caixa com Tiny | Gerou e salvou um novo polígono |
| Instalar e usar MedSAM2 | Checkpoint público instalado; clique, ponto negativo e salvamento funcionaram |
| Trocar MedSAM2 → Small | Modelo ativo e seleção persistida passaram a Small |
| Pedir um modelo não instalado | HTTP 409 com instrução de instalação; Small continuou disponível |
| Preparar exemplos BYOM pela CLI publicada | Imagem Docker construída; Otsu e Watershed responderam `/ping` 200 |
| Descobrir os dois BYOM na interface | Ambos apareceram como disponíveis |
| Pré-anotar com Otsu | 50 anotações COCO → 100 objetos editáveis |
| Pré-anotar com Watershed | 16 anotações COCO → 32 objetos editáveis |
| Desfazer cada pré-anotação | Restaurou a contagem anterior sem remover as anotações existentes |
| Construir template BYOM e importar pela interface | Contêiner na porta 8082 registrado como `byom-ubuntu-audit` |
| Executar o BYOM importado | Inferência real, resultado visível e desfazer corretos |
| Pré-anotar as três imagens com Otsu | Três chamadas reais; 50, 34 e 26 anotações COCO; 220 objetos editáveis |
| Parar um contêiner | Otsu desabilitado; Watershed e SAM continuaram disponíveis |
| Reiniciar Otsu pela CLI | Redescoberta e nova inferência funcionaram |
| Instalar serviço de usuário com terminal ocupando a porta | Recusa clara, instruindo fechar o terminal anterior |
| Instalar serviço após encerrar o conector do terminal | Serviço ativo; segmentação pelo site funcionou |
| Trocar Small → Tiny → Small sob systemd | Trocas funcionaram e preservaram CPU |
| Reiniciar o serviço após troca explícita | Small e CPU preservados |

Nos exemplos BYOM, cada anotação COCO contém contorno e ponto-chave. Por isso
o número de objetos editáveis é maior que o número de entradas COCO; a caixa
da mesma entrada não é duplicada quando o contorno é aproveitável.

## Falha confirmada: escolha para o reinício diverge da interface

Impacto: o usuário confirma Small como modelo em uso, fecha o terminal e, ao
religar, recebe MedSAM2. Não houve perda de anotações, mas o modelo de inferência
mudou sem uma nova escolha do usuário naquele arranque.

Reprodução realizada com os arquivos publicados:

1. Instalar Small, mantê-lo ativo e confirmar seu uso no editor.
2. Em outro terminal, executar:
   `POLIGOME_DEVICE=cpu bash poligome-sam-macos-linux.sh medsam2-latest`.
3. O instalador informa que MedSAM2 está instalado e que o conector continua
   usando o modelo anterior, para ativação posterior pela interface.
4. Abrir a ficha do Small e clicar em **Usar este modelo**.
5. A interface e `/health` confirmam `sam2.1-hiera-small`, mas
   `~/.poligome-sam/selected-model.txt` contém `medsam2-latest`.
6. Encerrar o conector e executar:
   `POLIGOME_DEVICE=cpu bash poligome-sam-start-macos-linux.sh`.
7. O conector e o editor passam a `medsam2-latest`. As 10 anotações existentes
   permaneceram intactas durante esta reprodução.

Causa observada no código: o ramo `other-model` do instalador grava o modelo
recém-instalado como selecionado. Ao confirmar um modelo que já está pronto,
`connect()` em `app/editor/presentation/use-sam-catalog.ts` retorna sucesso sem
chamar `/load`. Esse retorno não restaura a seleção persistida. O próprio
`/load` também retorna imediatamente para um modelo já ativo, antes de
persistir a seleção. Iniciador e serviço leem `selected-model.txt`.

Uma troca efetiva para outro modelo e de volta ao desejado restabeleceu a
seleção correta. Isso foi verificado com MedSAM2 → Small e com as trocas sob
systemd. É um contorno para o problema, não uma correção do produto.

Evidências: `selection-before-restart.json`, `selection-after-restart.json`,
`reproduce-selection.log`, `restart.log` e as capturas dos cenários 16 e 17.

## Problema de orientação no Firefox 153

O editor público abriu no Firefox, mas a chamada ao conector expirou enquanto
o navegador aguardava permissão de acesso à rede local. O console registrou
**Local Network Access permission required**. As permissões `local-network`
e `loopback-network` estavam em `prompt`; `local-network-access` não era um
nome de permissão reconhecido por esse navegador.

Ao mesmo tempo, abrir `http://127.0.0.1:7860/health` diretamente em outra aba
do mesmo navegador retornou Small em estado `ready`. Apesar disso, o painel
do site mostrou **Conector desligado** e orientou instalar ou iniciar o
conector. Essa orientação não corresponde ao bloqueio observado e pode levar
o usuário a repetir a instalação sem resolver a permissão.

Não foi possível responder ao pedido nativo de permissão pelo controlador
headless usado no teste. Portanto, a inferência após concessão da permissão
no Firefox permanece não validada; o resultado não prova uma incompatibilidade
definitiva desse navegador com o conector.

Evidências: `firefox-diagnostic.json` e `27-firefox-editor.png`.

## Pré-requisitos e limites

- O Chromium bloqueou inicialmente a comunicação HTTPS → loopback. O site
  mostrou **Acesso à rede local bloqueado**. Concedida essa permissão no
  contexto de teste, a conexão funcionou com as proteções do navegador ativas.
- A GPU desta máquina não pôde ser validada: `nvidia-smi` retornou
  `Driver/library version mismatch`. Todos os testes de inferência usaram a
  opção CPU disponibilizada no guia.
- SAM 3: guia e pré-requisitos inspecionados; o checkpoint respondeu HTTP 401
  sem autenticação. Não houve instalação ou inferência de SAM 3, nem troca
  entre runtimes SAM 2 e SAM 3.
- Não foram instalados Base+, Large ou os demais ajustes médicos. Large foi
  usado apenas para testar a recusa de ativação sem checkpoint.
- A inferência MedSAM2 valida a integração; não avalia qualidade médica.
- O BYOM próprio foi criado com o template oficial, sem pesos externos.
  Não foi avaliado um modelo privado do usuário.
- O serviço foi instalado, usado, trocado e reiniciado. Não houve reinício do
  computador nem teste de novo login gráfico.

## Verificação complementar e artefatos

`npm run test:sam-installers` e `npm run test:byom` terminaram com código 0.
A suíte SAM pulou a verificação PowerShell dependente de `pwsh`, ausente nesta
máquina. Esses testes complementam os testes reais acima.

Capturas, controladores reproduzíveis por fase, requisições e logs estão em
`interaction-audit/ubuntu-live-2026-10-14/`. `summary.json` reúne a última
tentativa de cada cenário; `results.ndjson` preserva também as tentativas
iniciais. Houve ajustes de seletores no controlador, que foram retestados.
O cenário 17 passou como **reprodução da falha**, não como aprovação do produto.
Foram concluídos 24 cenários no Chromium, incluindo essa reprodução e a
inspeção do guia de SAM 3. A tentativa adicional de inferência no Firefox
não passou pelo bloqueio de permissão descrito acima.

Nenhum código de aplicação ou instalador foi alterado nesta auditoria.
Os modelos instalados foram mantidos; o serviço temporário, o BYOM temporário
e os processos de teste foram removidos ou encerrados ao finalizar.

## Correções e validação posterior

- Instalar outro SAM preserva `selected-model.txt` e encerra apenas o estado
  de instalação pendente. O comportamento foi alinhado no bash e no instalador
  nativo de Windows.
- Confirmar o modelo já carregado passa por `/load`, que salva a escolha sem
  reiniciar o modelo. A API também informa falha se não conseguir gravar a
  seleção. As somas SHA-256 dos três instaladores foram atualizadas para o
  conector corrigido.
- A consulta de permissão prefere `loopback-network`, usado pelo Firefox
  atual, e aceita `local-network-access` e `local-network` como alternativas.
  O hook acompanha o evento nativo de mudança de permissão, permitindo a
  reconexão automática quando o usuário concede acesso.

Validação local:

| Verificação | Resultado |
| --- | --- |
| TypeScript e suíte JavaScript completa | 558 testes passaram |
| Ciclo de vida do conector | 10 testes passaram; as regressões de confirmação foram reproduzidas antes da correção |
| Instaladores SAM e suíte BYOM | Passaram; verificação PowerShell nativa continua pulada por ausência de `pwsh` |
| Build estático e build do Worker | Passaram; artefato do Worker validado |
| Auditoria Chromium de IA | 44 cenários passaram, incluindo confirmação persistida sem recarga |
| Guias de instalação | 8 cenários passaram, quatro idiomas em 1440 e 360 px |
| Instalação real de MedSAM2 com Small ativo | Modelo ativo e seleção persistida continuaram Small; nenhuma retomada pendente |
| Firefox com a compilação corrigida e o conector real | Confirmou Small sem recarga, salvou segmentação, trocou Small → Tiny → Small e executou BYOM com desfazer |
| Permissão nativa do Firefox com a consulta corrigida | Exibiu a orientação de permissão pendente e reconectou automaticamente após conceder acesso |
| Reinício real após confirmação | Small em CPU preservado |
| ESLint dos arquivos alterados | 0 erros; 2 avisos preexistentes de hooks |

Para validar a compilação no Firefox sem publicar, os arquivos estáticos
locais foram servidos por interceptação apenas no navegador de teste. Essa
interceptação altera a aplicação de restrições de rede do navegador; por isso
o pedido nativo de permissão recebeu uma verificação separada, usando o
documento público e a consulta de permissão corrigida injetada no contexto
descartável, sem interceptar requisições. As chamadas de inferência usaram o
conector, os pesos e o Docker reais.

Logs e capturas das correções: `interaction-audit/ubuntu-fixes-2026-10-14/`.
Os primeiros testes encontraram a dependência local `yaml` ausente e um
artefato antigo do Worker; a dependência foi restaurada com a integridade do
lockfile verificada, o artefato foi reconstruído e a suíte completa passou.

Ao concluir as correções, o conector local atualizado permaneceu ligado com
Small em CPU para uso no navegador. O servidor de teste foi encerrado e Otsu
voltou ao estado parado que tinha antes dessa etapa. Não há serviço de login
criado por esses testes.

## Verificação posterior dos fluxos Windows

A revisão solicitada depois das correções encontrou mais uma divergência no
WSL2: o `.bat` podia confirmar no Windows o modelo recém-instalado, mesmo que
o conector Linux continuasse usando o anterior. Além disso, ao reiniciar depois
de trocar pelo editor, a cópia antiga do Windows podia substituir a escolha
mais recente do WSL.

O instalador agora espelha a seleção efetivamente confirmada pelo WSL e só
remove a retomada Windows após a gravação bem-sucedida. O iniciador relê a
seleção do WSL antes de consultar o conector ou iniciar o modelo. IDs vazios
ou desconhecidos não substituem a escolha anterior.

Foi usado PowerShell 7.6.7 portátil no Ubuntu, obtido da distribuição oficial
da Microsoft com SHA-256 conferido. Dessa forma, as verificações PowerShell
antes puladas também puderam ser executadas:

| Verificação | Resultado |
| --- | --- |
| `sam-native-connector.test.ps1` | Download, integridade, fallback, uso offline e autoatualização passaram |
| `sam-windows-state.test.ps1` | Handlers nativos de modelo já ativo/outro instalado passaram; sincronização do iniciador conferida para os dez modelos e entradas vazias/inválidas |
| `sam-wsl-state.test.py` | Seis testes executaram a função bash real embutida no `.bat`; incluíram instalação de outro modelo, ativação, interrupção, concorrência e falha de gravação |
| `sam-connector-lifecycle.test.py` | Confirmação sem reinício preservada; os dez modelos mantêm o código de saída 75 usado pelo lançador Windows |
| `byom-native.test.ps1` | Validação da CLI nativa e orientação para contêiner importado parado passaram |
| `npm test` com `pwsh` disponível | Passou, incluindo os 558 testes JavaScript e as suítes SAM/BYOM |

As regressões PowerShell de seleção e integridade também foram adicionadas
ao job `native-ai`, que usa `windows-latest` no GitHub Actions.

**Limite:** não foi executada uma instalação completa em um Windows real nesta
máquina Ubuntu. Argumentos de processos Windows, execução pelo `cmd.exe`,
integração com uma distribuição WSL2 real e inferência com GPU Windows ainda
dependem desse ambiente. O job Windows foi atualizado, mas não foi disparado
remotamente nesta sessão.

Evidências desta etapa: `interaction-audit/windows-compatibility-2026-10-14/`.
