import {build} from 'esbuild';
export async function buildApp(){
 const client = await build({
  entryPoints:['public/app.js'], bundle:true, format:'iife', platform:'browser', target:'es2022', write:false
 });
 await build({
  entryPoints:['src/worker.mjs'], bundle:true, format:'esm', platform:'browser', target:'es2022',
  outfile:'dist/worker.mjs', loader:{'.html':'text','.css':'text'},
  plugins:[{name:'client-as-text', setup(build){
   build.onLoad({filter:/public[\\/]app\.js$/},()=>({contents:client.outputFiles[0].text,loader:'text'}));
  }}]
 });
 console.log('Built dist/worker.mjs');
}
await buildApp();
