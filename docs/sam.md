# SAM local — instalação e uso

O Poligome roda os modelos Segment Anything no computador do usuário. Imagens e
prompts nunca saem da máquina: o editor fala com um conector FastAPI em
`127.0.0.1`, e é ele quem carrega o modelo.

Este documento cobre os modelos oficiais. Para rodar um modelo seu num contêiner,
veja [byom.md](byom.md).

---

## Começo rápido

São três passos, e o primeiro depende do seu sistema. Se você não sabe qual
modelo escolher, use `sam2.1-hiera-small`: ele é o recomendado, tem 184 MB e
roda em CPU.

### 1. Rode o instalador

**Linux ou macOS** — baixe `poligome-sam-macos-linux.sh` pelo painel de modelos
do editor e rode, na pasta onde ele caiu:

```bash
bash poligome-sam-macos-linux.sh sam2.1-hiera-small
```

**Windows** — baixe `poligome-sam-windows.bat` e dê um duplo clique, ou:

```
poligome-sam-windows.bat sam2.1-hiera-small
```

O `.bat` não instala nada no Windows em si: ele repassa tudo para o WSL2, onde o
modelo e o ambiente Python ficam. Você precisa do WSL2 instalado antes; se não
tiver, o próprio `.bat` diz isso e para.

Sem argumento, os dois abrem um menu com os dez modelos.

### 2. Espere terminar

A primeira instalação baixa o PyTorch e o modelo, e demora: de poucos minutos a
bem mais, conforme a sua internet. O fim se parece com isto:

```
Modelo sam2.1-hiera-small instalado, carregado e selecionado.
A seleção foi salva em ~/.poligome-sam/selected-model.txt.
Mantenha este terminal aberto enquanto usar o SAM.
```

Se aparecer um erro no meio, ele diz o que falta — por exemplo, no Linux, que o
pacote `python3-venv` precisa ser instalado.

### 3. Use no editor

Com o terminal aberto, volte ao editor e recarregue a página. Ele procura o
conector sozinho em `127.0.0.1:7860` e conecta sem você pedir nada. A partir
daí, clicar na imagem com a ferramenta SAM já segmenta.

> **O terminal precisa ficar aberto.** Fechar o terminal derruba o conector, e
> nenhuma página web pode ligá-lo de volta. A seção seguinte explica como
> evitar esse passo diário.

---

## O que exige ação manual

Vale saber antes de instalar: **o conector precisa estar rodando** sempre que
você quiser usar IA. Ele é um processo local, e nenhuma página web pode iniciá-lo
— o editor consegue encontrá-lo sozinho, nunca ligá-lo.

Na prática, isso significa:

| Situação | O que acontece | O que fazer |
| --- | --- | --- |
| Primeira instalação | o instalador sobe o conector e segura o terminal | manter o terminal aberto |
| Fechou o terminal | o conector morre junto | rodar o iniciador de novo |
| Reiniciou o computador | o conector não volta sozinho | rodar o iniciador de novo |
| Trocou de modelo pelo editor | o conector se reinicia sozinho | nada |

O iniciador é:

```bash
bash poligome-sam-start-macos-linux.sh
```

Ele sobe o modelo salvo em `~/.poligome-sam/selected-model.txt`, sem reinstalar
nada.

**Para não repetir isso todo dia**, no Linux existe o serviço de usuário:

```bash
bash poligome-sam-service-linux.sh install
```

Com ele o conector sobe no login e o passo manual desaparece. **Em Windows e
macOS ainda não há equivalente** — nesses sistemas o iniciador precisa ser
executado a cada sessão.

Sem conector, o editor continua abrindo e a anotação manual continua funcionando;
só as ferramentas de IA ficam indisponíveis.

## Os modelos

