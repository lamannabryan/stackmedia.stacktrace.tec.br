export const TOUR_VERSION = 2;

export const tours = {
  home: {
    title: 'Boas-vindas ao _stackmedia',
    description: 'Conheça os atalhos para transformar seus produtos em artes. São só 3 passos para começar.',
    steps: [
      {
        id: 'create',
        target: '[data-tour="home-create"] > .studio-primary-action',
        eyebrow: 'Seu ponto de partida',
        title: 'Uma oferta começa aqui',
        description: 'Crie Stories e Feed em PNG ou MP4. Para a televisão da loja, escolha Criar vídeo para TV: selecione de 2 a 5 produtos e monte um carrossel animado de 15 segundos.',
        placement: 'bottom',
      },
      {
        id: 'barcode',
        target: '[data-tour="home-barcode"]',
        eyebrow: 'Do produto à arte',
        title: 'Use o código de barras',
        description: 'Escolha Stories ou Feed e escaneie o código com um leitor conectado. Quando o produto for encontrado no catálogo, o editor do formato escolhido abrirá com ele selecionado.',
        placement: 'bottom',
      },
      {
        id: 'formats',
        target: '[data-tour="home-formats"]',
        eyebrow: 'Explore as possibilidades',
        title: 'Escolha o formato da campanha',
        description: 'Stories, Feed e TV aparecem em Disponível agora, com seus recursos e botões de criação. TV exporta um vídeo horizontal em 1920 × 1080.',
        placement: 'bottom',
      },
    ],
  },
  catalogue: {
    title: 'Seu catálogo, organizado',
    description: 'Encontre produtos, refine a busca e prepare sua próxima campanha em 4 passos rápidos.',
    steps: [
      {
        id: 'search',
        target: '[data-tour="catalogue-search"]',
        eyebrow: 'Encontre o que precisa',
        title: 'Busque do seu jeito',
        description: 'Digite o nome, EAN, fabricante ou princípio ativo. A lista de produtos acompanha sua busca automaticamente.',
        placement: 'bottom',
      },
      {
        id: 'filters',
        target: '[data-tour="catalogue-filters"]',
        eyebrow: 'Uma seleção mais precisa',
        title: 'Combine os filtros',
        description: 'Refine por categoria, status e disponibilidade de imagem. O catálogo começa exibindo produtos com imagem local; altere Imagem para ver os demais.',
        placement: 'bottom',
      },
      {
        id: 'results',
        target: '[data-tour="catalogue-results"]',
        eyebrow: 'Explore o catálogo',
        title: 'Confira os produtos encontrados',
        description: 'Os resultados aparecem nos cartões abaixo. Use as setas para mudar de página e abra um produto para consultar ou editar seus dados.',
        placement: 'top',
      },
      {
        id: 'actions',
        target: '[data-tour="catalogue-actions"]',
        eyebrow: 'Pronto para criar',
        title: 'Cadastre ou crie uma arte',
        description: 'Novo produto abre o cadastro. Criar Story e Criar Feed levam ao editor do formato escolhido. Nos cartões dos produtos, esses atalhos já levam o item para a arte. O botão Tour guiado permite rever estas dicas.',
        placement: 'bottom',
      },
    ],
  },
  stories: {
    title: 'Sua primeira arte, passo a passo',
    description: 'Conheça as 6 partes do editor e veja como preparar um Story pronto para compartilhar.',
    steps: [
      {
        id: 'background',
        target: '[data-tour="stories-background"]',
        eyebrow: 'Dê o tom da campanha',
        title: 'Escolha um fundo',
        description: 'Explore os fundos disponíveis e selecione o visual da sua oferta. O painel pode ficar recolhido após a escolha; toque no título para abrir novamente.',
        placement: 'right',
      },
      {
        id: 'composition',
        target: '[data-tour="stories-composition"]',
        eyebrow: 'Defina a estrutura',
        title: 'Uma arte, diferentes combinações',
        description: 'Escolha 1 produto, 2 produtos com descrições separadas ou um combo com descrição única. Toque no título do painel para expandir as opções quando precisar.',
        placement: 'right',
      },
      {
        id: 'product',
        target: '[data-tour="stories-product"]',
        eyebrow: 'Traga o catálogo para a arte',
        title: 'Encontre o produto da oferta',
        description: 'Abra o painel para buscar por nome, marca, princípio ativo ou código. Selecione um resultado; nas composições com dois produtos, escolha também o segundo item. O painel sinaliza quando a seleção está completa.',
        placement: 'right',
      },
      {
        id: 'offer',
        target: '[data-tour="stories-offer"]',
        eyebrow: 'Complete sua mensagem',
        title: 'Destaque o preço',
        description: 'Informe o valor da oferta, como 29,90. Se a composição pedir dois preços, preencha ambos. Logo abaixo, Texto livre permite adicionar uma chamada curta.',
        placement: 'left',
      },
      {
        id: 'preview',
        target: '[data-tour="stories-preview"]',
        eyebrow: 'Ajuste os detalhes',
        title: 'Veja sua arte ganhar forma',
        description: 'A prévia acompanha suas escolhas. Arraste os elementos para movê-los e use os cantos para mudar seu tamanho. O zoom e a grade ajudam a conferir o alinhamento.',
        placement: 'left',
      },
      {
        id: 'download',
        target: '[data-tour="stories-download"]',
        eyebrow: 'Pronta para compartilhar',
        title: 'Baixe sua arte em PNG ou MP4',
        description: 'Quando o fundo, os produtos e os preços estiverem prontos, baixe a imagem PNG ou um vídeo MP4 de 15 segundos com animações de entrada e saída, em 1080 × 1920. Você pode rever este guia a qualquer momento em Tour guiado.',
        placement: 'bottom',
      },
    ],
  },
};

