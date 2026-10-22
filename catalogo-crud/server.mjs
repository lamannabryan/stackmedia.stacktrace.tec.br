import { createServer } from 'node:http';
import { createApplication } from './src/app.mjs';
import { loadConfig } from './src/config.mjs';
import { initializeCatalogDatabase } from './src/database/catalog-database.mjs';

const config = loadConfig();
const database = await initializeCatalogDatabase(config);
const requestHandler = createApplication({ config, database });
const server = createServer(requestHandler);

let shuttingDown = false;

server.keepAliveTimeout = 5_000;
server.headersTimeout = 10_000;
server.requestTimeout = 30_000;

server.on('error', (error) => {
  console.error('Erro no servidor HTTP:', error);
  if (!shuttingDown) process.exit(1);
});

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Encerrando servidor (${signal})...`);

  const forceExit = setTimeout(() => {
    console.error('Encerramento excedeu o tempo limite; finalizando o processo.');
    database.close();
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  server.close((error) => {
    clearTimeout(forceExit);
    database.close();
    if (error) {
      console.error(error);
      process.exit(1);
    }
    process.exit(0);
  });
}

server.listen(config.port, () => {
  console.log(`Catálogo CRUD disponível na porta ${config.port} (${config.environment}).`);
  if (!database.prepare('SELECT id FROM users LIMIT 1').get()) {
    console.log('Primeiro acesso: execute npm run users:create-admin para cadastrar o administrador.');
  }
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => shutdown(signal));
}
