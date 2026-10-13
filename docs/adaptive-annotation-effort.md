# Medir se o LoRA poupa trabalho de anotação

O objetivo é chegar à mesma qualidade com menos trabalho humano. O começo
pode custar preparação, correções e testes; o ganho deve aparecer nos casos
seguintes. A quantidade de dados necessária é uma descoberta do projeto,
não um número universal que a interface promete.

## Fluxo no editor

1. Abra **IA → Adaptive AI → O LoRA está poupando trabalho?** e ative
   **Medir esforço neste projeto**. A opção começa desativada.
2. Use pontos ou caixa. A medição começa no primeiro prompt/começo do arrasto.
3. Aceite a proposta com **Salvar e editar**. A medição continua enquanto você
   inspeciona e corrige a máscara.
4. Use **Concluir revisão** quando ela atingir seu critério de qualidade.
   Essa ação declara o fim do trabalho; não certifica automaticamente a qualidade
   nem aprova a máscara para o dataset de treino.
5. Alterne entre SAM original e adaptador em novos casos semelhantes. Consulte
   a tabela por versão e exporte **medições CSV**.

O painel mostra exemplos de treino efetivamente usados (`data.fit.instances`)
e grupos de origem por versão quando o conector oferece esses dados. Portanto,
pode responder: “depois de X máscaras usadas para treinar esta versão, o
tempo/cliques observados nos novos casos foram Y”. Pacotes importados sem essa
evidência mostram **Não informado**. Não fabricamos resultados na tabela vazia.

## O que é contado

| Medida | Definição |
| --- | --- |
| Segundos por revisada | Tempo de trabalho em primeiro plano + espera, incluindo tentativas descartadas, dividido por máscaras concluídas |
| Prompts por revisada | Cliques positivos/negativos ou caixas, incluindo tentativas descartadas, dividido por máscaras concluídas |
| Correções por revisada | Gestos que alteram a geometria depois de aceitar; um arrasto conta uma vez, não uma vez por frame |
| Espera total | Tempo em primeiro plano com pelo menos uma solicitação SAM pendente; solicitações sobrepostas não duplicam o tempo |
| Revisadas / imagens | Número de máscaras concluídas e imagens distintas; várias máscaras da mesma imagem não são fontes independentes |
| Descartadas / incompletas | Tentativas rejeitadas entram no custo; sessões sem conclusão explícita ficam fora das médias e são indicadas |
| Respostas sem cache | Respostas que explicitamente informam que o embedding não foi reutilizado |

Os prompts não representam todos os cliques da interface. Aceitar, menus, pan
e zoom não contam como prompts/correções, embora seu tempo durante a sessão
conte. Renomear classes e alterar notas de revisão não são alterações de geometria.
Pausas explícitas e aba oculta não contam. Use **Pausar medição** para interrupções
mantendo a aba visível. Novos prompts e correções retomam a medição pausada.

Aceitar não termina o cronômetro. Reabrir uma máscara incompleta selecionada
retoma o trabalho; editar uma máscara já concluída reabre seu registro, que
precisa ser concluído novamente. Trocar imagem/projeto ou fechar a página deixa
uma sessão em andamento incompleta. Reiniciar uma proposta não aceita registra
uma tentativa descartada; reiniciar após aceitar deixa revisão incompleta.
Não há cronometragem retroativa do tempo passado com o editor fechado.
Excluir parte das propostas remove essas máscaras do denominador; excluir
todas registra descarte. Operações que substituem todas as formas por novos
IDs, como algumas divisões/uniões, encerram a tentativa como descarte; não
atribuímos automaticamente o trabalho a formas novas sem rastrear sua origem.

## Comparação e retorno do investimento

Cada resposta registra a identidade efetiva do modelo, dispositivo,
fingerprint do checkpoint base e versão do adaptador. Modelo antigo que não
oferece metadata aparece como não identificado. Troca de modelo dentro da
mesma tentativa marca a sessão como misturada. Esses registros não alimentam
o cálculo de retorno. Busca por texto do SAM 3 é excluída: seu decoder textual
não é adaptado por este LoRA interativo.

