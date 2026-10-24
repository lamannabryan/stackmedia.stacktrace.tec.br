const restrictionMessages = Object.freeze({
  ACCOUNT_INACTIVE: 'Sua conta está desativada. Entre em contato com o responsável pela conta para liberar o acesso.',
  ACCESS_EXPIRED: 'Seu acesso expirou. Entre em contato com o responsável pela conta para renovar a validade.',
  ARTWORK_LIMIT_REACHED: 'Seu limite de artes foi atingido. Aguarde a renovação mensal, se aplicável, ou entre em contato com o responsável pela conta.',
});
const unconfirmed = 'Não foi possível confirmar sua entrada. Tente novamente.';

export class LoginError extends Error {
  constructor(message, code = 'LOGIN_FAILED') {
    super(message);
    this.name = 'LoginError';
    this.code = code;
  }
}

// Credentials go only to this origin. The server alone decides whether to issue
// the HttpOnly cookie; no password, token or eligibility is stored by this module.
export async function requestLogin({ email, password }) {
  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST', mode: 'same-origin', credentials: 'same-origin',
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (response.redirected || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      throw new LoginError(unconfirmed);
    }
    let data;
    try { data = await response.json(); } catch { throw new LoginError(unconfirmed); }
    if (!response.ok) {
      if (response.status === 403 && Object.hasOwn(restrictionMessages, data?.code)) {
        throw new LoginError(restrictionMessages[data.code], data.code);
      }
      if (response.status === 401) throw new LoginError('E-mail ou senha inválidos.', 'INVALID_CREDENTIALS');
      if (response.status === 429) throw new LoginError('Muitas tentativas. Aguarde 15 minutos e tente novamente.', 'LOGIN_RATE_LIMITED');
      if (response.status >= 500) throw new LoginError('Serviço temporariamente indisponível. Tente novamente em instantes.');
      throw new LoginError('Não foi possível autorizar o acesso. Atualize a página e tente novamente.');
    }
    if (response.status !== 200 || !Number.isSafeInteger(data?.user?.id) || data.user.id < 1 || data.user.active !== true
      || !['superadministrador', 'administrador', 'cliente'].includes(data.user.role)
      || typeof data.csrfToken !== 'string' || !/^[a-f0-9]{64}$/.test(data.csrfToken)) {
      throw new LoginError(unconfirmed);
    }
    return data;
  } catch (error) {
    if (error instanceof LoginError) throw error;
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw new LoginError('O servidor demorou para responder. Tente novamente.', 'LOGIN_TIMEOUT');
    }
    throw new LoginError('Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.', 'LOGIN_NETWORK_ERROR');
  }
}
