import { createReadStream, existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { defaultSecurityHeaders, sendError } from './response.mjs';
import { fileVersion } from './file-version.mjs';

const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
  ['.svg', 'image/svg+xml'],
  ['.ico', 'image/x-icon'],
  ['.woff2', 'font/woff2'],
  ['.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
]);

function acceptsGzip(header = '') {
  const encodings = String(header).toLowerCase().split(',').map((entry) => {
    const [name, ...parameters] = entry.trim().split(';');
    const quality = parameters.find((parameter) => parameter.trim().startsWith('q='));
    return [name.trim(), quality === undefined ? 1 : Number(quality.trim().slice(2))];
  });
  const match = encodings.find(([name]) => name === 'gzip')
    || encodings.find(([name]) => name === '*');
  return Boolean(match && match[1] > 0 && match[1] <= 1);
}

export function fileExists(filePath) {
  return existsSync(filePath);
}

export function resolveStaticFile(rootDirectory, urlPath) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(urlPath);
  } catch {
    return null;
  }

  const pieces = decodedPath.split('/').filter(Boolean);
  if (pieces.some((piece) => (
    piece === '.'
    || piece === '..'
    || piece.startsWith('.')
    || piece.includes('\\')
  ))) {
    return null;
  }

  const candidate = path.resolve(rootDirectory, ...pieces);
  const rootPrefix = `${rootDirectory}${path.sep}`;
  if (candidate !== rootDirectory && !candidate.startsWith(rootPrefix)) {
    return null;
  }
  return candidate;
}

export async function serveFile({ request, response, rootDirectory, urlPath, cacheControl = 'no-store', versioned = false, cacheVersion }) {
  const filePath = resolveStaticFile(rootDirectory, urlPath);
  if (!filePath) {
    sendError(response, 403, 'Caminho não permitido.');
    return;
  }

  try {
    const info = await fs.stat(filePath);
    if (!info.isFile()) {
      sendError(response, 404, 'Arquivo não encontrado.');
      return;
    }

    const contentType = mimeTypes.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream';
    const compressible = info.size >= 1024
      && /^(?:text\/|application\/(?:json|manifest\+json)|image\/svg\+xml)/.test(contentType);
    const compressed = compressible && acceptsGzip(request.headers['accept-encoding']);
    const version = cacheVersion || fileVersion(info);
    const etag = `W/"${version}"`;
    const requestedVersion = new URL(request.url, 'http://localhost').searchParams.get('v');
    const headers = {
      ...defaultSecurityHeaders,
      'Content-Type': contentType,
      'Cache-Control': versioned && requestedVersion === version
        ? 'private, max-age=31536000, immutable' : cacheControl,
      ETag: etag,
      'Last-Modified': info.mtime.toUTCString(),
      ...(compressible ? { Vary: 'Accept-Encoding' } : {}),
      ...(compressed ? { 'Content-Encoding': 'gzip' } : {}),
    };
    const matches = request.headers['if-none-match']?.split(',').some((tag) => (
      tag.trim() === '*' || tag.trim().replace(/^W\//, '') === etag.replace(/^W\//, '')
    ));
    if (headers['Cache-Control'] !== 'no-store' && matches) {
      response.writeHead(304, headers);
      response.end();
      return;
    }
    response.writeHead(200, { ...headers, ...(!compressed ? { 'Content-Length': info.size } : {}) });

    if (request.method === 'HEAD') {
      response.end();
      return;
    }

    if (compressed) await pipeline(createReadStream(filePath), createGzip(), response);
    else await pipeline(createReadStream(filePath), response);
  } catch (error) {
    if (error.code === 'ENOENT') {
      sendError(response, 404, 'Arquivo não encontrado.');
      return;
    }
    throw error;
  }
}
