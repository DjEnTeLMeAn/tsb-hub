const CACHE_NAME='tsb-hub-v0-10-0-update-refresh';
const APP_SHELL=['./','./index.html','./css/style.css?v=0.8.21-dev','./css/mobile-first-cleanup.css?v=0.9.4-clean-symmetry','./css/mobile-dashboard.css?v=0.8.25-today-core','./css/mobile-finance.css?v=0.9.0-finance-v1','./js/app.js?v=0.8.21-dev','./js/mobile-first-cleanup.js?v=0.9.3-nav-v1','./js/mobile-dashboard.js?v=0.8.24-lean','./js/finance-module-v1.js?v=0.9.2-finance-simple','./manifest.json?v=0.8.21-dev','./icons/icon-192.png','./icons/icon-512.png'];

async function openCache(){return caches.open(CACHE_NAME)}
async function fetchFresh(request){return fetch(request,{cache:'reload'})}
async function putFresh(cache,url){const request=new Request(url,{cache:'reload'});const response=await fetchFresh(request);if(response&&response.ok)await cache.put(url,response.clone());return response}
async function precacheFresh(){const cache=await openCache();await Promise.all(APP_SHELL.map(url=>putFresh(cache,url).catch(()=>null)))}
async function clearOldCaches(){const keys=await caches.keys();await Promise.all(keys.filter(key=>key!==CACHE_NAME).map(key=>caches.delete(key)))}
async function notifyClients(message){const clientsList=await self.clients.matchAll({type:'window',includeUncontrolled:true});clientsList.forEach(client=>client.postMessage(message))}

self.addEventListener('install',event=>{event.waitUntil(precacheFresh().then(()=>self.skipWaiting()))});
self.addEventListener('activate',event=>{event.waitUntil(clearOldCaches().then(()=>self.clients.claim()).then(()=>notifyClients({type:'TSB_SW_ACTIVATED',cacheName:CACHE_NAME})))});
self.addEventListener('message',event=>{const type=event.data&&event.data.type;if(type==='SKIP_WAITING')self.skipWaiting();if(type==='TSB_CLEAR_CACHES')event.waitUntil(clearOldCaches())});
self.addEventListener('fetch',event=>{
  const request=event.request;if(request.method!=='GET')return;
  const url=new URL(request.url);if(url.origin!==self.location.origin)return;
  if(request.mode==='navigate'){
    event.respondWith(fetch(request,{cache:'no-store'}).then(response=>{const copy=response.clone();openCache().then(cache=>cache.put('./index.html',copy));return response}).catch(()=>caches.match('./index.html')));
    return;
  }
  const isAppAsset=APP_SHELL.some(item=>url.pathname.endsWith(item.replace('./','').split('?')[0]));
  if(isAppAsset){
    event.respondWith(fetchFresh(request).then(response=>{const copy=response.clone();openCache().then(cache=>cache.put(request,copy));return response}).catch(()=>caches.match(request)));
    return;
  }
  event.respondWith(caches.match(request).then(cached=>cached||fetch(request).then(response=>{const copy=response.clone();openCache().then(cache=>cache.put(request,copy));return response})));
});
