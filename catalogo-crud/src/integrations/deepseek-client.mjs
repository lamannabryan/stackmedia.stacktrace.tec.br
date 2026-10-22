import { HttpError } from '../http/errors.mjs';

const unavailable = message => new HttpError(503, message, { expose: true });

// Shared server-only adapter for DeepSeek integrations. No caller-controlled endpoints.
export function createDeepSeekClient({ apiKey, model = 'deepseek-flash', fetchImpl = fetch } = {}) {
  function requireConfigured() {
    if (!apiKey) throw unavailable('IA não configurada. O administrador deve definir DEEPSEEK_API_KEY no servidor.');
  }
  async function post(endpoint, body, signal) {
    requireConfigured();
    try {
      const response = await fetchImpl(`https://api.deepseek.com${endpoint}`, {
        method: 'POST', redirect: 'error', signal,
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        await response.body?.cancel();
        if ([401, 403].includes(response.status)) throw unavailable('A DeepSeek recusou o acesso. Peça ao administrador para verificar a chave e as permissões da API.');
        if (response.status === 402) throw unavailable('Saldo insuficiente na DeepSeek. Peça ao administrador para verificar a conta.');
        if (response.status === 429) throw new HttpError(429, 'A DeepSeek atingiu o limite de consultas. Aguarde um minuto e tente novamente.');
        throw unavailable('A consulta à DeepSeek está indisponível. Tente novamente mais tarde.');
      }
      const chunks = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) throw unavailable('A resposta da DeepSeek excedeu o limite permitido.');
        chunks.push(Buffer.from(chunk));
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch (error) {
      if (error instanceof HttpError) throw error;
      // Never expose provider errors, headers, prompts or credentials to logs/UI.
      throw unavailable('Não foi possível concluir a consulta à DeepSeek. Tente novamente em alguns instantes.');
    }
  }
  return {
    requireConfigured,
    search: (ean, signal, { manufacturer = false } = {}) => post('/v1/tools/search', {
      query: manufacturer ? `"${ean}" (fabricante OR laboratório OR "fabricado por" OR manufacturer)` : `"${ean}"`,
      count: 5, need_content: true,
    }, signal),
    extract: (messages, signal) => post('/chat/completions', { model, messages, stream: false,
      thinking: { type: 'disabled' }, response_format: { type: 'json_object' }, max_tokens: 1400 }, signal),
  };
}