| Modelo | ID | Checkpoint | Acesso |
| --- | --- | --- | --- |
| SAM 2.1 Hiera Tiny | `sam2.1-hiera-tiny` | 156 MB | público |
| SAM 2.1 Hiera Small | `sam2.1-hiera-small` | 184 MB | público |
| SAM 2.1 Hiera Base+ | `sam2.1-hiera-base-plus` | 324 MB | público |
| SAM 2.1 Hiera Large | `sam2.1-hiera-large` | 898 MB | público |
| MedSAM2 (imagem médica) | `medsam2-latest` | 156 MB | público |
| MedSAM2 · lesão em TC | `medsam2-ct-lesion` | 156 MB | público |
| MedSAM2 · lesão hepática em RM | `medsam2-mri-liver-lesion` | 156 MB | público |
| MedSAM2 · ecocardiograma | `medsam2-us-heart` | 156 MB | público |
| MedSAM2 2411 (versão anterior) | `medsam2-2411` | 156 MB | público |
| SAM 3 Concepts | `sam3-concepts` | 3,45 GB | **aprovação manual da Meta** |

Aliases aceitos: `medsam2`, `medsam2-ct`, `medsam2-mri`, `medsam2-us` e `sam3`.

Os quatro MedSAM2 são ajustes finos do SAM 2.1 Hiera Tiny e reaproveitam o mesmo
runtime: instalá-los custa apenas o download do checkpoint, sem ambiente novo.

---

## Instalação, em detalhe

Tudo fica em `~/.poligome-sam`, e nada é escrito na pasta do projeto:

| Caminho | O que guarda |
| --- | --- |
| `venvs/sam2` e `venvs/sam3` | um ambiente Python por família de runtime |
| `models/<id>/` | só o checkpoint do modelo que você escolheu |
| `poligome-sam-local.py` | o conector |
| `selected-model.txt` | qual modelo o iniciador deve subir |

Instalar um segundo modelo da mesma família custa apenas o download do
checkpoint: o ambiente Python já está pronto e é reaproveitado.

### Linux

```bash
bash poligome-sam-macos-linux.sh sam2.1-hiera-small
```

Exige Python 3.10 ou mais novo e, em distribuições Debian e Ubuntu, o pacote
`python3-venv`. Sem ele o instalador para logo no começo e diz o comando exato
para instalá-lo.

### macOS

O mesmo script do Linux:

```bash
bash poligome-sam-macos-linux.sh sam2.1-hiera-small
```

Duas condições, conferidas antes de qualquer download:

- **Apple Silicon.** O PyTorch 2.5.1+ não publica mais wheels para Mac Intel,
  então num Intel o instalador recusa em vez de falhar no meio do `pip`.
- **macOS 14 ou mais novo**, que é o mínimo do PyTorch atual.

O SAM 3 não é oferecido no macOS, porque exige CUDA.

### Windows

```
poligome-sam-windows.bat sam2.1-hiera-small
```

O `.bat` não instala nada no Windows em si: ele delega ao WSL2, com o mesmo menu
e os mesmos IDs. Antes de começar, ele confere que o WSL2 existe, que a
distribuição responde e que há `curl` ou `wget` nela; se algo faltar, ele diz o
quê.

Duas consequências que costumam surpreender:

- **O modelo fica dentro do WSL**, em `~/.poligome-sam` da distribuição, e não
  em `C:\Users`. É lá que o conector procura.
- **A seleção do Windows só é confirmada depois** que o WSL confirma que o
  modelo carregou. Uma instalação interrompida deixa o estado anterior intacto,
  e o iniciador retoma sozinho da próxima vez.

### Já instalado

Os iniciadores `poligome-sam-start-macos-linux.sh` e
`poligome-sam-start-windows.bat` sobem o modelo salvo em
`~/.poligome-sam/selected-model.txt` e retomam automaticamente uma instalação
interrompida.

No Linux, `poligome-sam-service-linux.sh install` registra o conector como
serviço de usuário do systemd, para ele subir no login sem terminal aberto.

---

## SAM 3: a aprovação da Meta

O SAM 3 é o único modelo do catálogo com checkpoint **gated**. Sem aprovação, o
download responde `HTTP 401` e a instalação para. Não há caminho alternativo: a
Meta não publica o arquivo em outro lugar.

### Passo a passo

