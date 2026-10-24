# Regras comerciais no backend

O backend oferece limites de artes por usuário, validade do acesso e o perfil
`superadministrador`. A tela de login consulta o servidor e informa os bloqueios
de acesso. A administração comercial continua disponível pelas APIs; não há
pagamentos, planos cadastrados ou integração com as exportações dos editores.

**As exportações PNG/MP4 atuais são executadas no navegador e ainda não chamam
as novas APIs. Portanto, os downloads dos editores não são contabilizados e não
possuem bloqueio individual.** O login considera o saldo dos registros de geração
feitos pela API. Uma próxima etapa deve integrar os editores. Para impedir que
um cliente modificado contorne a cobrança, a geração/entrega do arquivo precisa
ocorrer em um fluxo controlado pelo servidor: somente uma chamada JavaScript
antes de exportar não oferece essa garantia.

## Perfis e primeiro superadministrador

O superadministrador herda todas as permissões administrativas no backend e pode:

- Definir limites e expiração de qualquer conta, inclusive administradores.
- Criar e alterar contas com perfil `superadministrador`.
- Alterar dados, redefinir senhas e excluir outros superadministradores.

Administradores comuns mantêm a gestão operacional e de contas comuns, mas não
podem mudar suas condições comerciais nem editar, redefinir senha, excluir ou
promover um superadministrador. Clientes só consultam sua própria cota e registram
gerações para a própria conta. O usuário da geração vem da sessão, nunca do corpo.

Na pasta `catalogo-crud`, com a configuração de banco do servidor:

```powershell
npm.cmd run users:create-super-admin
```

Em Linux, use `npm run users:create-super-admin`. O comando solicita nome,
e-mail e senha com confirmação e entrada oculta. Funciona também em uma
instalação que já tem usuários, desde que ainda não exista nenhum
superadministrador. Use um e-mail ainda não cadastrado. Contas existentes não são
promovidas automaticamente. O comando antigo `users:create-admin` permanece
disponível apenas para criar o primeiro administrador de um banco sem usuários.

Sem terminal interativo, o novo comando aceita as mesmas variáveis
`BOOTSTRAP_ADMIN_NAME`, `BOOTSTRAP_ADMIN_EMAIL` e `BOOTSTRAP_ADMIN_PASSWORD` do
comando antigo. Remova-as depois. Não há senha padrão nem criação automática de
contas durante a inicialização normal.

O último superadministrador ativo e sem expiração não pode ser excluído,
desativado, rebaixado ou receber validade de acesso. Isso mantém uma conta de
gestão permanente. A exclusão da própria conta também continua proibida.
As telas e verificações de perfil do frontend serão adaptadas em outra etapa;
por enquanto, use as APIs para a administração comercial e do novo perfil.

## Condições por usuário

| Campo | Valores e comportamento |
| --- | --- |
| `artwork_limit` | Inteiro não negativo; `0` impede novas gerações; `null` significa ilimitado. |
| `artwork_limit_period` | `monthly`: mês civil em `America/Sao_Paulo`; `total`: pacote sem renovação automática. |
| `access_expires_at` | Data/hora ISO 8601 com fuso explícito ou `null` para acesso sem vencimento. |

Exemplo: `2026-12-01T00:00:00-03:00` encerra o acesso no início de 1º de dezembro
em São Paulo. Para dar acesso durante todo o dia 30, use esse instante. O servidor
normaliza a data para UTC; datas inválidas ou sem fuso são rejeitadas. Uma data no
passado é permitida e bloqueia o acesso imediatamente.

Usuários existentes e novos sem configuração comercial recebem limite ilimitado,
período `total` e acesso sem expiração. Nenhum perfil fica isento de uma cota que
tenha sido configurada para ele.

O consumo considera todos os formatos juntos. Cada registro aceito consome uma
arte, seja uma imagem ou um vídeo completo; produtos e quadros dentro de uma
composição não são cobrados individualmente. Prévia, consulta de catálogo e
edição não consomem cota. Não há geração retroativa de registros dos downloads
anteriores a esta API.

