'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),Module=require('node:module');
(async()=>{
 if(process.platform!=='linux'){console.log('SKIP: Linux permissions test');return}
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rg-appimage-')),handlers={},marker=path.join(root,'started'),data=Buffer.from(`#!/bin/sh\nprintf ok > '${marker}'\n`),digest='sha256:'+crypto.createHash('sha256').update(data).digest('hex');
 const asset={id:20,name:'Demo-x86_64.AppImage',browser_download_url:'https://github.com/demo/game/releases/download/v2/Demo-x86_64.AppImage',size:data.length,digest};
 const latest={id:17,tag_name:'v2',html_url:'https://github.com/demo/game/releases/tag/v2',draft:false,prerelease:false,assets:[asset]};let answer=1,orig=Module._load,oldFetch=global.fetch;
 const electron={app:{getPath:()=>root,whenReady:()=>new Promise(()=>{}),on(){}},ipcMain:{handle:(n,f)=>handlers[n]=f},BrowserWindow:{fromWebContents:()=>null},dialog:{showMessageBox:async()=>({response:answer})},shell:{}};
 Module._load=function(n,...a){if(n==='electron')return electron;if(n==='./github-api')return()=>({api:async()=>latest,graphql:()=>{}});if(n==='./features')return()=>({getToken:()=>null});if(n==='./platform-features')return()=>{};return orig.call(this,n,...a)};
 global.fetch=async()=>new Response(data,{status:200,headers:{'content-length':String(data.length)}});
 try{
  require('./main');const event={sender:{id:1,send(){}}};
  const file=await handlers.install(event,'demo/game','linux',17,20);assert(file.verified);assert.equal(fs.statSync(file.path).mode&0o111,0o111,'download not executable');
  fs.chmodSync(file.path,0o640);answer=0;assert((await handlers.run(event,file.id)).cancelled);assert.equal(fs.statSync(file.path).mode&0o777,0o640,'cancel changed mode');
  answer=1;const launched=await handlers.run(event,file.id);assert(launched.started);assert.equal(fs.statSync(file.path).mode&0o777,0o751,'must preserve existing permissions and add +x');
  for(let i=0;i<30&&!fs.existsSync(marker);i++)await new Promise(r=>setTimeout(r,20));assert.equal(fs.readFileSync(marker,'utf8'),'ok','real executable failed to start');
  fs.renameSync(file.path,file.path+'.original');const external=path.join(root,'outside.AppImage');fs.writeFileSync(external,'outside',{mode:0o600});fs.symlinkSync(external,file.path);await assert.rejects(()=>handlers.run(event,file.id),/разрешить запуск AppImage/);assert.equal(fs.statSync(external).mode&0o777,0o600,'symlink target chmod');fs.unlinkSync(file.path);fs.renameSync(file.path+'.original',file.path);
  const oldLib=JSON.parse(fs.readFileSync(path.join(root,'library.json')));oldLib[0].release='v1';fs.writeFileSync(path.join(root,'library.json'),JSON.stringify(oldLib));const updated=await handlers['library-update'](event,file.id,20);assert.equal(updated.release,'v2');assert.equal(fs.statSync(updated.path).mode&0o111,0o111,'updated AppImage not executable');
  const externalEntry={...updated,id:'external',path:external};fs.writeFileSync(path.join(root,'library.json'),JSON.stringify([externalEntry]));await assert.rejects(()=>handlers.run(event,'external'),/расположение/);assert.equal(fs.statSync(external).mode&0o777,0o600);
  console.log('PASS Linux AppImage download, old file repair, cancellation, real launch, update, symlink and path safety');
 }finally{Module._load=orig;global.fetch=oldFetch;fs.rmSync(root,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exit(1)});
