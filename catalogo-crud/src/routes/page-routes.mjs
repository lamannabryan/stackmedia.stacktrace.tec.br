/**
 * Public page registry. Add an explicit entry for each new format instead of
 * deriving a filename from the URL, which keeps the static surface controlled.
 */
const pages = new Map([
  ['/', 'index.html'],
  ['/catalogo', 'catalogo.html'],
  ['/import-produtos', 'import-produtos.html'],
  ['/parceiros', 'parceiros.html'],
  ['/usuarios', 'usuarios.html'],
  ['/backgrounds', 'backgrounds.html'],
  ['/revistas', 'revistas.html'],
  ['/login', 'login.html'],
  ['/artes/stories', 'stories.html'],
  ['/artes/feed', 'feed.html'],
  ['/artes/indoor-h', 'indoor-h.html'],
]);

export function resolvePageRoute(pathname) {
  const normalizedPath = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return pages.get(normalizedPath) || null;
}
