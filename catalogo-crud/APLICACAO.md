# _stackmedia — visão geral e funcionalidades

O **_stackmedia** é uma aplicação web para organizar um catálogo de produtos e criar peças de divulgação comercial. Reúne os dados e as imagens dos produtos, fundos de campanhas e ferramentas de composição para produzir ofertas destinadas às redes sociais e às televisões de uma loja.

A aplicação atende ao trabalho de quem prepara campanhas e materiais promocionais para o varejo. O catálogo também contempla informações específicas de produtos de farmácia, como princípio ativo, registro MS e indicação de genérico.

O fluxo principal é escolher um formato, selecionar produtos do catálogo, montar a oferta sobre um fundo de campanha e baixar o resultado como imagem ou vídeo.

## Formatos disponíveis

| Formato | Uso previsto | Dimensões | Composição | Exportação |
| --- | --- | --- | --- | --- |
| Stories | Peças verticais para Stories e Status | 1080 × 1920 px, proporção 9:16 | Um produto, dois produtos ou combo de dois produtos | PNG ou MP4 de 15 segundos |
| Feed | Publicações verticais para o feed das redes sociais | 1080 × 1350 px, proporção 4:5 | Um produto, dois produtos ou combo de dois produtos | PNG ou MP4 de 15 segundos |
| TV Indoor | Ofertas para telas horizontais no estabelecimento | 1920 × 1080 px, proporção 16:9 | Cinco produtos em sequência | MP4 de 15 segundos |

Os arquivos exportados podem ser publicados nos canais desejados ou transferidos para o sistema de exibição da loja. A publicação e a reprodução ficam a cargo do usuário após o download.

## Central de criação

A página inicial concentra os atalhos para criar Stories, Feed e vídeos para TV Indoor, explorar o catálogo e localizar produtos por código de barras. Cada formato apresenta suas dimensões e os recursos disponíveis.

A central também exibe os fabricantes cadastrados como parceiros em destaque. Cada parceiro pode levar diretamente à lista de seus produtos no catálogo.

## Catálogo de produtos

Clientes consultam os produtos e os utilizam nas artes. Cadastro, edição e exclusão são exclusivos dos administradores.

O catálogo é a base usada pelos editores. Nele é possível:

- Consultar produtos em cartões com imagem e informações de identificação.
- Buscar por nome, EAN, fabricante ou princípio ativo.
- Filtrar por categoria, situação ativa ou inativa e disponibilidade de imagem local.
- Consultar produtos de um fabricante a partir dos destaques da central.
- Navegar pelos resultados com paginação.
- Cadastrar, editar e excluir produtos.
- Abrir Stories ou Feed com o produto escolhido já selecionado.

O cadastro reúne nome, subtítulo, código de barras, fabricante, grupo, categorias, status, datas de vigência, frases promocionais e informações de imagem. Também contempla campos como princípio ativo, registro MS, produto genérico e produto em destaque.

As imagens dos produtos são associadas a arquivos disponíveis no servidor. O formulário permite informar a URL de origem e o caminho da imagem local. O sistema reconhece versões WebP disponíveis e mantém compatibilidade com referências PNG existentes.

Por padrão, a listagem começa pelos produtos com imagem local, facilitando a escolha de itens utilizáveis nas artes.

## Editor de Stories e Feed

Os dois formatos compartilham as ferramentas de edição e ajustam a área de criação às respectivas dimensões.

### Fundos e tipos de oferta

O usuário escolhe um fundo de campanha e define uma das três composições:

- **Um produto:** uma imagem de produto com seu cartão de descrição e preço.
- **Dois produtos:** duas imagens, cada uma com sua oferta e seu preço.
- **Combo:** dois produtos reunidos em uma composição com descrição e preço únicos.

Os produtos são buscados no catálogo. Para concluir a exportação, o editor exige o fundo carregado, as imagens dos produtos e os preços correspondentes à composição.

### Preços e texto livre

Os campos de preço usam formatação brasileira e entrada automática em centavos: digitar `1234`, por exemplo, resulta em `12,34`. A prévia acompanha as alterações.

