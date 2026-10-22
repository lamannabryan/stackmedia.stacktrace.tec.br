import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeepSeekClient } from '../src/integrations/deepseek-client.mjs';
import { createProductAiService, normalizeProductEan, parseProductExtraction } from '../src/modules/products/product-ai-service.mjs';
import { loadConfig } from '../src/config.mjs';

const ean = '3017620422003';
const content = `EAN ${ean}. Produto Exemplo. Apresentação: 30 cápsulas. Fabricante: Laboratório Exemplo.`;
const source = { id: 1, title: 'Produto Exemplo', url: 'https://example.com/product', content };
const extracted = { ean, encontrado: true, campos: {
  nome: { valor: 'Produto Exemplo', fonte: 1, trecho: 'Produto Exemplo.' },
  subtitulo: { valor: '30 cápsulas', fonte: 1, trecho: 'Apresentação: 30 cápsulas.' },
  fabricante: { valor: 'Laboratório Exemplo', fonte: 1, trecho: 'Fabricante: Laboratório Exemplo.' },
} };
const completion = (data = extracted) => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(data) } }] });
function fixture({ now, searchResults = [source], response = completion(), fetchError, status = 200 } = {}) {
  const calls = [];
  const client = createDeepSeekClient({ apiKey: 'test-deepseek-secret', fetchImpl: async (url, options) => {
    calls.push({ url, ...options, body: JSON.parse(options.body) });
    if (fetchError) throw fetchError;
    return Response.json(url.endsWith('/search') ? { results: searchResults } : response, { status });
  } });
  return { calls, client, service: createProductAiService({ client, now }) };
}

test('DeepSeek searches by exact EAN and extracts evidence-backed fields using server-side credentials', async () => {
  const f = fixture();
  const result = await f.service.lookup('301 7620 422003', 1);
  assert.deepEqual(result.campos, { nome: 'Produto Exemplo', subtitulo: '30 cápsulas', fabricante: 'Laboratório Exemplo' });
  assert.equal(result.encontrado, true);
  assert.equal(result.fontes[0].url, source.url);
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].url, 'https://api.deepseek.com/v1/tools/search');
  assert.deepEqual(f.calls[0].body, { query: `"${ean}"`, count: 5, need_content: true });
  assert.equal(f.calls[1].url, 'https://api.deepseek.com/chat/completions');
  assert.equal(f.calls[1].body.model, 'deepseek-flash');
  assert.equal(f.calls[1].body.response_format.type, 'json_object');
  assert.equal(f.calls[1].body.thinking.type, 'disabled');
  assert.equal(f.calls[1].headers.Authorization, 'Bearer test-deepseek-secret');
  assert.equal(f.calls[1].redirect, 'error');
  assert.equal(f.calls[0].signal, f.calls[1].signal);
  assert.ok(!JSON.stringify(result).includes('test-deepseek-secret'));
  assert.equal(loadConfig({ DEEPSEEK_MODEL: 'deepseek-v4-pro', DEEPSEEK_API_KEY: ' secret ' }).deepseek.apiKey, 'secret');
});

test('invalid EAN/check digit and missing credentials are rejected without upstream calls', async () => {
  const f = fixture();
  for (const value of [null, 3017620422003, 'invalid', '123', '00000000', '3017620422004', '3017620422003ignore']) {
    await assert.rejects(f.service.lookup(value, 1), error => error.statusCode === 400);
  }
  assert.equal(f.calls.length, 0);
  assert.equal(normalizeProductEan('96385074'), '96385074');
  assert.equal(normalizeProductEan('036000291452'), '036000291452');
  await assert.rejects(createProductAiService({ client: createDeepSeekClient() }).lookup(ean, 1), /DEEPSEEK_API_KEY/);
});