1. **Conta no Hugging Face** — https://huggingface.co/join
2. Logado, abrir https://huggingface.co/facebook/sam3. O formulário pede:
   - nome e sobrenome;
   - data de nascimento;
   - país (a localização por IP também é registrada);
   - afiliação;
   - cargo, numa lista fixa: *Student, Research Graduate, AI researcher,
     AI developer/engineer, Reporter, Other*;
   - caixa aceitando a licença e a Política de Privacidade da Meta.
3. **Enviar e esperar.** O repositório está marcado como `gated: manual`, ou
   seja, alguém revisa — não é liberação automática. O status aparece em
   https://huggingface.co/settings/gated-repos
4. **Autenticar na máquina.** Aprovado, rode o instalador: ele chama o
   `hf auth login` oficial, que guarda o token sozinho. O Poligome não lê nem
   armazena o seu token.

O formulário é vinculado à sua conta e pede dados pessoais seus, então ninguém
pode solicitar por você.

### Requisitos próprios

O SAM 3 não compartilha ambiente com o SAM 2.1:

| | SAM 2.1 e MedSAM2 | SAM 3 |
| --- | --- | --- |
| Python | 3.10+ | 3.12+ |
| PyTorch | 2.5.1+ | 2.10 com CUDA 12.8 |
| GPU | recomendada | **obrigatória**, CUDA 12.6+ |
| Sistema | Linux, macOS (Apple Silicon), WSL2 | Linux ou WSL2 |
| Licença | Apache 2.0 · MedSAM2 restrito a pesquisa | SAM License, própria da Meta |

A instalação do SAM 3 fixa `setuptools<81` enquanto a revisão oficial ainda
depender de `pkg_resources`, e instala explicitamente as dependências que o
import principal usa mas o `pyproject` não declara.

### Verificado nesta implementação

Com uma conta aprovada, o fluxo foi exercitado assim:

| Etapa | Como foi conferida |
| --- | --- |
| formulário e aprovação | campos lidos da API do Hugging Face; repositório confirmado como `gated: manual` |
| autenticação | `hf auth whoami` respondendo com a conta aprovada |
| download | `hf download facebook/sam3 sam3.pt`, 3.450.062.241 bytes, batendo com o tamanho que o instalador exige |
| instalação | `bash poligome-sam-macos-linux.sh sam3-concepts` do começo ao fim, com a seleção salva em `selected-model.txt` |
| inferência | ponto 0,980 · caixa 0,984 · texto devolvendo três instâncias para "red circle" e duas para "blue square" |
| troca de modelo | entra e sai do SAM 3 sem perder SAM 2.1 nem MedSAM2 |

Numa segunda passagem, em outra máquina e partindo do zero, o ramo de download
foi exercitado pelo próprio instalador: com a conta aprovada e sem checkpoint em
disco, `bash poligome-sam-macos-linux.sh sam3-concepts` criou o ambiente,
instalou o runtime e baixou os 3.450.062.241 bytes sozinho. Essa máquina não
chegou a rodar inferência, porque a GPU dela é anterior ao que o PyTorch CUDA
12.8 suporta — foi o que revelou a checagem de capability descrita adiante.

Isso revelou dois defeitos que o gate escondia, ambos corrigidos:

- **dtype.** O SAM 3 gera ativações em bfloat16 sem declarar autocast próprio, e
  o conector carrega o modelo numa thread e atende requisições em outra. Toda
  inferência morria com `mat1 and mat2 must have the same dtype`. O adaptador
  passou a declarar autocast bfloat16 explicitamente.
- **CLI do Hugging Face.** O console script `hf` grava o caminho do interpretador
  no shebang, então quebra se a pasta do app for renomeada. O instalador confere
  o shebang sem executar o script e, se o interpretador sumiu, resolve o entry
  point pelo próprio pacote.

---

## Prompts por modelo

| Prompt | SAM 2.1 | MedSAM2 | SAM 3 |
| --- | --- | --- | --- |
| ponto positivo e negativo | sim | sim | sim |
| caixa | sim | sim | sim |
| texto (conceito) | não | não | **sim** |
| caixa como exemplar | não | não | sim |
| múltiplas instâncias de um conceito | não | não | sim |

O prompt de texto funciona melhor como frase nominal curta — `carro vermelho`.
Descrições relacionais longas exigem outro tipo de modelo.

