# Estrutura MariaDB para receber o catálogo SQLite

O arquivo `scripts/mariadb-schema.sql` cria as 9 tabelas atuais, com os mesmos
nomes e a mesma ordem de colunas, incluindo `magazines.background`. Preserva
chaves primárias, índices, verificações e os três relacionamentos com suas
ações de exclusão. Não importa registros nem muda o banco usado pelo servidor
da aplicação, que continua sendo SQLite.

O script lê exclusivamente as credenciais `DB_HOST`, `DB_PORT`, `DB_USER`,
`DB_PASSWORD` e `DB_NAME` de `.env.example`. Não imprime credenciais.

Na pasta `catalogo-crud`, após `npm ci`:

```powershell
node scripts/prepare-mariadb.mjs
node scripts/prepare-mariadb.mjs --apply
node scripts/prepare-mariadb.mjs --verify
```

Sem argumento, apenas inspeciona. `--apply` valida a lista de tabelas SQLite,
os limites dos campos de destino e as referências, e recusa executar se qualquer
tabela de destino já existir. `--verify` confere colunas e relacionamentos.
O banco de destino precisa existir. DDL MariaDB tem commit implícito: se houver
falha durante a criação, algumas tabelas poderão já ter sido criadas; inspecione
o estado antes de completar manualmente, sem apagar tabelas com dados.

## Preparação do dump

Para gerar o dump de dados compatível, sem conectar ao MariaDB:

```powershell
node scripts/export-mariadb.mjs
```

O resultado fica em `data/exports/catalogo-mariadb-<timestamp UTC>.sql`, acompanhado
de um `.manifest.json` com contagens por tabela, tamanho e SHA-256. Essa pasta
ignora os dumps no Git. A origem padrão é `data/catalogo.sqlite`; opcionalmente,
informe caminho de origem e caminho de saída como primeiro e segundo argumentos.
A leitura ocorre em uma única transação SQLite, incluindo os dados confirmados
no WAL. O exportador confere integridade, referências, colunas, limites e contagens.
Textos são codificados em hexadecimal UTF-8 para preservar aspas, barras e quebras
de linha independentemente do escape do cliente SQL. O arquivo contém apenas
INSERTs e configuração da sessão/transação, sem DROP, DELETE ou CREATE TABLE.
Importe no banco vazio já estruturado, interrompendo ao primeiro erro (sem
`--force`). O dump inclui todas as tabelas, inclusive hashes de senha e sessões.

Um `.dump` bruto do SQLite **não é SQL MariaDB**. Exporte somente os dados,
convertendo os INSERTs para o dialeto MariaDB, ou use um importador com parâmetros.
Não execute os CREATE TABLE, PRAGMA e comandos de transação SQLite no MariaDB.
Preserve IDs e nomes explícitos das colunas. Importe na ordem das tabelas do
arquivo SQL, que coloca tabelas referenciadas antes das dependentes. Para IDs
explicitamente iguais a zero, use `NO_AUTO_VALUE_ON_ZERO` na sessão de importação.

- Inteiros usam `BIGINT` assinado; IDs gerados pelo SQLite usam `AUTO_INCREMENT`.
- Texto livre e datas usam `LONGTEXT`, preservando os formatos originais.
- Campos textuais de chave usam `VARCHAR(768)`, exceto `magazine_items.ean`
  (`191`) e `users.role` (`32`). Os limites são conferidos contra os dados locais.
- Índices de busca de produtos usam prefixos de 191 caracteres, sem limitar
  o conteúdo armazenado.
- O conjunto de caracteres é `utf8mb4`; comparações gerais usam `utf8mb4_bin`.
  E-mail e fabricante de parceiros usam `utf8mb4_unicode_ci` para unicidade
  sem diferenciar maiúsculas. Essa collation também equipara alguns acentos,
  diferentemente de `NOCASE` do SQLite; revise colisões no momento da importação.
  MariaDB também pode equiparar espaços finais em chaves textuais.
- Chaves primárias textuais não aceitam NULL no destino. Um dump futuro deve
  respeitar essa regra, mesmo que SQLite permita NULL em algumas dessas chaves.

A aplicação exige uma adaptação separada da camada de acesso a dados para passar
a operar diretamente sobre MariaDB; preparar este esquema não faz essa troca.

## Importar o dump gerado

```powershell
node scripts/import-mariadb.mjs data/exports/catalogo-mariadb-<timestamp UTC>.sql
```

O importador lê as credenciais de `.env.example`, verifica o SHA-256 e as contagens
do manifesto e exige tabelas InnoDB vazias. Insere em uma única transação com
verificação de chaves estrangeiras habilitada. Compara todos os campos com o
conteúdo do dump antes do COMMIT e confere contagens depois da gravação.
Em caso de erro antes do COMMIT, solicita rollback. Não execute com outros
processos escrevendo no destino. O arquivo `.sql.import-result.json` registra
o resultado sem credenciais ou conteúdo dos registros. A repetição da importação
é recusada quando as tabelas já contêm dados.
