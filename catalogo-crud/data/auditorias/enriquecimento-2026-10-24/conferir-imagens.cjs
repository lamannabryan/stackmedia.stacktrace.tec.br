const fs=require('node:fs');
const path=require('node:path');
const sharp=require(path.resolve('catalogo-crud/node_modules/sharp'));
const rows=require('./pendentes.json').filter(r=>r.imagem);
const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
(async()=>{
 const resolved=[];
 for(let page=0;page<Math.ceil(rows.length/20);page++){
  const items=[];
  for(const [i,r] of rows.slice(page*20,page*20+20).entries()){
   const base=path.resolve('imagens-produtos',r.imagem);
   const file=[base.replace(/\.png$/i,'.webp'),base.replace(/\.png$/i,'_resultado.webp'),base].find(f=>fs.existsSync(f));
   if(!file)throw Error('imagem ausente '+r.id);
   const thumb=await sharp(file).resize(236,198,{fit:'contain',background:'#ffffff'}).flatten({background:'#ffffff'}).png().toBuffer();
   const left=(i%5)*240,top=Math.floor(i/5)*230;
   items.push({input:thumb,left:left+2,top:top+30});
   items.push({input:Buffer.from('<svg width="240" height="30"><rect width="240" height="30" fill="white"/><text x="3" y="13" font-family="Arial" font-size="12">'+esc(r.id+' '+r.nome.slice(0,28))+'</text><text x="3" y="27" font-family="Arial" font-size="10">'+esc(r.subtitulo||'')+'</text></svg>'),left,top});
   resolved.push({id:r.id,arquivo:file,pagina:page+1});
  }
  await sharp({create:{width:1200,height:920,channels:3,background:'#eeeeee'}}).composite(items).png().toFile(path.join(__dirname,'embalagens-'+(page+1)+'.png'));
 }
 fs.writeFileSync(path.join(__dirname,'imagens-conferidas.json'),JSON.stringify(resolved,null,2));
 console.log('Geradas '+Math.ceil(rows.length/20)+' pranchas de conferência.');
})();