O MedSAM2 aceita os mesmos prompts do SAM 2.1, mas foi treinado em TC, RM e
ultrassom: em fotografia comum o resultado é pior que o do SAM 2.1 padrão, e a
caixa funciona melhor que o ponto.

---

## Conexão automática

Ao abrir o editor, a página procura o conector em `127.0.0.1:7860` sozinha. Se
ele responder `ready`, a conexão é estabelecida sem passar pelo modal, e o modelo
que **já está carregado** vira o modelo em uso — adotá-lo evita uma troca de três
a nove segundos que ninguém pediu.

Os contêineres BYOM seguem o mesmo princípio: são descobertos na mesma passada.
O que estava em uso volta a estar, desde que continue registrado e no ar; com um
único contêiner disponível e nenhuma escolha anterior, ele é adotado. Com vários,
escolher por conta seria chutar, então a escolha fica com você.

A sondagem se repete quando a aba volta ao foco, porque é aí que algo pode ter
mudado do lado de fora — o caso típico é sair da aba para iniciar o conector e
voltar. Nessa segunda passada, uma aba que **já está conectada** não readota o
modelo nem reativa a seleção, o que desfaria um "desselecionar todos"; ela apenas
reconfere a saúde e atualiza a lista de contêineres. Se o conector tiver morrido
nesse intervalo, o estado passa a offline em vez de continuar afirmando que há
modelo carregado.

Não encontrar o conector é o caso normal de quem não instalou nada, então nada é
dito na tela e a anotação manual segue funcionando.

O que a página **não** faz é iniciar o conector ou os contêineres: nenhuma página
web pode criar processo local. Para que eles estejam sempre no ar, use o serviço
de usuário (`poligome-sam-service-linux.sh install`) e o comando `examples` do
BYOM.

## Trocar de modelo

A troca acontece pela própria interface. `GET /models` lista o que está
instalado em `~/.poligome-sam` e `POST /load {"model_id"}` recarrega o conector
no ambiente da família pedida.

Como cada família tem runtime próprio, a troca usa `execv` para substituir o
processo preservando PID, terminal e processo pai — assim os instaladores que
aguardam o conector continuam válidos. A porta fica indisponível por instantes e
o modal acompanha o `/health` até o `ready`. Modelos não instalados são recusados
com HTTP 409 explicando o que falta.

Medido nesta máquina: trocar entre variantes do SAM 2.1 e MedSAM2 leva cerca de
três segundos; entrar ou sair do SAM 3, cerca de nove. Num notebook sem GPU, com
o modelo em CPU, a mesma troca entre variantes do SAM 2.1 levou de 6 a 24
segundos — o número acompanha a máquina, não o modelo.

## Escolher CPU ou GPU

Por padrão o conector decide sozinho: usa CUDA se houver, depois Metal no Apple
Silicon, e CPU se não houver nem uma nem outra. O SAM 2.1 e o MedSAM2 rodam em
CPU sem nenhuma configuração — é o que acontece em qualquer máquina sem GPU.

O caso em que `auto` erra é a GPU que o PyTorch enxerga mas que não aguenta o
modelo: ela é escolhida e a inferência falha por falta de memória. Para esses
casos, `POLIGOME_DEVICE` força a escolha:

```bash
POLIGOME_DEVICE=cpu bash poligome-sam-start-macos-linux.sh
POLIGOME_DEVICE=cpu bash poligome-sam-macos-linux.sh sam2.1-hiera-small
POLIGOME_DEVICE=cpu bash poligome-sam-service-linux.sh install
```

No Windows, defina a variável antes de chamar o `.bat`; ela é repassada ao WSL2:

```
set POLIGOME_DEVICE=cpu
poligome-sam-start-windows.bat
```

Os valores aceitos são `auto` (padrão), `cpu`, `cuda` e `mps`. Pedir `cuda` numa
máquina sem CUDA falha na hora, dizendo isso, em vez de carregar o modelo e
quebrar depois. O serviço do systemd grava a escolha na unidade, então ela
sobrevive ao reinício.

### Por que o SAM 3 não roda em CPU

