'use strict';
const assert=require('node:assert/strict'),Module=require('node:module'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'rg-stars-')),handlers={},original=Module._load;
const mock={app:{getPath:()=>temp,getVersion:()=>'0.11.0'},safeStorage:{isEncryptionAvailable:()=>false},ipcMain:{handle:(n,f)=>handlers[n]=f},BrowserWindow:{fromWebContents:()=>null},dialog:{},shell:{}};
Module._load=function(n,...a){return n==='electron'?mock:original.call(this,n,...a)};
const validRepo=s=>typeof s==='string'&&/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(s)&&s.length<200&&!s.includes('..');
require('./features')({api:async()=>{},download:async()=>{},validRepo});
let starred=false, requests=[],failure=0;
global.fetch=async(url,opts)=>{requests.push({url,opts});if(url==='https://api.github.com/user')return Response.json({login:'tester'});if(failure)return new Response(null,{status:failure,headers:{'x-ratelimit-remaining':failure===429?'0':'10'}});if(opts.method==='GET')return new Response(null,{status:starred?204:404});if(opts.method==='PUT'){starred=true;return new Response(null,{status:204})}if(opts.method==='DELETE'){starred=false;return new Response(null,{status:204})}throw Error('Unexpected request')};
(async()=>{
 assert.deepEqual(await handlers['github-star-status']({},'owner/project'),{authenticated:false});
 await assert.rejects(()=>handlers['github-set-star']({},'owner/project',true),/войдите/i);assert.equal(requests.length,0);
 await assert.rejects(()=>handlers['github-star-status']({},'owner/../../evil'),/Некорректный/);await assert.rejects(()=>handlers['github-set-star']({},'https://evil.example/p',true),/Некорректный/);await assert.rejects(()=>handlers['github-set-star']({},'owner/project','true'),/Некорректное/);assert.equal(requests.length,0);
 await handlers.login({},'ghp_TESTSECRET');
 assert.deepEqual(await handlers['github-star-status']({},'owner/project'),{authenticated:true,login:'tester',starred:false});
 assert.deepEqual(await handlers['github-set-star']({},'owner/project',true),{starred:true});assert.equal((await handlers['github-star-status']({},'owner/project')).starred,true);
 assert.deepEqual(await handlers['github-set-star']({},'owner/project',false),{starred:false});assert.equal((await handlers['github-star-status']({},'owner/project')).starred,false);
 for(const r of requests.slice(1)){assert.equal(r.url,'https://api.github.com/user/starred/owner/project');assert.equal(r.opts.redirect,'error');assert.equal(r.opts.headers.Authorization,'Bearer ghp_TESTSECRET');if(r.opts.method==='PUT')assert.equal(r.opts.headers['Content-Length'],'0')}
 failure=403;await assert.rejects(()=>handlers['github-set-star']({},'owner/project',true),/Starring/);failure=401;await assert.rejects(()=>handlers['github-star-status']({},'owner/project'),/токен/);failure=429;await assert.rejects(()=>handlers['github-star-status']({},'owner/project'),/ограничил/);failure=404;await assert.rejects(()=>handlers['github-set-star']({},'owner/project',true),/не найден/);
 await handlers.logout({});fs.rmSync(temp,{recursive:true,force:true});console.log('PASS GitHub stars: login, check, star, unstar, errors, repo validation and credential safety');
})().catch(e=>{console.error(e);process.exit(1)});
