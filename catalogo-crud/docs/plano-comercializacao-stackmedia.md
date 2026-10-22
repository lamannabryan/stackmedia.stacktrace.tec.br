# Plano de comercialização do _stackmedia

## 01. Direção recomendada

**Mercado escolhido: varejo em geral.**

**Data da análise: 19 de outubro de 2026.** Este plano considera o código disponível em `catalogo-crud`, a documentação do projeto e consultas agregadas, somente leitura, ao banco local. Valores de venda, metas e prazos propostos são hipóteses de planejamento, sujeitas à validação com clientes.

### A decisão principal

Transformar o _stackmedia em uma **plataforma de catálogo e produção de ofertas para lojistas**, com assinatura mensal por loja e implantação assistida. O resultado vendido deve ser uma rotina mais rápida para produzir peças com produtos, preços e identidade da loja.

O software já tem um núcleo funcional expressivo: catálogo, busca por EAN, cadastro apoiado por IA, imagens, Stories, Feed, vídeos para TV, revistas mensais, fabricantes parceiros e PWA. A comercialização exige complementar esse núcleo com separação entre empresas, personalização por loja, recuperação do trabalho, atendimento, contratos e controle financeiro.

**Caminho recomendado:** preparar um piloto pago com 3 a 5 lojas, usando uma instalação isolada por empresa e uma versão comum do código. Evoluir para uma plataforma compartilhada com separação entre empresas depois de demonstrar uso recorrente e disposição de pagamento.

### Cinco decisões para tomar primeiro

1. **Oferta:** acesso ao software + configuração inicial + treinamento, com escopo de suporte definido.
2. **Unidade de cobrança:** loja ou operação comercial; quantidade de usuários como limite secundário.
3. **Preço a experimentar:** R$ 299/mês por loja + R$ 790 de implantação. Estes valores ainda não foram validados.
4. **Entrada no varejo geral:** testar dois grupos de lojistas, começando por produtos embalados e ofertas frequentes. Perfumaria/higiene aproveita parte da base atual; conveniência ou pet shop ajuda a avaliar outro contexto.
5. **Regra de expansão:** ampliar aquisição somente quando houver renovação, suporte administrável, dados separados e margem de contribuição positiva.

### Julgamento de prontidão

| Dimensão | Avaliação baseada na análise |
| --- | --- |
| Demonstração comercial | Há recursos suficientes para demonstrar valor com produtos reais e autorizados. |
| Piloto pago assistido | Viável após concluir os requisitos P0 deste plano e combinar as limitações por contrato. |
| SaaS com cadastro e compra sem atendimento | Ainda faltam funções de operação, cobrança e separação entre empresas. |
| Plataforma ampla para qualquer varejista | Exige catálogo por loja, unidades/variantes e campanhas com vigência mais flexível. |
| Capacidade de atender muitos clientes | Não medida nesta análise; documentação de carga não comprova capacidade em produção. |

## 02. Escopo, evidências e limites da análise

Foram examinados os módulos de catálogo, usuários e sessões, IA, busca e envio de imagens, parceiros, revistas, fundos, editores, exportação, PWA, rotas, configuração, banco, documentação de implantação e organização das verificações existentes. Também foram pesquisadas fontes oficiais de fornecedores, concorrentes, proteção de dados e propriedade intelectual.

O banco consultado foi `catalogo-crud/data/catalogo.sqlite`, aberto em modo somente leitura. Foram extraídos **apenas indicadores agregados de produtos e estrutura de tabelas**. Não foram consultados nomes de usuários, e-mails, senhas, tokens ou chaves de integração.

Não foram executados testes da aplicação, testes de carga, auditoria de dependências, chamadas pagas de IA ou avaliação da hospedagem. A análise não comprova segurança de produção, desempenho, faturamento, direitos sobre o acervo nem satisfação de clientes. As lacunas indicadas significam “não identificado no código e nos documentos examinados”; serviços externos podem existir fora deste workspace.

### Como interpretar o documento

- **Constatação:** observação direta no código, no banco local ou na documentação identificada.
- **Recomendação:** decisão proposta para tornar a operação comercial viável.
- **Hipótese:** preço, prazo, custo ou indicador que precisa ser medido.
- **P0:** condição para começar o piloto pago com responsabilidade.
- **P1:** condição para ampliar a operação e reduzir atendimento manual.
- **P2:** expansão condicionada à demanda e à capacidade da equipe.

### Informações que ainda precisam ser levantadas

| Informação | Como obter | Decisão que depende dela |
| --- | --- | --- |
| Clientes e uso atuais | Entrevistas e registros autorizados de uso | Se o piloto será inicial ou expansão de uma operação existente |
| Custos reais de hospedagem e APIs | Faturas, limites contratados e consumo | Preço mínimo e orçamento mensal |
| Tempo disponível e equipe | Horas semanais do responsável e fornecedores | Prazo real do plano de 90 dias |
| Titularidade do software e acervo | Contratos anteriores, cessões e licenças | O que pode ser licenciado e reutilizado |
| Qualidade por segmento | Amostra de produtos de cada loja | Quais segmentos têm melhor ativação |
| Exigências dos compradores | Demonstrações e propostas pagas | Necessidade de redes, aprovação, integrações ou marca própria |

## 03. O produto que já existe