É possível adicionar um texto livre de até 64 caracteres, como uma chamada promocional, e ajustar seu tamanho e sua posição na arte.

### Organização visual

O editor oferece prévia editável e controles para:

- Selecionar, arrastar e redimensionar produtos, cartões de oferta e texto livre.
- Centralizar elementos e redefinir seus ajustes.
- Vincular produto e oferta para movimentá-los em conjunto.
- Aplicar ajuste automático de tamanho e posição conforme a composição.
- Exibir uma grade de terços para auxiliar o alinhamento.
- Alterar o zoom da prévia no desktop.

O ajuste automático considera as proporções das imagens, as margens da arte e o espaço ocupado pelo texto livre. Os elementos continuam editáveis depois do ajuste.

No desktop, os botões de ajuste automático, vínculo e grade ficam empilhados no canto superior esquerdo da área de criação, com os ícones centralizados.

### Conversão entre formatos

Uma composição pode ser convertida de Stories para Feed ou de Feed para Stories. A conversão mantém produtos, preços e texto livre, adapta as posições e os tamanhos e permite continuar editando.

O sistema procura um fundo equivalente da mesma campanha no formato de destino. Quando não encontra, mantém o fundo original com recorte e apresenta um aviso para revisão.

### Exportação

A exportação em **PNG** gera uma imagem estática nas dimensões do formato escolhido.

A exportação em **MP4** gera um vídeo de 15 segundos, a 30 quadros por segundo, sem áudio. Produtos, ofertas e texto livre recebem animações de entrada e saída; o fundo permanece fixo. As posições e os tamanhos definidos na edição são usados no vídeo.

Durante a geração do MP4, o usuário pode acompanhar o progresso, cancelar e, ao finalizar, usar o link para baixar novamente o resultado.

## Editor de TV Indoor

O módulo de TV Indoor cria um carrossel de ofertas para exibição em uma televisão horizontal.

O processo consiste em selecionar **exatamente cinco produtos diferentes**, todos com imagem local disponível, organizar a sequência, informar preços opcionais e escolher um fundo. É possível remover e substituir itens; os preços acompanham os produtos quando a ordem muda.

A prévia permite reproduzir a animação e conferir os momentos do vídeo pela linha do tempo e pelas cenas. Cada produto ocupa um intervalo de três segundos, com transições horizontais e retorno ao primeiro item para favorecer a reprodução em repetição.

O resultado é um MP4 de 15 segundos em Full HD, sem áudio. A composição reserva uma área à esquerda para a identidade da campanha presente no fundo. Para manter o vídeo em repetição, essa opção deve ser ativada na televisão ou no player utilizado.

## Busca por código de barras

A leitura de código de barras permite partir de um produto físico para a criação de uma oferta. O usuário escolhe Stories ou Feed, informa ou lê o código e, quando o produto é encontrado no catálogo, o editor abre com o item selecionado.

- **No desktop:** entrada manual, leitura por dispositivo conectado e opção de câmera.
- **No celular:** leitura pela câmera, iniciada pelo botão **Ler com câmera**.

O leitor aceita códigos de produtos compatíveis com a validação GTIN, incluindo EAN e UPC. As imagens da câmera são processadas no próprio aparelho; somente o código identificado é enviado para consultar o catálogo.

A câmera depende da permissão do navegador e de acesso por HTTPS ou localhost. A captura é encerrada ao fechar o leitor, encontrar um código ou colocar a aplicação em segundo plano.

## Parceiros em destaque

O gerenciamento de parceiros é exclusivo dos administradores. Os demais usuários autenticados podem visualizar os destaques na central e acessar os produtos de cada fabricante.

A tela de parceiros permite configurar até três fabricantes do catálogo, cada um com seu logotipo e sua posição no carrossel da central.

É possível trocar o fabricante, substituir o logotipo e remover o destaque. Os logotipos podem ser enviados em PNG, JPEG ou WebP e são preparados pelo servidor para exibição.

O carrossel oferece navegação manual e pausa. Com mais de um parceiro, também alterna automaticamente. O botão de cada fabricante abre o catálogo já filtrado por ele.

## Uso no computador e no celular

