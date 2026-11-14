'use strict';
const {app,ipcMain,BrowserWindow,dialog}=require('electron');
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
module.exports=function({api,validRepo,classify,loadLib,graphql,getToken}){
 async function github(url){return api(url,{allowNotFound:true})}
 ipcMain.handle('readme',async(_e,repo)=>{if(!validRepo(repo))throw Error('Некорректный репозиторий.');let data=await github('https://api.github.com/repos/'+repo+'/readme');if(!data)return 'README не найден.';if(data.encoding!=='base64'||typeof data.content!=='string')return 'README слишком большой или недоступен через API GitHub. Откройте репозиторий на GitHub.';let bytes=Buffer.from(data.content.replace(/\s/g,''),'base64');if(bytes.length>300000)bytes=bytes.subarray(0,300000);const text=bytes.toString('utf8');return text+(Number(data.size)>bytes.length?'\n\n[Описание сокращено.]':'')});
 // Cache asset names per repository, so switching OS does not repeat requests.
 const cache=new Map();
 function getCached(repo){const x=cache.get(repo.toLowerCase());return x&&Date.now()-x.time<600000?x.names:null}
 function put(repo,names){cache.set(repo.toLowerCase(),{time:Date.now(),names})}
 async function fetchRest(repo){let release=await github('https://api.github.com/repos/'+repo+'/releases/latest');let names=(release?.assets||[]).map(a=>a.name);put(repo,names)}
 async function fetchGraphql(items){
  const query='{ '+items.map((item,i)=>{const [owner,name]=item.repo.split('/');return `r${i}: repository(owner:${JSON.stringify(owner)},name:${JSON.stringify(name)}) { latestRelease { releaseAssets(first:100) { nodes { name } } } }`}).join(' ')+' }';
  const data=await graphql(query);if(!data)throw Error('GitHub не вернул данные релизов.');
  items.forEach((item,i)=>put(item.repo,(data['r'+i]?.latestRelease?.releaseAssets?.nodes||[]).map(a=>a.name)));
 }
 ipcMain.handle('filter-results',async(_e,items,os)=>{
  if(!Array.isArray(items)||items.length>18||!['windows','linux','mac'].includes(os)||items.some(x=>!x||!validRepo(x.repo)))throw Error('Некорректный фильтр.');
  const missing=items.filter(x=>getCached(x.repo)===null);
  if(missing.length){if(graphql&&getToken&&await getToken())await fetchGraphql(missing);else{let at=0;await Promise.all(Array.from({length:Math.min(4,missing.length)},async()=>{while(at<missing.length){let i=at++;await fetchRest(missing[i].repo)}}))}}
  return items.filter(item=>(getCached(item.repo)||[]).some(name=>{let arch=classify(name,os);return os==='mac'?['x64','arm64','universal'].includes(arch):arch==='x64'}));
 });
 function steamRoots(){let h=app.getPath('home');return [path.join(h,'.local/share/Steam'),path.join(h,'.steam/steam'),path.join(h,'.var/app/com.valvesoftware.Steam/.local/share/Steam')].filter(x=>fs.existsSync(x))}
 const protonFile=()=>path.join(app.getPath('userData'),'proton-9.json');
 async function validProton(file){try{let real=await fsp.realpath(file);return path.basename(real)==='proton'&&path.basename(path.dirname(real)).toLowerCase()==='proton 9.0-4'&&(await fsp.stat(real)).isFile()}catch{return false}}
 async function getProton(e){let saved;try{saved=JSON.parse(await fsp.readFile(protonFile(),'utf8')).path}catch{}if(saved&&await validProton(saved))return saved;for(const root of steamRoots()){let candidate=path.join(root,'steamapps/common/Proton 9.0-4/proton');if(await validProton(candidate))return candidate}let choice=await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender),{title:'Выберите файл proton из папки Proton 9.0-4',properties:['openFile']});if(choice.canceled||!choice.filePaths[0])return null;let file=choice.filePaths[0];if(!await validProton(file))throw Error('Выберите файл proton именно из папки Proton 9.0-4. Сначала установите эту версию Proton в Steam.');await fsp.mkdir(app.getPath('userData'),{recursive:true});await fsp.writeFile(protonFile(),JSON.stringify({path:file}),{mode:0o600});return file}
 ipcMain.handle('run-proton',async(e,id)=>{if(process.platform!=='linux')throw Error('Proton доступен только в Linux.');let item=(await loadLib()).find(x=>x.id===id);if(!item||item.os!=='windows'||!fs.existsSync(item.path))throw Error('Windows-файл не найден в библиотеке.');let roots=steamRoots();if(!roots.length)throw Error('Steam не найден. Установите Steam и Proton 9.0-4, затем повторите.');let proton=await getProton(e);if(!proton)return {cancelled:true};let answer=await dialog.showMessageBox(BrowserWindow.fromWebContents(e.sender),{type:'warning',buttons:['Отмена','Запустить'],defaultId:0,cancelId:0,title:'Запуск через Proton 9.0-4',message:`Запустить ${item.name} через Proton 9.0-4?\n\nИсточник: ${item.repo}\nСовместимость не гарантируется. Программа получит права вашего пользователя.`});if(answer.response!==1)return {cancelled:true};let prefix=path.join(app.getPath('userData'),'proton',crypto.createHash('sha256').update(item.repo.toLowerCase()).digest('hex').slice(0,24));await fsp.mkdir(prefix,{recursive:true});return new Promise((resolve,reject)=>{let p=spawn(proton,['run',item.path],{env:{...process.env,STEAM_COMPAT_CLIENT_INSTALL_PATH:roots[0],STEAM_COMPAT_DATA_PATH:prefix},cwd:path.dirname(item.path),detached:true,stdio:'ignore',shell:false});p.once('error',err=>reject(Error('Не удалось запустить Proton: '+err.message)));p.once('spawn',()=>{p.unref();resolve({started:true})})})});
};