| Capacidade | O que foi encontrado | Consequência comercial |
| --- | --- | --- |
| Catálogo | Pesquisa, filtros, paginação, EAN, fabricante, categorias, imagens e situação | Núcleo reutilizável para organizar produtos e criar ofertas. |
| Cadastro colaborativo | Cliente pode cadastrar produto pendente; administrador edita e aprova | Há curadoria básica; falta identificar autoria e acompanhar a aprovação por empresa. |
| Integração de IA | DeepSeek pesquisa o EAN e sugere nome, subtítulo e fabricante com fontes | Vender como auxílio ao cadastro, com revisão humana. |
| Busca de imagens | Google Imagens via SerpApi; escolha de resultado e cópia local | Facilita cadastro; não concede licença de uso comercial da fotografia. |
| Upload de imagens | Validação de tamanho/formato, reprocessamento e conversão em WebP | Boa base para um catálogo visual; falta política de armazenamento e origem dos arquivos. |
| Stories e Feed | Canvas, produto individual, dois produtos/combos, preço, texto, fundos e ajustes | Há uma jornada de criação especializada em ofertas. |
| Conversão de formato | Conversão entre Stories e Feed com preservação da composição editável | Reduz trabalho repetido; deve entrar na demonstração. |
| Exportação | PNG e MP4; vídeo de 15 segundos codificado no navegador | Reduz processamento no servidor, mas depende do aparelho e do suporte a H.264. |
| TV Indoor | Vídeo horizontal com cinco produtos | É produção de arquivo; não foi identificado gerenciamento remoto de televisores. |
| Revistas mensais | Importação XLSX, prévia, preços sugeridos, ativação e revisão | Pode evoluir para campanhas comerciais por período e loja. |
| Parceiros | Três posições de fabricante, logotipos e acesso ao catálogo filtrado | Útil para acordos comerciais; exposição atual é dentro da área autenticada. |
| PWA e mobile | Instalação, interface adaptada, câmera de código de barras e tema escuro | Facilita acesso; não equivale a aplicativo nativo nem operação completa offline. |
| Acesso | Login, dois perfis, sessões, bloqueio, CSRF e limitação de tentativas | Há controles de segurança; não há gestão de organizações. |
| Apresentação | Landing page com prints reais e descrição dos recursos | Ativo para demonstração; falta uma jornada comercial de contato e contratação. |

### Capacidades que não devem ser anunciadas como disponíveis

Não foram identificados: estoque, PDV, emissão fiscal de vendas da loja, checkout de consumidores, publicação automática em redes sociais, gerenciamento remoto de TVs, histórico de artes salvo no servidor, colaboração simultânea, cobrança SaaS integrada ou isolamento de várias empresas na mesma instalação.

A “revista” atual é uma lista de produtos e preços por mês. Não foi identificado um editor de encarte multipágina com exportação em PDF. A IA atual não cria imagens de produtos nem administra campanhas autonomamente.

## 04. Dados do catálogo e adaptação ao varejo geral

### Retrato do banco local

| Indicador | Resultado observado | Leitura correta |
| --- | --- | --- |
| Produtos | 11.105 | Volume do banco local, não número de produtos licenciados ou validados. |
| Produtos ativos | 11.103 | Situação cadastral; não comprova qualidade do conteúdo. |
| Sem referência de imagem | 5.762, aproximadamente 51,9% | Ausência de `imagem_arquivo`; não foi feita inspeção física de todos os arquivos. |
| Sem fabricante | 1.023, aproximadamente 9,2% | Pode prejudicar busca e destaque de parceiros. |
| Sem EAN | 3 | Cadastro manual permite ausência; varejo precisa também de SKU próprio. |
| EANs repetidos | 29 grupos, 29 registros excedentes | Resolver duplicidades antes de criar restrições únicas. |
| Perfumaria e Cosméticos | 6.921 | Grupo mais representativo do acervo atual. |
| Medicamento/Medicamentos | 2.602 somados | Duas denominações de categoria para normalizar. |
| Suplementos | 1.201 | Conteúdo sujeito a regras próprias de divulgação. |

**Conclusão:** o tamanho do acervo é uma vantagem potencial. Seu uso comercial depende de autorização, cobertura visual, correção e adequação ao segmento. Evite anunciar “catálogo completo para todo o varejo” com base apenas na contagem.

### Adaptações recomendadas

1. **Separar dados comuns dos dados da loja.** Nome, GTIN/EAN e fabricante podem integrar uma base licenciada; preço, SKU, promoções, marca e arquivos particulares pertencem à operação do cliente.
2. **Criar catálogo privado por empresa.** Produtos cadastrados por uma loja não devem virar automaticamente patrimônio compartilhado da plataforma.
3. **Importar catálogo por CSV/XLSX.** Prever mapeamento de colunas, prévia, validação, relatório de erros e atualização por identificador. O importador atual de revistas não substitui essa função.
4. **Suportar produtos sem EAN.** Manter identificação interna, SKU e cadastro manual para artesanato, produtos próprios, hortifrúti e itens fracionados. IA por EAN será uma opção, não requisito.
5. **Adicionar unidade e apresentação.** Exemplos: un., kg, g, L, mL, pacote e caixa. Planejar variantes de tamanho/cor quando houver demanda comprovada.
6. **Tornar campos farmacêuticos opcionais por segmento.** Princípio ativo, registro MS e genérico não devem dominar o formulário de uma loja comum.
7. **Separar marca, fabricante e fornecedor.** Um parceiro comercial do varejista pode ser distribuidor ou marca, e hoje o destaque usa o campo fabricante.
8. **Evoluir “revistas” para campanhas.** Início/fim, loja, preço normal/promocional, unidade, regras de combo e responsável. Preservar as revistas existentes na migração.

**Meta de piloto:** cadastrar os 50 a 100 produtos mais usados de cada loja, com imagens autorizadas e revisadas, em vez de tentar corrigir todo o acervo antes de vender.

## 05. Posicionamento e concorrência

### Proposta de valor para experimentar

“Organize os produtos da sua loja e transforme suas ofertas em peças para redes sociais e TV, com a identidade do seu negócio e apoio no cadastro.”

A demonstração deve mostrar uma sequência concreta: escolher produto, informar preço, aplicar a marca da loja, exportar Story, converter para Feed e gerar o material de TV. A IA e o PWA apoiam essa experiência; o comprador precisa perceber redução de trabalho e consistência das ofertas.

### Referências de mercado consultadas

