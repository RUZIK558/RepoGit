const assert=require('node:assert'),Module=require('node:module'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'rg-git-')),handlers={},orig=Module._load;
const mock={app:{getPath:()=>temp,getVersion:()=>'0.9.0'},safeStorage:{isEncryptionAvailable:()=>false},ipcMain:{handle:(n,f)=>handlers[n]=f},BrowserWindow:{fromWebContents:()=>null},dialog:{},shell:{}};
Module._load=function(n,...a){return n==='electron'?mock:orig.call(this,n,...a)};
let networkCount=0;global.fetch=async(url,opts)=>{networkCount++;return Response.json({login:'example'})};
const auth=require('./features')({api:async()=>{},download:async()=>{},validRepo:()=>true});
(async()=>{
 await assert.rejects(()=>handlers.login({},'github_Логин'),/личный токен GitHub/);assert.equal(networkCount,0);await assert.rejects(()=>handlers.login({},'foo bar'),/токен/);assert.equal(networkCount,0);
 const a=await handlers.login({},'ghp_TESTSECRET');assert.equal(a.login,'example');assert.equal(await auth.getToken(),'ghp_TESTSECRET');
 const client=require('./github-api')({getToken:auth.getToken});let seen=[];
 global.fetch=async(u,o)=>{seen.push({u,o});return Response.json({ok:true})};await client.api('https://api.github.com/repos/test/one');assert.equal(seen[0].o.headers.Authorization,'Bearer ghp_TESTSECRET');assert.equal(seen[0].o.redirect,'error');await assert.rejects(()=>client.api('https://evil.example/repos/test/one'),/Неподдерживаемый/);assert.equal(seen.length,1);
 global.fetch=async()=>new Response(JSON.stringify({message:'Resource not accessible'}),{status:403,headers:{'Content-Type':'application/json','X-RateLimit-Remaining':'20'}});await assert.rejects(()=>client.api('https://api.github.com/x'),/недостаточно прав/);
 global.fetch=async()=>new Response(JSON.stringify({message:'API rate limit exceeded'}),{status:403,headers:{'Content-Type':'application/json','X-RateLimit-Remaining':'0','X-RateLimit-Reset':String(Math.round(Date.now()/1000+300))}});await assert.rejects(()=>client.api('https://api.github.com/x'),/ограничил число запросов.*после/);
 global.fetch=async()=>new Response('',{status:404});assert.equal(await client.api('https://api.github.com/x',{allowNotFound:true}),null);
 let graph=0,rest=0;require('./platform-features')({api:async()=>{rest++;return {assets:[{name:'foo-x64.exe'}]}},graphql:async q=>{graph++;let aliases=[...q.matchAll(/r(\d+): repository/g)];return Object.fromEntries(aliases.map(m=>['r'+m[1],{latestRelease:{releaseAssets:{nodes:[{name:'foo-x64.exe'},{name:'foo-x86_64.AppImage'}]}}}]))},getToken:auth.getToken,validRepo:r=>/^[\w.-]+\/[\w.-]+$/.test(r),classify:(n,os)=>os==='windows'&&n.endsWith('.exe')?'x64':os==='linux'&&n.endsWith('.AppImage')?'x64':null,loadLib:async()=>[]});
 let items=Array.from({length:18},(_,i)=>({repo:'owner/repo'+i}));assert.equal((await handlers['filter-results']({},items,'windows')).length,18);assert.equal(graph,1);assert.equal(rest,0);assert.equal((await handlers['filter-results']({},items,'linux')).length,18);assert.equal(graph,1);console.log('PASS invalid Unicode token, rate errors, credential safety, batched GraphQL and cache');
 await handlers.logout({});assert.equal(await auth.getToken(),null);fs.rmSync(temp,{recursive:true,force:true});
})().catch(e=>{console.error(e);process.exit(1)});
