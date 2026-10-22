# Publicação no Plesk

Esta aplicação Node.js usa SQLite e foi preparada para ser publicada mantendo a
mesma estrutura de arquivos existente hoje. A pasta `catalogo-crud` é a
aplicação; `produtos.json` e `imagens-produtos` permanecem como pastas irmãs.

## Permissão da câmera

O leitor de códigos da central usa `getUserMedia` com câmera traseira e sem áudio.
O domínio precisa de HTTPS válido e o usuário autoriza o acesso no navegador.
O Node envia `Permissions-Policy: camera=(self), geolocation=(), microphone=(),
payment=(), usb=()` e inclui `media-src 'self' blob:` na CSP.

Se o Apache/nginx/Plesk também definir esses cabeçalhos, não mantenha
`camera=()` no proxy: uma política mais restritiva impede o uso da câmera mesmo
com o cabeçalho correto no Node. Preserve a política de câmera para a própria
origem e mantenha o microfone desabilitado. Não é necessário liberar CDN ou
`unsafe-eval` na CSP.

Publique `public/js/features/barcode/`, `public/js/vendor/zxing-library-0.23.0.js`
e sua licença, junto com os arquivos atualizados da central. Reinicie o processo
Node para aplicar a alteração dos cabeçalhos. Após publicar, teste no Safari e
no PWA instalado: tocar em **Ler com câmera** deve abrir o diálogo e iniciar a
câmera diretamente, sem campo de digitação nem opção de leitor externo. Confira
a autorização, a leitura de um produto em Stories e Feed, o fechamento e a
negação de permissão. Após uma falha ou ao voltar do segundo plano, a câmera
deve permanecer desligada até o toque em **Tentar câmera novamente**, sem abrir
o teclado. No desktop, confira também a entrada manual, o leitor conectado e
a câmera opcional pelo botão **Usar câmera**. A decodificação não envia imagens
ao servidor.

## Estrutura a manter no servidor

Envie a pasta `vidamix` inteira, preservando esta relação:

```text
vidamix/
├── produtos.json
├── imagens-produtos/
│   └── manifesto-imagens.json
└── catalogo-crud/
    ├── camas-stories/
    ├── camas-feed/
    ├── camas-indoor-h/
    ├── data/
    ├── public/
    ├── package.json
    └── server.mjs
```

A `Application Root` do Plesk será `vidamix/catalogo-crud`. Por isso, os
caminhos padrão da aplicação já funcionam sem configurar caminhos absolutos:

```text
Banco SQLite:       ./data/catalogo.sqlite
Catálogo de origem: ../produtos.json
Manifesto:          ../imagens-produtos/manifesto-imagens.json
Imagens:            ../imagens-produtos
Backgrounds Stories: ./camas-stories
Backgrounds Feed:    ./camas-feed
Backgrounds Indoor:  ./camas-indoor-h
```

Os fundos de TV Indoor horizontal usam `camas-indoor-h`. Se estiverem em outra
pasta, configure `INDOOR_BACKGROUNDS_ROOT` nas variáveis do Plesk. O caminho pode
ser absoluto ou relativo à pasta da aplicação. A pasta pode ficar vazia durante
a preparação dos fundos; a API continuará respondendo com uma lista vazia.
Para exportar um vídeo Indoor, copie os fundos para essa pasta e selecione um
fundo no editor, além dos cinco produtos.

## Troca das imagens de produtos para WebP

Publique também `src/modules/products/product-images.mjs`, as alterações em
`product-service.mjs` e `src/app.mjs`, e reinicie o Node em **Restart App**.
Envie os arquivos convertidos para a mesma pasta `imagens-produtos/imagens/`.
Para cada referência `nome.png`, o servidor prioriza `nome.webp`, depois
`nome_resultado.webp`, e mantém o PNG quando nenhum WebP estiver disponível.
O nome deve preservar inclusive o hash original.

Não é necessário migrar manualmente `imagem_arquivo`, reimportar o manifesto
ou substituir o banco de produção. A resolução automática vale para os dados
existentes e para novas importações; o banco e o manifesto não são reescritos.
Novos lotes são reconhecidos sem reiniciar o Node novamente.

Após publicar, consulte um produto em `/api/products/ID`: `imagem_local_url`
deve terminar em `.webp` quando o arquivo convertido estiver disponível. A URL
final deve responder 200 com `Content-Type: image/webp`; a antiga URL PNG deve
redirecionar para ela. Confira o catálogo e a exportação da arte antes de remover
os PNG. Se houver uma regra própria de Apache/nginx para `/assets/`, preserve o
encaminhamento dessa rota ao Node para que a compatibilidade seja aplicada.
Os ícones PNG do PWA permanecem como estão.

## Antes de enviar

Na pasta `catalogo-crud`, execute:

```bash
npm ci
npm run verify
```

Envie todos os arquivos, inclusive `package-lock.json`, `camas-stories`, `camas-feed`, `camas-indoor-h`,
`produtos.json` e `imagens-produtos`. Não envie `node_modules`, `.env` ou a
pasta `data` de desenvolvimento.

> A pasta `data` será criada no primeiro início no servidor. Nas atualizações,
> preserve `data/catalogo.sqlite`, pois ela contém os dados persistentes.

## Configuração no Plesk

Em **Websites & Domains > Node.js**:

