import {Miniflare} from 'miniflare';
import {readFile,mkdir,readdir} from 'node:fs/promises';
import {watch} from 'node:fs';
import {buildApp} from './build.mjs';
await mkdir('.local',{recursive:true});
// Match the maximum supported date of the installed local workerd runtime.
const mf=new Miniflare({modules:true,scriptPath:'dist/worker.mjs',compatibilityDate:'2026-07-30',port:8787,host:'127.0.0.1',d1Databases:{DB:'qmc-local'},d1Persist:'.local/d1',bindings:{DEV_MODE:'true',LINE_OFFICIAL_ID:'@788fjcfb'}});
const db=await mf.getD1Database('DB');
for(const file of (await readdir('migrations')).filter(file=>file.endsWith('.sql')).sort()) {
 const migration=await readFile(`migrations/${file}`,'utf8');
 await db.batch(migration.split(';').map(x=>x.trim()).filter(Boolean).map(sql=>db.prepare(sql)));
}
console.log(`Local: ${await mf.ready}`);
console.log('体験版: http://127.0.0.1:8787/demo');
let timer,busy=false;
for(const directory of ['src','public']) watch(directory,{recursive:true},()=>{
 clearTimeout(timer);timer=setTimeout(async()=>{
  if(busy)return;busy=true;
  try{await buildApp();await mf.setOptions({modules:true,scriptPath:'dist/worker.mjs',compatibilityDate:'2026-07-30',port:8787,host:'127.0.0.1',d1Databases:{DB:'qmc-local'},d1Persist:'.local/d1',bindings:{DEV_MODE:'true',LINE_OFFICIAL_ID:'@788fjcfb'}});console.log('Updated. Reload the browser to see changes.');}catch(e){console.error(e.message);}finally{busy=false;}
 },200);
});
for(const sig of ['SIGINT','SIGTERM']) process.on(sig,async()=>{await mf.dispose();process.exit();});
