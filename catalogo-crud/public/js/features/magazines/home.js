import { sessionReady } from '../../session.js';
import { mountMagazineCatalogue } from './catalogue.js';

export const magazineMonth = month => new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T12:00:00Z`));

function renderMagazine(magazine) {
  const section = document.getElementById('revista-atual');
  if (!section) return;
  section.hidden = false;
  document.getElementById('home-magazine-title').textContent = magazine.title;
  document.getElementById('home-magazine-period').textContent = `Revista do mês / ${magazineMonth(magazine.month)}`;
  document.getElementById('home-magazine-count').textContent = `${magazine.items.length} produtos selecionados`;
  mountMagazineCatalogue(magazine);

}

// A single request supplies both the hero and the monthly selection.
export const currentMagazine = sessionReady.then(async () => {
  const response = await fetch('/api/revistas/destaque', { cache: 'no-store', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('Revista indisponível');
  const { revista } = await response.json();
  if (!revista?.items?.length) return null;
  renderMagazine(revista);
  return revista;
}).catch(() => null);