Essa é a única exceção, e ela não vem do Poligome: vem do código da Meta.
Pedir CPU ao SAM 3 é recusado pelo conector, e a recusa apenas antecipa o que
aconteceria adiante. Exercitando o modelo com a guarda desligada e a GPU
escondida, o carregamento morre aqui:

```
sam3/model_builder.py, em build_sam3_image_model
  -> _create_vision_backbone
  -> _create_position_encoding
     sam3/model/position_encoding.py, linha 55:
     tensors = torch.zeros((1, 1) + size, device="cuda")
RuntimeError: No CUDA GPUs are available
```

O `device="cuda"` está escrito no próprio upstream e ignora o dispositivo
pedido. Não há configuração que contorne isso, e é por isso que o conector diz
não logo na entrada, em vez de deixar o usuário esperar o download de 3,45 GB
para receber um erro de CUDA no fim.

### A GPU precisa ser nova o bastante

Ter uma GPU NVIDIA também não basta. As rodas oficiais do PyTorch CUDA 12.8
trazem kernels de `sm_70` em diante, então uma placa anterior a isso é
reconhecida mas não executa nada:

```
NVIDIA GeForce GTX 1050 with CUDA capability sm_61 is not compatible
with the current PyTorch installation.
```

O instalador confere a capability pelo `nvidia-smi` antes de baixar qualquer
coisa e recusa em segundos, dizendo qual é a placa e qual é o mínimo. Sem essa
conferência, o erro só apareceria depois de cerca de 11 GB baixados, na forma
de `no kernel image is available for execution on the device`.

---

## Quando algo dá errado

As mensagens abaixo são as que aparecem de verdade, com o que fazer em cada uma.

| A mensagem diz | O que aconteceu | O que fazer |
| --- | --- | --- |
| `não foi possível criar o ambiente virtual` | falta o `python3-venv` | `sudo apt install python3.12-venv` e rodar de novo |
| `Python 3.10+ não foi encontrado` | o Python do sistema é antigo demais | instalar um Python 3.10 ou mais novo |
| `a porta 7860 já está ocupada` | outro conector, com outro modelo, está no ar | fechar o terminal dele, ou trocar de modelo pelo editor em vez do instalador |
| `exige um Mac Apple Silicon` | Mac Intel | usar Linux, ou um Mac M1 ou mais novo |
| `exige macOS 14 ou mais novo` | macOS antigo | atualizar o sistema |
| `nvidia-smi não foi encontrado` | pediu SAM 3 sem GPU NVIDIA | escolher um SAM 2.1 ou MedSAM2, que rodam em CPU |
| `CUDA não está disponível` | pediu `POLIGOME_DEVICE=cuda` sem CUDA | usar `auto` ou `cpu` |
| `não foi possível baixar o checkpoint gated` | SAM 3 sem aprovação da Meta | pedir acesso e esperar a liberação |
| `o conector terminou antes de ... ficar pronto` | o modelo não coube na memória | forçar `POLIGOME_DEVICE=cpu`, ou escolher um modelo menor |
| `modelo inválido` | ID digitado errado | rodar sem argumento e escolher no menu |

Uma instalação interrompida não deixa lixo pela metade: o download vai para um
arquivo `.part`, o checkpoint só é aceito se o tamanho bater com o oficial, e a
seleção só é gravada depois que o modelo carrega. Rodar o iniciador de novo
retoma de onde parou.

Para ver o que o conector está fazendo:

```bash
curl -s http://127.0.0.1:7860/health
```

A resposta diz o modelo carregado, o dispositivo em uso e o estado
(`loading`, `ready` ou `error`), com a mensagem do erro quando houver.

---

## Limites desta versão

- **Só imagem.** SAM 2.1 e SAM 3 fazem vídeo no upstream, mas o editor integra
  apenas imagens. O SAM 3.1, com Object Multiplex para vídeo, não está integrado.
- **Sem máscara anterior como prompt**, sem geração automática de máscaras e sem
  exemplares combinados com texto.
- **MedSAM2 não cobre odontologia.** Radiografia odontológica não faz parte do
  treino publicado; usar o ajuste fino de TC em CBCT dental é extrapolação.
