# Integrações de IA: DeepSeek

A primeira integração consulta um EAN e preenche os campos vazios **Nome**, **Subtítulo** e **Fabricante** no formulário do catálogo. A busca de imagens via SerpApi é independente e permanece inalterada.

## Ativação

Crie uma chave na plataforma da DeepSeek e configure as variáveis no ambiente do servidor:

```env
DEEPSEEK_API_KEY=sua_chave_privada
DEEPSEEK_MODEL=deepseek-flash
```

O modelo é opcional; `deepseek-flash` é o padrão. A chave é usada exclusivamente pelo backend. Não a adicione ao JavaScript público nem ao controle de versão.

Para configuração local em `.env`, preserve as variáveis existentes e inicie, dentro de `catalogo-crud`, com:

```powershell
node --env-file=.env server.mjs
```

Os comandos atuais `npm start` e `npm run start:production` não leem `.env` automaticamente. Em produção, configure as variáveis no gerenciador do processo e reinicie o serviço.

A conta precisa permitir a Search API e o modelo escolhido, com saldo/cota disponível. Busca e geração podem ter cobrança: consulte os [preços da DeepSeek](https://api-docs.deepseek.com/quick_start/pricing/). A implementação não cria contas nem adiciona créditos automaticamente.

## Uso

1. Abra **Novo produto**, informe o EAN e clique em **Preencher dados com IA**.
2. Aguarde a pesquisa e a extração. A aplicação apresenta os campos preenchidos e links das fontes.
3. Confira os dados, corrija se necessário e clique em **Criar produto**.

O acionamento é explícito para não gerar cobranças a cada dígito digitado. A API recebe somente o EAN; campos digitados pelo usuário, sessão e dados pessoais não são enviados à DeepSeek.

Campos já preenchidos e edições feitas durante a consulta são preservados. Campos sem evidência permanecem vazios. Ao trocar o EAN, sugestões da IA ainda não editadas são limpas; alterações manuais são mantidas. Fechar o modal descarta respostas atrasadas. O salvamento aguarda o término da consulta.

Usuários comuns podem consultar e criar produtos, sempre **pendentes**. Somente administradores podem aprová-los. A consulta em si não grava ou altera registros. O administrador também pode usar a integração ao editar um produto; usuários comuns não podem editar produtos existentes.

## Implementação e limites

- `src/integrations/deepseek-client.mjs`: cliente reutilizável para futuras integrações. URLs fixas da DeepSeek, chave no cabeçalho de autorização, sem redirecionamentos, respostas limitadas a 2 MB e mensagens de erro sem segredos.
- `src/modules/products/product-ai-service.mjs`: valida comprimento e dígito verificador do EAN; consulta até cinco resultados em `POST /v1/tools/search`; mantém fontes que mencionem o EAN exato; extrai os três campos usando `POST /chat/completions` com JSON Output.
- Cada valor precisa de um trecho literal da fonte fornecida. Respostas truncadas, EAN divergente, fontes desconhecidas e valores sem evidência são recusados. Fabricante exige identificação explícita no trecho; marca ou vendedor não devem ser inferidos como fabricante.
- As fontes e o modelo ainda podem errar ou associar dados ao produto errado. O preenchimento é uma sugestão para revisão, não uma garantia de identificação. O sistema não é uma base oficial GS1 e não fornece orientações médicas.
- Endpoint interno: `POST /api/products/lookup-ean`, corpo `{"ean":"3017620422003"}`. Exige sessão ativa e CSRF para administradores e clientes. Retorna `ean`, `encontrado`, `campos` e `fontes`, sem chave, prompt ou conteúdo bruto do provedor.
- Cache em memória por usuário/EAN por dez minutos, até 200 entradas. Consultas simultâneas idênticas são agrupadas. Limites por processo: seis novas consultas por minuto/usuário e três consultas simultâneas, com prazo total de 45 segundos. Reiniciar o processo limpa cache e limites.
- Fechar o modal cancela a espera no navegador; uma chamada já enviada ao provedor pode terminar e consumir cota. Não há repetição automática de chamadas com falha.
- Sem resultados verificáveis, sem chave, saldo insuficiente, limite atingido ou falha da API, o formulário informa o ocorrido e mantém o preenchimento manual disponível.

## Testes

```powershell
npm.cmd run check
npm.cmd run test:catalogue
npm.cmd run test:auth
```

As suítes usam respostas controladas, sem consumo de API. Cobrem validação de EAN, extração com evidência, erros, timeout, tamanho de resposta, cache, concorrência, permissões, CSRF, preenchimento e preservação de edições. A consulta real deve ser validada após configurar uma chave no ambiente de destino.

Referências oficiais: [Search API](https://api-docs.deepseek.com/api/search/), [JSON Output](https://api-docs.deepseek.com/guides/json_mode/), [Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/).
