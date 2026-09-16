# BYOM — traga o seu próprio modelo

O Poligome aceita modelos de segmentação empacotados por você em um contêiner
Docker. O contrato imita o do Amazon SageMaker, de propósito: um contêiner já
preparado para o SageMaker costuma rodar aqui sem mudança nenhuma no
empacotamento, e quem nunca fez isso pode seguir a documentação da AWS e chegar
ao mesmo lugar.

A diferença está no propósito e no corpo de `/invocations`. O SAM é interativo:
você clica, ele segmenta o que está sob o clique. O BYOM é automático: o
contêiner recebe a imagem inteira, sem prompt nenhum, e devolve um documento
COCO já rotulado. O editor desenha as máscaras, caixas e pontos com as classes
que o próprio modelo indicou, prontas para revisão.

---

## O que exige ação manual

O BYOM depende de **duas** coisas rodando na sua máquina, e nenhuma delas sobe
sozinha. O editor descobre as duas ao abrir e ao voltar o foco da aba, mas não
pode iniciar nem uma nem outra: nenhuma página web cria processo local nem sobe
contêiner.

| Precisa estar no ar | Por quê | Se estiver parado |
| --- | --- | --- |
| **Conector do Poligome** (`127.0.0.1:7860`) | o editor não fala direto com o contêiner; tudo passa por ele | o BYOM nem aparece na lista |
| **Contêiner do modelo** (`127.0.0.1:8080`, …) | é ele que roda a inferência | o card mostra "contêiner parado" e o botão de rodar fica desabilitado |

O conector é assunto do [sam.md](sam.md) — inclusive o serviço de login, que
resolve o lado dele.

**Os contêineres não voltam sozinhos.** Eles são criados com `docker run` sem
política de reinício, então reiniciar o computador ou o Docker os deixa em
`Exited`. O registro em `~/.poligome-sam/byom` sobrevive; o processo não. Para
subir tudo de novo:

```bash
# os exemplos oficiais
bash poligome-byom-macos-linux.sh examples

# um modelo específico
bash poligome-byom-macos-linux.sh start --model-id byom-meu-modelo
```

Os dois comandos são seguros de repetir: `examples` preserva registros que você
já tenha ajustado, e `start` não sobe um segundo contêiner se o `/ping` já
responde.

Se preferir que um contêiner volte sozinho junto com o Docker, dá para marcar
isso à mão, uma vez:

```bash
docker update --restart unless-stopped poligome-byom-otsu
```

O `start` continua funcionando normalmente depois disso.

Para conferir o estado sem abrir o editor:

```bash
bash poligome-byom-macos-linux.sh list
```

## No Windows

Não há `.bat` para o BYOM, e não falta nenhum: no Windows o conector já roda
dentro do WSL2 — é para lá que `poligome-sam-windows.bat` delega. O registro
fica em `~/.poligome-sam/byom` **dentro da distribuição WSL**, não em
`C:\Users\...`, e é só esse diretório que o conector lê.

A CLI é a mesma, executada de dentro do WSL:

```bash
wsl bash poligome-byom-macos-linux.sh examples
```

O que muda é o Docker: ele precisa responder ao comando `docker` **de dentro
dessa mesma distribuição**. Há dois caminhos:

| Caminho | O que fazer |
| --- | --- |
| Docker Desktop | ligar a integração da distribuição em Settings › Resources › WSL integration |
| Docker Engine no WSL | instalar o Docker dentro da distribuição, como num Linux comum |

Sem isso, a CLI para antes de tentar qualquer coisa e diz que o `docker` não foi
encontrado no PATH.

## O contrato

| Requisito | Valor |
| --- | --- |
| Porta | `8080`, dentro do contêiner |
| Comando de inicialização | `docker run <imagem> serve` |
| Verificação de saúde | `GET /ping` responde `200` quando o modelo está carregado |
| Inferência | `POST /invocations`, `Content-Type: application/json` |
| Descrição (opcional) | `GET /metadata` declara classes e geometria |
| Pesos do modelo | `/opt/ml/model` |

Enquanto o modelo ainda estiver carregando, responda `/ping` com qualquer status
diferente de `200`. O Poligome só habilita a anotação depois do `200`.

### Entrada de `/invocations`

