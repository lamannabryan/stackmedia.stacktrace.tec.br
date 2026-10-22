import { badRequest } from './errors.mjs';
import { createHash } from 'node:crypto';

export const defaultSecurityHeaders = Object.freeze({
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'SAMEORIGIN',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(self), geolocation=(), microphone=(), payment=(), usb=()',
  'Content-Security-Policy': [
    "default-src 'self'",
    "base-uri 'self'",
    "connect-src 'self'",
    "font-src 'self' https://cdnjs.cloudflare.com data:",
    "form-action 'self'",
    "frame-ancestors 'self'",
    "img-src 'self' blob: data:",
    "media-src 'self' blob:",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self' https://cdnjs.cloudflare.com",
  ].join('; '),
});

export function sendJson(response, statusCode, body) {
  const payload = `${JSON.stringify(body)}\n`;
  response.writeHead(statusCode, {
    ...defaultSecurityHeaders,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  response.end(payload);
}

// The browser keeps the manifest, but checks for additions/replacements on each visit.
export function sendRevalidatedJson(request, response, body) {
  const payload = `${JSON.stringify(body)}\n`;
  const etag = `"${createHash('sha256').update(payload).digest('hex')}"`;
  const unchanged = request.headers['if-none-match']?.split(',').some((tag) => (
    tag.trim() === '*' || tag.trim().replace(/^W\//, '') === etag
  ));
  response.writeHead(unchanged ? 304 : 200, {
    ...defaultSecurityHeaders,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'private, no-cache',
    ETag: etag,
    ...(!unchanged ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
  });
  response.end(unchanged ? undefined : payload);
}

export function sendError(response, statusCode, message) {
  sendJson(response, statusCode, { error: message });
}

export function sendNoContent(response) {
  response.writeHead(204, defaultSecurityHeaders);
  response.end();
}

export async function readJsonBody(request, { maxBytes = 1_000_000 } = {}) {
  const contentType = String(request.headers['content-type'] || '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase();
  if (contentType !== 'application/json') {
    throw badRequest('O corpo da requisição precisa usar Content-Type application/json.');
  }

  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) {
      throw badRequest(`O corpo da requisição excede ${Math.round(maxBytes / 1_000_000)} MB.`);
    }
    chunks.push(chunk);
  }

  if (size === 0) return {};

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw badRequest('O corpo da requisição precisa ser um JSON válido.');
  }
}
