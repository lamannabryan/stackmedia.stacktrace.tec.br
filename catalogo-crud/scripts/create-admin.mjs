import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { loadConfig } from '../src/config.mjs';
import { initializeCatalogDatabase } from '../src/database/catalog-database.mjs';
import { createUserService } from '../src/modules/users/user-service.mjs';

const bootstrapKeys = ['BOOTSTRAP_ADMIN_NAME', 'BOOTSTRAP_ADMIN_EMAIL', 'BOOTSTRAP_ADMIN_PASSWORD'];
const fromEnvironment = bootstrapKeys.some((key) => process.env[key] !== undefined);
const superAdmin = process.argv.includes('--super-admin');
const role = superAdmin ? 'superadministrador' : 'administrador';
const label = superAdmin ? 'Superadministrador' : 'Administrador';
const createOptions = superAdmin ? { firstSuperAdminOnly: true } : { firstAdminOnly: true };

if (fromEnvironment) {
  let database;
  try {
    if (bootstrapKeys.some((key) => !process.env[key])) {
      throw new Error('Defina BOOTSTRAP_ADMIN_NAME, BOOTSTRAP_ADMIN_EMAIL e BOOTSTRAP_ADMIN_PASSWORD para criar o administrador sem terminal interativo.');
    }
    const config = loadConfig();
    database = await initializeCatalogDatabase(config);
    console.log(`Banco de dados: ${config.databasePath}`);
    await createUserService({ database }).create({
      name: process.env.BOOTSTRAP_ADMIN_NAME,
      email: process.env.BOOTSTRAP_ADMIN_EMAIL,
      password: process.env.BOOTSTRAP_ADMIN_PASSWORD,
      role,
      active: true,
    }, createOptions);
    console.log(`${label} criado. Acesse /login para entrar. Remova as variáveis BOOTSTRAP_ADMIN_* da hospedagem.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    database?.close();
  }
} else if (!process.stdin.isTTY) {
  console.error('Sem terminal interativo: defina BOOTSTRAP_ADMIN_NAME, BOOTSTRAP_ADMIN_EMAIL e BOOTSTRAP_ADMIN_PASSWORD e execute novamente.');
  process.exitCode = 1;
} else {
  const database = await initializeCatalogDatabase(loadConfig());
  let muted = false;
  const output = new Writable({ write(chunk, encoding, callback) { if (!muted) process.stdout.write(chunk, encoding); callback(); } });
  const prompt = createInterface({ input: process.stdin, output, terminal: true });
  try {
    if (superAdmin ? database.prepare("SELECT id FROM users WHERE role = 'superadministrador' LIMIT 1").get()
      : database.prepare('SELECT id FROM users LIMIT 1').get()) throw new Error(`Já existe ${role}. Use a gestão de usuários para criar outras contas.`);
    console.log(`Criação do primeiro ${role} do _stackmedia.`);
    const name = await prompt.question('Nome: ');
    const email = await prompt.question('E-mail: ');
    process.stdout.write('Senha (10 a 128 caracteres; entrada oculta): '); muted = true;
    const password = await prompt.question('');
    muted = false; process.stdout.write('\nConfirme a senha: '); muted = true;
    const confirmation = await prompt.question('');
    muted = false; process.stdout.write('\n');
    if (password !== confirmation) throw new Error('As senhas não coincidem.');
    await createUserService({ database }).create({ name, email, password, role, active: true }, createOptions);
    console.log(`${label} criado. Acesse /login para entrar.`);
  } catch (error) { muted = false; console.error(`\n${error.message}`); process.exitCode = 1; }
  finally { prompt.close(); database.close(); }
}