```json
{
  "image": "data:image/png;base64,<imagem completa>",
  "file_name": "amostra.png",
  "width": 1920,
  "height": 1080
}
```

Não há prompts. O contêiner decide sozinho o que existe na imagem.

### Saída de `/invocations`

Um documento COCO:

```json
{
  "images": [
    { "id": 1, "file_name": "amostra.png", "width": 1920, "height": 1080 }
  ],
  "categories": [
    { "id": 1, "name": "cárie" },
    { "id": 2, "name": "restauração" }
  ],
  "annotations": [
    {
      "id": 1,
      "image_id": 1,
      "category_id": 1,
      "segmentation": [[120.0, 80.0, 300.0, 84.0, 296.0, 240.0, 118.0, 236.0]],
      "bbox": [118.0, 80.0, 182.0, 160.0],
      "area": 29120.0,
      "score": 0.91
    },
    {
      "id": 2,
      "image_id": 1,
      "category_id": 2,
      "keypoints": [640.0, 410.0, 2],
      "num_keypoints": 1
    }
  ]
}
```

Como cada campo é lido:

| Campo | Efeito no editor |
| --- | --- |
| `categories[].name` | vira a classe da anotação; classes iguais às existentes são reaproveitadas, e as novas ganham cor automática |
| `segmentation` | cada anel vira um polígono. Só o formato de lista de pontos (`[x, y, x, y, …]`) é aceito; RLE não |
| `bbox` | `[x, y, largura, altura]`, usado quando não há `segmentation` |
| `keypoints` | trios `x, y, visibilidade` no formato COCO; cada ponto com visibilidade diferente de `0` vira uma anotação de ponto |
| `category_id` | liga a anotação à classe; ausente, a anotação entra como não rotulada |
| `images` | opcional. Quando ausente, o conector preenche com a imagem que enviou |

Cada anotação precisa trazer ao menos um entre `segmentation`, `bbox` e
`keypoints` — sem geometria não há o que desenhar, e o conector recusa a
resposta inteira com uma mensagem dizendo qual anotação está incompleta.

`score` é opcional e hoje serve apenas de informação; o editor não filtra por
ele. Se o seu modelo tem um limiar de confiança, aplique-o dentro do contêiner.

Erros com corpo `{"detail": "mensagem"}` são mostrados ao usuário como estão,
então escreva mensagens que ajudem quem está anotando.

### `GET /metadata`, opcional

Quando existe, o Poligome usa esta rota para explicar na tela o que o contêiner
faz **antes da primeira execução**:

```json
{
  "name": "Detector de cáries",
  "task": "Segmentação de lesões em radiografia panorâmica",
  "description": "Segmenta lesões de cárie e restaurações em radiografia panorâmica adulta.",
  "limitations": "Não avaliado em dentição decídua nem em CBCT. Lesões incipientes são subdetectadas.",
  "categories": [{ "id": 1, "name": "cárie" }, { "id": 2, "name": "restauração" }],
  "geometry": ["polygon", "bbox"],
  "parameters": { "threshold": "0.35" }
}
```

Todos os campos são opcionais menos `categories`. `task` abre a explicação na
tela, `limitations` vira um aviso destacado na ficha do modelo e `parameters`
mostra a configuração com que o contêiner está rodando.

Sem `/metadata`, a explicação é montada a partir do que a última execução
devolveu — o Poligome guarda esse resumo no registro. Sem nenhum dos dois, a
tela diz que não há o que descrever, em vez de inventar.

## Os dois exemplos oficiais

O repositório traz dois modelos prontos, versionados em `public/byom/examples`,
para que a lista nunca dependa do que existe na máquina de quem escreveu o
contrato. Um comando constrói a imagem e registra os dois:

```bash
bash poligome-byom-macos-linux.sh examples
```

| modelo | porta | o que faz |
| --- | --- | --- |
| `byom-otsu` | 8080 | limiar de Otsu; objetos encostados viram uma região só |
| `byom-watershed` | 8081 | watershed na transformada de distância; separa objetos que se tocam |

Os dois saem da **mesma imagem**, mudando só a variável `METHOD` — é o exemplo
prático de por que `register` aceita `--env`. Reexecutar `examples` não
sobrescreve um registro que você já tenha ajustado: se o arquivo existe, ele é
mantido.