Após pelo menos cinco máscaras concluídas por modelo, com mesma base,
dispositivo e modo de prompt, o painel apresenta variação observada de tempo
e prompts. Cinco é um mínimo de interface, **não evidência de significância
estatística**. Sem ganho de tempo, não oferece uma promessa de amortização.

O campo **Tempo adicional preparando e testando (min)** permite estimar:

```text
ganho por máscara = segundos do original − segundos do adaptado
anotações futuras para compensar = teto(custo adicional em segundos / ganho por máscara)
```

Por exemplo hipotético, 10 minutos adicionais e 10 segundos poupados por
máscara compensam o custo após outras 60 máscaras semelhantes. O painel usa
suas medições, não esse exemplo. O custo não é o tempo de treino em CPU por
definição: se você continuou anotando durante o treino, informe apenas trabalho
adicional e interrupções que realmente custaram tempo.

Para avaliar a hipótese “depois de X dados economizamos Y tempo/Z cliques”,
compare sucessivas versões treinadas com quantidades crescentes de dados.
Use casos novos fora do treino, distribua dificuldades comparáveis, alterne
a ordem original/adaptado e mantenha o mesmo critério de qualidade. Registre
imagens/fontes distintas, cache frio/quente e experiência do anotador.
Uma revisão independente das máscaras reduz o risco de chamar menor qualidade
de maior velocidade. Repita com mais imagens e pessoas antes de generalizar.
Os números atuais são observacionais; não ajustamos uma curva preditiva de
economia nem um limiar universal de dados suficientes.

## Histórico e validação

O histórico fica no navegador, vinculado ao UUID do projeto `.plgm`, com até
1.000 sessões recentes e 100 metadados de versões. O arquivo de projeto não
embute o histórico. Reabrir o mesmo projeto no mesmo navegador recupera os
registros locais; outro computador precisa do CSV para análise externa.
O CSV exporta resultados, tempos, identidade do modelo e quantidade de dados
de treino conhecida, distinguindo adaptador desconhecido do modelo original, sem imagens,
coordenadas ou nomes de arquivos. Falha de armazenamento mantém um histórico
temporário e apresenta aviso para exportar antes de fechar.

Os testes de unidade verificam relógio, pausa, concorrência, descarte,
atribuição, geometria, retorno e CSV. O harness `tests/browser/annotation-effort-ui.html`
renderiza o editor real. O script opcional `scripts/annotation-effort-sam3-qa.mjs`
usa um conector SAM 3 isolado e um pacote LoRA real, contando correções e
verificando metadata, cache e exportação. **Tempos de automação não são dados de
produtividade humana**. Para resultados do modelo, consultar a
[validação local do SAM 3](adaptive-sam3-local-validation.md).

```powershell
npm run typecheck
node --import tsx --import ./tests/helpers/register-hooks.mjs --test tests/annotation-effort.test.mjs
node scripts/adaptive-ui-qa.mjs
node scripts/annotation-effort-ui-qa.mjs
```

Os dois scripts UI acima usam respostas controladas e Playwright Chromium.
O segundo valida exclusão parcial, reabertura da revisão, pausa/retomada e
persistência no editor real. O teste com SAM 3 exige um conector **isolado**:

```powershell
node scripts/annotation-effort-sam3-qa.mjs --base http://127.0.0.1:60934 --image work/sam3-effort-fixture.png --x 222 --y 121 --adapter resultados-adaptive/sam3-local/sam3-local-test.plora --out resultados-adaptive/sam3-local/effort-browser
```

Esse comando usa a imagem sintética de núcleos produzida por
`tests/helpers/adaptive_fixtures.py:nuclei_image(49001, 49)` nesta sessão; a
porta depende do conector iniciado. Ele ativa/desativa o adaptador informado,
portanto não deve ser apontado ao conector que você está usando para trabalhar.
