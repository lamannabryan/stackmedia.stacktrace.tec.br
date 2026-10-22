# Arquitetura do VidaMix Studio

O projeto deixou de ser tratado como uma página única de prova de conceito.
Ele é organizado por responsabilidade e por capacidade de produto: catálogo,
formatos de arte, publicação e integrações futuras.

## Rotas de produto

| Rota | Responsabilidade |
| --- | --- |
| `/` | Central de criação e catálogo de formatos disponíveis. |
| `/catalogo` | Gestão da base de produtos. |
| `/artes/stories` | Editor de Stories (1080 × 1920). |
| `/api/*` | API JSON, separada das páginas e dos arquivos estáticos. |

Os aliases de arquivos antigos continuam disponíveis para não quebrar links
existentes. Novos formatos devem receber uma rota semântica em
`/artes/<formato>`.

## Organização

```text
src/
  config.mjs                 Configuração e caminhos de execução
  database/                  Acesso e ciclo de vida do SQLite
  http/                      Router, respostas, erros e arquivos estáticos
  modules/
    products/                Regras e operações do catálogo
    stories/                 Backgrounds e dados específicos de Stories

public/
  index.html                 Hub da aplicação
  catalogo.html              Gestão de produtos
  stories.html               Casca da tela de Stories
  js/
    features/
      stories/               Bootstrap, estado, DOM e editor do formato

camas-stories/               Fundos de Stories
camas-feed/                  Fundos de Feed (4:5)
data/                        Banco SQLite local (não versionado)
docs/                        Decisões e contratos de arquitetura
```

O `server.mjs` é apenas o ponto de entrada. Regra de negócio, persistência,
respostas HTTP e roteamento não devem voltar a ser acumulados nele.

## Convenção para novos formatos

Para adicionar, por exemplo, Feed quadrado ou frente e verso:

1. Crie uma página em `public/` e o módulo em
   `public/js/features/<formato>/`.
2. Registre a rota de página `/artes/<formato>`.
3. Reaproveite contratos comuns de produto, exportação e assets; mantenha a
   composição específica do formato isolada.
4. Se houver dados próprios, crie `src/modules/<formato>/` com serviço e
   rotas da API correspondentes.
5. Para frente e verso, modele uma arte como um documento com páginas
   ordenadas; cada página tem canvas, elementos e background próprios.

Essa regra evita que Stories conheça decisões de Feed, encarte ou publicação.

## Segurança e operação

- Variáveis de ambiente são lidas apenas na configuração do servidor.
- O acesso às páginas e aos dados exige sessão de usuário, com perfis administrador e cliente.
  `src/modules/users/` concentra usuários, senhas, sessões e controle de acesso.
  HTTP Basic é uma barreira adicional opcional, ativada com `APP_AUTH_ENABLED=true`.
  Consulte [Login, usuários e permissões](usuarios-e-permissoes.md).
- Tokens e chaves de integrações futuras nunca podem ir para `public/`.
- A entrega de arquivos estáticos usa resolução de caminho restrita, sem acesso
  arbitrário ao disco.
- A API valida entrada antes de escrever no SQLite.
- O banco local e seus arquivos WAL/SHM não são versionados e devem residir em
  storage persistente externo ao release.
- O serviço usa WAL e um tempo de espera curto para reduzir falhas por lock;
  em Plesk, mantenha uma única instância da aplicação enquanto usar SQLite.
- Integrações de publicação devem usar filas no servidor, estado persistido,
  tentativas idempotentes e logs de auditoria.

## Próximas fronteiras

- Persistir artes como rascunhos e versões.
- Criar uma camada de storage para exportações e assets.
- Criar uma fila de publicação para Instagram e outros canais.
- Introduzir migrations versionadas ao evoluir o schema além do catálogo atual.
