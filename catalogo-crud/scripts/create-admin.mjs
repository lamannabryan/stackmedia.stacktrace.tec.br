import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { loadConfig } from '../src/config.mjs';
import { initializeCatalogDatabase } from '../src/database/catalog-database.mjs';
import { createUserService } from '../src/modules/users/user-service.mjs';

if (!process.stdin.isTTY) {
  console.error('Execute este comando em um terminal interativo. A senha não será exibida.');
  process.exitCode = 1;
} else {
  const database = await initializeCatalogDatabase(loadConfig());
  let muted = false;
  const output = new Writable({ write(chunk, encoding, callback) { if (!muted) process.stdout.write(chunk, encoding); callback(); } });
  const prompt = createInterface({ input: process.stdin, output, terminal: true });
  try {
    if (database.prepare('SELECT id FROM users LIMIT 1').get()) throw new Error('Já existem usuários. Use Conta > Gerenciar usuários para criar outras contas.');
    console.log('Criação do primeiro administrador do _stackmedia.');
    const name = await prompt.question('Nome: ');
    const email = await prompt.question('E-mail: ');
    process.stdout.write('Senha (10 a 128 caracteres; entrada oculta): '); muted = true;
    const password = await prompt.question('');
    muted = false; process.stdout.write('\nConfirme a senha: '); muted = true;
    const confirmation = await prompt.question('');
    muted = false; process.stdout.write('\n');
    if (password !== confirmation) throw new Error('As senhas não coincidem.');
    await createUserService({ database }).create({ name, email, password, role: 'administrador', active: true }, { firstAdminOnly: true });
    console.log('Administrador criado. Acesse /login para entrar.');
  } catch (error) { muted = false; console.error(`\n${error.message}`); process.exitCode = 1; }
  finally { prompt.close(); database.close(); }
}