A imagem não é versionada no repositório: o tarball tem cerca de 347 MB, contra
menos de 4 MB de todo o histórico. Em vez disso, a **base do Dockerfile é fixada
por digest**, de modo que reconstruir meses depois produz a mesma imagem, byte a
byte, a partir de uma receita de poucos kilobytes.

## Passo a passo

### 1. Escreva o servidor de inferência

Baixe o exemplo, que já implementa o contrato inteiro:

```bash
curl -O https://www.poligome.com/byom/serve.py
curl -O https://www.poligome.com/byom/Dockerfile
```

O exemplo traz **dois métodos**, escolhidos pela variável `METHOD`, para mostrar
que uma mesma imagem pode servir a vários modelos registrados:

| `METHOD` | O que faz |
| --- | --- |
| `otsu` | limiar de Otsu e contorno externo de cada região. Objetos encostados viram uma região só |
| `watershed` | watershed sobre a transformada de distância: objetos que se tocam viram instâncias separadas |

Nenhum precisa de GPU. `SEED_FACTOR` ajusta o watershed: ele é a fração do pico
da transformada de distância que vira semente, então o quanto ele tolera de
sobreposição acompanha o tamanho do objeto — não há um número de pixels que valha
para qualquer imagem. Medido nesta implementação com dois círculos, a maior
sobreposição que ainda sai como duas instâncias é:

| diâmetro | `0,5` | `0,6` (padrão) | `0,8` |
| --- | --- | --- | --- |
| 60 px | 5 px | 5 px | 15 px |
| 90 px | 5 px | 10 px | 30 px |
| 180 px | 20 px | 30 px | mais de 40 px |

Subir o fator separa mais, ao custo de sementes menores, que descartam objetos
pequenos.

Os dois existem para ser um molde: troque a função `predict()` pelo seu modelo e
mantenha o resto.

### 2. Construa a imagem

```bash
docker build -t meu-modelo .
```

Ou, pela CLI do Poligome:

```bash
bash poligome-byom-macos-linux.sh build --path . --image meu-modelo
```

### 3. Registre o modelo

```bash
bash poligome-byom-macos-linux.sh register \
  --model-id byom-meu-modelo \
  --image meu-modelo \
  --name "Meu modelo de segmentação"
```

Para registrar os dois exemplos a partir da mesma imagem:

```bash
bash poligome-byom-macos-linux.sh register --model-id byom-otsu \
  --image poligome-byom-exemplo --name "Exemplo Otsu" --port 8080 --env METHOD=otsu
bash poligome-byom-macos-linux.sh register --model-id byom-watershed \
  --image poligome-byom-exemplo --name "Exemplo Watershed" --port 8081 --env METHOD=watershed
```

O identificador precisa começar com `byom-`, para nunca colidir com um modelo
oficial do catálogo. O registro grava `~/.poligome-sam/byom/byom-meu-modelo.json`. O conector não
carrega o seu modelo: ele apenas encaminha a imagem para o contêiner e valida a
resposta, então não há ambiente Python novo nem download nenhum.

Opções úteis:

| Opção | Efeito |
| --- | --- |
| `--port N` | porta local publicada; o padrão é `8080` |
| `--name "Rótulo"` | nome exibido na tela |
| `--env CHAVE=VALOR` | variável passada ao `docker run`; repetível |

`--env` permite que uma mesma imagem sirva a vários modelos registrados. É assim
que o exemplo entrega dois: `METHOD=otsu` e `METHOD=watershed`.

### 4. Suba o contêiner

```bash
bash poligome-byom-macos-linux.sh start --model-id byom-meu-modelo
```

O comando publica a porta apenas em `127.0.0.1`, espera o `/ping` responder
`200` e só então declara sucesso. Se o contêiner morrer antes disso, as últimas
linhas do log aparecem na saída.

### 5. Use no editor

Os modelos registrados aparecem na barra lateral do botão do modelo de IA, sob
**BYOM · seu modelo**, com o estado de cada contêiner. Ao escolher um, a barra
sobre a imagem ganha o botão **Rodar BYOM** — que vira **Rodar de novo** depois
da primeira execução. É a mesma barra do SAM: as abas de pontos e caixas só
aparecem com a ferramenta SAM ativa, porque o BYOM não recebe prompt, e o botão
de rodar aparece sempre que houver um contêiner selecionado.

