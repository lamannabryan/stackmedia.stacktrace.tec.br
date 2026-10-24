# Enriquecimento e normalização do catálogo

Aplicado em 2026-10-24T17:25:16.669Z ao banco catalogo-crud/data/catalogo.sqlite.

Foram atribuídos fabricantes a **1.913 produtos** e normalizadas **686 grafias**, totalizando **2.599 registros atualizados**.

| Indicador | Antes | Depois |
|---|---:|---:|
| Produtos | 12.611 | 12.611 |
| Sem fabricante identificado | 2.241 | 328 |
| Com imagem e sem fabricante | 1.399 | 57 |
| Sem imagem | 6.170 | 6.170 |
| Fabricantes distintos cadastrados | 874 | 926 |

**97,4% do catálogo possui fabricante preenchido.** Os 328 casos restantes estão em [pendencias.md](pendencias.md), com dados estruturados em [pendentes-revisao.json](pendentes-revisao.json).

## Critérios utilizados

- Campo vazio, nulo ou "Não Classificado" foi tratado como fabricante ausente.
- Atribuições combinaram nomes e subtítulos distintivos, referências existentes no catálogo, EAN, páginas oficiais, bulas, catálogos e lojas. Foram registradas 835 consultas individuais por produto, além das pesquisas por marcas.
- Foram conferidas visualmente 95 imagens de produtos que ainda estavam pendentes após a pesquisa por nome/EAN.
- O campo segue o uso comercial do catálogo: pode identificar a empresa, o grupo responsável ou a marca fabricante. Não é uma identificação da fábrica física ou do CNPJ responsável por cada lote. Casos licenciados identificáveis foram separados, como chocolates Lacta (Mondelēz), sorvetes Lacta (Froneri) e sobremesas Lacta (Mr. Bey).
- Fabricantes já preenchidos receberam somente normalização; não houve auditoria integral de sua exatidão original. As novas atribuições são inferências documentadas, sujeitas à qualidade das fontes.
- Variações de acentos, caixa, espaços e pontuação foram unificadas. Exemplos: NESTLE → Nestlé; L'Oreal/Loreal → L'Oréal; Kimberly Clark → Kimberly-Clark; Grupo Boticario → Grupo Boticário. Foram consolidados aliases confirmados, como Kley Hertz → Hertz, e rótulos redundantes Nestlé + marca.
- Não foram modificados nomes, EANs, imagens, categorias ou outros campos do produto, além de fabricante e updated_at. Nenhum produto foi excluído nesta aplicação.

## Inconsistências para revisão

- Produto 41864: Cadastro de teste; imagem de foguete. Não representa produto comercial identificável.
- Produto 44603: Nome de aveia Quaker com imagem de telefone Samsung. Não atribuir fabricante pela imagem.
- Produto 41911: Nome de sabonete líquido 400ml e EAN associado a Lovecare, mas imagem de gel antisséptico Vida Farmácias 1 litro. Identidade conflitante; exige revisão antes de atribuição ou exclusão.

## Backup e validação

- [Backup anterior à aplicação](aplicacao-2026-10-24T17-25-16-669Z/catalogo-antes.sqlite)
- [Auditoria com valores anteriores, posteriores e fontes por produto](aplicacao-2026-10-24T17-25-16-669Z/alteracoes.json)
- PRAGMA quick_check: ok. PRAGMA foreign_key_check: nenhum erro.
- Zero grupos com grafias equivalentes por acento, caixa, espaço ou pontuação após a atualização.
- Confirmados: mesmos 12.611 produtos, preservação dos demais campos e tabelas, backup íntegro e atualização atômica em transação SQLite.

O backup inclui os dados anteriores da aplicação inteira. Para reverter somente estas alterações sem perder mudanças posteriores, use os valores anteriores da auditoria por ID e confira se o fabricante atual ainda coincide com o valor aplicado.
