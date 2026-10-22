# Testes de carga do VidaMix

Destino informado: `https://vidamix.vidafarmacias.com.br`, hospedado em Plesk.
Script: `scripts/load-test.js`, executado com Grafana k6 em outro computador.

## O que significa capacidade

O resultado será a quantidade de usuários virtuais **ativos**, executando um
fluxo definido e mantendo tempos de resposta aceitáveis. Não equivale a contas
cadastradas ou abas abertas. Anote o fluxo e as pausas junto de qualquer número.

Neste projeto, a composição, o PNG e a codificação MP4 acontecem no navegador.
O servidor Node.js fornece páginas, buscas no SQLite, produtos e imagens. O teste
HTTP mede essa hospedagem; a fluidez do editor e o tempo de exportação precisam
de uma conferência separada em computadores e celulares representativos.

## Preparar a hospedagem e a máquina geradora

1. Faça o teste preferencialmente antes da abertura ao público, na configuração
   final de hospedagem. Se já houver usuários, reserve uma janela de teste.
   Confirme os limites de testes de carga do provedor, sobretudo em plano compartilhado.
2. Preserve HTTPS, autenticação, proxy, cache/CDN e número de processos iguais aos
   da implantação real. Use o volume real de catálogo e imagens. O script só faz GET.
3. Registre CPU/vCPUs, RAM, plano, limites do processo Node.js, versão do Node,
   processos ativos e serviços que compartilham o servidor. Plesk sozinho não
   informa capacidade. A nomenclatura dos gráficos depende das extensões e do
   acesso administrativo; solicite ao provedor se não conseguir consultar.
4. Rode k6 em outra máquina com conexão cabeada ou em uma VPS externa. Monitore
   também CPU, memória e rede dessa máquina: ela não pode limitar o teste.
   Não execute o gerador no mesmo servidor da aplicação.
5. Deixe os logs de acesso, de erro do proxy e da aplicação e os gráficos do host
   acessíveis. Registre horários e fuso para cruzar com o relatório.

## Instalar e executar no Windows

Na máquina geradora, instale k6 e reabra o terminal se necessário:

```powershell
winget install k6 --source winget
k6 version
```

Abra PowerShell na pasta `catalogo-crud` e configure:

```powershell
$env:BASE_URL = 'https://vidamix.vidafarmacias.com.br'

# Mesmas credenciais Basic configuradas no Plesk; não salve a senha no código.
$loadCredential = Get-Credential -Message 'Credenciais do VidaMix'
$env:APP_USER = $loadCredential.UserName
$env:APP_PASSWORD = $loadCredential.GetNetworkCredential().Password

New-Item -ItemType Directory -Force -Path 'tmp/load-results' | Out-Null
$env:K6_WEB_DASHBOARD = 'true'
# Gera relatório sem manter o servidor do painel aberto ao terminar.
$env:K6_WEB_DASHBOARD_PORT = '-1'
$env:FLOW = 'mixed'
$env:ASSET_MODE = 'cached'
$env:VUS = '1'
$env:RAMP_SECONDS = '10'
$env:DURATION = '2m'
$env:K6_WEB_DASHBOARD_EXPORT = 'tmp/load-results/validacao.html'
k6 run scripts/load-test.js
```

Se a aplicação estiver realmente sem autenticação, omita Get-Credential e remova
APP_USER/APP_PASSWORD do ambiente. Não desative a proteção do site para o teste.
Erros 401/403, redirecionamentos e respostas de login devem ser corrigidos antes
de aumentar a carga. O setup interrompe se não alcançar a API ou os dados mínimos.

Depois da validação, rode uma carga de cada vez:

```powershell
$env:VUS = '10'
$env:RAMP_SECONDS = '60'
$env:DURATION = '10m'
$loadRun = Get-Date -Format 'yyyyMMdd-HHmmss'
$env:K6_WEB_DASHBOARD_EXPORT = "tmp/load-results/mixed-cached-10vu-$loadRun.html"
k6 run scripts/load-test.js
```

Altere VUS e o nome do relatório em cada execução. A progressão inicial sugerida
é **5 → 10 → 25 → 50 → 75 → 100**; os valores não são uma estimativa da capacidade.
Analise a etapa antes de seguir. Se houver folga em 100, prossiga em incrementos;
se 25 já falhar, refine entre o último nível aprovado e 25.

O cenário `warmup` sobe até a carga escolhida em RAMP_SECONDS. O cenário `steady`
mantém essa quantidade durante DURATION. São cenários separados: o aquecimento
prepara o servidor; o conjunto de usuários do patamar pode começar sem cache.
Iterações do aquecimento podem ser interrompidas na transição e aparecer no
resumo. Ao interpretar o limite, use **steady** e os gráficos daquele intervalo.
O encerramento permite até 90 segundos para finalizar os fluxos em andamento.

No fim da sessão, remova as credenciais do ambiente:

```powershell
Remove-Item Env:APP_USER, Env:APP_PASSWORD -ErrorAction SilentlyContinue
Remove-Variable loadCredential -ErrorAction SilentlyContinue
```

## Carga representada pelo script

| FLOW | Comportamento |
| --- | --- |
| `mixed` | Aproximadamente 25% catálogo, 37,5% Stories e 37,5% Feed por jornada |
| `catalogue` | Abre catálogo, consulta categorias, lista 48 produtos, busca e pagina |
| `stories` | Abre editor, carrega fundos/produtos, busca, seleciona itens e pausa para editar |
| `feed` | Mesmo fluxo, com os fundos e a página de Feed |

