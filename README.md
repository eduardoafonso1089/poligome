# Poligome

Free, local-first data annotation for AI. Annotate images in the browser — no account, no dataset upload, and no Poligome server holding your images.

Poligome keeps the annotation workflow on your machine. Images and annotations are processed locally in the browser, while optional helpers and AI models can run as local services on the same computer.

## Image annotation

The image editor is available at `/annotate` and supports boxes, polygons, masks, polylines and keypoints, including vector editing, snapping, per-class visibility, quality/review tools and large-raster navigation.

Projects can be saved as `.plgm` files containing classes, geometries, layout metadata and image references. Image bytes are not included in newly exported projects. When reopening a project, select the original images with the same names. Older `.plgm` files that already contain bundled images remain readable.

The landing page also includes a one-click computer-vision demo with synthetic aerial images and example annotations ready to edit or export.

### Import and export

Poligome exports annotations as COCO, YOLO and GeoJSON, as well as portable `.plgm` projects.

COCO and YOLO exports are annotation-only ZIP archives. The export dialog supports train/validation/test proportions, an optional test split, random assignment and balancing by total instance count.

The importer accepts standalone COCO JSON and COCO or YOLO ZIP packages. Load the original images first; Poligome matches standard image paths and filenames and warns about missing or ambiguous images instead of guessing.

## Geospatial rasters

Poligome opens GeoTIFF and Cloud Optimized GeoTIFF (COG) files directly. COGs can be rendered as tiled rasters without converting the whole image to PNG, and annotations over georeferenced assets can be exported as GeoJSON.

Files that are not proper COGs can still be opened, but large rasters are more efficient after conversion. Poligome provides an optional local COG converter for this workflow.

See [Raster import and export](docs/RASTER_WORKFLOW.md) for supported formats, sidecars, memory limits, coordinate handling and verification instructions.

## Local AI and Poligome Runtime

Poligome is designed so AI-assisted annotation can run on the same computer as the dataset. The browser can communicate with a model service bound to loopback (`127.0.0.1`), receive inference results and use them as pre-annotations without sending the source images to a Poligome cloud service.

This model-service direction is called **Poligome Runtime**. The goal is to provide a plug-and-play local runtime with standard models and an extension path for users to connect their own models. Models may run in a local Python environment or a container; **Docker is not required to install or run the Poligome web interface**.

The repository already includes the Local SAM connector as an AI-oriented local helper. The broader Poligome Runtime for arbitrary user models is under development and is not presented as a completed feature.

## Local helpers

Optional helper services run on your own computer and bind to loopback rather than acting as public APIs.