SAM e BYOM podem ficar ativos ao mesmo tempo, e o botão do topo mostra os dois.
**Desselecionar todos**, no rodapé da janela, apenas deixa de usá-los para
anotar: nada é desinstalado, o conector segue conectado e as listas continuam
iguais.
São caminhos independentes: o SAM segmenta o que você clica, o BYOM anota a
imagem inteira, e as máscaras de um não alteram nem substituem as do outro — as
anotações do BYOM entram somadas às que já existem.

O resultado não entra direto na lista de anotações: ele aparece como
**proposta**, desenhada em tracejado sobre a imagem, e a barra oferece
**Salvar** e **Descartar**. É o mesmo contrato do SAM, em que a máscara só vira
anotação no salvar. Trocar de imagem esconde os botões, mas a proposta continua
guardada e reaparece ao voltar.

Salvar uma reexecução **substitui** o resultado anterior daquele modelo naquela
imagem, em vez de empilhar máscaras idênticas. Cada anotação criada guarda a origem
(`byom:<model-id>`), então anotações feitas à mão, as de outro modelo e as da
mesma origem em outras imagens ficam intactas. O aviso na tela diz quantas foram
substituídas.

Clicar num modelo abre a ficha dele: explicação automática do que exporta,
limitações que o próprio modelo declara, classes, parâmetros, variáveis do
contêiner e o resumo da última execução. A ficha também traz um campo de
**anotação livre**, para registrar em que dados o modelo foi treinado ou o que
revisar com atenção. O lápis edita nome, porta e anotação; a lixeira remove o
registro, sem tocar na imagem nem no contêiner do Docker.

**Trazer meu modelo** é só a documentação — contrato, passo a passo, arquivos
para baixar e o formulário de importação. Não há botão de usar modelo ali,
porque não é um modelo.

Também dá para **importar sem terminal**: no painel **Trazer meu modelo** há um
formulário com identificador, nome e porta. Ele apenas declara onde o contêiner
está — subir o contêiner continua sendo trabalho da CLI ou do `docker run`,
porque o Poligome não executa Docker por conta própria. As anotações aparecem
desenhadas com as classes que o modelo devolveu, prontas para revisar, corrigir
e exportar como qualquer outra anotação feita à mão.

---

## Comandos da CLI

```
examples  [--path DIR]                   constrói e registra os dois exemplos oficiais
build     --path DIR --image NOME        constrói a imagem a partir de um Dockerfile
register  --model-id ID --image NOME     registra o modelo (aceita --env CHAVE=VALOR)
start     --model-id ID                  sobe o contêiner e espera o /ping
stop      --model-id ID                  encerra o contêiner
status    [--model-id ID]                mostra registro, contêiner e /ping
list                                     lista os modelos registrados
logs      --model-id ID [--follow]       mostra a saída do contêiner
remove    --model-id ID [--purge]        remove o registro
```

---

## GPU

O contrato não trata de GPU: quem decide é a sua imagem. Para dar acesso à
placa, suba o contêiner à mão com o mesmo nome que a CLI usaria:

```bash
docker run -d --name poligome-byom-meu-modelo --gpus all \
  -p 127.0.0.1:8080:8080 meu-modelo serve
```

Depois disso, `start` percebe que o `/ping` já responde e não sobe um segundo
contêiner.

---

## Limites desta versão

- **Uma imagem por vez.** A anotação roda sobre a imagem aberta; não há lote.
- **Sem prompt.** O BYOM não recebe ponto, caixa nem texto: para segmentação
  guiada por clique, use o SAM.
- **`segmentation` só em polígono.** RLE, o outro formato do COCO, não é
  interpretado.
- **Só endereços locais.** O endpoint precisa ser `127.0.0.1` ou `localhost`.
  Um endereço remoto é recusado no registro, porque tiraria as imagens da sua
  máquina — exatamente o que o Poligome evita.
- **A licença é sua.** O Poligome não sabe o que roda dentro do contêiner e não
  verifica se o uso do modelo é permitido.
