import { badRequest } from '../../http/errors.mjs';

export const COMMERCIAL_FIELDS = Object.freeze(['access_expires_at', 'artwork_limit', 'artwork_limit_period']);

function expiration(value) {
  if (value === null) return null;
  // Require an explicit timezone and reject normalized impossible calendar dates.
  const match = typeof value === 'string' && value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/);
  const time = match ? Date.parse(value) : NaN;
  if (!match || !Number.isFinite(time) || Number(match[2]) > 23 || Number(match[3]) > 59
    || Number(match[4]) > 59 || new Date(`${match[1]}T00:00:00Z`).toISOString().slice(0, 10) !== match[1]) {
    throw badRequest('Informe access_expires_at como data e hora ISO 8601 com fuso horário, ou null.');
  }
  return new Date(time).toISOString();
}

export function commercialPolicy(payload, current = {}) {
  const access_expires_at = payload.access_expires_at === undefined
    ? current.access_expires_at ?? null : expiration(payload.access_expires_at);
  const artwork_limit = payload.artwork_limit === undefined ? current.artwork_limit ?? null : payload.artwork_limit;
  const artwork_limit_period = payload.artwork_limit_period === undefined
    ? current.artwork_limit_period ?? 'total' : payload.artwork_limit_period;
  if (artwork_limit !== null && (!Number.isSafeInteger(artwork_limit) || artwork_limit < 0)) {
    throw badRequest('artwork_limit deve ser um inteiro não negativo ou null para ilimitado.');
  }
  if (!['monthly', 'total'].includes(artwork_limit_period)) {
    throw badRequest('artwork_limit_period deve ser monthly ou total.');
  }
  return { access_expires_at, artwork_limit, artwork_limit_period };
}
