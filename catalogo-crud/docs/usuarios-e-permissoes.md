# Login, usuários e permissões

O _stackmedia exige login por e-mail e senha para acessar o catálogo, os editores e os dados da aplicação. Além dos perfis abaixo, o backend possui `superadministrador`, que herda as permissões administrativas e gerencia limites de artes, expiração de acesso e outras contas de superadministradores. Consulte [Regras comerciais](regras-comerciais.md) para criar esse perfil e usar suas APIs; as telas ainda não foram adaptadas para ele.

| Recurso | Administrador | Cliente |
| --- | --- | --- |
| Consultar catálogo e detalhes dos produtos | Sim | Sim |
| Usar código de barras, Stories, Feed e TV | Sim | Sim |
| Criar e exportar artes | Sim | Sim |
| Ver os destaques de parceiros na central | Sim | Sim |
| Cadastrar, editar e excluir produtos | Sim | Não |
| Gerenciar parceiros e logotipos | Sim | Não |
| Gerenciar contas comuns e redefinir suas senhas | Sim | Não |

## Primeiro acesso

Na pasta `catalogo-crud`, execute em um terminal interativo do servidor:

```powershell
npm.cmd run users:create-admin
```

Em Linux, use `npm run users:create-admin`. O comando solicita nome, e-mail, senha e confirmação. A entrada da senha fica oculta, e não há senha padrão. O comando só funciona enquanto não existir nenhum usuário. Nas próximas vezes, crie contas pela interface administrativa.

Execute com a mesma configuração de armazenamento usada pela aplicação, especialmente `CATALOG_DATABASE_PATH` ou `CATALOG_STORAGE_ROOT`, quando definidos. O comando carrega o `.env` local, se existir; variáveis já definidas no ambiente prevalecem. No Plesk, as variáveis configuradas apenas no painel também precisam estar presentes no terminal usado para esse comando.

O banco recebe as novas tabelas automaticamente, preservando os produtos e parceiros existentes. Reinicie a aplicação para carregar o código atualizado e acesse `/login`. Em produção, use `NODE_ENV=production` e HTTPS, pois o cookie de sessão recebe o atributo `Secure`.

A tela de login informa quando o acesso está desativado, expirado ou com o limite
de artes atingido. O backend verifica essas condições após validar a senha e
recusa a entrada sem criar uma sessão. Senhas incorretas continuam recebendo uma
mensagem genérica. O esgotamento da cota bloqueia somente novos logins nesta etapa;
as regras anteriores de expiração e desativação das sessões permanecem aplicadas.

## Gerenciar contas

Depois de entrar como administrador, abra **Conta > Gerenciar usuários**, ou acesse `/usuarios`.

- **Novo usuário:** informe nome, e-mail, perfil e senha de 10 a 128 caracteres.
- **Editar:** altere os dados e o perfil. Deixe a nova senha vazia para manter a atual.
- **Bloquear:** desmarque **Conta ativa** e salve. As sessões existentes são encerradas e o usuário não consegue entrar novamente até ser reativado.
- **Redefinir senha:** informe uma nova senha na edição. As sessões anteriores são encerradas; compartilhe a nova senha com a pessoa por um canal apropriado.
- **Excluir:** remove a conta e encerra suas sessões, após confirmação na interface.

O sistema não permite excluir a própria conta nem remover, bloquear ou rebaixar o último administrador ativo. Alterações no e-mail, na senha, no perfil ou na situação invalidam todas as sessões da conta. Quando o administrador faz uma dessas alterações na própria conta, precisa entrar novamente.

A busca da tela filtra usuários por nome ou e-mail. O menu **Conta** mostra o nome e o perfil atual e permite sair.

## Proteção e armazenamento

As permissões são verificadas no servidor, inclusive para requisições diretas à API e aliases HTML. A interface também oculta ações administrativas dos clientes; os detalhes dos produtos ficam disponíveis somente para consulta.

As tabelas são:

| Tabela | Dados armazenados |
| --- | --- |
| `users` | Nome, e-mail único, hash da senha, perfil, situação e datas de criação/alteração |
| `user_sessions` | Hash do token da sessão, usuário, token de proteção CSRF e expiração |
| `login_attempts` | Identificadores com hash, contadores e prazo das tentativas de login |
| `artwork_generations` | Gerações registradas na API, usuário, formato, saída, chave de repetição e mês de consumo |

As senhas usam scrypt com salt individual. O navegador recebe um cookie `HttpOnly`, `SameSite=Lax`, com validade de 12 horas; o token original da sessão não é salvo no banco. Gravações exigem token CSRF e rejeitam origens externas. O login limita tentativas por e-mail e endereço de conexão, com janela de 15 minutos.

A aplicação não oferece cadastro público nem recuperação de senha por e-mail. Administradores criam as contas e redefinem senhas. Preserve o banco SQLite nos backups, pois ele também contém os usuários.

O login de usuários é obrigatório mesmo quando `APP_AUTH_ENABLED=false`. Essa variável controla somente a antiga barreira HTTP Basic, que pode continuar como proteção adicional da hospedagem; ela não substitui os perfis nem concede acesso administrativo.

Os arquivos necessários para mostrar o login, a tela offline e os metadados de instalação PWA continuam públicos. `/api/health` informa apenas o estado do serviço. Os destaques de parceiros são visíveis aos usuários autenticados, mas sua gestão é exclusiva dos administradores.

## Validação

```powershell
npm.cmd run test:auth
npm.cmd run verify
```

Os testes usam bancos isolados e verificam login, bloqueios por perfil, proteção CSRF, expiração, logout, redefinição de senha, aliases de páginas, limite de tentativas e preservação do último administrador.