| Referência | Oferta divulgada pelo fornecedor | Implicação para o _stackmedia |
| --- | --- | --- |
| Canva | Brand Kit e recursos para manter a identidade das peças | Personalização por loja é uma expectativa básica. [Canva](https://www.canva.com/pro/brand-kit/) |
| Encarte Fácil | Ferramenta para ofertas do varejo, modelos, recursos de IA e plano Pro anunciado por R$ 69/mês | Há concorrência direta e preço baixo. Um plano assistido de R$ 299 precisa justificar a diferença pelo serviço e pela rotina entregue. [Encarte Fácil](https://encartefacil.com/) |
| PosterMyWall | Criação e marketing para varejo, com planos e funções de distribuição | Recursos de design e publicação têm substitutos amplos. [PosterMyWall](https://www.postermywall.com/index.php/m/retail) |
| Bannerbear | Automação de imagens/vídeos e planos por créditos | Referência para precificar operações que geram custo variável. [Bannerbear](https://www.bannerbear.com/pricing/) |

Estas são descrições públicas dos fornecedores, consultadas em 19/10/2026, sem avaliação prática dos concorrentes. Não comprovam participação de mercado, qualidade ou resultados de vendas. Os preços podem mudar.

### Diferenciação a construir e medir

- Catálogo próprio organizado, com apoio inicial para importar e corrigir os produtos relevantes.
- Menos etapas entre produto, preço e formatos de divulgação.
- Marca e informações da loja reaproveitadas automaticamente nas artes.
- Campanhas e condições comerciais organizadas por período.
- Atendimento em português e implantação que leva o cliente até a primeira campanha.
- Parceiros comerciais integrados ao catálogo, com autorização e métricas claras.

Uma interface agradável, modo escuro e instalação PWA ajudam a experiência, mas são insuficientes, isoladamente, para sustentar uma mensalidade maior. A disposição de pagamento deve ser demonstrada por contratos e renovações.

## 06. Modelos de negócio possíveis

| Modelo | Como cobrar | Melhor momento | Dependências e riscos |
| --- | --- | --- | --- |
| **Assinatura por loja com implantação** | Mensalidade + configuração inicial | Recomendado para começar | Entregar catálogo inicial, marca e treinamento; limitar trabalho personalizado. |
| Plano para redes | Valor base + lojas adicionais | Após validar uma loja | Preços, permissões e campanhas por unidade; painel central ainda precisa ser desenvolvido. |
| Plano para agências | Pacote de operações/clientes + excedentes | Após existir separação entre clientes | Agência precisa alternar contextos sem expor dados e definir quem atende o lojista. |
| Marca própria, ou white label | Implantação maior + mensalidade mínima + lojas | Quando houver comprador disposto a financiar | Domínio, marca, contrato e suporte separados; tema escuro não equivale a white label. |
| Licença em instalação dedicada | Licença anual + implantação + manutenção | Compradores com requisitos de ambiente próprio | Atualizações e suporte ficam mais caros; evitar entregar código-fonte por padrão. |
| Serviços de conteúdo | Pacotes de templates, importação, campanha e treinamento | Complemento desde o piloto | Separar serviço humano de receita do software e controlar revisões. |
| Patrocínio de fabricantes | Contrato por período/campanha ou rede participante | Depois de existir audiência mensurável | A vitrine atual é interna. Não prometer exposição a consumidores nem retorno sem medição. |

### Combinação recomendada

**Primeiros 90 dias:** assinatura por loja + implantação delimitada. Cobrança e provisão de contas podem começar assistidas, com registros e conciliação. Não é necessário construir checkout automático antes de conversar com os primeiros compradores.

**Depois de validar renovação:** plano para redes ou agências, conforme a demanda observada. Manter uma base de código com configuração, evitando uma versão diferente do produto para cada contrato.

**Receita de parceiros:** começar com pilotos de cofinanciamento de campanhas, mediante autorização das lojas. Identificar conteúdo patrocinado e separar escolha comercial de informações objetivas do produto. A receita principal deve continuar viável sem patrocínio.

Adiar plano gratuito permanente e venda vitalícia. O primeiro pode gerar custo de atendimento antes de demonstrar conversão; a segunda financia pouco uma obrigação contínua de hospedagem, segurança e suporte. Uma demonstração com dados autorizados pode cumprir o papel de experimentação inicial.

## 07. Oferta, planos e regras de cobrança

### Oferta do piloto

**Hipótese inicial: R$ 299/mês por loja + R$ 790 de implantação.** Negociar um piloto de 60 dias, com regras claras de saída, exportação e tratamento dos dados. A duração pode se estender além do primeiro ciclo de 90 dias deste plano, conforme a data de entrada de cada loja.

Escopo sugerido de implantação: uma marca, até 100 produtos fornecidos em planilha válida, até seis adaptações de templates e uma sessão de treinamento de 60 minutos. Fotografia, pesquisa extensiva de direitos e saneamento de bases grandes devem ter orçamento próprio.

| Item | Oferta piloto proposta | Condição para anunciar |
| --- | --- | --- |
| Operação | Uma loja, até três usuários | Controle de contas e contrato; instalação isolada por empresa. |
| Produção | Stories, Feed e TV nos formatos atuais | Compatibilidade de exportação documentada; sem promessa de publicação automática. |
| Marca | Logo, cores e informações da loja nos templates | Configuração da marca implementada ou adaptação manual incluída no escopo. |
| IA | Até 100 consultas novas por mês | Contador persistente e teto no servidor; não existe hoje como limite comercial. |
| Imagens externas | Até 100 buscas novas por mês | Cota própria, licença de uso tratada e consumo conciliado com o provedor. |
| Arquivos privados | Franquia inicial de 1 GB | Medição de armazenamento e política de excedente, ainda a implementar. |
| Suporte | Canal definido, em dias e horários comerciais | Exemplo: primeira resposta em até um dia útil; prazo de solução depende do caso. |

Não cobrar por PNG/MP4 local apenas para simular custo de processamento em nuvem. Hoje a exportação ocorre no navegador. Monetizar valor, atendimento e capacidades; aplicar cotas principalmente onde há custo real de API, armazenamento ou processamento futuro.

### Expansões de preço para investigar

| Oferta futura | Faixa inicial para entrevistas, não tabela aprovada |
| --- | --- |
| Loja com autoatendimento e suporte reduzido | R$ 99 a R$ 149/mês, somente após reduzir custo de implantação e atendimento |
| Loja com apoio e recursos ampliados | R$ 299 a R$ 499/mês |
| Rede com três lojas | R$ 899 a R$ 1.299/mês, mais R$ 149 a R$ 249 por loja adicional |
| Agência com cinco operações | R$ 999 a R$ 1.499/mês, com condições de revenda e suporte |
| White label | Proposta sob medida após estimar implantação, infraestrutura e manutenção |

Testar preço com propostas reais, mantendo registro de aceitação e motivo de recusa. Se a maioria comparar o produto apenas a um editor de R$ 69, esclarecer o escopo assistido ou reduzir custo e preço; acrescentar funções sem resolver a objeção pode atrasar a validação.

### Regras financeiras necessárias

Definir início de cobrança, vencimento, reajuste, cancelamento, desconto anual, suspensão por atraso, período de tolerância e destino dos dados. Não excluir dados automaticamente ao primeiro atraso. Separar cancelamento de assinatura, estorno e exclusão de conta.

No piloto, usar um provedor com cobrança hospedada e conciliar os pagamentos. Para automação, comparar tarifas e condições de fornecedores. O Asaas, por exemplo, documenta assinaturas e acompanhamento por webhooks; criar uma assinatura não confirma pagamento. [Documentação Asaas](https://docs.asaas.com/docs/assinaturas)

## 08. Custos e viabilidade econômica

### Modelo inicial, com premissas explícitas

O exemplo abaixo é um orçamento hipotético, não uma demonstração financeira do projeto. Substituir cada parcela por fatura ou medição. Os 10% usados para taxas e tributos são uma reserva de simulação, sem representar enquadramento tributário.

| Premissa mensal | Valor do exemplo |
| --- | --- |
| Preço por loja | R$ 299 |
| Custo direto por loja | R$ 60: suporte R$ 30, infraestrutura incremental R$ 10, APIs R$ 15, comunicações/contingência R$ 5 |
| Taxas e tributos simulados | 10% da receita, ou R$ 29,90 por loja |
| Custos fixos operacionais | R$ 1.800: infraestrutura base R$ 500, ferramentas/contabilidade R$ 300, conteúdo/manutenção contratada R$ 1.000 |
| Remuneração adicional do responsável | R$ 6.000 para produto, gestão e vendas, sem repetir as horas de suporte acima |

**Contribuição por loja = 299 - 60 - 29,90 = R$ 209,10/mês**, aproximadamente 69,9% da receita. Essa é margem de contribuição, não lucro líquido.

| Lojas pagantes | Receita recorrente mensal | Após custos diretos, taxas e R$ 1.800 fixos | Após também reservar R$ 6.000 de remuneração |
| --- | --- | --- | --- |
| 10 | R$ 2.990 | R$ 291 | -R$ 5.709 |
| 30 | R$ 8.970 | R$ 4.473 | -R$ 1.527 |
| 50 | R$ 14.950 | R$ 8.655 | R$ 2.655 |
| 100 | R$ 29.900 | R$ 19.110 | R$ 13.110 |

Neste cenário, o equilíbrio dos custos fixos operacionais ocorre em **9 lojas**; incluindo a remuneração adicional, em **38 lojas**. Se o custo direto subir a R$ 120 por loja, a contribuição cai para R$ 149,10 e o segundo equilíbrio exige **53 lojas**.

Os números excluem desenvolvimento inicial, aquisição de clientes, inadimplência além da reserva, estornos extraordinários e crescimento por degraus de infraestrutura/equipe. A receita de implantação é pontual e deve financiar a implantação; não entra na receita recorrente mensal. Em pequenas bases, mínimos de fornecedores podem superar os rateios do exemplo.

### Como calcular IA e busca de imagens

O código usa uma busca DeepSeek e, quando existem fontes, uma chamada de extração. Medir requisições, tokens, êxito, latência e custo por empresa. A busca de imagens é um serviço separado.

Na consulta de 19/10/2026, a tabela da DeepSeek indicava, para `deepseek-flash` em horário de pico, US$ 0,30 por milhão de tokens de entrada sem cache e US$ 1,20 por milhão de saída; Search indicava US$ 0,75 por mil requisições bem-sucedidas. Um exemplo de 1.000 consultas com 4.000 tokens de entrada e 600 de saída cada resultaria em **US$ 2,67**: US$ 1,20 + US$ 0,72 + US$ 0,75. Isso não é consumo medido do sistema; exclui câmbio, tributos e outros serviços. [Preços DeepSeek](https://api-docs.deepseek.com/quick_start/pricing/)

A SerpApi anunciava plano Starter de **US$ 25/mês para 1.000 buscas**. O custo contratado deve considerar a franquia mínima e a soma de todas as lojas, e não apenas um custo médio por requisição. [Preços SerpApi](https://serpapi.com/pricing)

### Aquisição e retorno

Registrar anúncios, deslocamento, comissão e horas comerciais. Se o custo de aquisição de um cliente for R$ 900 e sua contribuição mensal for R$ 209,10, o retorno simples desse gasto levará aproximadamente **4,3 meses**, antes de considerar cancelamentos. Não usar uma estimativa de valor vitalício do cliente sem histórico suficiente de retenção.

Um exemplo de valor percebido: 40 peças/mês com economia medida de 8 minutos por peça representam 5,3 horas. A R$ 40/hora, são cerca de R$ 213. Essa economia, sozinha, não justifica automaticamente R$ 299; é necessário demonstrar outros benefícios ou ajustar oferta e preço.

## 09. Arquitetura comercial e separação entre empresas

### Situação atual

As tabelas `products`, `users`, `featured_partners`, `magazines` e `magazine_items` não possuem vínculo com uma empresa. O papel “cliente” identifica uma permissão de usuário, não uma empresa isolada. Os administradores têm alcance sobre os dados da instalação.

Os parceiros têm três posições globais. A revista tem mês único na instalação. Imagens e fundos são servidos a usuários autenticados sem um proprietário empresarial separado. **Cadastrar usuários de empresas diferentes na mesma instância não cria separação comercial dos dados.**

### Etapa A: piloto com instalações isoladas

Usar um subdomínio e processo por empresa, com banco, diretório de imagens, fundos privados, logs e backups próprios. O código deve vir do mesmo release. Configuração e dados mudam por cliente; alterações manuais exclusivas no código devem ser evitadas.

Manter inventário de versão, domínio, responsável, armazenamento, integração e status de cobrança de cada instalação. Automatizar a criação gradualmente. Não basta duplicar a página: separar também diretórios e credenciais de operação, aplicar permissões no sistema e avaliar o risco de compartilhar o mesmo host.

SQLite pode continuar nessa fase, respeitando a orientação existente de uma instância por banco e medindo a carga. A troca de banco não é um pré-requisito automático para a primeira venda.

### Etapa B: plataforma compartilhada

Criar organizações e lojas, associação de usuários, papéis, direitos de cada plano e identificação da empresa em todas as consultas e arquivos. A organização autorizada deve ser resolvida pela sessão e pela associação do usuário; um `tenant_id` recebido do navegador não pode decidir o acesso sozinho.

| Entidade proposta | Finalidade |
| --- | --- |
| `organizations`, `stores`, `memberships` | Empresas, unidades, usuários e permissões |
| `store_products`, `product_variants`, `brand_profiles` | Catálogo privado, variantes e identidade da loja |
| `campaigns`, `campaign_items`, `artworks`, `artwork_versions` | Ofertas, preços, composições e recuperação do trabalho |
| `assets`, `asset_rights` | Arquivos, proprietário, origem, licença e autorização |
| `subscriptions`, `entitlements`, `usage_events` | Contratação, recursos liberados e consumo |
| `billing_events`, `audit_events` | Conciliação de cobrança e histórico de ações críticas |

Uma base comum de produtos deve ser opcional, licenciada e ter regras de atualização; dados privados não devem alimentá-la sem autorização. Planejar migração dos clientes piloto com mapa de identificadores, comparação de totais e reversão.

Avaliar PostgreSQL e armazenamento de objetos quando compartilhamento, concorrência ou operação justificarem. Preservar o monólito modular e HTML/JS/CSS enquanto atenderem ao produto. A mudança para outro framework ou microsserviços não é requisito comercial por si só.

## 10. Backlog P0: antes do piloto pago

| ID | Entrega | Critério de conclusão | Responsável sugerido |
| --- | --- | --- | --- |
| P0-01 | Isolamento por empresa | Cliente A não acessa dados, arquivos, contas ou backups do B; instalações e diretórios inventariados | Desenvolvimento/operação |
| P0-02 | Titularidade e acervo inicial | Direitos de software, logos, fontes, fundos e produtos usados no piloto documentados | Responsável + jurídico |
| P0-03 | Configuração da loja | Logo, informações comerciais e templates corretos em Story, Feed e TV | Produto/design |
| P0-04 | Importação assistida | 50 a 100 produtos do cliente carregados, sem duplicidades não resolvidas, com revisão visual | Produto/operação |
| P0-05 | Backups recuperáveis | Banco e arquivos restaurados em ambiente separado com procedimento registrado | Operação |
| P0-06 | Recuperação do trabalho | Rascunho salvo e reaberto após recarga; arquivos e formato identificados | Desenvolvimento |
| P0-07 | Contas e recuperação | Identidade verificada na redefinição, sessão revogada e senha temporária trocada; fluxo assistido documentado | Desenvolvimento/suporte |
| P0-08 | Controle de custos | Consumo de IA/busca por cliente registrado, teto mensal aplicado e orçamento do fornecedor acompanhado | Desenvolvimento/financeiro |
| P0-09 | Suporte e contrato | Escopo, atendimento, cancelamento, cobrança e dados acordados com cada piloto | Comercial/jurídico |
| P0-10 | Observabilidade básica | Alertas para indisponibilidade, falha de backup, disco e falhas repetidas de integrações | Operação |
| P0-11 | Compatibilidade declarada | Matriz de navegadores/aparelhos e resultados de exportação documentados | Desenvolvimento/produto |
| P0-12 | Oferta comercial concreta | Demonstração com dados autorizados, proposta e canal de contato funcional | Comercial |

### Pontos específicos do código para tratar

**PWA e imagens:** `public/sw.js` mantém cache de imagens versionadas por URL. `public/js/session.js` não apresenta limpeza desse cache no logout. Antes de receber arquivos privados, definir política de cache por empresa/usuário e descarte na saída; verificar o comportamento também em dispositivos compartilhados. É uma observação estática, não uma exploração executada. Arquivos já baixados pelo usuário não podem ser revogados por limpeza de cache.

**Rascunhos:** o estado de composição está em memória, e o logout avisa que a arte será descartada. Para o piloto, implementar salvamento por usuário/empresa com versão do documento, referências de assets e estado “salvo”. Um simples campo `localStorage` compartilhado não atende colaboração, troca de aparelho ou isolamento.

**Origem das imagens:** a busca externa retorna uma seleção temporária e o upload salva um arquivo. Não foi identificada a gravação da origem/licença dessa nova seleção na tabela de créditos. Adicionar o registro de procedência e uma regra de autorização antes do uso comercial.

**Login atrás de proxy:** o limitador usa o endereço da conexão. Em um proxy que concentre as conexões, usuários diferentes podem compartilhar a mesma cota de IP. Verificar a configuração e só aceitar cabeçalhos de proxies explicitamente confiáveis.

## 11. Backlog P1 e P2: escala e produto

### P1: depois dos primeiros pilotos, antes de ampliar aquisição

| Entrega | Resultado esperado |
| --- | --- |
| Importação de catálogo com prévia | O lojista consegue repetir uma atualização sem depender de manipulação manual do banco. |
| Kit da marca configurável | Logo, cores, contatos e textos institucionais aplicados sem recriar fundos a cada contrato. |
| Campanhas por período e loja | Ofertas semanais, mensais e sazonais coexistem; preços têm contexto e responsável. |
| Biblioteca de artes e versões | Duplicar, recuperar, reutilizar e revisar a criação anterior. |
| Recuperação de senha por e-mail | Token único, expiração, invalidação e resposta sem revelar contas existentes. |
| MFA para administradores | Reduzir risco das contas com acesso amplo; prever recuperação controlada. |
| Papéis comerciais | Administrador da plataforma, gestor da empresa, editor e aprovador, conforme necessidade. |
| Assinatura e cobrança integradas | Eventos verificados, idempotência, tolerância a atraso e conciliação; pagar duas vezes não duplica acesso. |
| Indicadores de uso | Identificar ativação, recorrência, erro de exportação, consumo e demanda por suporte. |
| Trilhas de auditoria | Quem alterou produtos, preços, permissões, parceiros e configurações. |
| Migrations versionadas | Atualizações de banco reproduzíveis, com backup e estratégia de reversão. |

### P2: somente após sinal de compra ou uso

- Painel de redes e agências, campanhas centrais e adaptação por loja.
- Encartes multiproduto, A4/PDF e impressão, se os pilotos demonstrarem essa necessidade.
- Integração com ERP por importação recorrente e, depois, API de um fornecedor prioritário.
- Publicação e agendamento em redes, com APIs oficiais, autorização e revisão de permissões.
- Player e gerenciamento de TVs, com agenda, dispositivo e comprovação de reprodução.
- Remoção de fundo e outras funções de IA com custo e benefício medidos.
- White label e portal de fabricantes, com políticas de marca e dados.

### Manutenção que deve acompanhar a evolução

O editor principal tem aproximadamente 3.087 linhas. Separar persistência, exportação, seleção e manipulação de canvas ao tocar nessas áreas. Evitar uma reescrita ampla antes de obter receita e evidência de uso.

O índice de EAN não é único e existem duplicidades. O preenchimento por IA valida o dígito, mas o cadastro manual usa validação mais permissiva. Unificar as regras e o tratamento de produto sem EAN, preservando códigos históricos e unidades diferentes.

A importação inicial depende da tabela de produtos estar vazia. Se todos os produtos forem removidos, uma reinicialização pode reimportar a base original. Criar inicialização explícita e migrations; permitir uma empresa nova com catálogo vazio.

## 12. Operação, segurança e continuidade

### Pontos positivos existentes

Há senhas com scrypt e salt, tokens de sessão armazenados com hash, cookie HttpOnly/SameSite, CSRF, checagem de permissões no servidor, limitação de login, consultas SQL parametrizadas, headers de segurança e validações de arquivos. Integrações usam chaves no backend e possuem limites de tempo/concorrência. Esses controles devem ser preservados e avaliados no ambiente real.

### Rotina mínima de operação

1. Manter ambientes de desenvolvimento, homologação e produção separados. Usar dados fictícios ou autorizados fora da produção.
2. Manter repositório e releases reproduzíveis. Não foi identificado diretório Git nem pipeline de CI nas pastas examinadas; confirmar se estão mantidos em outro local.
3. Fixar uma versão suportada do Node e atualizar dependências com revisão. O intervalo atual `>=22.13.0 <25` permite versões intermediárias; padronizar uma linha LTS, como 24, após compatibilidade. [Ciclo oficial do Node.js](https://nodejs.org/en/about/previous-releases)
4. Executar as suítes existentes em homologação, além dos novos cenários comerciais, antes de publicar. Isso é uma ação futura deste plano; as suítes não foram executadas nesta análise.
5. Monitorar disponibilidade, API, erro de exportação no cliente, uso de disco, custo de integração e sucesso de backups. O `/api/health` atual retorna apenas estado básico, sem comprovar a saúde de todas as dependências.
6. Definir atualização e reversão de código, banco e assets. Registro de publicação deve incluir versão, responsável e resultado.

### Backup e restauração

A orientação atual de copiar SQLite e WAL/SHM deve ser substituída por um procedimento de snapshot consistente. A documentação SQLite apresenta Online Backup API e alternativas para uma base em uso. Um conjunto de arquivos copiados em momentos diferentes não comprova uma cópia recuperável. [Backup SQLite](https://www.sqlite.org/backup.html)

Incluir banco, imagens privadas, fundos, logos, configurações e referências de versão. Proteger chaves em mecanismo separado. Guardar cópia fora do servidor de produção, com acesso restrito, retenção e criptografia apropriadas.

**Metas iniciais propostas, não garantias atuais:** perda máxima de até 24 horas de dados (RPO) e recuperação em até 8 horas (RTO). Medir uma restauração antes do piloto e periodicamente depois. Se a rotina exigir perda menor, reduzir o intervalo de backup e rever custo/contrato.

### Desempenho e limites

`DatabaseSync`, pesquisas com `LIKE` e consultas adicionais por produto justificam medição com catálogo e concorrência reais. Não há evidência nesta análise para afirmar que o sistema suporta 100 ou 1.000 usuários simultâneos.

O script k6 existente usa HTTP Basic e não implementa o login de sessão obrigatório atual. Atualizar autenticação e cenários antes de usá-lo como evidência. Testar leitura, gravação, uploads e falhas de integração separadamente, em ambiente autorizado. Exportação MP4 precisa de avaliação em aparelhos representativos, pois ocorre no navegador.

Corrigir também a documentação: o guia de permissões não reflete o cadastro pendente por clientes; o README diz que o service worker não guarda imagens, enquanto o código contém cache de imagens versionadas.

## 13. Contratos, privacidade e direitos de uso

As ações desta seção precisam ser ajustadas por profissionais jurídico e contábil ao modelo escolhido. O documento orienta decisões de produto e operação; não determina regime tributário nem certifica conformidade.

### Antes de contratar

- Confirmar quem detém o software. Se ele foi desenvolvido sob contrato anterior, verificar limites de reutilização, exclusividade e cessões de colaboradores.
- Fazer busca de disponibilidade da marca _stackmedia, domínio e apresentação comercial. Avaliar registro de marca e registro do programa, que são proteções diferentes. O INPI descreve o registro do programa como instrumento de segurança jurídica sobre autoria/titularidade. [INPI](https://www.gov.br/inpi/pt-br/assuntos/programas-de-computador)
- Contratar com identificação da empresa, objeto, usuários/lojas, limites, preço, reajuste, cancelamento, suporte, disponibilidade, responsabilidade por conteúdo, dados e término.
- Definir com contador CNPJ, atividades, emissão de nota, tributos sobre licença/serviços e tratamento das assinaturas. A hipótese financeira de 10% não substitui essa definição.

### Dados pessoais

Mesmo sem dados de consumidores finais, contas, nomes, e-mails e registros de acesso são dados pessoais. Mapear finalidades, bases legais, acesso, retenção, exclusão e atendimento aos titulares. Definir quando o fornecedor atua como controlador e quando atua como operador de dados do cliente; o papel depende da atividade, não apenas do nome no contrato. [Orientações ANPD](https://www.gov.br/anpd/pt-br/assuntos/noticias/nova-versao-do-guia-dos-agentes-de-tratamento)

Preparar aviso de privacidade, acordo de tratamento de dados e relação de fornecedores. Agentes de pequeno porte continuam sujeitos a medidas essenciais de segurança, observadas as regras aplicáveis. [Resolução ANPD nº 2](https://www.gov.br/anpd/pt-br/acesso-a-informacao/institucional/atos-normativos/regulamentacoes_anpd/resolucao-cd-anpd-no-2-de-27-de-janeiro-de-2022)

O fluxo de IA examinado envia EAN e conteúdo de fontes, sem encaminhar o cadastro de usuário no corpo da consulta. Manter essa minimização. Avaliar hospedagem, suporte, e-mail e futuras integrações quanto a transferências internacionais de dados pessoais e mecanismos aplicáveis. Não presumir que consultar um EAN, sozinho, é transferência de dados pessoais. [ANPD: transferências internacionais](https://www.gov.br/anpd/pt-br/assuntos/assuntos-internacionais/transferencia-internacional-de-dados)

Criar procedimento de incidentes, com responsáveis e comunicação ao cliente. Verificar com jurídico o enquadramento, os prazos e as exceções do regulamento de comunicação. [ANPD: incidentes de segurança](https://www.gov.br/anpd/pt-br/canais_atendimento/agente-de-tratamento/comunicado-de-incidente-de-seguranca-cis)

### Imagens, marcas e ofertas

Resultado de busca não equivale a autorização de reprodução. Registrar fornecedor, origem, licença, autorização e restrições de fotografias, fundos e logos. Preferir material do próprio lojista, fabricante autorizado ou acervo licenciado. Créditos não substituem a permissão exigível. [Lei de Direitos Autorais](https://planalto.gov.br/ccivil_03/leis/l9610.htm)

Modelos devem facilitar informação clara de preço, unidade, vigência e condições da oferta, com revisão pelo responsável da loja. Validar juridicamente textos de desconto, combos e restrições, à luz das regras de informação ao consumidor. [Código de Defesa do Consumidor](https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm)

Como o acervo contém medicamentos, manter uma política específica se esse segmento continuar atendido. A Anvisa informa que publicidade ao público geral é restrita aos medicamentos isentos de prescrição. A classificação, os avisos e a aprovação das peças exigem revisão especializada. [Anvisa](https://www.gov.br/anvisa/pt-br/assuntos/noticias-anvisa/2018/medicamentos---cuidado-com-promessas-milagrosas/)

## 14. Venda, implantação e retenção

### Pesquisa comercial de duas semanas

Selecionar 12 a 15 lojistas de dois segmentos, registrando porte, frequência de ofertas, ferramentas usadas e responsável pelo trabalho. Perguntar:

1. Como foi produzida a última campanha? Solicitar que mostrem o processo.
2. Quanto tempo foi gasto para encontrar imagens, conferir preço, montar e adaptar formatos?
3. Quem aprova e quem publica? Quais erros e retrabalhos acontecem?
4. O que falta na ferramenta atual? Quanto pagam por software e por serviço?
5. Quem decide e paga? Qual resultado justificaria trocar ou adicionar uma ferramenta?
6. Aceitariam um piloto pago com seus produtos? Qual objeção impede a contratação?

O objetivo é documentar a rotina e obter compromissos. Elogio à demonstração e intenção vaga de compra não substituem pagamento e uso.

### Funil comercial simples

| Etapa | Ação | Registro necessário |
| --- | --- | --- |
| Lista de interessados | Contatos existentes, associações locais, indicação e parceiros | Origem e permissão de contato |
| Diagnóstico de 20 minutos | Entender frequência, catálogo, marca e responsável | Dor, ferramenta atual e decisão de compra |
| Demonstração de 15 minutos | Criar uma oferta com produto autorizado do prospect | Tempo, dúvidas e valor percebido |
| Proposta | Plano, implantação, limites, piloto e saída | Aceite, recusa ou pendência concreta |
| Implantação | Marca, 50 a 100 produtos e treinamento | Primeira campanha e responsável ativo |
| Acompanhamento | Revisar uso na primeira semana e no primeiro mês | Bloqueios, horas de suporte e renovação |

O plano de aquisição não pressupõe disparos em massa nem contato já autorizado. Definir abordagem e permissões antes de enviar mensagens.

### Roteiro de implantação

1. Assinar proposta e confirmar cobrança inicial.
2. Receber planilha e arquivos com declaração de direitos de uso.
3. Provisionar ambiente, contas, marca, templates e cópia de segurança.
4. Criar a primeira oferta junto ao cliente e exportar dois formatos.
5. Instalar PWA quando útil e explicar dependência de conexão e limites de vídeo.
6. Fazer o cliente repetir a tarefa sozinho; registrar dificuldades.
7. Retornar após sete dias e no fechamento do primeiro mês.

### Indicadores e metas propostas

**Indicador principal:** lojas pagantes que exportaram ao menos uma campanha na semana. Medir também peças criadas, tempo até a primeira exportação, frequência de retorno, falhas, suporte por loja e renovação.

No piloto, buscar: pelo menos 3 lojas pagantes; 4 de 5 lojas conseguindo concluir uma primeira campanha sem assistência contínua; 3 de 5 usando semanalmente por quatro semanas; e pelo menos 3 renovações entre 5 clientes que chegaram à data de renovar. São critérios iniciais para decidir o próximo passo, não comprovação estatística de mercado.

Eventos propostos: `product_imported`, `artwork_saved`, `export_completed`, `export_failed`, `ai_lookup_completed`, `image_search_completed` e `support_request`. Usar empresa, formato, duração e resultado; evitar conteúdo de artes, senhas ou dados pessoais desnecessários nos eventos. Eventos emitidos apenas pelo navegador não devem ser a única fonte de faturamento.

## 15. Plano de execução de 90 dias

O calendário pressupõe um responsável por produto/comercial, uma pessoa de desenvolvimento com disponibilidade regular e apoio pontual de design, operação, jurídico e contabilidade. É uma estimativa inicial; replanejar após a primeira semana. Horas de manutenção de clientes atuais reduzem a capacidade disponível.

| Período | Entregas principais | Dependências | Critério para avançar |
| --- | --- | --- | --- |
| Dias 1 a 7 | Confirmar direitos, custos e oferta; escolher dois segmentos; iniciar entrevistas; registrar backlog | Acesso aos responsáveis e contratos existentes | Escopo do piloto, orçamento e riscos documentados |
| Dias 8 a 21 | Instalações isoladas, backup/restauração, configuração de loja, ajustes de cache e acesso, cotas | Decisões de infraestrutura e acervo | Separação e recuperação demonstradas em homologação |
| Dias 22 a 35 | Importação assistida, rascunho mínimo, catálogo inicial, templates, compatibilidade e contratos | P0 técnico e jurídico | Uma loja demonstrativa conclui a jornada inteira |
| Dias 36 a 60 | Entrada de 3 a 5 pilotos pagos, treinamento, medição semanal e correção de bloqueios | P0 concluído e cobrança conciliável | Uso repetido, suporte registrado e orçamento sob controle |
| Dias 61 a 90 | Revisar preço, margens e renovações disponíveis; automatizar o gargalo principal; planejar P1 | Dados reais dos pilotos | Decisão documentada: expandir, ajustar segmento/oferta ou estender o piloto |

Clientes que ingressarem perto do dia 60 não terão um ciclo completo de 60 dias ao fim do plano. Acompanhar sua renovação até aproximadamente o dia 120; não declarar retenção comprovada antes disso.

### Esforço e reserva

Para os ajustes de piloto, usar inicialmente uma faixa de **25 a 45 dias de desenvolvimento efetivo**, além de trabalho comercial, design e jurídico. É uma estimativa de ordem de grandeza, não orçamento fechado. Não inclui um SaaS multitenant completo, integração de ERP, player de TV ou aplicativo nativo.

Orçar por entrega e critério de conclusão. Se contratar desenvolvimento, multiplicar dias estimados pela diária acordada e acrescentar reserva para incerteza. Separar esse investimento do caixa mensal. No exemplo econômico, três meses de despesas fixas com remuneração somam R$ 23.400, antes de implantação, aquisição e custos variáveis; ajustar à realidade da equipe.

### Quando avançar ou ajustar

- **Expandir:** clientes renovam, valor é demonstrável, custo de suporte cabe no preço e nenhuma pendência P0 está aberta.
- **Ajustar oferta/preço:** clientes usam, mas recusam a cobrança ou exigem serviço que consome a margem.
- **Ajustar segmento:** onboarding ou catálogo não atende a rotina de um grupo; comparar com o outro grupo do piloto.
- **Adiar aquisição:** incidentes, perda de trabalho, isolamento insuficiente ou restauração sem comprovação.
- **Priorizar uma integração:** várias oportunidades pagantes dependem do mesmo fluxo, com benefício e custo claros.

## 16. Checklist de lançamento e decisões futuras

### Antes do primeiro piloto pago

- [ ] Posicionamento para varejo e escopo de entrega aprovados.
- [ ] Titularidade do código e autorização do acervo inicial confirmadas.
- [ ] Empresa, proposta, cobrança e emissão fiscal organizadas.
- [ ] Dados e arquivos separados por cliente.
- [ ] Marca da loja aplicada corretamente às artes.
- [ ] Catálogo inicial revisado e duplicidades resolvidas.
- [ ] Rascunho salvo e recuperável.
- [ ] Acesso, redefinição de senha e cache documentados.
- [ ] Backup restaurado em ambiente separado.
- [ ] Limites e consumo de integrações controlados.
- [ ] Compatibilidade e limitações de PWA/MP4 comunicadas.
- [ ] Canal, horários e responsável pelo suporte definidos.

### Antes de ampliar a aquisição

- [ ] Renovação medida em clientes que completaram o ciclo.
- [ ] Margem calculada com suporte e custos reais de fornecedores.
- [ ] Implantação reproduzível e tempo por cliente conhecido.
- [ ] Pagamento, suspensão e cancelamento conciliados.
- [ ] Exportação e exclusão de dados do cliente previstas.
- [ ] Atualização, reversão e resposta a incidentes praticadas.
- [ ] Capacidade de carga medida com autenticação atual.
- [ ] Arquitetura escolhida para redes/agências e isolamento futuro.

### Próximas três ações do responsável

1. **Montar a oferta piloto em uma página**, usando os limites e critérios deste documento.
2. **Agendar cinco entrevistas de diagnóstico** e obter planilhas/amostras autorizadas de dois segmentos.
3. **Abrir o backlog P0 com responsável e prazo**, começando por isolamento, direitos sobre o acervo e restauração.

O sinal mais útil para o próximo investimento será um lojista que conclui a campanha, volta na semana seguinte e renova a assinatura com atendimento sustentável.

## 17. Mapa de evidências do projeto

Os caminhos abaixo são relativos à pasta `catalogo-crud`. As observações refletem o estado examinado em 19/10/2026; o código pode evoluir.

| Evidência | Arquivos e observação |
| --- | --- |
| Banco e ausência de organizações | `src/database/catalog-database.mjs`, `src/modules/users/user-service.mjs`, `src/modules/magazines/schema.mjs`: tabelas globais, parceiros limitados a três posições e mês único. |
| Catálogo e aprovação | `src/modules/products/product-service.mjs`, `src/routes/api-routes.mjs`: filtros por perfil e cadastro de cliente sempre pendente. |
| Sessão e autorização | `src/modules/users/session-service.mjs`, `src/app.mjs`, `src/http/response.mjs`: cookie, CSRF, limite de login, rotas e headers. |
| IA e consumo | `src/modules/products/product-ai-service.mjs`, `src/integrations/deepseek-client.mjs`: EAN, fontes, extração, cache temporário e limites por processo. |
| Imagens e direitos | `src/modules/products/google-image-search.mjs`, `product-image-upload.mjs`: integração, seleção temporária e reprocessamento; créditos antigos em tabela separada. |
| Parceiros | `src/modules/partners/partner-service.mjs`, `public/js/features/partners/`: fabricante, logotipo, carrossel e catálogo filtrado. |
| Revistas | `src/modules/magazines/`, `public/js/revistas.js`: XLSX, prévia, preços em centavos e versão para concorrência. |
| Criação e persistência | `public/js/features/stories/state.js`, `editor.js`, `public/js/features/indoor/editor.js`: composição em memória e exportação. |
| Vídeo | `public/js/features/stories/video-export.js`: WebCodecs/H.264, dimensões suportadas, 15 segundos e renderização no navegador. |
| PWA e cache | `public/sw.js`, `public/js/pwa.js`, `public/js/session.js`: cache de imagens versionadas, instalação e saída de sessão. |
| Operação | `src/config.mjs`, `server.mjs`, `docs/deployment-plesk.md`: caminhos locais, SQLite, inicialização e implantação. |
| Verificações existentes | `package.json`, `scripts/*.test.mjs`, `scripts/load-test.js`: diversas suítes e script de carga; não executados nesta análise. |
| Dados agregados | Leitura de `data/catalogo.sqlite`: contagens de produtos, categorias, ausência de campos e EANs repetidos. Sem leitura de contas ou segredos. |
| Apresentação | `public/apresentacao.html`, `.css`, `.js` e `apresentacao-tema.js`: apresentação comercial, prints reais e tema. |

### Fontes externas

As fontes estão vinculadas junto às respectivas afirmações nas seções 5, 7, 8, 12 e 13. Foram priorizadas páginas oficiais dos fornecedores, SQLite, Node.js, INPI, ANPD, Anvisa e legislação federal. Preços de fornecedores foram consultados em 19/10/2026; confirmar condições, moeda e tributação no momento da contratação.

