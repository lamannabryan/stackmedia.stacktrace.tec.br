import { badRequest, HttpError } from '../../http/errors.mjs';
import { accessExpired } from '../users/permissions.mjs';

const monthFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' });
export function artworkMonth(date) {
  const parts = monthFormatter.formatToParts(date);
  return `${parts.find(part => part.type === 'year').value}-${parts.find(part => part.type === 'month').value}`;
}

export function createArtworkService({ database, now = Date.now }) {
  function account(id) {
    const user = database.prepare('SELECT id, active, access_expires_at, artwork_limit, artwork_limit_period FROM users WHERE id = ?').get(id);
    if (!user) throw new HttpError(404, 'Usuário não encontrado.');
    return user;
  }
  function summary(user, time) {
    const month = artworkMonth(new Date(time));
    const monthly = user.artwork_limit_period === 'monthly';
    const used = database.prepare(`SELECT COUNT(*) AS total FROM artwork_generations WHERE user_id = ?${monthly ? ' AND period_month = ?' : ''}`)
      .get(...(monthly ? [user.id, month] : [user.id])).total;
    const remaining = user.artwork_limit === null ? null : Math.max(0, user.artwork_limit - used);
    const expired = accessExpired(user, time);
    return { user_id: user.id, access_expires_at: user.access_expires_at, access_expired: expired,
      artwork_limit: user.artwork_limit, artwork_limit_period: user.artwork_limit_period,
      period_month: monthly ? month : null, used, remaining,
      can_generate: Boolean(user.active) && !expired && (remaining === null || remaining > 0) };
  }
  function quota(userId) {
    return summary(account(userId), now());
  }
  function generate(userId, payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)
      || Object.keys(payload).some(key => !['idempotency_key', 'format', 'output'].includes(key))) {
      throw badRequest('Informe idempotency_key, format e output. O usuário é identificado pela sessão.');
    }
    const { idempotency_key, format, output } = payload;
    if (typeof idempotency_key !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(idempotency_key)) {
      throw badRequest('idempotency_key deve conter de 8 a 128 letras, números, hífens ou sublinhados.');
    }
    if (!['stories', 'feed', 'encarte', 'indoor-h'].includes(format) || !['png', 'mp4'].includes(output)
      || (format === 'indoor-h' && output !== 'mp4')) throw badRequest('Formato ou saída de arte inválidos.');
    // Serialize the check and insert across connections/processes. An attempt
    // never consumes quota on validation failure or when the transaction fails.
    database.exec('BEGIN IMMEDIATE');
    try {
      const time = now();
      const user = account(userId);
      if (!user.active) throw new HttpError(403, 'Conta inativa.');
      if (accessExpired(user, time)) throw new HttpError(403, 'O acesso desta conta expirou.');
      const previous = database.prepare('SELECT * FROM artwork_generations WHERE user_id = ? AND idempotency_key = ?').get(userId, idempotency_key);
      if (previous) {
        if (previous.format !== format || previous.output !== output) throw new HttpError(409, 'Esta idempotency_key já foi usada para outra geração.');
        const result = { generation: { ...previous }, replayed: true, quota: summary(user, time) };
        database.exec('COMMIT');
        return result;
      }
      if (!summary(user, time).can_generate) throw new HttpError(403, 'Limite de artes atingido para este período.');
      const createdAt = new Date(time).toISOString();
      const month = artworkMonth(new Date(time));
      const insert = database.prepare(`INSERT INTO artwork_generations (user_id, idempotency_key, format, output, period_month, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`).run(userId, idempotency_key, format, output, month, createdAt);
      const generation = { id: Number(insert.lastInsertRowid), user_id: userId, idempotency_key, format, output, period_month: month, created_at: createdAt };
      const result = { generation, replayed: false, quota: summary(user, time) };
      database.exec('COMMIT');
      return result;
    } catch (error) { database.exec('ROLLBACK'); throw error; }
  }
  return { quota, generate };
}