test('empty results, other EANs, invalid URLs and ambiguous products do not produce invented data', async () => {
  for (const searchResults of [[], [{ ...source, content: 'Outro produto 1234567890123' }], [{ ...source, url: 'javascript:alert(1)' }]]) {
    const f = fixture({ searchResults });
    assert.equal((await f.service.lookup(ean, 1)).encontrado, false);
    assert.equal(f.calls.length, 2);
  }
  const f = fixture({ response: completion({ ...extracted, encontrado: false }) });
  assert.deepEqual((await f.service.lookup(ean, 1)).campos, { nome: null, subtitulo: null, fabricante: null });
});

test('fields without literal evidence or known sources are dropped; manufacturer is not inferred from a brand', () => {
  const data = structuredClone(extracted);
  data.campos.nome.valor = 'Invented name';
  data.campos.subtitulo.fonte = 999;
  data.campos.fabricante = { valor: 'Produto Exemplo', fonte: 1, trecho: 'Produto Exemplo.' };
  const result = parseProductExtraction(completion(data), ean, [source]);
  assert.deepEqual(result.campos, { nome: null, subtitulo: null, fabricante: null });
  assert.deepEqual(result.fontes, []);
  data.campos.nome = extracted.campos.nome;
  data.status = 'ativo'; data.campos.status = 'ativo';
  const partial = parseProductExtraction(completion(data), ean, [source]);
  assert.equal(partial.campos.nome, 'Produto Exemplo');
  assert.equal('status' in partial, false);
  assert.equal('status' in partial.campos, false);
});

test('malformed JSON, mismatched EAN, truncated responses and invalid search structures are rejected', async () => {
  for (const response of [{}, { choices: [{ finish_reason: 'length', message: { content: '{}' } }] },
    { choices: [{ finish_reason: 'stop', message: { content: 'not json' } }] }, completion({ ...extracted, ean: 'other' }), completion({ ...extracted, campos: [] })]) {
    const f = fixture({ response });
    await assert.rejects(f.service.lookup(ean, 1), error => error.statusCode === 502);
  }
  await assert.rejects(fixture({ searchResults: null }).service.lookup(ean, 1), error => error.statusCode === 502);
});

test('provider failures have safe messages and are not cached', async () => {
  for (const status of [401, 402, 403, 429, 500]) {
    const f = fixture({ status });
    await assert.rejects(f.service.lookup(ean, 1), error => error.statusCode === (status === 429 ? 429 : 503));
    await assert.rejects(f.service.lookup(ean, 1));
    assert.equal(f.calls.length, 2);
  }
  const f = fixture({ fetchError: new Error('secret credential test-deepseek-secret') });
  await assert.rejects(f.service.lookup(ean, 1), error => error.statusCode === 503 && !error.message.includes('secret'));
});

test('cache and in-flight deduplication avoid repeat charges and expire after ten minutes', async () => {
  let time = 0;
  const f = fixture({ now: () => time });
  const results = await Promise.all([f.service.lookup(ean, 1), f.service.lookup(ean, 1)]);
  assert.deepEqual(results[0], results[1]); assert.equal(f.calls.length, 2);
  await f.service.lookup(ean, 1); assert.equal(f.calls.length, 2);
  await f.service.lookup(ean, 2); assert.equal(f.calls.length, 4);
  time += 600_001;
  await f.service.lookup(ean, 1); assert.equal(f.calls.length, 6);
});

test('per-user rate limits and global concurrency limit are enforced', async () => {
  const f = fixture({ status: 500 });
  for (let i = 0; i < 6; i++) await assert.rejects(f.service.lookup(ean, 1));
  await assert.rejects(f.service.lookup(ean, 1), error => error.statusCode === 429);
  assert.equal(f.calls.length, 6);
  const resolvers = [];
  const service = createProductAiService({ client: { requireConfigured() {}, search: (_ean, _signal, options) =>
    options?.manufacturer ? Promise.resolve({ results: [] }) : new Promise(resolve => resolvers.push(resolve)) } });
  const pending = [1, 2, 3].map(owner => service.lookup(ean, owner));
  await assert.rejects(service.lookup(ean, 4), error => error.statusCode === 429);
  resolvers.forEach(resolve => resolve({ results: [] }));
  await Promise.all(pending);
  assert.equal((await f.service.lookup(ean, 1).catch(error => error)).statusCode, 429);
});

