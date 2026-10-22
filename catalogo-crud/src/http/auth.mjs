import { timingSafeEqual } from 'node:crypto';
import { defaultSecurityHeaders } from './response.mjs';

function safeEqual(left, right) {
  const leftValue = Buffer.from(String(left), 'utf8');
  const rightValue = Buffer.from(String(right), 'utf8');
  return leftValue.length === rightValue.length && timingSafeEqual(leftValue, rightValue);
}

function readBasicCredentials(authorization) {
  if (typeof authorization !== 'string') return null;
  const match = /^Basic\s+([A-Za-z0-9+/]+={0,2})$/i.exec(authorization.trim());
  if (!match) return null;

  let decoded;
  try {
    decoded = Buffer.from(match[1], 'base64').toString('utf8');
  } catch {
    return null;
  }

  const separator = decoded.indexOf(':');
  if (separator < 1) return null;

  return {
    username: decoded.slice(0, separator),
    password: decoded.slice(separator + 1),
  };
}

export function isRequestAuthorized(request, auth) {
  if (!auth.enabled) return true;

  const credentials = readBasicCredentials(request.headers.authorization);
  return Boolean(
    credentials
      && safeEqual(credentials.username, auth.username)
      && safeEqual(credentials.password, auth.password),
  );
}

export function sendUnauthorized(response, auth) {
  const realm = String(auth.realm || 'Restricted').replace(/[\r\n"]/g, '') || 'Restricted';
  response.writeHead(401, {
    ...defaultSecurityHeaders,
    'Cache-Control': 'no-store',
    'Content-Length': '0',
    'WWW-Authenticate': `Basic realm="${realm}", charset="UTF-8"`,
  });
  response.end();
}
