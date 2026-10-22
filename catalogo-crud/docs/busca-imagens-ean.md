# Busca automática no Google Imagens por EAN

1. No catálogo, abra **Novo produto** e preencha **EAN**.
2. Clique em **Buscar no Google Imagens**. A aplicação consulta o Google Imagens via SerpApi e mostra os três primeiros resultados no próprio modal, na ordem recebida.
3. Clique na opção desejada e salve o produto. O servidor baixa a imagem original e salva uma cópia local. Não é necessário abrir outra aba, copiar uma URL ou carregar um arquivo manualmente.
4. Produtos de usuários comuns continuam **pendentes** até um administrador aprová-los como **ativos**.

## Configuração obrigatória no servidor

Configure `SERPAPI_API_KEY` com uma chave válida da SerpApi no ambiente do processo Node e reinicie a aplicação. A chave nunca é enviada ao navegador. Não a publique nem a cole no chat.

Se a configuração estiver no `.env` local (adicione a variável sem substituir as demais), inicie explicitamente com `node --env-file=.env server.mjs`. Os comandos `npm start` e `npm run start:production` atuais usam apenas as variáveis já exportadas no ambiente; eles não carregam `.env` automaticamente. No serviço de hospedagem, configure a variável no gerenciador do processo.

Sem a chave, a interface informa que a busca automática não está configurada; não há resultados simulados nem redirecionamento para uma busca manual. A SerpApi é um provedor externo, com cota e condições próprias: https://serpapi.com/images-results. O EAN pesquisado é enviado ao provedor. A ordem pode diferir de uma busca personalizada na conta Google do usuário.

## Comportamento e segurança

- Mostra até três opções, se houver menos resultados. Uma imagem cuja prévia não puder ser carregada permanece na posição original, desabilitada; não é substituída silenciosamente pelo quarto resultado.
- O usuário confere se a foto corresponde ao produto e se possui permissão para utilizá-la. Resultados do Google não implicam licença livre.
- Seleções usam tokens vinculados ao usuário e ao EAN, válidos por dez minutos. Trocar o EAN, fechar o modal ou carregar um arquivo descarta a seleção na interface.
- As buscas são armazenadas temporariamente por usuário/EAN por dez minutos; há limite de seis consultas novas por minuto/usuário e três simultâneas por processo. Cotas e faturamento continuam sujeitos ao provedor.
- O download aceita apenas HTTPS em porta padrão, valida DNS e redirecionamentos e fixa a conexão a um IPv4 público. Endereços privados, credenciais na URL, downloads excessivos e timeouts são bloqueados. Hosts exclusivamente IPv6 ou imagens apenas HTTP não são suportados.
- O servidor valida a imagem original: PNG, JPG ou WebP estáticos de até 8 MB e 25 megapixels. Converte para WebP de até 2000 × 2000, preservando transparência. Grava em `IMAGES_ROOT/imagens/` somente ao salvar e remove o novo arquivo se a validação do produto falhar.
- O campo `products.imagem_url` não é recriado. URLs de resultados ficam apenas em memória temporária no servidor. Créditos de imagens antigas são preservados.
- Envio de arquivo, colagem e arrastar/soltar continuam disponíveis como alternativas. O limite do corpo JSON é 12 MB; o proxy deve permitir esse tamanho para uploads manuais.

## Validação

`npm.cmd run check`, `npm.cmd run test:catalogue` e `npm.cmd run test:auth`.

Os testes automatizados usam respostas controladas do provedor e imagens locais; não consomem cota. Após configurar uma chave real, valide no ambiente de destino a busca por um EAN conhecido, a seleção, o salvamento e a aprovação. Sem credencial, a consulta real não pode ser verificada.
