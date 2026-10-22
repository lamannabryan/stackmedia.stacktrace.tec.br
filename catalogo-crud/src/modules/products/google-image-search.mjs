import { randomUUID } from 'node:crypto';
import { resolve4 } from 'node:dns/promises';
import https from 'node:https';
import { BlockList, isIP } from 'node:net';
import sharp from 'sharp';
import { badRequest, HttpError } from '../../http/errors.mjs';

const blocked = new BlockList();
for (const [address, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3]]) {
  blocked.addSubnet(address, prefix, 'ipv4');
}
export function isPublicImageAddress(address) {
  return isIP(address) === 4 && !blocked.check(address, 'ipv4');
}

// Resolve once and pin the connection to a public IPv4 address, including every redirect.
// No cookies, authorization headers, arbitrary ports or internal-network destinations.
export async function downloadPublicImage(value, { maxBytes = 8 * 1024 * 1024, redirects = 3,
  signal = AbortSignal.timeout(12_000), resolve = resolve4, request = https.get } = {}) {
  const url = new URL(value);
  signal.throwIfAborted();
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) throw new Error('Unsafe URL');
  const addresses = isIP(url.hostname) ? [url.hostname] : await Promise.race([
    resolve(url.hostname), new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(new Error('DNS timeout')), { once: true });
    }),
  ]);
  signal.throwIfAborted();
  if (!addresses.length || addresses.some(address => !isPublicImageAddress(address))) throw new Error('Unsafe address');
  return new Promise((resolveResult, reject) => {
    const req = request(url, { agent: false, family: 4, signal,
      lookup: (_host, options, callback) => options.all
        ? callback(null, [{ address: addresses[0], family: 4 }]) : callback(null, addresses[0], 4),
      headers: { Accept: 'image/png,image/jpeg,image/webp', 'User-Agent': 'Stackmedia-ProductImages/1.0' },
    }, response => {
      response.on('error', reject);
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.destroy();
        if (!redirects || !response.headers.location) return reject(new Error('Invalid redirect'));
        let next;
        try { next = new URL(response.headers.location, url).href; } catch (error) { reject(error); return; }
        resolveResult(downloadPublicImage(next, { maxBytes, redirects: redirects - 1, signal, resolve, request }));
        return;
      }
      if (response.statusCode !== 200 || Number(response.headers['content-length']) > maxBytes) {
        response.destroy(); reject(new Error('Image unavailable')); return;
      }
      const chunks = [];
      let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > maxBytes) { response.destroy(); reject(new Error('Image too large')); }
        else chunks.push(chunk);
      });
      response.on('end', () => resolveResult(Buffer.concat(chunks)));
    });
    req.on('error', reject);
  });
}

const unavailable = message => new HttpError(503, message, { expose: true });
const TTL = 10 * 60_000;
export function createGoogleImageSearch({ apiKey, fetchImpl = fetch, download = downloadPublicImage, now = Date.now } = {}) {
  const tokens = new Map(), cache = new Map(), requests = new Map();
  let active = 0;
  function prune() {
    for (const map of [tokens, cache, requests]) {
      for (const [key, entry] of map) if (entry.expires <= now()) map.delete(key);
    }
  }
  async function search(ean, owner) {
    if (!/^(?:\d{8}|\d{12,14})$/.test(ean)) throw badRequest('Informe um EAN de 8, 12, 13 ou 14 dígitos.');
    if (!apiKey) throw unavailable('Busca automática não configurada. O administrador deve definir SERPAPI_API_KEY no servidor.');
    prune();
    const key = `${owner}:${ean}`;
    if (cache.has(key)) return cache.get(key).items;
    const rate = requests.get(owner) || { count: 0, expires: now() + 60_000 };
    if (rate.count >= 6 || active >= 3) throw new HttpError(429, 'Aguarde um minuto antes de buscar novamente.');
    if (requests.size >= 1000 && !requests.has(owner)) throw unavailable('Busca ocupada. Tente novamente em um minuto.');
    rate.count++; requests.set(owner, rate); active++;
    try {
      const url = new URL('https://serpapi.com/search.json');
      url.search = new URLSearchParams({ engine: 'google_images', q: ean, hl: 'pt', gl: 'br', api_key: apiKey }).toString();
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(20_000), redirect: 'error' });
      if (!response.ok) throw unavailable('Não foi possível consultar o Google Imagens. Verifique a chave e a cota da SerpApi.');
      const data = await response.json();
      if (data.error) throw unavailable('O provedor não concluiu a busca. Verifique a chave e a cota da SerpApi.');
      if (!Array.isArray(data.images_results) && data.search_information?.image_results_state !== 'Fully empty') {
        throw unavailable('O provedor retornou uma resposta inesperada. Tente novamente.');
      }
      const items = await Promise.all((data.images_results || []).slice(0, 3).map(async (result, index) => {
        const item = { position: index + 1, title: String(result.title || `Opção ${index + 1}`).slice(0, 180),
          source: String(result.source || '').slice(0, 120), preview: null, token: null };
        try {
          const original = new URL(result.original);
          if (original.protocol !== 'https:' || original.username || original.password || (original.port && original.port !== '443')) return item;
          const bytes = await download(result.thumbnail || original.href, { maxBytes: 2 * 1024 * 1024 });
          const preview = await sharp(bytes, { limitInputPixels: 25_000_000 }).resize(280, 280, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
          item.preview = `data:image/webp;base64,${preview.toString('base64')}`;
          item.token = randomUUID();
          tokens.set(item.token, { owner, ean, original: original.href, expires: now() + TTL });
        } catch { /* Keep the original Google ranking, marking this option unavailable. */ }
        return item;
      }));
      cache.set(key, { items, expires: now() + TTL });
      while (cache.size > 100) cache.delete(cache.keys().next().value);
      while (tokens.size > 300) tokens.delete(tokens.keys().next().value);
      return items;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw unavailable('A busca demorou demais ou está indisponível. Tente novamente.');
    } finally { active--; }
  }
  async function resolveSelection(token, ean, owner) {
    prune();
    const entry = tokens.get(token);
    if (!entry || entry.owner !== owner || entry.ean !== ean) throw badRequest('Seleção inválida ou expirada. Busque as imagens novamente.');
    try { return await download(entry.original); }
    catch { throw unavailable('Não foi possível baixar a imagem escolhida. Selecione outra opção ou carregue um arquivo.'); }
  }
  return { search, resolveSelection };
}