test('DeepSeek timeout and oversized responses fail safely', async () => {
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    const client = createDeepSeekClient({ apiKey: 'test', fetchImpl: (_url, { signal }) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }) });
    await assert.rejects(createProductAiService({ client, timeoutMs: 5 }).lookup(ean, 1), error => error.statusCode === 503);
  } finally { clearTimeout(keepAlive); }
  const client = createDeepSeekClient({ apiKey: 'test', fetchImpl: async () => new Response('x'.repeat(2 * 1024 * 1024 + 1)) });
  await assert.rejects(client.search(ean, AbortSignal.timeout(1000)), /limite permitido/);
});

test('missing manufacturer triggers a targeted search and combines literal evidence from the same EAN', async () => {
  const calls = [];
  const initial = { ...source, content: `EAN ${ean}. Produto Exemplo. Apresentação: 30 cápsulas.` };
  const technical = { url: 'https://example.com/technical', title: 'Ficha técnica', content: `EAN ${ean}. Fabricado\npor: Empresa Exemplo.` };
  const client = createDeepSeekClient({ apiKey: 'test', fetchImpl: async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, body, signal: options.signal });
    if (url.endsWith('/search')) return Response.json({ results: body.query.includes('fabricante') ? [technical] : [initial] });
    const data = structuredClone(extracted);
    data.campos.fabricante = calls.length === 2 ? null
      : { valor: 'Empresa Exemplo', fonte: 2, trecho: 'Fabricado\npor: Empresa Exemplo.' };
    return Response.json(completion(data));
  } });
  const result = await createProductAiService({ client }).lookup(ean, 1);
  assert.equal(result.campos.fabricante, 'Empresa Exemplo');
  assert.equal(result.campos.nome, 'Produto Exemplo');
  assert.equal(result.fontes.length, 2);
  assert.equal(calls.length, 4);
  assert.match(calls[2].body.query, new RegExp(`"${ean}".*fabricante.*laboratório`));
  assert.ok(calls.every(call => call.signal === calls[0].signal));
});

test('technical sheets late in a long page are retained for extraction', async () => {
  const f = fixture({ searchResults: [{ ...source, content: 'Menu de navegação. '.repeat(1500) + content }] });
  const result = await f.service.lookup(ean, 1);
  assert.equal(result.campos.fabricante, 'Laboratório Exemplo');
  const evidence = JSON.parse(f.calls[1].body.messages[1].content).fontes[0].content;
  assert.ok(evidence.includes(content));
  assert.ok(evidence.length < 20_000);
});

test('supplementary search failure preserves verified fields and partial cache expires sooner', async () => {
  let time = 0, searches = 0;
  const data = structuredClone(extracted);
  data.campos.fabricante = null;
  const service = createProductAiService({ now: () => time, client: {
    requireConfigured() {},
    search: async (_ean, _signal, options) => {
      searches++;
      if (options?.manufacturer) throw new Error('Provider unavailable');
      return { results: [source] };
    },
    extract: async () => completion(data),
  } });
  assert.equal((await service.lookup(ean, 1)).campos.nome, 'Produto Exemplo');
  assert.equal((await service.lookup(ean, 1)).campos.fabricante, null);
  assert.equal(searches, 2);
  time += 60_001;
  await service.lookup(ean, 1);
  assert.equal(searches, 4);
});

test('supplementary sources with another EAN cannot fill manufacturer or trigger extraction', async () => {
  let extractions = 0;
  const data = structuredClone(extracted);
  data.campos.fabricante = null;
  const service = createProductAiService({ client: {
    requireConfigured() {},
    search: async (_ean, _signal, options) => ({ results: options?.manufacturer
      ? [{ ...source, content: content.replace(ean, '96385074') }] : [source] }),
    extract: async () => { extractions++; return completion(data); },
  } });
  assert.equal((await service.lookup(ean, 1)).campos.fabricante, null);
  assert.equal(extractions, 1);
});
