# Revisão dos fluxos SAM e BYOM

Data: 14/10/2026. Revisão do código local e execução de testes no Windows e WSL2.

Os problemas encontrados foram corrigidos. Os fluxos exercitados passaram nos
testes descritos abaixo. Essa conclusão cobre instalação, descoberta, ativação,
troca e uso conforme o contrato do aplicativo; não certifica a inferência de
qualquer modelo BYOM externo nem substitui testes com todos os pesos e GPUs.

## Correções

| Problema | Comportamento após a correção |
| --- | --- |
| A ferramenta SAM mantinha capacidades antigas após trocar o modelo | Ferramenta e central compartilham o mesmo estado do conector; texto aparece/desaparece conforme o modelo carregado |
| Propostas antigas podiam continuar visíveis ao trocar a conexão/modelo | A troca cancela a requisição e descarta prompts/propostas; anotações já salvas permanecem |
| Parar de usar SAM alterava apenas a seleção da central | A ferramenta ativa volta para seleção manual e descarta a proposta |
| Retornar à aba depois da primeira instalação não ativava automaticamente o SAM | O primeiro modelo pronto é adotado sem pedir uma recarga; uma desativação explícita continua respeitada |
| Um conector encontrado durante o carregamento podia permanecer assim na interface | A saúde é acompanhada até sair de `loading` |
| Endereço em memória e endereço salvo podiam divergir se o armazenamento fosse bloqueado | SAM e BYOM usam o endereço do estado compartilhado; respostas de operações BYOM no endereço antigo não sobrescrevem a nova conexão |
| Windows nativo reutilizava a decisão de dispositivo da família anterior | A troca reavalia o runtime de destino; CPU explicitamente escolhida continua valendo |
| Falha ao salvar a seleção podia relançar o modelo errado no Windows | O pedido de troca é recusado antes do reinício, mantendo o modelo atual |
| Falha de substituição do processo podia deixar o navegador aguardando o modelo novo até o prazo final | O erro do conector é comunicado imediatamente mesmo quando a saúde ainda identifica o modelo anterior |
| Descoberta sequencial de BYOM podia exceder o prazo e esvaziar toda a lista | Verificações em paralelo, com até 16 trabalhadores, e prazo de 30 segundos no cliente; ordem estável preservada |
| Portas inválidas da CLI PowerShell podiam gerar erro de conversão e continuar com o padrão | Valores inválidos ou ausentes são recusados antes de acessar Docker |
| BYOM importado sem imagem Docker gerava uma tentativa de início incompreensível | A CLI explica que é preciso iniciar o contêiner original ou registrar a imagem, antes de remover qualquer contêiner |
| Guia BYOM podia sugerir PowerShell para um conector no WSL2 | O guia segue o sistema informado pelo conector, com escolha manual disponível |
| Documentação descrevia Windows como apenas WSL2 | Caminhos nativo e WSL2 documentados, com diretórios e CLIs correspondentes |

As somas SHA-256 dos três instaladores foram atualizadas para o conector alterado
e conferidas pela suíte dos instaladores.

## Matriz revisada

| Ambiente | SAM | BYOM | Evidência nesta revisão |
| --- | --- | --- | --- |
| Linux / WSL2 | 4 SAM 2.1, 5 MedSAM2 e SAM 3 | CLI bash e contrato de contêiner | Scripts executados no WSL2 com dependências/downloads simulados; contrato HTTP dos exemplos executado com Python |
| Windows nativo | Os mesmos 10 IDs e aliases | CLI PowerShell | Catálogos comparados; funções nativas executadas; argumentos de processo e sondagem HTTP reais; ciclo de troca testado sem carregar pesos |
| macOS Apple Silicon, 14+ | 4 SAM 2.1 e 5 MedSAM2 | CLI bash com Docker | Os nove caminhos SAM executados com `uname`/`sw_vers` simulados; guia da CLI validado no navegador |
| macOS Intel / macOS anterior a 14 | Recusa explícita do instalador | Independente das restrições SAM, exige Docker e conector compatível | Recusas SAM verificadas antes de download |
| SAM 3 no macOS | Não oferecido pelo instalador | Não altera o contrato BYOM | Recusa verificada antes de download |

BYOM usa serviços independentes: escolher outro contêiner não recarrega o SAM.
Foram verificados os dois exemplos oficiais, Otsu e Watershed, polígonos,
caixas, pontos, metadados opcionais, registros inválidos e descoberta simultânea
de 20 registros. Dois BYOMs distintos foram usados na interface, preservando o
resultado do primeiro e as anotações manuais ao executar o segundo.

A base Docker fixada no exemplo foi consultada no registro: seu índice OCI
contém `linux/amd64` e `linux/arm64/v8`. Isso confirma a presença das arquiteturas
na base, sem provar o build completo do exemplo em cada uma.

## Verificações executadas

| Verificação | Resultado |
| --- | --- |
| TypeScript (`npm run typecheck`) | Passou |
| Suíte JavaScript, exceto o teste de instalação de Node que exige shell Linux | 478 testes passaram; 1 teste de HTML do build foi pulado por ausência do artefato Vite |
| Interface Chromium (`node scripts/ai-flow-audit.mjs`) | 44 cenários passaram, incluindo todos os modelos SAM e os quatro hosts do guia BYOM |
| Instaladores (`bash tests/sam-installers.test.sh`, no WSL2) | Passou, incluindo os nove caminhos macOS simulados, retomada, downloads truncados, seleção e matriz dos dez IDs |
| BYOM (`bash tests/byom.test.sh`, no WSL2) | Passou, incluindo os exemplos HTTP e o ciclo de vida do conector |
| Ciclo do conector (`tests/sam-connector-lifecycle.test.py`) | 9 testes passaram no Windows e no WSL2, sem pesos |
| Origem do instalador nativo (`tests/sam-native-connector.test.ps1`) | Passou no PowerShell do Windows |
| Processo nativo (`tests/sam-native-installer.test.ps1`) | Passou usando Python do venv SAM 3: argumentos com espaços/aspas, CLI HF e saúde por dispositivo |
| CLI BYOM nativa (`tests/byom-native.test.ps1`) | Passou no PowerShell do Windows |
| ESLint dos arquivos TypeScript alterados | 0 erros; 26 avisos, incluindo os avisos de hooks do editor |
| `git diff --check` | Passou |

O relatório dos cenários Chromium está em
`interaction-audit/ai-flow-audit.json` (artefato local ignorado pelo Git).

## Limites da evidência

- Os downloads e checkpoints da matriz SAM foram simulados. Não foram
  reinstalados os dez modelos nem executada inferência de cada peso nesta revisão.
- O macOS foi simulado para testar os caminhos do instalador; não houve máquina
  macOS física para executar PyTorch/MPS.
- O daemon Docker Desktop Linux estava desligado. A tentativa de build real
  não pôde iniciar; os testes BYOM usaram servidores locais e dublês da CLI Docker.
- O teste de instalação de Node falhou quando lançado pelo Windows com Bash
  do WSL e caminhos temporários do Windows; ele foi excluído da execução geral.
  Esse teste é do instalador do projeto, não do SAM/BYOM.
- Um BYOM externo precisa cumprir `/ping`, `/invocations` e o formato COCO aceito.
  Compatibilidade de seus pesos, bibliotecas, GPU, volumes e qualidade de saída
  depende da imagem específica. Metadados são opcionais.
- O prazo da lista BYOM é finito: configurações que elevem muito o timeout de
  `/ping`, ou catálogos grandes com serviços lentos, ainda podem exceder 30 segundos.
