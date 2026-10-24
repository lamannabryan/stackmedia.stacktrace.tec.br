const {DatabaseSync,backup}=require('node:sqlite');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const dir=__dirname;
const dbFile=path.resolve('catalogo-crud/data/catalogo.sqlite');
const changes=JSON.parse(fs.readFileSync(path.join(dir,'proposta.json'),'utf8'));
const pending=JSON.parse(fs.readFileSync(path.join(dir,'pendentes.json'),'utf8'));
const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const empty=s=>!norm(s)||['naoclassificado','naoinformado','desconhecido'].includes(norm(s));
const digest=o=>createHash('sha256').update(JSON.stringify(o)).digest('hex');
const stats=rows=>({total:rows.length,sem_fabricante:rows.filter(r=>empty(r.fabricante)).length,sem_imagem:rows.filter(r=>!String(r.imagem_arquivo||'').trim()).length,com_imagem_sem_fabricante:rows.filter(r=>String(r.imagem_arquivo||'').trim()&&empty(r.fabricante)).length,fabricantes_distintos:new Set(rows.filter(r=>!empty(r.fabricante)).map(r=>r.fabricante)).size});
(async()=>{
 assert(changes.length>0,'Nenhuma alteração proposta.');
 assert.equal(new Set(changes.map(r=>r.id)).size,changes.length,'IDs repetidos');
 const time=new Date().toISOString();
 const run=path.join(dir,'aplicacao-'+time.replace(/[:.]/g,'-'));
 fs.mkdirSync(run,{recursive:true});
 const db=new DatabaseSync(dbFile);
 db.exec('PRAGMA busy_timeout=10000; PRAGMA foreign_keys=ON;');
 const backupFile=path.join(run,'catalogo-antes.sqlite');
 await backup(db,backupFile);
 const saved=new DatabaseSync(backupFile,{readOnly:true});
 const beforeBackup=saved.prepare('SELECT * FROM products ORDER BY id').all();
 assert.equal(saved.prepare('PRAGMA quick_check').get().quick_check,'ok','Backup inválido');
 saved.close();
 db.exec('BEGIN IMMEDIATE');
 let audit,result;
 try {
  const before=db.prepare('SELECT * FROM products ORDER BY id').all();
  assert.equal(digest(before),digest(beforeBackup),'Produtos modificados após backup; operação cancelada');
  assert.equal(before.length,12611,'Quantidade mudou desde análise');
  const fkBefore=db.prepare('PRAGMA foreign_key_check').all();
  const otherTables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name<>'products' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>r.name);
  const otherHashes=new Map(otherTables.map(t=>[t,digest(db.prepare('SELECT * FROM "'+t.replace(/"/g,'""')+'"').all())]));
  const index=new Map(before.map(r=>[r.id,r]));
  const update=db.prepare('UPDATE products SET fabricante=?,updated_at=? WHERE id=? AND fabricante IS ?');
  audit=[];
  for(const c of changes){
   const r=index.get(c.id);
   assert(r,'Produto ausente '+c.id);
   assert.equal(r.nome,c.nome,'Nome alterado '+c.id);
   assert.equal(r.fabricante,c.antes,'Fabricante alterado '+c.id);
   assert(c.depois&&c.fontes.length,'Alteração sem fonte '+c.id);
   assert.equal(update.run(c.depois,time,c.id,c.antes).changes,1,'Update incompleto '+c.id);
   audit.push({...c,updated_at_antes:r.updated_at,updated_at_depois:time});
  }
  const after=db.prepare('SELECT * FROM products ORDER BY id').all();
  const byId=new Map(changes.map(c=>[c.id,c]));
  assert.equal(after.length,before.length);
  for(let i=0;i<before.length;i++){
   const c=byId.get(before[i].id);
   assert.deepEqual({...after[i]},c?{...before[i],fabricante:c.depois,updated_at:time}:{...before[i]},'Campo indevidamente modificado '+before[i].id);
  }
  for(const t of otherTables)assert.equal(digest(db.prepare('SELECT * FROM "'+t.replace(/"/g,'""')+'"').all()),otherHashes.get(t),'Tabela alterada '+t);
  assert.equal(db.prepare('PRAGMA quick_check').get().quick_check,'ok');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),fkBefore,'Novos erros de referência');
  const variants=new Map();
  for(const r of after.filter(r=>!empty(r.fabricante))){const k=norm(r.fabricante);const s=variants.get(k)||new Set();s.add(r.fabricante);variants.set(k,s);}
  const duplicates=[...variants.values()].filter(s=>s.size>1).map(s=>[...s]);
  assert.equal(duplicates.length,0,'Restaram variantes gráficas equivalentes: '+JSON.stringify(duplicates));
  const a=stats(before),b=stats(after);
  assert.equal(b.sem_fabricante,pending.length,'Pendências divergentes');
  result={data:time,banco:dbFile,backup:backupFile,antes:a,depois:b,atribuicoes:changes.filter(c=>c.motivo==='regra_pesquisada').length,normalizacoes:changes.filter(c=>c.motivo==='normalizacao_grafica').length,total_alterado:changes.length,cobertura_fabricante_percentual:Math.round((b.total-b.sem_fabricante)/b.total*10000)/100,validacao:{quick_check:'ok',foreign_key_check:fkBefore.length,variantes_graficas_equivalentes:duplicates.length,outros_campos_e_tabelas_preservados:true,backup_verificado:true}};
  fs.writeFileSync(path.join(run,'alteracoes.json'),JSON.stringify({status:'preparado',...result,alteracoes:audit},null,2));
  db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');db.close();fs.writeFileSync(path.join(run,'falha.txt'),String(e.stack));throw e;}
 db.close();
 fs.writeFileSync(path.join(run,'alteracoes.json'),JSON.stringify({status:'aplicado',...result,alteracoes:audit},null,2));
 fs.writeFileSync(path.join(dir,'resultado.json'),JSON.stringify({...result,auditoria:path.join(run,'alteracoes.json')},null,2));
 console.log(JSON.stringify(result,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
