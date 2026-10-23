import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(sourceDirectory, '..');

function getPort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : 3332;
}

function resolveConfiguredPath(value, fallback) {
  const configuredValue = String(value || '').trim();
  if (!configuredValue) return path.resolve(fallback);
  return path.isAbsolute(configuredValue)
    ? path.normalize(configuredValue)
    : path.resolve(projectDirectory, configuredValue);
}

function getBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;

  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  throw new Error('APP_AUTH_ENABLED deve ser true ou false.');
}

function getAuthConfig(env) {
  const enabled = getBoolean(env.APP_AUTH_ENABLED, false);
  const username = String(env.APP_AUTH_USERNAME || '').trim();
  const password = String(env.APP_AUTH_PASSWORD || '');

  if (enabled && (!username || !password)) {
    throw new Error(
      'Defina APP_AUTH_USERNAME e APP_AUTH_PASSWORD quando APP_AUTH_ENABLED=true.',
    );
  }

  return Object.freeze({
    enabled,
    username,
    password,
    realm: '_stackmedia',
  });
}

/**
 * Centralizes paths and runtime options so modules do not need to read process.env.
 * Passing a different env object also makes the application easier to exercise in tests.
 */
export function loadConfig(env = process.env) {
  const environment = String(env.NODE_ENV || 'development').trim().toLowerCase();
  const storageDirectory = resolveConfiguredPath(
    env.CATALOG_STORAGE_ROOT,
    path.join(projectDirectory, 'data'),
  );
  const databasePath = resolveConfiguredPath(
    env.CATALOG_DATABASE_PATH,
    path.join(storageDirectory, 'catalogo.sqlite'),
  );

  return Object.freeze({
    projectDirectory,
    environment,
    publicDirectory: path.join(projectDirectory, 'public'),
    storageDirectory,
    dataDirectory: path.dirname(databasePath),
    databasePath,
    storyBackgroundsDirectory: resolveConfiguredPath(
      env.STORY_BACKGROUNDS_ROOT,
      path.join(projectDirectory, 'camas-stories'),
    ),
    feedBackgroundsDirectory: resolveConfiguredPath(
      env.FEED_BACKGROUNDS_ROOT,
      path.join(projectDirectory, 'camas-feed'),
    ),
    encarteBackgroundsDirectory: resolveConfiguredPath(
      env.ENCARTE_BACKGROUNDS_ROOT,
      path.join(projectDirectory, 'camas-encarte'),
    ),
    indoorBackgroundsDirectory: resolveConfiguredPath(
      env.INDOOR_BACKGROUNDS_ROOT,
      path.join(projectDirectory, 'camas-indoor-h'),
    ),
    sourceCatalogPath: resolveConfiguredPath(
      env.CATALOG_SOURCE,
      path.join(projectDirectory, '..', 'produtos.json'),
    ),
    sourceManifestPath: resolveConfiguredPath(
      env.MANIFEST_SOURCE,
      path.join(projectDirectory, '..', 'imagens-produtos', 'manifesto-imagens.json'),
    ),
    imagesDirectory: resolveConfiguredPath(
      env.IMAGES_ROOT,
      path.join(projectDirectory, '..', 'imagens-produtos'),
    ),
    port: getPort(env.PORT || env.CATALOGO_PORT),
    serpApiKey: String(env.SERPAPI_API_KEY || '').trim(),
    deepseek: Object.freeze({
      apiKey: String(env.DEEPSEEK_API_KEY || '').trim(),
      model: String(env.DEEPSEEK_MODEL || 'deepseek-flash').trim(),
    }),
    auth: getAuthConfig(env),
  });
}
