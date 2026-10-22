import { createReadStream, existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
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
    };
    const matches = request.headers['if-none-match']?.split(',').some((tag) => (
      tag.trim() === '*' || tag.trim().replace(/^W\//, '') === etag.replace(/^W\//, '')
    ));
    if (headers['Cache-Control'] !== 'no-store' && matches) {
      response.writeHead(304, headers);
      response.end();
      return;
    }
    response.writeHead(200, { ...headers, 'Content-Length': info.size });

    if (request.method === 'HEAD') {
      response.end();
      return;
    }

    createReadStream(filePath).pipe(response);
  } catch (error) {
    if (error.code === 'ENOENT') {
      sendError(response, 404, 'Arquivo não encontrado.');
      return;
    }
    throw error;
  }
}
