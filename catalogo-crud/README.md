# _stackmedia

Plataforma local para organizar produtos e criar artes comerciais em Stories,
Feed e vídeos para TV. Sua estrutura permite incluir novos formatos, documentos
de frente e verso, exportações e integrações de publicação sem concentrar toda
a lógica em uma única página ou arquivo.

Para medir usuários simultâneos na hospedagem, consulte
[Testes de carga](docs/load-testing.md). O roteiro usa `scripts/load-test.js`
com k6 em uma máquina externa e inclui catálogo, Stories, Feed e imagens.

## Importação de produtos por planilha

No catálogo (`/catalogo`), administradores podem clicar em **Importar planilha**,
selecionar um `.xlsx`, analisar a prévia e importar os novos produtos. A primeira
aba deve manter os cabeçalhos na linha 1: **`code` → EAN**,
**`product_name_pt` → Nome** e **`brands` → Fabricante**. A identificação é feita
pelo nome do cabeçalho, em qualquer posição, aceitando os dois arquivos de exemplo:

| Campo | planilha exemplo.xlsx | planilha exemplo 2.xlsx |
| --- | --- | --- |
| EAN (`code`) | A | A |
| Nome (`product_name_pt`) | N | F |
| Fabricante (`brands`) | Z | L |

As demais colunas são ignoradas, sem necessidade de removê-las. A prévia mostra
as colunas identificadas, e os erros indicam a coluna correta de cada arquivo.
Cabeçalhos obrigatórios ausentes ou repetidos bloqueiam a importação para evitar
um mapeamento ambíguo. Espaços nas extremidades e diferenças entre maiúsculas e
minúsculas nos cabeçalhos são aceitos.

O limite é de 10 MB e 10.000 linhas. Nome é obrigatório e deve ter até 255
caracteres; Fabricante é opcional, também com até 255 caracteres. EANs aceitam
8, 12, 13 ou 14 dígitos. Prefira texto para preservar zeros iniciais. Valores
numéricos inteiros e máscaras de zeros também são aceitos; fórmulas, datas e
notação científica escrita como texto são rejeitadas nos campos importados.

A prévia informa novos produtos, EANs já cadastrados, repetidos e linhas
inválidas. São exibidos até 100 produtos e 100 ocorrências, com os totais do
arquivo. A importação adiciona todos os novos produtos válidos como ativos e
sem imagem, preserva os já cadastrados (inclusive inativos e pendentes) e
ignora linhas inválidas. Para EAN repetido, vale a primeira linha válida.
Após salvar, o catálogo exibe o filtro **Sem imagem local**.

`POST /api/products/import/preview` analisa e `POST /api/products/import` grava.
Ambos recebem `{ "file": "<XLSX em base64>" }`, exigem sessão de administrador
e CSRF. A gravação revalida a planilha e os EANs em uma transação: repetir a
importação não duplica produtos e falhas revertem o lote inteiro. A leitura usa
worker com limites de tempo, memória e tamanho descompactado. Não há novas
dependências ou migrações de banco. Testes: `npm run test:product-import`.

## Preenchimento de produtos com IA

No catálogo, informe o EAN e clique em **Preencher dados com IA** para consultar
a DeepSeek e preencher Nome, Subtítulo e Fabricante vazios, com fontes para revisão.
Configure `DEEPSEEK_API_KEY` no servidor. A consulta preserva edições manuais e
não aprova nem salva produtos automaticamente. Consulte
[Integração DeepSeek](docs/integracao-deepseek.md) para ativação, limites e testes.

## Remoção do fundo branco nas imagens da busca

