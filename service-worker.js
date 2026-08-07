const RELEASE='0.11.0-finance-v2-part1-20260807';
const CACHE_NAME=`tsb-hub-${RELEASE}`;
const APP_SHELL=[
  `./index.html?v=${RELEASE}`,
  `./manifest.json?v=${RELEASE}`,
  `./css/style.css?v=${RELEASE}`,
  `./css/mobile-first-cleanup.css?v=${RELEASE}`,
  `./css/mobile-dashboard.css?v=${RELEASE}`,
  `./css/mobile-finance.css?v=${RELEASE}`,
  `./css/confirm-dialog.css?v=${RELEASE}`,
  `./js/update-manager.js?v=${RELEASE}`,
  `./js/finance-core.js?v=${RELEASE}`,
  `./js/app.js?v=${RELEASE}`,
  `./js/mobile-first-cleanup.js?v=${RELEASE}`,
  `./js/mobile-dashboard.js?v=${RELEASE}`,
  `./icons/icon-192.png?v=${RELEASE}`,
  `./icons/icon-512.png?v=${RELEASE}`
];
function abs(path){return new URL(path,self.registration.scope).href}
async function currentCache(){return caches.open(CACHE_NAME)}
async function cacheFresh(cache,path){const request=new Request(abs(path),{cache:'reload'});const response=await fetch(request,{cache:'reload'});if(!response.ok)throw new Error(`${path}: ${response.status}`);await cache.put(request,response.clone())}
async function precache(){const cache=await currentCache();await Promise.all(APP_SHELL.map(path=>cacheFresh(cache,path)))}
async function clearOld(){const keys=await caches.keys();await Promise.all(keys.filter(key=>key!==CACHE_NAME).map(key=>caches.delete(key)))}
async function notify(message){const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});clients.forEach(client=>client.postMessage(message))}
async function networkFirst(request,fallback=''){
  try{
    const response=await fetch(request,{cache:'no-store'});
    if(response?.ok){const cache=await currentCache();await cache.put(request,response.clone())}
    return response;
  }catch(error){
    const cached=await caches.match(request,{ignoreSearch:true});
    if(cached)return cached;
    if(fallback){const backup=await caches.match(new Request(abs(fallback)),{ignoreSearch:true});if(backup)return backup}
    throw error;
  }
}
self.addEventListener('install',event=>event.waitUntil(precache().then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(clearOld().then(()=>self.clients.claim()).then(()=>notify({type:'TSB_SW_ACTIVATED',release:RELEASE,cacheName:CACHE_NAME}))));
self.addEventListener('message',event=>{
  const type=event.data?.type;
  if(type==='SKIP_WAITING')self.skipWaiting();
  if(type==='TSB_FORCE_REFRESH')event.waitUntil(precache().then(()=>clearOld()).then(()=>notify({type:'TSB_SW_REFRESHED',release:RELEASE})));
  if(type==='TSB_GET_VERSION'&&event.source)event.source.postMessage({type:'TSB_SW_VERSION',release:RELEASE,cacheName:CACHE_NAME});
});
self.addEventListener('fetch',event=>{
  const request=event.request;if(request.method!=='GET')return;
  const url=new URL(request.url);if(url.origin!==self.location.origin)return;
  if(url.pathname.endsWith('/version.json')){event.respondWith(fetch(request,{cache:'no-store'}));return}
  if(request.mode==='navigate'){event.respondWith(networkFirst(request,`./index.html?v=${RELEASE}`));return}
  if(/\.(?:js|css|json|html)$/i.test(url.pathname)){event.respondWith(networkFirst(request));return}
  event.respondWith(caches.match(request,{ignoreSearch:true}).then(cached=>cached||fetch(request).then(async response=>{if(response?.ok){const cache=await currentCache();await cache.put(request,response.clone())}return response})));
});