1. Selecione Node.js **22.13 ou superior e inferior ao 25**.
2. Defina **Application Root** como `vidamix/catalogo-crud`.
3. Defina **Document Root** como `vidamix/catalogo-crud/public`.
4. Informe `server.mjs` em **Application Startup File**.
5. Selecione o modo **Production** e o gerenciador `npm`.
6. Em **Custom Environment Variables**, cadastre apenas:

```env
NODE_ENV=production
APP_AUTH_ENABLED=false
```

Não defina `PORT`: o Plesk fornece esse valor ao processo Node.js. Também não
é preciso declarar variáveis de caminho se a estrutura acima foi preservada.

O acesso exige login de usuário. `APP_AUTH_ENABLED=false` desliga apenas a antiga
barreira HTTP Basic, sem desativar o login nem as permissões. As variáveis do
painel têm efeito mesmo que o `.env` local tenha sido alterado.

Crie o primeiro administrador pelo comando `npm run users:create-admin`, usando
no terminal a mesma configuração de armazenamento do processo Node.js.
Consulte [Login, usuários e permissões](usuarios-e-permissoes.md).

Clique em **NPM Install** e depois em **Restart App** (ou **Enable Node.js**).

A geração de miniaturas e fundos otimizados depende do Sharp, incluído no
`package-lock.json`. Instale as dependências no próprio servidor (`npm ci` ou
**NPM Install**) para obter o binário correto. Mantenha
`CATALOG_STORAGE_ROOT/background-cache` gravável pelo usuário do Node.js.
O cache é gerado automaticamente e pode ser reconstruído a partir dos originais.

## Validação após publicar

Abra diretamente, sem credenciais:

```text
https://seu-dominio/api/health
```

A resposta esperada é:

```json
{"status":"ok"}
```

Entre em `/login` e depois valide `/`, `/catalogo`, `/artes/stories`, `/artes/feed` e `/artes/indoor-h`.
Confira também `/api/indoor-backgrounds` para verificar a lista de fundos da TV.

### Instalação PWA

Mantenha o site na raiz do domínio/subdomínio, como nas rotas acima, e force HTTPS.
Envie também `public/manifest.json`, `public/manifest.webmanifest`, `public/sw.js`,
`public/offline.html`, `public/pwa.css`, `public/js/pwa.js`, `public/branding/`,
`public/pwa-icons/`, `public/apple-touch-icon.png` e
`public/apple-touch-icon-precomposed.png`, além das cinco páginas HTML atualizadas.
Reinicie a aplicação após atualizar o código em `src/`.

As páginas usam `/manifest.json?v=2`, servido como `application/json` também
pelo proxy. O `.webmanifest` é mantido apenas para links antigos. Os ícones
ficam em `/pwa-icons/`: **não use `/icons/`**, pois o Apache/Plesk pode resolver
esse caminho para seus próprios ícones em vez dos arquivos da aplicação.
O ícone Apple tem ainda os caminhos convencionais na raiz do site.

O Node permite GET/HEAD sem senha somente para esses manifestos e arquivos de
ícone enumerados, sem liberar páginas ou API. Se houver proteção de diretório
no próprio Plesk/nginx/Apache, esses metadados também precisam ser acessíveis
sem o desafio HTTP Basic. Não aplique cache longo a `/sw.js` e preserve seu
Content-Type JavaScript ao servi-lo diretamente pelo proxy.

Verifique a publicação, sem enviar credenciais:

```bash
npm run check:pwa -- https://vidamix.vidafarmacias.com.br
```

O comando verifica o HTML quando ele está acessível, o manifesto standalone,
o tipo MIME, os ícones PNG e suas dimensões. Ele falha se detectar referências
antigas a `/icons/`, erro HTTP (como 404/401) ou manifesto sem Content-Type JSON.
Com HTML protegido, informa que as tags da página não foram verificadas e
confere os arquivos públicos de instalação diretamente.

Após abrir a aplicação, confira o manifesto e o service worker nas ferramentas do
navegador e use **Instalar aplicativo** na central. Abra o ícone instalado e
confirme que o VidaMix inicia na central em uma janela standalone. Em iOS,
use o Safari e **Compartilhar > Adicionar à Tela de Início**, mantendo
**Abrir como App** ativado se essa opção aparecer. Se já existir um atalho
sem ícone criado antes desta correção, remova-o e adicione novamente após
recarregar o site. Confira o logotipo na prévia antes de tocar em Adicionar.
Depois da primeira abertura online, desconecte e navegue: a tela de reconexão
deve aparecer. Os dados e editores continuam exigindo conexão com o servidor.

## Atualizações, versionamento e backup

- Versione código, documentação e `package-lock.json`; nunca versione `.env`,
  `node_modules` ou o banco SQLite.
- Crie uma tag antes de cada publicação, por exemplo `git tag -a v1.0.0 -m "Publicação v1.0.0"`.
- Para atualizar, envie os arquivos novos sem substituir `data/` e reinicie a
  aplicação no Plesk.
- Antes de atualizar, faça backup de `data/catalogo.sqlite` junto com os
  eventuais arquivos `catalogo.sqlite-wal` e `catalogo.sqlite-shm`.
- Force HTTPS no domínio e mantenha a senha administrativa apenas nas
  variáveis de ambiente do Plesk.
