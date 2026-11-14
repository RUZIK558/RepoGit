'use strict';
// Keep credentials in the main process and send them only to api.github.com.
module.exports=function({getToken}){
 async function request(url, options={}){
  const parsed=new URL(url);
  if(parsed.protocol!=='https:'||parsed.hostname!=='api.github.com'||parsed.port||parsed.username||parsed.password)throw Error('Неподдерживаемый адрес GitHub API.');
  const token=await getToken();
  const headers={'User-Agent':'RepoGit/0.9','Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',...(token?{Authorization:'Bearer '+token}:{}),...(options.body?{'Content-Type':'application/json'}:{})};
  let r;try{r=await fetch(url,{method:options.method||'GET',headers,body:options.body,redirect:'error',signal:AbortSignal.timeout(30000)})}catch(e){throw Error('Не удалось связаться с GitHub. Проверьте подключение и повторите попытку.')}
  if(options.allowNotFound&&r.status===404)return null;
  if(!r.ok){
   let data={};try{data=await r.json()}catch{}
   const message=String(data.message||'');const remaining=r.headers.get('x-ratelimit-remaining');
   if(r.status===429||(r.status===403&&(remaining==='0'||/rate limit|secondary rate/i.test(message)))){
    const reset=Number(r.headers.get('x-ratelimit-reset'));const time=reset>Date.now()/1000?new Date(reset*1000).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}):null;
    throw Error('GitHub ограничил число запросов.'+(time?' Попробуйте после '+time+'.':' Попробуйте позже.')+(!token?' Войдите в GitHub с личным токеном, чтобы использовать повышенный лимит.':''));
   }
   if(r.status===401)throw Error('GitHub не принял токен. На вкладке GitHub войдите снова с действующим personal access token.');
   if(r.status===403)throw Error('GitHub отклонил запрос: нет доступа или недостаточно прав токена.');
   if(r.status===404)throw Error('GitHub: репозиторий или файл не найден. Проверьте адрес и доступ.');
   throw Error('GitHub: ошибка '+r.status+'. Повторите попытку позже.');
  }
  return r.status===204?null:r.json();
 }
 async function api(url,options={}){return request(url,options)}
 async function graphql(query){const result=await request('https://api.github.com/graphql',{method:'POST',body:JSON.stringify({query})});if(result.errors?.length){const blocking=result.errors.filter(e=>!(e.type==='NOT_FOUND'&&/^r\d+$/.test(e.path?.[0]||'')));if(blocking.some(e=>/rate limit/i.test(e.message||'')))throw Error('GitHub ограничил число запросов. Повторите попытку позже.');if(blocking.length)throw Error('Не удалось проверить файлы релизов через GitHub. Повторите попытку.')}return result.data}
 return {api,graphql};
};
