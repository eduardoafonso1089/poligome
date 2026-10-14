# Revisão da instalação e uso pela interface

Data: 14/10/2026. Complementa a [revisão dos fluxos SAM e BYOM](sam-byom-review.md).

Os guias de SAM, BYOM e Runtime apresentam pré-requisitos, passos numerados,
comandos copiáveis, confirmação da conexão, uso e reinício. Os textos seguem
o idioma do editor: português, inglês, francês ou espanhol.

## Ajustes

- SAM apresenta o acesso necessário ao SAM 3 antes do download, a opção CPU
  antes dos comandos e o nome do botão de ativação realmente disponível.
  Modelos já instalados mostram como ativar; reinstalação e reinício ficam
  recolhidos. Os três caminhos são Linux/macOS, Windows com WSL2 e Windows nativo.
- BYOM separa exemplos, modelo próprio e importação de contêiner ativo.
  O guia exige Docker e conector, acompanha o sistema do conector e mantém
  os campos de importação ao mudar de caminho. O modelo próprio usa uma pasta
  dedicada e porta 8082, deixando 8080/8081 aos exemplos. Contêiner importado
  sem imagem registrada recebe instrução para iniciar o contêiner original.
- Runtime oferece PowerShell, WSL2, Linux e macOS. Usa Python 3.12, venv e
  Faster R-CNN em CPU; esclarece que as classes do exemplo são COCO. No macOS,
  PyTorch é instalado pelo PyPI, sem o índice CPU usado no Linux e Windows.
- Blocos PowerShell e bash do WSL2 ficam separados. A cópia informa sucesso
  ou oferece seleção manual se o navegador bloquear a área de transferência.
  Comandos, downloads e escolhas permanecem legíveis na largura de 360 px.

## Verificação

Foram executados testes antes das mudanças. Novas regressões foram reproduzidas
antes das correções: instruções SAM sem pré-requisitos, texto CPU pequeno,
botão de cópia pequeno, comando inviável para BYOM importado parado e conflito
da porta do modelo próprio com os exemplos.

| Verificação | Resultado |
| --- | --- |
| `tests/installation-guides.test.mjs` | 66 testes passaram: textos dos quatro idiomas, comandos por sistema, guias renderizados, pré-requisitos e ativação |
| Suíte geral JavaScript executável neste Windows | 544 testes passaram; 1 teste dependente de artefato do build foi pulado |
| `scripts/ai-flow-audit.mjs` | 44 cenários Chromium passaram, incluindo troca/ativação SAM e uso BYOM |
| `scripts/installation-ui-audit.mjs` | 8 cenários passaram: quatro idiomas em 1440 e 360 px, guias SAM/BYOM/Runtime, cópia, fallback, limites visuais e preservação dos campos |
| TypeScript | Passou |
| ESLint dos arquivos alterados | 0 erros; 2 avisos existentes de hooks em `use-sam-catalog.ts` |
| `git diff --check` | Passou |

Os relatórios e capturas estão em `interaction-audit/` (artefatos locais
ignorados pelo Git). A suíte geral excluiu `tests/installers.test.mjs`, cujo
instalador do projeto exige ambiente Linux com caminhos Linux.

## Alcance

Os cenários da interface usam API simulada e navegador real. A revisão dos
comandos Runtime também considerou o código do repositório local
`poligome-runtime` e a [documentação oficial do PyTorch](https://pytorch.org/get-started/locally/).
Não foram executadas instalações completas com pesos e GPU em cada sistema,
nem inferência de todos os modelos externos. As restrições físicas e os testes
dos instaladores SAM/BYOM estão registrados na revisão anterior.