O script inclui downloads paralelos das imagens e dos principais arquivos da
aplicação. A amostra inicial é de 12 imagens por listagem do catálogo, 8 do editor
e 6 fundos, além do fundo escolhido. Aproximadamente metade das jornadas do
editor faz outra busca para representar dois produtos/combos. Há pausas de
leitura e 30–60 segundos para edição. Compare essas quantidades com a aba Network
do navegador e ajuste ao comportamento da equipe antes de certificar capacidade.

`ASSET_MODE=cached` guarda imagens já baixadas por cada usuário virtual durante
o cenário. `ASSET_MODE=cold` baixa novamente as imagens a cada jornada, inclusive
quando já vistas: é uma carga mais intensa para testar banda e novos acessos.
O cache é uma aproximação: não implementa toda a política de cache do navegador.
Arquivos de interface são solicitados a cada abertura. Fontes, ícones externos e
todos os detalhes de lazy loading não estão reproduzidos. Não há execução de
JavaScript da página nem geração real de PNG/MP4 nesse script.

Repita o patamar candidato com `FLOW=catalogue`, `FLOW=stories`, `FLOW=feed` e
`ASSET_MODE=cold` para identificar o recurso limitante. Não misture as métricas
dos perfis ao informar o resultado. Para um teste de pico, reduza RAMP_SECONDS
apenas depois de conhecer uma carga estável.

Cadastros, edições e exclusões de produtos não estão incluídos. Se houver uso
administrativo concorrente relevante, crie um cenário separado numa cópia com
dados descartáveis. Sua capacidade de escrita não está certificada pelo teste GET.

## Aprovação e monitoramento

Metas iniciais propostas, ajustáveis conforme a experiência esperada:

| Métrica no patamar steady | Critério inicial |
| --- | --- |
| Erros HTTP globais e de API | Menos de 1% |
| Validações de conteúdo/status | Mais de 99% aprovadas |
| p95 das APIs | Abaixo de 800 ms |
| p95 de cada download de imagem | Abaixo de 2 s |
| Experiência real sob carga | Busca, fundos e edição continuam utilizáveis |

p95 é o tempo que 95% das requisições não ultrapassaram. Não é a média. A meta
de imagem é por arquivo, não o tempo total de abrir uma página. Observe p99 e
os endpoints individualmente, pois a soma pode esconder uma busca lenta.
`http_req_duration` mede envio, espera e recebimento; não inclui DNS/conexão/TLS.
Use também essas métricas de conexão e a experiência real para avaliar abertura.

O script reprova automaticamente se ultrapassar as metas. Há interrupção quando
a taxa HTTP global acumulada supera 5%, avaliada após um minuto; isso não é uma
janela móvel nem detecta toda degradação súbita. Interrompa com **Ctrl+C** caso
apareçam falhas contínuas, falta de memória, disco cheio ou impacto em usuários.

No host acompanhe CPU **por núcleo**, RAM do processo e do servidor, swap, disco,
I/O, banda de saída, reinícios e 502/503/504. O código usa SQLite síncrono: buscas
podem ocupar o processo Node mesmo com CPU total aparentemente baixa em uma
máquina com vários núcleos. Isso é uma hipótese a medir, não um gargalo confirmado.
Observe também limites e outros clientes/serviços da hospedagem.

Os fundos são arquivos PNG de tamanhos variados. Uma API rápida com downloads
lentos pode indicar banda ou entrega de arquivos como limite. A exportação MP4
no navegador deve ser experimentada separadamente, em máquinas da equipe,
enquanto o servidor está no patamar candidato.

## Transformar medições em uma capacidade

Preencha uma linha por execução; não use apenas o resumo global de uma rampa:

| Data/perfil/cache | VUs | req/s | API p95/p99 | Imagem p95 | Erros | CPU/RAM/rede | Resultado |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A medir | — | — | — | — | — | — | — |

1. Encontre o maior patamar estável que atende às metas e refine perto da falha.
2. Repita o candidato e sustente por **30–60 minutos** para detectar crescimento
   de memória, reinícios ou degradação. Em hospedagem compartilhada, repita em
   horários diferentes.
3. Como regra inicial de operação, reserve **20–30% de folga** sobre o máximo
   estável medido e valide novamente a carga operacional escolhida.
4. Se 100 passa e a carga maior não foi testada, conclua **“pelo menos 100 neste
   cenário”**, não “máximo de 100”. Não extrapole para usuários cadastrados.

Exemplo fictício: 100 VUs passam, 125 falham, 110 passam por 60 minutos. Com 25%
de folga, pode-se começar propondo cerca de 80 usuários ativos, ainda sujeito à
validação desse patamar e do perfil de utilização. Isso não é uma medição do VidaMix.

## Referências

- Instalação: https://grafana.com/docs/k6/latest/set-up/install-k6/
- Modelagem dos fluxos: https://grafana.com/docs/k6/latest/testing-guides/api-load-testing/
- Usuários simultâneos: https://grafana.com/docs/k6/latest/using-k6/scenarios/executors/constant-vus/
- Critérios de aprovação: https://grafana.com/docs/k6/latest/using-k6/thresholds/
- Relatório HTML: https://grafana.com/docs/k6/latest/results-output/web-dashboard/
