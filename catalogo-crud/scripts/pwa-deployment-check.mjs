import { pathToFileURL } from 'node:url';

function linkHref(html, rel) {
  return [...html.matchAll(/<link\b[^>]*>/gi)]
    .find(([tag]) => new RegExp(`\\brel=["']${rel}["']`, 'i').test(tag))?.[0]
    .match(/\bhref=["']([^"']+)["']/i)?.[1];
}

// Test the files actually delivered by the public proxy, not just the Node app.
// No credentials are sent: icon discovery must also work outside a login session.
export async function checkPwaDeployment(baseUrl) {
  const base = new URL(baseUrl);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) {
    throw new Error('Informe uma URL HTTP(S) sem usuário ou senha.');
  }
  const issues = [];
  const warnings = [];
  const checked = [];
  const request = async (pathname) => {
    const url = new URL(pathname, base);
    if (url.origin !== base.origin) throw new Error(`Recurso fora da origem da aplicação: ${pathname}`);
    checked.push(url.pathname + url.search);
    return fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10000) });
  };

  let manifestPath = '/manifest.json?v=2';
  let applePath = '/apple-touch-icon.png?v=2';
  try {
    let page = await request('/');
    if (page.status === 302 && new URL(page.headers.get('location'), base).origin === base.origin
      && new URL(page.headers.get('location'), base).pathname === '/login') {
      page = await request('/login');
    }
    if (page.ok) {
      const html = await page.text();
      const linkedManifest = linkHref(html, 'manifest');
      const linkedAppleIcon = linkHref(html, 'apple-touch-icon');
      if (!linkedManifest) issues.push('Página inicial sem link para o manifesto.');
      else manifestPath = linkedManifest;
      if (!linkedAppleIcon) issues.push('Página inicial sem apple-touch-icon.');
      else applePath = linkedAppleIcon;
      if (new URL(manifestPath, base).pathname !== '/manifest.json') {
        issues.push('HTML antigo: publique as páginas que usam /manifest.json.');
      }
    } else if (page.status === 401) {
      warnings.push('HTML protegido por senha; conferidos os arquivos públicos de instalação.');
    } else issues.push(`Página inicial: HTTP ${page.status}.`);
  } catch (error) { issues.push(`Página inicial: ${error.message}`); }

  const icons = new Map([
    [applePath, '180x180'],
    ['/apple-touch-icon.png', '180x180'],
    ['/apple-touch-icon-precomposed.png', '180x180'],
  ]);
  try {
    const response = await request(manifestPath);
    if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
    if (!/^application\/(?:manifest\+)?json\b/i.test(response.headers.get('content-type') || '')) {
      issues.push(`${manifestPath}: Content-Type JSON ausente ou incorreto.`);
    }
    const manifest = await response.json();
    if (manifest.display !== 'standalone') issues.push('Manifesto sem display standalone.');
    if (manifest.start_url !== '/' || manifest.scope !== '/') issues.push('Abertura ou escopo incorretos no manifesto.');
    for (const size of ['192x192', '512x512']) {
      if (!manifest.icons?.some((icon) => icon.sizes === size && (!icon.purpose || icon.purpose.includes('any')))) {
        issues.push(`Manifesto sem ícone padrão ${size}.`);
      }
    }
    for (const icon of manifest.icons || []) icons.set(icon.src, icon.sizes);
  } catch (error) { issues.push(`${manifestPath}: ${error.message}`); }

  for (const [pathname, size] of icons) {
    try {
      if (new URL(pathname, base).pathname.startsWith('/icons/')) {
        issues.push(`${pathname}: caminho /icons/ reservado pelo Apache/Plesk; use /pwa-icons/.`);
      }
      const response = await request(pathname);
      if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
      if (!/^image\/png\b/i.test(response.headers.get('content-type') || '')) throw new Error('Content-Type não é image/png');
      const png = Buffer.from(await response.arrayBuffer());
      if (png.length < 24 || png.toString('hex', 0, 8) !== '89504e470d0a1a0a') throw new Error('Resposta não contém um PNG');
      const dimensions = `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`;
      if (dimensions !== size) throw new Error(`Dimensões ${dimensions}; esperado ${size}`);
    } catch (error) { issues.push(`${pathname}: ${error.message}`); }
  }
  return { checked, issues, warnings };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]) {
    console.error('Uso: npm run check:pwa -- https://seu-dominio');
    process.exitCode = 1;
  } else {
    try {
      const result = await checkPwaDeployment(process.argv[2]);
      for (const warning of result.warnings) console.log(warning);
      for (const issue of result.issues) console.error(`- ${issue}`);
      if (result.issues.length) process.exitCode = 1;
      else console.log(`PWA publicado: ${result.checked.length} URLs verificadas, manifesto standalone e ícones PNG acessíveis sem senha.`);
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
