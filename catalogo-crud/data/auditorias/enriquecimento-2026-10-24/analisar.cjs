const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const root = process.cwd();
const dir = __dirname;
const db = new DatabaseSync(path.join(root, 'catalogo-crud/data/catalogo.sqlite'), { readOnly: true });
const rows = db.prepare('SELECT * FROM products ORDER BY id').all();
db.close();
const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const key = s => norm(s).replace(/ /g, '');
const empty = s => !norm(s) || ['naoclassificado', 'naoinformado', 'desconhecido'].includes(key(s));
const groups = new Map();
for (const r of rows.filter(r => !empty(r.fabricante))) {
  const g = groups.get(key(r.fabricante)) || new Map();
  g.set(r.fabricante, (g.get(r.fabricante) || 0) + 1);
  groups.set(key(r.fabricante), g);
}
const preferred = ['Nestlé', "L'Oréal", "L'Oréal Paris", 'Kimberly-Clark', 'Grupo Boticário', 'Brasterápica', 'Katiguá', 'La Roche-Posay', 'G-Tech', 'Giovanna Baby', 'CCM', 'EMS', 'Farmaervas', 'Body Action', 'Beauty Color', 'Bio Factor', 'Derma Chem', 'União Química', 'PepsiCo Brasil', 'Mondelēz Brasil'];
const canonical = new Map([...groups].map(([k, g]) => [k, [...g].sort((a,b) => b[1]-a[1])[0][0]]));
for (const s of preferred) canonical.set(key(s), s);
for (const s of ['Porán', 'SP Colors', 'Cristália', 'Integralmédica', 'Naturalle', 'Desinchá', 'Kanechom']) canonical.set(key(s), s);
const aliasSources = new Map();
for (const [a,b,url] of [
 ['Kley Hertz','Hertz','https://www.hertzfarma.com.br/politica-de-privacidade/'],
 ['Atlhetica','Atlhetica Nutrition','https://www.atlheticanutrition.com.br/sobre-nos'],
 ['Pais E Filhos','Pais & Filhos','normalizacao de conjuncao e simbolo &'],
 ['Catarinense Pharma','Catarinense','https://consultaremedios.com.br/kit-nuova-cabelos-e-unhas/p'],
 ['Cless','Cless Cosméticos','https://consultaremedios.com.br/lencos-umedecidos-baby-poppy/p']
]) {canonical.set(key(a),b);canonical.set(key(b),b);aliasSources.set(key(a),url);}
const nestleTags=new Set(['nestle','nestle brasil','nestle professional','ninho','moca','molico','nescafe','nescau','dolce gusto','kit kat','maggi','fondor','mucilon','nutren','nesfit','neston','bono','galak','prestigio','charge','negresco','passatempo','tradicao']);
for(const s of rows.map(r=>r.fabricante).filter(Boolean)) {
 const tags=s.split(',').map(norm);
 if(tags.length>1&&tags.includes('nestle')&&tags.every(t=>nestleTags.has(t))){canonical.set(key(s),'Nestlé');aliasSources.set(key(s),'https://www.nestle.com.br/perguntasfrequentes/nossa-empresa/respostas/produtos-marcas');}
}
const canon = s => canonical.get(key(s)) || String(s).trim().replace(/\s+/g, ' ');
const rules = JSON.parse(fs.readFileSync(path.join(dir, 'regras.json'), 'utf8'));
for(const f of fs.readdirSync(dir).filter(f=>/^regras-web\d+\.json$/.test(f)))rules.push(...JSON.parse(fs.readFileSync(path.join(dir,f),'utf8')));
const internal = require('./regras-internas.cjs');
for(const maker of internal.direct) {
  const refs=rows.filter(r=>!empty(r.fabricante)&&key(r.fabricante)===key(maker));
  if(refs.length) rules.push({pattern:'\\b'+norm(maker).replace(/ /g,' ?')+'\\b',fabricante:canon(refs[0].fabricante),fontes:refs.slice(0,5).map(r=>'SQLite products.id='+r.id+'; fabricante='+r.fabricante),tipo:'fabricante_explicito_com_referencia_interna'});
}
for(const [token,maker] of Object.entries(internal.tokens)) {
  const refs=rows.filter(r=>!empty(r.fabricante)&&key(r.fabricante)===key(maker)&&(' '+norm(r.nome)+' ').includes(' '+token+' '));
  if(refs.length)rules.push({pattern:'\\b'+token+'\\b',fabricante:canon(maker),fontes:refs.slice(0,5).map(r=>'SQLite products.id='+r.id+'; nome='+r.nome+'; fabricante='+r.fabricante),tipo:'marca_com_referencia_interna'});
}
const excluded = new Set(['natural','baby','globo','vida','nobre','cotton','flora','natura','ruby','max','nutri','gold','soft','supra','maisena','brinquedos','charm','botica','boticario','generico','principioativo','cimed generico'].map(key));
const direct = [...canonical.values()].filter(s => key(s).length >= 5 && !excluded.has(key(s)) && !s.includes(',') && !s.includes('/'));
const changes = [], pending = [], candidates = [];
const eanIndex = new Map();
for(const r of rows) if(!empty(r.fabricante) && r.ean) {const list=eanIndex.get(r.ean)||[];list.push(r);eanIndex.set(r.ean,list);}
for (const r of rows) {
  if (!empty(r.fabricante)) {
    const maker = canon(r.fabricante);
    if (maker !== r.fabricante) changes.push({id:r.id, nome:r.nome, antes:r.fabricante, depois:maker, motivo:'normalizacao_grafica', fontes:[r.fabricante, ...(aliasSources.has(key(r.fabricante))?[aliasSources.get(key(r.fabricante))]:[])],tipo:aliasSources.has(key(r.fabricante))?'alias_confirmado':'acentos_caixa_espacos_pontuacao'});
    continue;
  }
  const text = ' ' + norm(r.nome + ' ' + (r.subtitulo || '')) + ' ';
  const hitRules = rules.filter(rule => (!rule.ids || rule.ids.includes(r.id)) && (!rule.pattern || new RegExp(rule.pattern).test(text)) && (!rule.exclude || !new RegExp(rule.exclude).test(text)));
  const makers = [...new Set(hitRules.map(rule=>canon(rule.fabricante)))];
  if (makers.length === 1) {
    changes.push({id:r.id,nome:r.nome,antes:r.fabricante,depois:makers[0],motivo:'regra_pesquisada',fontes:[...new Set(hitRules.flatMap(rule=>rule.fontes))],regra:hitRules.map(rule=>rule.pattern||rule.ids),tipo:[...new Set(hitRules.map(rule=>rule.tipo||'pesquisa_web'))]});
    continue;
  }
  const d = direct.filter(s => text.includes(' ' + norm(s) + ' '));
  const exactEan = (eanIndex.get(r.ean)||[]).filter(s=>s.id!==r.id);
  const row = {id:r.id,nome:r.nome,subtitulo:r.subtitulo,ean:r.ean,imagem:r.imagem_arquivo,fabricante_atual:r.fabricante,conflitos:makers,candidatos:d,ean_fontes:exactEan.map(s=>({id:s.id,nome:s.nome,fabricante:canon(s.fabricante)}))};
  pending.push(row);
  if(d.length || exactEan.length) candidates.push(row);
}
fs.writeFileSync(path.join(dir,'proposta.json'),JSON.stringify(changes,null,2));
fs.writeFileSync(path.join(dir,'pendentes.json'),JSON.stringify(pending,null,2));
fs.writeFileSync(path.join(dir,'candidatos.json'),JSON.stringify(candidates,null,2));
const byMaker={};for(const r of changes.filter(x=>x.motivo==='regra_pesquisada'))byMaker[r.depois]=(byMaker[r.depois]||0)+1;
console.log(JSON.stringify({total:rows.length,ausentes:rows.filter(r=>empty(r.fabricante)).length,normalizacoes:changes.filter(x=>x.motivo==='normalizacao_grafica').length,atribuicoes:changes.filter(x=>x.motivo==='regra_pesquisada').length,pendentes:pending.length,candidatos:candidates.length,por_fabricante:byMaker},null,2));