O limite mensal renova à meia-noite do primeiro dia do mês no fuso de São Paulo,
sem cron, e não acumula saldo. O pacote total conta todas as gerações registradas
da conta e não renova. Para adicionar 50 artes a um pacote com limite 100,
configure o limite como 150. Alterar o limite, a validade ou o tipo de período
preserva o histórico: `total` conta todo o histórico e `monthly` conta apenas o
mês corrente. Períodos ilimitados também registram consumo. Diminuir o limite
abaixo do consumo resulta em saldo zero, sem apagar gerações.

## APIs

Todas as rotas exigem login. Mutações exigem o cookie de sessão e o cabeçalho
`X-CSRF-Token`, obtidos por `POST /api/auth/login` ou `GET /api/auth/me` para o
token CSRF. O cookie é definido pelo login.

| Método e rota | Permissão | Resultado |
| --- | --- | --- |
| `GET /api/artworks/quota` | Qualquer usuário válido | Cota e situação da própria conta. |
| `POST /api/artworks/generations` | Qualquer usuário válido | Autoriza e registra uma geração, consumindo uma unidade. |
| `GET /api/users/:id/commercial` | Superadministrador | Cota e situação de uma conta. |
| `PUT /api/users/:id/commercial` | Superadministrador | Altera somente as condições comerciais enviadas. |
| `POST /api/users` e `PUT /api/users/:id` | Administrador; condições comerciais e superusuários exigem superadministrador | Mantêm os campos usuais e aceitam os três campos comerciais. |

Exemplo de `PUT /api/users/42/commercial`:

```json
{
  "artwork_limit": 100,
  "artwork_limit_period": "monthly",
  "access_expires_at": "2026-12-01T00:00:00-03:00"
}
```

Campos omitidos são preservados, inclusive quando uma tela antiga salva os dados
cadastrais. Para remover o limite ou a validade, envie explicitamente `null`.
A rota comercial rejeita campos desconhecidos. Administradores comuns podem
reenviar valores comerciais idênticos aos atuais, mas não alterá-los.

Exemplo de resposta da cota:

```json
{
  "user_id": 42,
  "access_expires_at": "2026-12-01T03:00:00.000Z",
  "access_expired": false,
  "artwork_limit": 100,
  "artwork_limit_period": "monthly",
  "period_month": "2026-11",
  "used": 12,
  "remaining": 88,
  "can_generate": true
}
```

No pacote total, `period_month` é `null`. Em contas ilimitadas, `remaining` é
`null`. A consulta não reserva saldo: a decisão definitiva acontece na transação
de registro da geração.

Exemplo de `POST /api/artworks/generations`:

```json
{
  "idempotency_key": "5cda711d-3452-4bd0-99a9-eed0ab26228a",
  "format": "stories",
  "output": "png"
}
```

`format` aceita `stories`, `feed`, `encarte` e `indoor-h`; `output` aceita `png`
ou `mp4` (TV/`indoor-h` aceita somente `mp4`). A chave aceita de 8 a 128 letras
ASCII, números, hífens ou sublinhados. Use uma nova chave para cada geração
distinta e reutilize a mesma chave ao repetir uma requisição por falha de rede.

A resposta contém `generation`, `replayed` e `quota`. Um novo registro retorna
`201`; uma repetição idêntica retorna `200`, o registro original e a cota atual,
sem novo consumo, mesmo depois de mudar o mês. Reutilizar a chave com outro
formato/saída retorna `409`. A chave é isolada por usuário. A API não retorna um
arquivo e não permite ao cliente apagar registros, devolver créditos ou enviar
um contador de consumo.

O consumo é definitivo quando a transação de registro é confirmada. Falhas de
validação ou falta de saldo não consomem cota. Falhas posteriores na exportação
local não são observadas por esta API; reservas, conclusão e estorno controlado
pelo servidor devem ser definidos junto ao futuro fluxo de renderização.

