export const roleNames = Object.freeze({ cliente: 'Cliente', administrador: 'Administrador', superadministrador: 'Superadministrador' });

export function localDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function commercialPayload({ mode, limit, expires, expiration }, original = null) {
  const artwork_limit = mode === 'unlimited' ? null : Number(limit);
  if (!['unlimited', 'monthly', 'total'].includes(mode) || (mode !== 'unlimited'
    && (String(limit).trim() === '' || !Number.isSafeInteger(artwork_limit) || artwork_limit < 0))) {
    throw new Error('Informe um limite inteiro igual ou maior que zero.');
  }
  let access_expires_at = null;
  if (expires) {
    if (!expiration || !Number.isFinite(new Date(expiration).getTime())) throw new Error('Informe uma data e hora de expiração válidas.');
    access_expires_at = original?.access_expires_at && expiration === localDateTime(original.access_expires_at)
      ? original.access_expires_at : new Date(expiration).toISOString();
  }
  return { artwork_limit, artwork_limit_period: mode === 'unlimited' ? original?.artwork_limit_period || 'total' : mode, access_expires_at };
}

export function quotaDescription(quota) {
  const period = quota.artwork_limit_period === 'monthly' ? `no mês ${quota.period_month}` : 'no total';
  return `${quota.used} arte(s) registrada(s) ${period}. ${quota.remaining === null ? 'Saldo ilimitado.' : `${quota.remaining} disponível(is).`}
    ${quota.access_expired ? 'Acesso expirado.' : quota.remaining === 0 ? 'Limite atingido: novos logins bloqueados.' : ''}`.trim();
}
