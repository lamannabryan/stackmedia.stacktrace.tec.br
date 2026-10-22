function compilePattern(pattern) {
  const names = [];
  const parts = pattern
    .split('/')
    .filter(Boolean)
    .map((part) => {
      if (!part.startsWith(':')) return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      const name = part.slice(1);
      if (!name) throw new Error(`Parâmetro inválido na rota: ${pattern}`);
      names.push(name);
      return '([^/]+)';
    });

  return {
    names,
    expression: new RegExp(`^/${parts.join('/')}/?$`),
  };
}

function decodeParams(names, match) {
  const params = {};

  for (const [index, name] of names.entries()) {
    try {
      params[name] = decodeURIComponent(match[index + 1]);
    } catch {
      return null;
    }
  }

  return params;
}

/**
 * Small dependency-free router. Routes are explicit and can be split by domain
 * without exposing arbitrary files or endpoints.
 */
export function createRouter() {
  const routes = [];

  function add(method, pattern, handler) {
    const compiled = compilePattern(pattern);
    routes.push({ method, pattern, handler, ...compiled });
    return router;
  }

  async function dispatch(context) {
    for (const route of routes) {
      if (route.method !== context.request.method) continue;

      const match = route.expression.exec(context.url.pathname);
      if (!match) continue;

      const params = decodeParams(route.names, match);
      if (!params) return false;

      await route.handler({ ...context, params });
      return true;
    }

    return false;
  }

  const router = {
    add,
    get(pattern, handler) {
      return add('GET', pattern, handler);
    },
    post(pattern, handler) {
      return add('POST', pattern, handler);
    },
    put(pattern, handler) {
      return add('PUT', pattern, handler);
    },
    delete(pattern, handler) {
      return add('DELETE', pattern, handler);
    },
    dispatch,
  };

  return router;
}