Depois de buscar as três opções pelo EAN, selecione uma imagem e salve o produto.
O servidor baixa a imagem escolhida e remove o fundo branco antes de gravar o
WebP no catálogo. A prévia da seleção mostra a imagem original; a tela informa
que o processamento ocorrerá ao salvar. A remoção usa
[`magic-wand-tool`](https://github.com/Tamersoul/magic-wand-js) 1.1.7 (MIT),
instalada no projeto, e Sharp para leitura e gravação. Não exige chave de API
adicional nem download de modelos.

O recorte seleciona regiões brancas ou quase brancas conectadas às bordas,
preservando regiões brancas internas fechadas, como rótulos. Imagens que já
possuem transparência mantêm seu recorte. Fundos coloridos não são removidos.
Um produto branco sem contorno distinguível do fundo pode exigir outra imagem
ou um arquivo já recortado. A seleção totalmente branca é rejeitada para não
salvar uma imagem vazia. Arquivos carregados manualmente mantêm o fluxo atual.

O processamento acontece em worker com limite de 10 segundos, após reduzir a
imagem para no máximo 2000 × 2000 pixels. Em caso de falha, o produto não é
gravado e a tela permite escolher outra imagem. Testes em
`npm run test:catalogue` cobrem transparência, preservação de rótulos, arquivos
inválidos e gravação no banco temporário.

## Revistas mensais

Administradores acessam **Engrenagem → Gerenciar revistas** (`/revistas`). Cada mês/ano tem uma revista com título, situação e uma lista de produtos do catálogo com preços sugeridos. É possível consultar e buscar os produtos, renomear, pausar/ativar, substituir a lista por nova importação e excluir a edição sem excluir os produtos do catálogo.

A página inicial exibe a revista ativa do mês atual no carrossel e em uma seção ao final da página, para todos os usuários autenticados. Cada card oferece Stories e Feed. É possível selecionar de dois a cinco produtos para abrir Encarte ou TV com a seleção na mesma ordem e os preços importados da revista. A seleção permanece ao buscar, filtrar e trocar de página; os produtos sem imagem não podem ser incluídos. Os botões de criação em grupo ficam disponíveis a partir de dois itens.

Stories, Feed, Encarte e TV preenchem os preços sugeridos da revista vigente automaticamente, permitindo edição manual. Isso também funciona ao abrir pelo catálogo ou código de barras. Composições com vários produtos recebem preços individuais; o valor total de um combo é informado manualmente. Edições pausadas, futuras, encerradas ou sem produtos ativos não aparecem nesses destaques nem fornecem preços automáticos.

1. Baixe o modelo XLSX na página (arquivo distribuído em `resources/modelo-revista.xlsx`).
2. Preencha `EAN`, `PREÇO` e `VIGENCIA` a partir da linha 2 da aba `Revista`. Preserve os zeros iniciais do EAN. Use preço numérico ou decimal brasileiro e vigência `MM/AAAA` (datas Excel também são aceitas). Use somente um mês por arquivo.
3. Envie o XLSX e clique em **Analisar planilha**. Confira a prévia: corrija os erros ou marque **Ignorar as linhas com erro** para importar somente os produtos válidos.
4. Confirme a importação. Para um mês já cadastrado, a substituição integral exige marcar a confirmação; edições concorrentes exigem refazer a prévia.

O limite é de 4 MB e 2.000 produtos por arquivo. Linhas com EANs inexistentes, ambíguos, repetidos ou de produtos inativos, fórmulas, preços ou vigências inválidas podem ser descartadas mediante confirmação explícita. A prévia informa quantas linhas serão ignoradas; a API exige `ignoreErrors: true` e revalida o arquivo ao salvar. Arquivos sem produtos válidos, com cabeçalhos incorretos ou com meses diferentes continuam bloqueados. A gravação dos produtos selecionados é atômica. Os preços são armazenados em centavos, separados do catálogo. O mês corrente segue `America/Sao_Paulo`.

As tabelas `magazines` e `magazine_items` são criadas automaticamente na inicialização e fazem parte do backup SQLite. Publique também a pasta `resources/` e instale as dependências do `package-lock.json`. O XLSX é processado em worker com limites de tempo/memória e verificação de tamanho descompactado.

Esta etapa entrega a administração e os dados para integração com a criação de conteúdos. `GET /api/revistas/destaque` disponibiliza a edição ativa do mês a usuários autenticados, com os produtos e `preco_sugerido`; a seleção das revistas dentro dos editores será uma etapa posterior. As demais rotas `/api/revistas` são restritas a administradores; mutações exigem CSRF. Testes: `npm run test:magazines`.

## Acesso e usuários

A aplicação exige login por e-mail e senha. Clientes consultam o catálogo e criam
artes; administradores também gerenciam produtos, parceiros e usuários.
Para criar o primeiro administrador, execute `npm run users:create-admin` em um
terminal no servidor, com a mesma configuração de banco da aplicação. No Windows,
use `npm.cmd run users:create-admin`. Não há senha padrão.
Consulte [Login, usuários e permissões](docs/usuarios-e-permissoes.md).

## Identidade visual


A identidade compartilhada está em `public/brand.css`: Space Grotesk no corpo,
Archivo Black nos títulos, tinta `#151515`, papel `#f3ede8`, superfície `#fcf8f4`,
rosa `#e21a59` e laranja `#e25d1f`, com tokens de bordas, cantos e sombras.
As páginas carregam essa base antes dos estilos de cada tela; o tour também
usa os mesmos tokens. A fonte é servida localmente por `public/fonts/`, com sua
licença SIL, sem depender do Google Fonts em tempo de execução.
O tema da interface é independente da composição e das fontes das artes exportadas.
O botão de sol/lua no cabeçalho alterna entre os modos claro e escuro. Sem uma
preferência salva, o app acompanha o tema do sistema. A escolha é guardada neste
navegador e sincronizada entre abas. `public/js/theme.js` aplica o tema antes do
primeiro conteúdo; `public/theme.css` cobre também os modais mobile, tour e tela
offline. Imagens e exportações PNG/MP4 conservam suas cores. Execute
`npm run test:theme` para verificar preferência, sincronização e inicialização.

## Instalar como aplicativo (PWA)

O _stackmedia pode ser instalado em modo **standalone**, com janela própria,
nome e ícone. Acesse por **HTTPS** em produção (ou `localhost` em desenvolvimento).
Na central, clique em **Instalar aplicativo** quando o navegador disponibilizar
a instalação, ou use a opção de instalar no menu do navegador. No iPhone/iPad,
abra no Safari e use **Compartilhar > Adicionar à Tela de Início**.
O botão deixa de aparecer dentro do aplicativo instalado.

Os logotipos vetoriais `_stackmedia` para os temas claro e escuro ficam em
`public/branding/stackmedia-wordmark.svg` e `stackmedia-wordmark-dark.svg`.
O monograma `_s` em `public/branding/stackmedia-icon.svg` gera os ícones PWA
de 192 e 512 pixels, a versão maskable e o ícone Apple de 180 pixels.
Para regenerar os PNGs, execute `node scripts/generate-pwa-icons.mjs`.

`public/manifest.json` define o modo standalone e a abertura na central.
Todas as telas e seus aliases carregam o manifesto e `public/js/pwa.js`.
A abertura animada está em `public/js/pwa-launch.js` e `public/pwa.css`.
Ela aparece na entrada do app instalado (inclusive no iOS), sem repetir em links
internos, recargas ou retorno pelo histórico. A apresentação leva cerca de 1,8 s,
respeita movimento reduzido e pode ser encerrada por toque ou teclado.
Para visualizar no navegador, abra `/?abertura=1`. A animação é exibida dentro
do app; a tela nativa anterior à página continua sendo controlada pelo sistema.
O manifesto e os ícones de instalação aceitam GET/HEAD sem autenticação, para
que a descoberta do ícone não dependa da sessão HTTP Basic do navegador.
As páginas e os dados exigem uma sessão de usuário. O login e seus recursos
visuais ficam públicos. HTTP Basic é uma barreira adicional, aplicada somente
quando `APP_AUTH_ENABLED=true`; ela não substitui o login de usuários.
O manifesto `.webmanifest` permanece disponível para compatibilidade, com o
mesmo conteúdo do `.json` (verificado pelos testes).

Os ícones usam `/pwa-icons/` porque `/icons/` pode ser um alias do Apache/Plesk.
O PNG Apple também está na raiz de `public/` como `apple-touch-icon.png` e
`apple-touch-icon-precomposed.png`. A extensão `.json` evita depender de um
tipo MIME adicional no proxy. Após publicar, execute
`npm run check:pwa -- https://vidamix.vidafarmacias.com.br` para conferir os
arquivos efetivamente entregues pela hospedagem, incluindo MIME, status HTTP
e dimensões dos ícones. Se houver um atalho antigo sem ícone no iPhone,
remova-o e adicione novamente pelo Safari depois de atualizar a publicação.

O service worker em `public/sw.js` mantém apenas uma tela de falta de conexão
e seus recursos visuais. **Catálogo, edição e consulta de produtos precisam de
conexão com o servidor**; dados da API, páginas da aplicação e imagens de produtos
não são armazenados pelo service worker. Ao perder a conexão e navegar, o usuário
pode tentar novamente na mesma URL. Atualizações do worker aguardam o fechamento
das janelas da aplicação, sem recarregar artes em edição. Incremente `CACHE_NAME`
em `sw.js` ao modificar a tela offline ou seus recursos.

Execute `npm run test:pwa` (também incluído em `npm run verify`) para verificar
manifesto, ícones, rotas, autenticação, fallback offline e fluxo de instalação.

## Experiência mobile

Até 900 px, as telas usam cabeçalhos compactos, áreas de toque maiores e os
espaçamentos seguros do aparelho. A central e o catálogo têm navegação inferior
com **Início**, **Catálogo**, **Stories** e **Feed**. Os cartões, botões e links de
TV ficam ocultos no mobile; a rota direta continua disponível. No desktop,
os acessos a TV permanecem. O modo instalado é identificado tanto por
`display-mode: standalone` quanto pelo sinal do Safari no iOS.

O catálogo oferece filtros recolhíveis, categorias com rolagem horizontal,
paginação também no final da lista e edição em tela inteira. Cabeçalho e ações
do formulário permanecem visíveis enquanto os campos rolam. Na central, o código
de barras é lido pela câmera: **Ler com câmera** abre o leitor e inicia a captura
no mesmo toque. No mobile não há digitação manual nem leitura por dispositivo
externo. No desktop, continuam disponíveis a entrada manual, o leitor conectado
e a câmera opcional.

Stories e Feed mantêm o canvas ampliado e editável. Os botões quadrados **Fundo**,
**Produtos** e **Oferta**, à direita sob a grade, abrem os respectivos modais;
**Ajuste automático** e **Vincular** ficam à esquerda, e a exportação no cabeçalho.
Não há abas de etapas nem painel Ajustes no mobile: produtos, ofertas e textos
podem ser arrastados e redimensionados diretamente na arte.

`public/app-shell.css` e `public/js/app-shell.js` centralizam navegação, modo
instalado e ajuste ao teclado. Os estilos mobile específicos ficam em
`home.css`, `catalogue-mobile.css`, `stories-mobile.css` e `indoor-h.css`.
As alturas acompanham o VisualViewport, inclusive quando o teclado redimensiona
a tela, sem desativar o zoom do navegador.

`npm run test:app-mobile`, `npm run test:catalogue`, `npm run test:stories-mobile`
e `npm run test:indoor` verificam esses fluxos e integram `npm run verify`.
Ao validar no aparelho, confira instalação em standalone, rotação, teclado,
edição de produto, leitura pela câmera e os modais e gestos dos editores.

## Conversão entre Feed e Stories

No editor, use **Converter para Feed** ou **Converter para Stories**. No celular,
o botão fica em **Salvar arte**. A conversão mantém produtos, composição, preços
e texto livre, ajusta os elementos à nova área e mantém a arte editável.
O editor procura a versão equivalente do fundo pelo nome da campanha. Se ela
não existir, conserva o fundo original com recorte e mostra um aviso para revisão.
Falhas no carregamento do fundo mantêm o formato atual e permitem tentar novamente.
A conversão fica indisponível durante a exportação de PNG ou MP4.

`public/js/features/stories/format-conversion.js` centraliza a transformação das
coordenadas e a correspondência dos fundos. `npm run test:stories-layout` verifica
esses comportamentos e o ajuste dos elementos para os dois formatos.

## Leitor pela câmera

No mobile, toque em **Ler com câmera** na central: o diálogo abre e já inicia
a câmera. Autorize o acesso, escolha Stories ou Feed e enquadre o código inteiro,
com boa iluminação. O leitor prefere a câmera traseira, confirma duas leituras
do mesmo código e abre o produto no formato escolhido. Não há campo de código,
envio manual nem opção de alternar para um leitor USB/Bluetooth no mobile.

No desktop, **Código de barras** mantém a entrada manual e o leitor conectado.
Para ler pela câmera, toque em **Usar câmera**; **Desligar câmera e digitar código**
retorna à entrada manual.

A câmera exige HTTPS em produção (ou `localhost` para desenvolvimento) e
permissão do navegador. O acesso ocorre apenas depois do toque do usuário, sem
microfone. Fechar o leitor, trocar para digitação no desktop, encontrar um código ou colocar
o app em segundo plano encerra a captura. Voltar ao app não religa a câmera
automaticamente. No mobile, uma pausa ou erro mantém a entrada manual oculta e
oferece **Tentar câmera novamente**. A captura só recomeça após esse toque;
erros na consulta do produto também não abrem o teclado nem reiniciam a câmera.
As imagens são processadas no dispositivo; somente o código identificado é
enviado à API existente de produtos.

O decodificador ZXing 0.23.0 é servido localmente e carregado sob demanda, sem
depender de `BarcodeDetector`, permitindo o uso em Safari/iOS. São aceitos
EAN-13, EAN-8, UPC-A e códigos numéricos GTIN em ITF/Code 128, sempre com tamanho
e dígito verificador válidos. Não é um leitor de QR codes.

Os módulos estão em `public/js/features/barcode/`; a biblioteca e licença estão
em `public/js/vendor/`. Não há dependência npm ou build adicional em produção.
Publique também os arquivos novos e mantenha `Permissions-Policy: camera=(self)`
no proxy, conforme o [guia de publicação](docs/deployment-plesk.md).
`npm run test:app-mobile` inclui decodificação de pixels reais de códigos gerados,
permissões negadas, cancelamento de pedidos pendentes e desligamento das câmeras.

## Imagens de produtos em WebP

As referências PNG já gravadas no SQLite e no manifesto continuam válidas.
Para `imagens/produto.png`, o servidor procura, nesta ordem, `produto.webp`,
`produto_resultado.webp` e o PNG original na mesma pasta. O sufixo `_resultado`
é aceito para arquivos gerados pelo conversor em lote. Preserve o nome completo,
incluindo o hash que já faz parte do nome; arquivos WebP vazios ou diretórios
não são tratados como conversões prontas.

A API entrega a URL WebP em `imagem_local_url` para catálogo, leitura por EAN
e editores. URLs PNG antigas redirecionam temporariamente para o WebP disponível,
com suporte a GET/HEAD e `Content-Type: image/webp` no arquivo final. Produtos
ainda não convertidos continuam usando PNG. Novos arquivos são detectados nas
próximas requisições, sem reiniciar o processo a cada lote.

Esta resolução ocorre na leitura: não reescreve o banco, o manifesto nem as
URLs externas de origem. Também permite salvar um cadastro cujo caminho antigo
PNG agora corresponde a um WebP. Não é necessário apagar o SQLite ou reimportar
o catálogo. As regras de autenticação e acesso à pasta de imagens permanecem.
Ícones do PWA, logotipos e fundos não participam desta conversão automática.

Publique o código atualizado, reinicie o Node uma vez e envie os WebP completos
para `imagens-produtos/imagens/` (ou `IMAGES_ROOT/imagens/`). Recarregue a tela
para obter as novas URLs; mantenha os PNG até validar os arquivos convertidos.
`npm run test:catalogue` inclui os testes de compatibilidade em
`scripts/product-images.test.mjs`.

## Rotas

| Endereço | Uso |
| --- | --- |
| `/` | Central do _stackmedia e formatos disponíveis |
| `/catalogo` | Gestão de produtos |
| `/artes/stories` | Editor de artes para Stories |
| `/artes/feed` | Editor de artes para Feed vertical (4:5) |
| `/artes/indoor-h` | Carrossel de 2 a 5 produtos para TV horizontal (16:9) |
| `/api/*` | API JSON interna |

Os caminhos antigos de arquivos continuam funcionando como compatibilidade, mas
novas telas devem ser registradas por rota semântica.

## Editor de Feed

Abra **Feed** na central, na navegação ou no catálogo. O atalho **Feed** de cada
produto abre `/artes/feed?productId=ID` com o item selecionado. O leitor de código
de barras da central também permite escolher Stories ou Feed antes da leitura.

Feed usa 1080 × 1350 pixels, acompanhando a proporção 4:5 dos fundos enviados em
`camas-feed/`. A lista é carregada por `/api/feed-backgrounds`; as imagens são
servidas em `/feed-backgrounds/`. Para outra localização, configure
`FEED_BACKGROUNDS_ROOT`. Stories continua usando `camas-stories/` e 1080 × 1920.

Os formatos compartilham o editor, incluindo um produto, dois produtos, combo,
preços, texto livre, seleção, movimentação, redimensionamento, vínculo de
elementos, zoom, grade, ajuste automático, interface mobile, tour e exportações.
O PNG e o MP4 de 15 segundos usam o tamanho do formato selecionado e recebem
prefixos `feed-` ou `story-` no nome do arquivo. As condições de suporte a MP4
descritas abaixo também se aplicam ao Feed.

A configuração em `public/js/features/stories/formats.js` separa dimensões,
áreas iniciais de produtos, margem superior e origem dos fundos. O ajuste
automático respeita a área mais curta do Feed. `npm run verify` verifica os dois
formatos, incluindo geometria, dimensões do MP4, controles das páginas e fundos.

## Vídeo para TV

Abra **TV** na central ou acesse `/artes/indoor-h`. O editor cria um
carrossel horizontal de **1920 × 1080 pixels**, com **dois a cinco produtos** em um
vídeo MP4 de **15 segundos**, sem áudio. O tempo é dividido igualmente entre os
produtos, com transições horizontais suaves; a última transição volta ao
primeiro produto para permitir a reprodução em repetição na televisão.

1. Busque e selecione de dois a cinco produtos diferentes do catálogo, todos com imagem
   local disponível. É possível continuar a partir de dois produtos.
2. Reordene os produtos na sequência desejada e informe os preços de cada
   oferta, se quiser. Os preços são opcionais e acompanham o produto quando
   sua posição muda. Remova um item para substituí-lo por outro.
3. Continue para escolher um fundo e conferir a prévia animada. Revise a ordem,
   a descrição dos produtos e os preços antes da exportação.
4. Clique em **Baixar MP4** e acompanhe a geração do arquivo. O vídeo é criado
   no navegador; mantenha a página aberta até a conclusão. Depois, transfira
   o arquivo para a televisão ou para o sistema de exibição da loja.

Os fundos ficam em `catalogo-crud/camas-indoor-h/` (a pasta `camas-indoor-h`
dentro da aplicação). Copie para ela as imagens **PNG, JPG, JPEG ou WebP**,
preferencialmente em 1920 × 1080, e atualize a página. Se a pasta estiver vazia,
o editor informa que é necessário adicionar os fundos antes de exportar.
A lista é carregada por `/api/indoor-backgrounds`, e os arquivos são servidos
em `/indoor-backgrounds/`. Use `INDOOR_BACKGROUNDS_ROOT` para configurar outra
pasta, inclusive um diretório persistente na hospedagem.

O fundo preenche a tela sem deformação; proporções diferentes podem sofrer
recorte central. Produtos mantêm suas proporções e textos longos são limitados
ao espaço disponível. Os nove fundos fornecidos concentram as marcas da campanha
à esquerda; por isso, a composição reserva os primeiros 30% da largura (576 pixels),
inclusive durante as transições, com margens de 84 pixels no topo e na base.
A exportação
gera MP4/H.264 a 30 quadros por segundo usando WebCodecs no próprio navegador.
É necessário **HTTPS ou localhost** e codificação H.264 disponível, como em
Chrome ou Edge compatíveis. O editor verifica o suporte antes de exportar.

O fluxo tem módulos próprios em `public/js/features/indoor/`. O codificador
MP4 é compartilhado com Stories e Feed; os editores desses formatos continuam
usando suas próprias composições e dimensões. Execute `npm run test:indoor`
para verificar seleção, ordem dos produtos, animação e exportação Full HD.

## Editor de Stories no celular

Em telas de até 900 pixels, Stories e Feed mantêm o canvas ampliado, sem abas
de etapas e sem painel **Ajustes**. À direita, sob a grade, três botões quadrados
abrem **Fundo**, **Produtos** e **Oferta**. À esquerda ficam **Ajuste automático**
e **Vincular**; a exportação permanece no cabeçalho.

O modal de fundo fecha assim que uma opção é escolhida. O modal de produtos
fecha quando a seleção exigida está completa: um produto no modo individual ou
dois nos modos com dois produtos. O modal de oferta reúne preços e
texto livre; **Salvar oferta** confirma a edição e retorna à arte.

Toque em um produto, cartão de oferta ou texto para selecioná-lo. Arraste para
reposicionar e use as alças para redimensionar diretamente no canvas.
**Ajuste automático** continua disponível para organizar um ou dois produtos
e combos, e **Vincular** controla o movimento conjunto dos elementos.

Os campos usam teclado apropriado e fontes de pelo menos 16 pixels. Os modais
acompanham a altura visível quando o teclado abre. O layout considera a área
segura do aparelho e a orientação horizontal; os botões principais têm áreas
de toque de pelo menos 44 pixels.

Desktop e mobile compartilham os mesmos controles e canvas. Mudar o tamanho
da janela preserva produtos, preços, posições e downloads em andamento; o
desktop mantém seus painéis. O tour mobile apresenta a barra de ferramentas
e os controles correspondentes ao fluxo de edição por modais.

O comportamento fica em `public/js/features/stories/mobile-editor.js`, os estilos
em `public/stories-mobile.css` e os testes em `scripts/stories-mobile.test.mjs`
e `scripts/stories-gestures.test.mjs`.
Execute `npm run test:stories-mobile` ou `npm run verify`. Os testes verificam
navegação, foco, teclado virtual e restauração dos controles com DOM simulado;
a aparência e os gestos devem também ser conferidos em aparelhos reais.

## Preços de Stories

Os campos de preço usam entrada automática em centavos: `1` vira `0,01`,
`1234` vira `12,34` e `123456` vira `1.234,56`. Não é necessário digitar
vírgula. A máscara vale para ambos os preços e para o preço único do combo,
aceita valores colados com formatação e atualiza a prévia durante a digitação.
Apagar o conteúdo deixa o campo vazio novamente.

## Ajuste automático de Stories

No editor, o botão **Ajuste automático**, abaixo de **Oferta**, dimensiona e
posiciona as imagens e os cartões de descrição/preço conforme a composição.
Um produto recebe uma oferta central; dois produtos mantêm ofertas independentes;
o combo agrupa as imagens com um único cartão e preço. O ajuste compara disposições
laterais e empilhadas, respeita a proporção das imagens, as margens da arte e o
espaço do texto livre existente.

O botão fica disponível quando todas as imagens necessárias estão carregadas,
mesmo antes de preencher os preços. Depois do ajuste, os controles de tamanho
partem de 100% e os elementos continuam editáveis. Se não houver espaço, a
composição atual é preservada. A prévia e o PNG usam as mesmas posições.

A geometria fica em `public/js/features/stories/auto-layout.js`, com testes em
`scripts/stories-auto-layout.test.mjs` executados por `npm run test:stories-layout`
e incluídos em `npm run verify`.

## Exportação de Stories em MP4

Com o fundo, os produtos e os preços preenchidos, clique em **Baixar MP4 · 15 s**.
O vídeo tem 1080 × 1920 pixels, 30 quadros por segundo e duração de 15 segundos,
sem áudio. Produtos, cartões de descrição/preço e texto livre entram suavemente
em sequência; a oferta permanece parada para leitura de 1,5 a 13,5 segundos e
sai com animação no final. O fundo permanece fixo.

A exportação funciona com um produto, dois produtos e combos, usando as posições
e os tamanhos definidos no editor. A arte é capturada no clique: alterações feitas
enquanto o vídeo é gerado não entram no arquivo em andamento. O painel exibe o
progresso, permite cancelar e oferece um link para baixar novamente o resultado.
**Baixar PNG** continua disponível como exportação de imagem.

O MP4 é codificado em H.264 no navegador, usando WebCodecs e um muxer servido
localmente. É necessário acessar por HTTPS ou localhost e usar um navegador com
codificação H.264 disponível (por exemplo, Chrome ou Edge atualizados). Se o
ambiente não oferecer suporte, o editor apresenta a orientação no painel de
exportação. Nenhum FFmpeg ou serviço externo é necessário no servidor.

Os módulos `video-animation.js` e `video-export.js` ficam em
`public/js/features/stories/`. A biblioteca e sua licença estão em `public/js/vendor/`.
Os testes de animação e exportação são executados por `npm run test:stories-video`
e fazem parte de `npm run verify`.

## Tour guiado

A central, o catálogo e o editor de Stories apresentam um tour contextual na
primeira visita a cada seção. O guia destaca os controles, acompanha a rolagem e
permite avançar, voltar ou sair sem modificar os produtos ou a arte. O botão
**Tour guiado**, disponível nas três telas, permite começar novamente.

A preferência e o progresso são salvos na chave `vidamix:tour` do `localStorage`
do navegador, sem cookies nem envio ao servidor. Assim, recarregar a página pode
retomar o passo atual; uma seção concluída não repete o tour automaticamente.
Pular o tour, fechá-lo ou usar Escape antes da conclusão dispensa os tours
automáticos de todas as seções; o botão **Tour guiado** continua disponível.
Esse estado pertence ao navegador e à origem da aplicação: limpar os
dados do site, usar outro navegador ou acessar por outra origem reinicia a
experiência. Se o armazenamento estiver indisponível, o guia continua utilizável,
mas a preferência não será preservada ao recarregar a página.

Os textos e alvos ficam em `public/js/features/tour/steps.js`, identificados pelos
atributos `data-tour` das páginas. `TOUR_VERSION` controla a versão da experiência;
incremente-o quando uma mudança relevante justificar apresentar o tour novamente.

## Executar

```powershell
npm.cmd run start
```

Abra `http://localhost:3333`. Para desenvolvimento com reinício automático:

```powershell
npm.cmd run dev
```

Consulte `src/config.mjs` para a porta e os diretórios de origem. Defina as
variáveis no ambiente do processo ou no painel de variáveis da hospedagem.

## Verificar

```powershell
npm.cmd run verify
```

Esse comando valida a sintaxe dos módulos, testa a persistência do tour,
o ajuste automático, a máscara dos preços, o fluxo mobile, a seleção e o carrossel
Indoor, as animações e a exportação MP4,
e executa um teste de fumaça das rotas de páginas, API e arquivos estáticos.
Os testes do MP4 usam o muxer real e simulam o codificador do navegador para
verificar duração, resolução, cancelamento e liberação de recursos. A reprodução
e a aparência do vídeo também devem ser conferidas em um navegador compatível.

## Publicação

O projeto está preparado para ser executado no Plesk com Node.js 22.13+.
Antes de publicar, mantenha o SQLite, o catálogo de importação e as imagens em
um caminho persistente fora da aplicação, configure `APP_AUTH_ENABLED=false` e
execute npm.cmd run check:production.

O procedimento completo, com caminhos, variáveis e rollback, está em
[docs/deployment-plesk.md](docs/deployment-plesk.md).

## Estrutura

```text
src/
  config.mjs             configuração centralizada
  database/              persistência e inicialização do SQLite
  http/                  router, respostas, erros e arquivos estáticos
  modules/               regras por domínio (produtos, stories, ...)
  routes/                rotas de página e API

public/
  index.html             central de criação
  catalogo.html          catálogo
  stories.html           editor de Stories
  indoor-h.html          seleção e vídeo para TV
  js/features/stories/   estado, DOM e comportamento do editor
  js/features/indoor/    seleção, prévia e carrossel horizontal
  js/features/tour/      tour contextual e progresso no navegador

docs/                    decisões e convenções de arquitetura
scripts/                 verificações locais
```

Leia [a arquitetura detalhada](docs/architecture.md) antes de criar um novo
formato ou integração.

## Cache de imagens e carregamento

Backgrounds de Stories, Feed e Indoor e imagens de produtos recebem URLs com
`?v=` calculado pelo tamanho e pelas datas de alteração do arquivo. Imagens
inalteradas são reaproveitadas pelo cache local do navegador por até um ano.
Adicionar um fundo não invalida os demais; substituir um arquivo gera uma nova
URL automaticamente, sem precisar reiniciar a aplicação. Os diretórios de fundos
continuam sendo a fonte dos arquivos, sem alterar imagens originais ou o banco.

A lista de fundos é revalidada a cada abertura do editor (ou ao atualizar os
fundos no Indoor), usando ETag/304 quando nada mudou. Miniaturas são carregadas
sob demanda e decodificadas de forma assíncrona; selecionar outro fundo preserva
as miniaturas existentes. O servidor gera miniaturas WebP de até 240 × 240 pixels
e versões da arte limitadas a 1080 × 1920 (Stories), 1080 × 1350 (Feed) ou
1920 × 1080 (Indoor), preservando a proporção e os arquivos originais.
Esses arquivos ficam em `CATALOG_STORAGE_ROOT/background-cache`, são gerados
sob demanda uma única vez por versão e reaproveitados nas visitas seguintes.
A conversão usa Sharp, com uma imagem por vez e limite de fila. Arquivos inválidos
retornam erro sem enviar o original pesado como alternativa. O diretório de cache
precisa ser gravável pelo processo Node.js.

O editor mantém no máximo quatro entradas no cache de imagens decodificadas.
Ao trocar fundos rapidamente, termina a carga atual e processa somente a seleção
mais recente, evitando decodificações simultâneas de fundos intermediários.
As miniaturas e a imagem da arte têm caches independentes por URL.

Ao publicar esta versão, execute `npm ci` (ou **NPM Install** no Plesk) no servidor
e reinicie a aplicação. Isso instala o Sharp com o binário adequado ao sistema
operacional; não copie a pasta `node_modules` do Windows para o servidor Linux.

Em HTTPS ou localhost, o service worker também mantém as imagens já utilizadas
em Cache Storage entre visitas e atualizações do aplicativo. Esse cache é limitado
a 240 imagens/96 MiB, com até 12 MiB por arquivo; versões substituídas são
descartadas. O navegador pode remover dados locais por falta de espaço ou quando
o usuário limpa o armazenamento. Nesses casos, ou se o cache estiver indisponível,
as imagens são baixadas novamente normalmente. Arquivos maiores usam o cache HTTP.
As páginas e os dados de produtos continuam sendo consultados no servidor.

A navegação entre páginas mostra uma barra de progresso e o aviso “Carregando
tela…”, respeitando redução de movimento e restaurando o estado ao voltar pelo
histórico. Após publicar esta atualização, feche as abas antigas do aplicativo
e reabra para ativar o novo service worker sem interromper edições em andamento.

## Parceiros em destaque

Acesse **Parceiros** no menu ou **Gerenciar parceiros** no hero da central
(`/parceiros`). Há três posições, exibidas nessa ordem no carrossel. Em cada uma,
selecione um fabricante já cadastrado em produtos, envie seu logotipo e salve.
É possível trocar a marca, substituir o logotipo ou remover o destaque sem
alterar os produtos. Um fabricante só pode ocupar uma posição.

Os logotipos aceitam PNG, JPG e WebP estáticos de até 4 MB e 16 megapixels.
O servidor valida e converte as imagens para WebP, preservando transparência.
A tabela `featured_partners` é criada automaticamente ao iniciar a aplicação;
os arquivos ficam em `CATALOG_STORAGE_ROOT/partner-logos` (por padrão,
`data/partner-logos`). Inclua essa pasta junto do SQLite nos backups.

Sem parceiros cadastrados, a central apresenta um convite ao cadastro. Com
dois ou três destaques, o carrossel alterna a cada 5 segundos e oferece
navegação manual, pausa e um preenchimento discreto no fundo do hero que indica
o tempo de cada parceiro. O preenchimento acompanha a pausa e retoma do mesmo
ponto. Redução de movimento desativa o avanço automático.
O botão de cada parceiro abre o catálogo filtrado pelo fabricante.

APIs: `GET /api/manufacturers`, `GET /api/featured-partners`,
`PUT /api/featured-partners/:slot` com `{ fabricante, logo? }` (logo em data URL),
e `DELETE /api/featured-partners/:slot`. `slot` aceita somente 1, 2 ou 3.
As rotas seguem a autenticação da aplicação. Validação: `npm run test:partners`.

## Importação de produtos por HTML

Acesse diretamente `/import-produtos` com uma conta de administrador. Essa tela
não aparece nos menus: cole o HTML completo da lista `ul#tbl-produtos`, no layout
do Cosmos (`li.product-list-item`), e clique em **Importar produtos**. O único campo
é o textarea. A barra acompanha cada produto processado e o relatório informa
cadastros, EANs ignorados, erros e itens sem foto.

O importador lê o nome em `.item-title > a`, o código no campo `GTIN/EAN:` e a
foto em `.picture img`. Preserva zeros à esquerda; não usa o código do `alt`
da imagem. Fabricante só é preenchido se houver um campo explícito `Fabricante:`;
o NCM não é mapeado para categoria. EANs já existentes são mantidos integralmente.
Imagens genéricas de NCM e placeholders são ignorados; esses produtos entram sem
foto. Quando uma foto real falha no download ou é inválida, o produto não é
cadastrado, permitindo repetir a importação depois.

As fotos são baixadas no servidor e salvas em WebP na pasta de imagens do catálogo,
com os mesmos limites do upload (8 MB, 25 megapixels e saída até 2000 × 2000).
São permitidos apenas endereços HTTPS públicos, com validação de DNS e redirects.
O HTML é interpretado como dados pelo Cheerio, sem executar scripts ou exibi-lo.
Limites por importação: 1 MB de HTML e 500 itens. As APIs
`POST /api/products/import-html/parse` e `POST /api/products/import-html/item`
exigem administrador e CSRF. Cada item é salvo separadamente; mantenha a página
aberta até concluir. Em caso de interrupção, cole o mesmo trecho novamente:
os EANs já cadastrados serão ignorados. O relatório fica disponível na página
até uma nova importação ou recarga.

Validação: `npm run test:product-import`. Ao publicar, execute `npm ci` e reinicie
a aplicação para carregar a nova dependência e as rotas.

## Crescer sem acoplamento

Para um formato novo, crie o módulo em `public/js/features/<formato>/`,
registre `/artes/<formato>` e mantenha regras ou dados próprios em
`src/modules/<formato>/`. Uma arte de frente e verso deve ser modelada como um
documento com páginas ordenadas, cada uma com seu canvas e elementos.

Segredos de integração, tokens de redes sociais e tarefas de publicação devem
permanecer exclusivamente no servidor. O banco local em `data/` não é
versionado.
# Gerenciamento de backgrounds

Administradores podem acessar **Conta → Gerenciar backgrounds** (`/backgrounds`) para adicionar e remover fundos de Stories, Feed e TV. O upload aceita imagens estáticas PNG, JPG e WebP de até 10 MB e 40 megapixels, com nome e prévia antes do envio. A remoção pede confirmação e retira o fundo da lista compartilhada do formato selecionado. Reabra o editor para atualizar os fundos em abas já abertas.

Os arquivos são validados e convertidos para WebP nas pastas de backgrounds configuradas, junto dos fundos existentes. Essas pastas precisam ter permissão de escrita e devem ser incluídas no backup persistente. As rotas POST e DELETE de `/api/story-backgrounds`, `/api/feed-backgrounds` e `/api/indoor-backgrounds` exigem administrador e token CSRF; a exclusão usa `/:filename`.


## Encarte quadrado

O formato **Encarte** está em `/artes/encarte`, com 1080 × 1080 pixels e composições de 1 a 5 produtos com preços individuais. Reutiliza o editor do Feed: preços individuais, texto livre, arraste, redimensionamento, grade, vínculo dos elementos, ajuste automático e exportação PNG/MP4. A conversão para Feed aceita composições de até dois produtos, conforme o limite do formato de destino.

Seus fundos são independentes: `camas-encarte/` (ou `ENCARTE_BACKGROUNDS_ROOT`), listados por `/api/encarte-backgrounds` e servidos em `/encarte-backgrounds/`. Inclui um fundo neutro inicial. Administradores podem adicionar e remover os fundos em **Gerenciar backgrounds → Encarte**. Inclua essa pasta no backup persistente e permita escrita para uploads.