Erros seguem o formato existente `{ "error": "mensagem" }`: `400` para entrada
inválida, `401` sem sessão válida, `403` por permissão, CSRF, acesso vencido no
login ou cota esgotada, `404` para usuário inexistente e `409` para conflitos.
As recusas comerciais no login também incluem um `code` estável, conforme abaixo.

## Bloqueio na tela de login

`POST /api/auth/login` verifica no servidor, após a senha correta, se a conta está
ativa, dentro da validade e com saldo de artes. A consulta da cota e a criação
da sessão ocorrem na mesma transação, com uma nova leitura dos dados depois da
verificação da senha. Nenhuma informação de limite ou autorização enviada pelo
navegador substitui os dados do banco.

| HTTP | `code` | Motivo exibido na tela |
| --- | --- | --- |
| `403` | `ACCOUNT_INACTIVE` | Conta desativada. |
| `403` | `ACCESS_EXPIRED` | Validade do acesso encerrada. |
| `403` | `ARTWORK_LIMIT_REACHED` | Cota mensal ou pacote total esgotado, inclusive limite zero. |

O bloqueio não cria sessão, não envia cookie de autenticação e não retorna token
CSRF. Senha incorreta ou e-mail desconhecido continuam retornando apenas o erro
genérico `401`, sem revelar a existência ou as condições de uma conta. As regras
valem para todos os perfis. Contas com cota ilimitada podem entrar enquanto
estiverem ativas e dentro da validade.

O módulo `public/js/auth-client.js` envia as credenciais somente para o endpoint
da mesma origem, usando cookies da mesma origem, sem cache, sem seguir redirects
e com timeout de 15 segundos. A navegação só ocorre depois de um `200` com uma
resposta de sessão válida. Bloqueios recebem mensagens fixas em texto; falhas de
rede, timeout e respostas inválidas mantêm a pessoa no login. Senhas e decisões
de bloqueio não são persistidas no navegador. Cliques repetidos não duplicam a
requisição. A senha é apagada do campo ao terminar cada tentativa.

Uma nova tentativa sempre consulta o backend: renovar a validade, reativar a
conta, aumentar o pacote ou iniciar um novo mês com saldo libera a entrada, sem
limpar dados do navegador. Entrar não consome artes.

**Nesta etapa, esgotar a cota impede somente novos logins.** Não encerra sessões
abertas nem adiciona controles aos botões dos editores. A expiração e a desativação
continuam invalidando o acesso das sessões conforme as regras anteriores.

## Expiração e persistência

O login confere a validade depois de verificar a senha. Contas vencidas com senha
correta recebem `403`; credenciais incorretas continuam com erro genérico `401`.
Cada requisição autenticada confere novamente a validade, inclusive sessões
abertas antes do vencimento. No vencimento, APIs retornam `401` e páginas
redirecionam ao login. As sessões da conta são removidas. Não há cron ou
necessidade de reiniciar o processo para aplicar vencimentos.

Alterar a data de validade revoga as sessões existentes e exige novo login, mesmo
ao prorrogar o acesso. Alterar somente a cota tem efeito no próximo login e no
próximo registro de geração, sem encerrar sessões. A validade comercial é
independente das 12 horas de duração normal de uma sessão.

A inicialização migra automaticamente a tabela SQLite `users` para aceitar o
novo perfil e os campos comerciais e cria `artwork_generations`. IDs, senhas,
sessões e relacionamentos existentes são preservados. A migração e os registros
de consumo são transacionais. O esquema de exportação MariaDB também inclui os
novos campos e registros; isso não muda o banco usado pela aplicação, que continua
SQLite. A exclusão de uma conta remove suas sessões e registros de geração.

Inclua o SQLite no backup antes de publicar. Esta alteração não executa a migração
no banco de desenvolvimento até a aplicação ou um comando de inicialização ser
executado com essa configuração.

## Verificação

```powershell
npm.cmd run test:auth
npm.cmd run verify
```

Os testes usam bancos isolados e cobrem migração, permissões, proteção do último
superadministrador, expiração no login e nas sessões, concorrência entre conexões,
repetição de requisições, troca de mês, pacotes, validação e bootstrap local.