**Local SAM** — AI pre-annotation, plus BYOM for your own containerized model. The catalog, the installers and the editor UI are described in [SAM local](#sam-local) and [BYOM](#byom--traga-o-seu-próprio-modelo) below.

**Local COG converter** supports large geospatial rasters. `public/poligome-cog-windows.bat` and `public/poligome-cog-macos-linux.sh` install the required Python packages and start the converter on `http://127.0.0.1:7861`. The manual service is `public/poligome-cog-local.py`.

Local connectors accept browser requests from the official Poligome origins and local development by default. A trusted self-hosted instance can set `POLIGOME_ALLOWED_ORIGIN_REGEX` to an anchored regular expression for its own origins.

## Run Poligome locally

Requirements: Git if you are cloning the repository. The installers require an
internet connection when they need to set up Node.js >= 22.13.0.

### Linux

```bash
git clone https://github.com/eduardoafonso1089/poligome.git
cd poligome
chmod +x install.sh
./install.sh
```

### Windows (PowerShell)

```powershell
git clone https://github.com/eduardoafonso1089/poligome.git
cd poligome
powershell -ExecutionPolicy Bypass -File .\install.ps1
npm run dev
```

Both installers validate the Node.js version and run `npm ci` using the lockfile as the dependency source of truth. If Node.js is missing or older than 22.13.0, the Linux installer downloads an official Node.js release to its user cache (without `sudo`), verifies its SHA-256 checksum, and prints the exact command needed to run the app with that cached runtime. The Windows installer first tries `winget`, then downloads and runs the official MSI installer. Windows may request administrator permission for the MSI fallback.

After the installer finishes, copy the `Run:` command it prints. With an already compatible Node.js, this is simply `npm run dev`; after a Linux download it prepends the cached Node.js directory to `PATH` for that command.

Manual installation is also available:

```bash
npm ci
npm run dev
```

For additional Windows troubleshooting, see [REINSTALL_WINDOWS.md](REINSTALL_WINDOWS.md).

## SAM local

O Poligome usa um conector FastAPI executado no computador do usuário; imagens e prompts não são enviados ao Site. A tela **Ativar SAM local** contém um catálogo com requisitos, licença, tamanho do checkpoint, plataforma e benchmark oficial — sempre acompanhado do hardware em que o número foi medido.

O passo a passo completo, incluindo a aprovação da Meta para o SAM 3, está em [docs/sam.md](docs/sam.md). Vale ler antes a seção **O que exige ação manual**: o conector é um processo local, precisa estar rodando sempre que a IA for usada e não volta sozinho depois de fechar o terminal ou reiniciar — o editor encontra o que está no ar, mas nenhuma página web pode iniciá-lo. No Linux o serviço de usuário resolve isso; em Windows e macOS ainda não há equivalente.

Modelos disponíveis:

| Família | Variantes | Uso nesta versão | Requisitos principais |
| --- | --- | --- | --- |
| SAM 2.1 | Hiera Tiny, Small, Base+, Large | pontos positivos/negativos e caixas; Small é o padrão | Python 3.10+, PyTorch 2.5.1+, Torchvision 0.20.1+; CUDA recomendada |
| MedSAM2 | Generalista médico, lesão em TC, lesão hepática em RM, ecocardiograma e o peso anterior 2411 | pontos positivos/negativos e caixas | mesmo runtime do SAM 2.1; nenhum ambiente adicional |
| SAM 3 | Imagem e conceitos | pontos, caixas e texto com múltiplas instâncias | Python 3.12+, PyTorch 2.7+, GPU e CUDA 12.6+; acesso gated no Hugging Face |

SAM 2.1 também possui tracking de vídeo no upstream. O SAM 3.1, lançado pela Meta em 27/03/2026, adiciona Object Multiplex para vídeo, mas ainda não está integrado nem é instalado pelo Poligome. O editor atual integra somente imagens e deixa essa diferença explícita.

Instalação e início:

- `public/poligome-sam-macos-linux.sh <model-id>` instala no Linux, macOS quando suportado ou WSL2 e inicia o modelo escolhido;
- `public/poligome-sam-windows.bat <model-id>` delega a instalação ao WSL2, preservando o mesmo menu e ID de modelo;
- os launchers `public/poligome-sam-start-macos-linux.sh` e `public/poligome-sam-start-windows.bat` reiniciam uma instalação existente e retomam automaticamente uma instalação interrompida;
- `public/poligome-sam-local.py` é o conector manual unificado, com CLI `--model`, `--checkpoint`, `--model-config` (nome Hydra do SAM 2), `--device`, `--port` e `--app-dir`;
- `public/poligome-sam-service-linux.sh install` registra o conector como serviço de usuário do systemd, para que ele suba no login e nenhum terminal precise ficar aberto (`status` e `uninstall` completam o ciclo). Em macOS e no WSL2 sem systemd, use o iniciador comum.

A troca de modelo acontece pela própria interface: `GET /models` lista o que está instalado em `~/.poligome-sam` e `POST /load {"model_id"}` recarrega o conector no venv da família pedida. Como cada família tem runtime próprio, a troca usa `execv` para substituir o processo preservando PID, terminal e processo pai, de modo que os instaladores que aguardam o conector continuam válidos; a porta fica indisponível por instantes e o modal acompanha o `/health` até o `ready`. Modelos não instalados são recusados com HTTP 409 explicando o que falta, em vez de subir quebrados.

O endpoint padrão é `http://127.0.0.1:7860/predict`. O conector valida o modelo solicitado, publica estado e capacidades em `/health`, detecta o dispositivo compatível e mantém em cache a representação da imagem atual para acelerar refinamentos. Requisições do navegador aceitam somente a origem oficial, origens loopback de desenvolvimento e origens adicionais declaradas em `POLIGOME_ALLOWED_ORIGINS`; os launchers configuram isso a partir de `POLIGOME_SITE_URL`. O MedSAM2 é um ajuste fino do SAM 2.1 Hiera Tiny para imagem médica publicado pelo grupo de Bo Wang. Ele carrega com a configuração oficial `sam2.1_hiera_t.yaml` e reaproveita o runtime do SAM 2.1, então instalá-lo custa apenas o checkpoint de 156 MB. Atenção à licença: o código do projeto é Apache 2.0, mas o card oficial dos pesos restringe o uso a pesquisa e educação, de modo que uso comercial não está autorizado; o catálogo mostra isso na tela antes da instalação. Em fotografia comum o resultado é pior que o do SAM 2.1 padrão, e prompts de caixa funcionam melhor que pontos, refletindo como o modelo foi treinado. Além do generalista, o repositório oficial publica ajustes finos por modalidade — `medsam2-ct-lesion` (lesão em TC), `medsam2-mri-liver-lesion` (lesão hepática em RM) e `medsam2-us-heart` (ultrassom cardíaco) — mais o peso base `medsam2-2411`, mantido apenas para reprodutibilidade. Todos partem do mesmo SAM 2.1 Hiera Tiny, carregam com o mesmo `sam2.1_hiera_t.yaml` e ocupam cerca de 156 MB cada, então acrescentar um deles a uma instalação existente custa só o download do checkpoint. O ajuste fino de ultrassom foi treinado pelo upstream em vídeo; como este editor integra apenas imagens, ele é usado quadro a quadro. A restrição de licença de pesquisa e educação vale para todos eles.

## BYOM — traga o seu próprio modelo

Além do catálogo oficial, o Poligome roda modelos de segmentação empacotados por você em um contêiner Docker. O propósito é diferente do SAM: não há prompt. O contêiner recebe a imagem inteira e devolve um documento COCO já rotulado, e o editor desenha as máscaras, caixas e pontos com as classes que o próprio modelo indicou, prontas para revisão.

O empacotamento imita o do Amazon SageMaker, então um contêiner preparado para lá roda aqui com pouca ou nenhuma mudança: a imagem sobe com `serve`, escuta na porta 8080, responde `GET /ping` com 200 quando está pronta e recebe a inferência em `POST /invocations`; os pesos ficam em `/opt/ml/model`.

- `public/byom/serve.py` e `public/byom/Dockerfile` são um exemplo executável com dois métodos escolhidos pela variável `METHOD` — `otsu`, que funde objetos encostados numa região só, e `watershed`, que os separa em instâncias distintas. Nenhum precisa de GPU, e os dois devolvem COCO com polígono, caixa e ponto central. Serve de molde: troque a função `predict()` pelo seu modelo;
- `public/poligome-byom-macos-linux.sh` cuida do ciclo de vida com `examples`, `build`, `register`, `start`, `stop`, `status`, `list`, `logs` e `remove`. `examples` constrói a imagem e registra os dois modelos oficiais versionados em `public/byom/examples` — `byom-otsu` e `byom-watershed`, que saem da mesma imagem mudando só a variável `METHOD`. A imagem não é versionada, porque o tarball tem ~347 MB contra menos de 4 MB de todo o histórico; em vez disso a base do Dockerfile é fixada por digest, então reconstruir depois produz a mesma imagem;
- o registro grava `~/.poligome-sam/byom/<id>.json`. O conector não carrega o modelo: ele encaminha para o contêiner e valida a resposta antes de repassá-la ao editor, o que transforma um COCO malformado numa mensagem clara em vez de um polígono torto na tela;
- o identificador precisa começar com `byom-`, e o endpoint só pode ser `127.0.0.1` ou `localhost`: um endereço remoto tiraria as imagens da máquina do usuário;
- `segmentation` vira polígono, `bbox` vira caixa e `keypoints` vira ponto, com `categories[].name` definindo a classe.

O conector expõe `GET /byom/models`, que lista os contêineres registrados com o estado de cada um, `POST /byom/register` para importar ou editar um registro, `DELETE /byom/models/{id}` para removê-lo e `POST /byom/annotate`, que roda um deles sobre uma imagem. Um contêiner pode implementar `GET /metadata` para declarar suas classes; quando não implementa, o conector guarda o resumo da última execução e a interface explica o modelo a partir dele. Na interface, o botão do modelo de IA no topo mostra o que está em uso — `SAM 2.1`, `MedSAM2` ou `BYOM` com o nome do contêiner, e os dois juntos quando ambos estão ativos, já que são caminhos independentes e as máscaras de um não interferem nas do outro — e dentro dele **Trazer meu modelo** reúne o contrato, o passo a passo, os arquivos para baixar e os contêineres registrados. O passo a passo completo está em [docs/byom.md](docs/byom.md), começando por **O que exige ação manual**: o BYOM depende do conector e do contêiner, e os contêineres são criados sem política de reinício, então reiniciar a máquina ou o Docker os deixa parados — o registro sobrevive, o processo não.

Checkpoints SAM 2.1 vêm dos downloads oficiais da Meta; SAM 3 exige solicitar acesso em https://huggingface.co/facebook/sam3, esperar a aprovação manual e executar `hf auth login` localmente. O fluxo foi verificado ponta a ponta com uma conta aprovada: download do checkpoint de 3,45 GB, carga em CUDA, prompts de ponto e caixa, e prompts de texto devolvendo múltiplas instâncias do conceito. O instaladores invocam o CLI do Hugging Face pelo console script quando ele é utilizável e, quando o shebang aponta para um interpretador que não existe mais — o que acontece se a pasta do app for renomeada —, caem no entry point resolvido pelo próprio pacote.

Os instaladores mantêm separadas a URL do Site e a origem pública dos arquivos: `POLIGOME_SITE_URL` controla a página aberta e o CORS, enquanto as atualizações dos scripts usam por padrão `https://raw.githubusercontent.com/eduardoafonso1089/epiaka/main/public`; o bootstrap do conector usa um commit público imutável e confere sua soma SHA-256. `POLIGOME_ASSET_BASE_URL` pode substituir essa origem HTTPS. Em desenvolvimento ou numa instalação offline no Linux/macOS, `POLIGOME_CONNECTOR_PATH` aceita explicitamente uma cópia local do conector. O runtime do SAM 3 fixa `setuptools<81` enquanto a revisão upstream usada ainda depender de `pkg_resources` e instala explicitamente as dependências usadas pelo import principal.

A seleção é transacional: o modelo escolhido fica em `pending-model.txt` durante a instalação e só é promovido a `selected-model.txt` depois que runtime, dispositivo, checkpoint e o `/health` do modelo exato passam nas validações. Os iniciadores retomam esse estado pendente; checkpoints incompletos não são reutilizados, pois os cinco artefatos são conferidos contra seus tamanhos oficiais antes da ativação.

Pesos e dependências nunca são gravados no checkout: Linux, macOS e WSL2 usam `~/.poligome-sam/`. O `.gitignore` também bloqueia formatos de checkpoint, ambientes virtuais e diretórios de modelos como proteção adicional.

Por segurança de memória, o serviço limita cada imagem a 16 megapixels, processa no máximo quatro corpos de previsão simultaneamente e devolve no máximo 64 instâncias SAM 3. Esses valores podem ser ajustados conscientemente com `POLIGOME_MAX_IMAGE_PIXELS`, `POLIGOME_MAX_CONCURRENT_REQUESTS` e `POLIGOME_SAM3_MAX_PREDICTIONS`; o limiar conceitual mínimo do SAM 3 usa `POLIGOME_SAM3_MIN_CONCEPT_THRESHOLD` e começa em `0.1`.

## Interface

Poligome supports Portuguese, English, French and Spanish, with light, dark and system themes.

## Development

Requirements: Node.js `>=22.13.0`.

```bash
npm ci
npm run dev
```

- `npm run install:ci`: perform the one bounded lockfile install
- `npm run dev`: start the Vite/Vinext development server
- `npm run build`: build and validate the deployable Sites artifact
- `npm run start`: start the built Vinext application
- `npm run typecheck`: run `tsc --noEmit` over the project
- `npm run test:unit`: run the Node test suite without building
- `npm run test:sam-installers`: exercise all five SAM installer paths with isolated mocks and sparse checkpoints
- `npm run test:byom`: exercise the BYOM lifecycle script against a mocked Docker
- `npm test`: typecheck, then run the unit, SAM installer and BYOM suites
- `npm run validate:artifact`: recheck an existing artifact's manifest and ESM `default.fetch` export
- `npm run db:generate`: generate Drizzle migrations after schema changes

The npm scripts target Linux and use `flock` and GNU `timeout`. On Windows, run
Vite directly — see [REINSTALL_WINDOWS.md](REINSTALL_WINDOWS.md) for the full
path, including the workaround for networks that block the npm registry.

## Project layout

```text
app/page.tsx          landing page
app/annotate/         image annotation route
app/editor/           editor components and interaction logic
app/lib/              shared project, raster, SAM and i18n utilities
app/raster/           raster-related route and UI
public/               local helper installers, services and static assets
docs/                 technical and workflow documentation
install.sh            Linux local setup
install.ps1           Windows local setup
```

The frontend stack includes React 19, Next 16, vinext, Vite, Tailwind CSS 4 and OpenLayers.

## Contributing and security

Contributions are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md), follow the [code of conduct](CODE_OF_CONDUCT.md), and use the issue templates for bugs and feature proposals. Please report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## License

Poligome — data annotation for AI  
Copyright (C) 2026 Eduardo Afonso

This program is free software, distributed under the [GNU Affero General Public License, version 3](LICENSE) (`AGPL-3.0-only`). You may use, study, modify and redistribute it provided that derivative versions comply with the license.

Because Poligome is a web application, **section 13** of the AGPL applies when a modified version is offered for use over a network. Merely using Poligome, including a hosted instance, does not place licensing obligations on datasets created or exported with the application.

No warranty; see [LICENSE](LICENSE) for the full terms and [NOTICE](NOTICE) for ownership and contribution credits.

### Commercial license

If AGPL requirements do not fit a use case — for example, embedding a modified Poligome in a closed product — a separate commercial license is available from the copyright holder. Contact `eduardoafonso1089@gmail.com` describing the intended use.

The Poligome name and logos are not covered by the AGPL; see [NOTICE](NOTICE).