// Keep the same guide and mobile targets, with separate progress for each format.
tours.feed = {
  ...tours.stories,
  description: tours.stories.description.replace('um Story', 'um Feed'),
  steps: tours.stories.steps.map((step) => ({
    ...step,
    description: step.description.replace('1080 × 1920', '1080 × 1350'),
  })),
};

tours.encarte = {
  ...tours.stories,
  description: 'Crie um Encarte vertical 3:4 com até 5 produtos e fundos próprios.',
  steps: tours.stories.steps.map(step => ({ ...step,
    description: step.description.replace('1080 × 1920', '1080 × 1080')
      .replace('1 produto, 2 produtos com descrições separadas ou um combo com descrição única', 'de 1 a 5 produtos com preços individuais'),
  })),
};

const mobileHome = {
  ...tours.home,
  steps: tours.home.steps.map((step) => ({
    ...step,
    description: ({
      create: 'Escolha Stories ou Feed para criar uma arte a partir dos produtos do catálogo. Os atalhos na parte inferior também levam aos formatos e ao catálogo.',
      barcode: 'Toque em Ler com câmera e autorize o acesso. Enquadre o código de barras inteiro; quando o produto for encontrado, ele abrirá em Stories ou Feed conforme o formato escolhido.',
      formats: 'Stories e Feed mostram os formatos disponíveis para criar sua campanha. Escolha um deles para começar.',
    })[step.id] || step.description,
  })),
};

function mobileArtworkTour(format) {
  return {
    ...tours[format],
    title: 'Crie diretamente na arte',
    description: 'A arte fica ampliada enquanto você edita. Conheça os botões para escolher o conteúdo, organizar os elementos e salvar.',
    steps: [
      { id: 'background', target: '#story-mobile-background-button', title: 'Escolha o fundo', description: 'Este botão abre os fundos em uma janela. Toque no visual desejado; a janela fecha e você volta à arte.', placement: 'left' },
      { id: 'product', target: '#story-mobile-products-button', title: 'Escolha os produtos', description: 'Abra a seleção e escolha entre 1 produto, 2 produtos ou um combo. Busque no catálogo e toque nos itens. A janela fecha quando a seleção estiver completa.', placement: 'left' },
      { id: 'offer', target: '#story-mobile-offer-button', title: 'Defina o preço', description: 'Abra a oferta, informe o preço e, se quiser, uma chamada curta. Toque em Salvar oferta para voltar à arte.', placement: 'left' },
      { id: 'preview', target: '[data-tour="stories-preview"]', title: 'Arraste para ajustar', description: 'Toque no produto, na oferta ou no texto e arraste para mover. Arraste os cantos do elemento selecionado para redimensionar. A grade ajuda a alinhar a composição.', placement: 'bottom' },
      { id: 'organize', target: '#story-mobile-auto-layout', title: 'Organize com um toque', description: 'À esquerda, Ajuste automático distribui os elementos na arte. Vincular elementos permite arrastar os produtos e suas ofertas juntos.', placement: 'right' },
      { id: 'download', target: '#story-mobile-export-button', title: 'Salve sua arte', description: 'Quando fundo, produtos e preços estiverem prontos, abra as opções de exportação para baixar PNG ou MP4 de 15 segundos.', placement: 'bottom' },
    ],
  };
}

export function getTour(page, { mobile = false } = {}) {
  if (!mobile) return tours[page];
  if (page === 'home') return mobileHome;
  if (['stories', 'feed', 'encarte'].includes(page)) {
    const tour = mobileArtworkTour(page);
    if (page === 'encarte') tour.steps = tour.steps.map(step => ({ ...step, description: step.description.replace('1 produto, 2 produtos ou um combo', '1 a 5 produtos') }));
    return tour;
  }
  return tours[page];
}