A interface se adapta ao tamanho da tela. No desktop, os editores apresentam painéis de configuração ao lado da área de criação. No celular, Stories e Feed priorizam a arte e abrem os controles de fundo, produtos e oferta em diálogos.

No mobile, o usuário pode mover e redimensionar os elementos diretamente na composição. A central e o catálogo oferecem navegação inferior para Início, Catálogo, Stories e Feed. Os atalhos de TV Indoor ficam ocultos nessa navegação, embora sua rota direta continue disponível.

A aplicação também oferece:

- **Tema claro e escuro**, com preferência salva no navegador. O tema da interface preserva as cores das artes exportadas.
- **Tour guiado** na central, no catálogo e nos editores de Stories e Feed, com opção de rever as orientações.
- **Instalação como aplicativo (PWA)** em navegadores compatíveis, com ícone e janela própria.
- **Tela de falta de conexão**, com opção de tentar acessar novamente.

A instalação como PWA mantém a necessidade de conexão com o servidor para consultar produtos e usar os recursos da aplicação. O armazenamento offline se limita à tela de falta de conexão e seus recursos visuais.

## Exemplo de uso

1. Abra o catálogo e encontre um produto pela busca, pelos filtros ou pelo código de barras na central.
2. Escolha criar um Story ou uma arte para Feed.
3. Selecione o fundo e defina a composição: um produto, dois produtos ou combo.
4. Informe os preços e, se necessário, acrescente uma chamada em texto livre.
5. Use o ajuste automático e refine a posição e o tamanho dos elementos.
6. Confira a prévia e baixe a imagem PNG ou o vídeo MP4.
7. Publique o arquivo no canal desejado. Para uma versão em outro formato, converta a composição e revise o resultado antes de exportar novamente.

## Funcionamento e armazenamento

### Login e perfis de acesso

O acesso é feito por e-mail e senha na tela `/login`. Há dois perfis: **administrador**, que gerencia usuários, parceiros e produtos e também cria artes; e **cliente**, que consulta o catálogo e cria e exporta artes.

Administradores acessam **Conta > Gerenciar usuários** para cadastrar contas, editar dados e perfis, bloquear acessos, redefinir senhas e excluir usuários. O sistema preserva pelo menos um administrador ativo. O menu **Conta** também permite sair da aplicação.

As permissões são verificadas no servidor. Senhas são armazenadas como hashes, e mudanças de senha, perfil ou situação encerram as sessões existentes. O primeiro administrador é criado por um comando no servidor, sem senha padrão. Consulte [Login, usuários e permissões](docs/usuarios-e-permissoes.md).

### Estrutura da aplicação

A aplicação usa **HTML, CSS e JavaScript** na interface, **Node.js** no servidor e **SQLite** para armazenar o catálogo, parceiros, usuários e sessões. Os arquivos de imagens, fundos e logotipos ficam no servidor.

As imagens e os vídeos das artes são gerados no navegador. A exportação de MP4 depende de suporte a WebCodecs com codificação H.264, além de HTTPS ou localhost. O editor verifica a compatibilidade e apresenta uma orientação quando o recurso não está disponível.

As composições permanecem no estado da página durante a edição. A versão atual não oferece uma biblioteca de projetos salvos ou recuperação de rascunhos após recarregar a página; o resultado é entregue por download de PNG ou MP4. Preferências como tema e progresso do tour são armazenadas no navegador.

## Principais páginas

| Endereço | Finalidade |
| --- | --- |
| `/` | Central de criação e destaques de parceiros |
| `/catalogo` | Consulta e manutenção dos produtos |
| `/artes/stories` | Editor de Stories |
| `/artes/feed` | Editor de Feed |
| `/artes/indoor-h` | Editor de vídeo para TV Indoor |
| `/parceiros` | Gestão dos fabricantes em destaque |
| `/login` | Entrada com e-mail e senha |
| `/usuarios` | Gestão de usuários e perfis, exclusiva de administradores |

Para instalação, execução, manutenção e publicação, consulte o [README](README.md) e o [guia de publicação](docs/deployment-plesk.md).

---

Documento baseado nas funcionalidades presentes no código em 17 de outubro de 2026.
