const RELEASE='v0.10.1-full-republish';
const CACHE_NAME=`tsb-hub-${RELEASE}`;
const APP_SHELL=[
  './',
  './index.html',
  `./css/style.css?v=${RELEASE}`,
  `./css/mobile-first-cleanup.css?v=${RELEASE}`,
  `./css/mobile-dashboard.css?v=${RELEASE}`,
  `./css/mobile-finance.css?v=${RELEASE}`,
  `./js/app.js?v=${RELEASE}`,
  `./js/mobile-first-cleanup.js?v=${RELEASE}`,
  `./js/mobile-dashboard.js?v=${RELEASE}`,
  `./js/finance-module-v1.js?v=${RELEASE}`,
  `./js/release-manager.js?v=${RELEASE}`,
  `./manifest.json?v=${RELEASE}`,
  `./icons/icon-192.png?v=${RELEASE}`,
  `./icons/icon-512.png?v=${RELEASE}`
];

async function openCache(){return caches.open(CACHE_NAME)}
async function fetchFresh(request){return fetch(request,{cache:'reload'})}
async function putFresh(cache,url){
  const request=new Request(url,{cache:'reload'});
  const response=await fetchFresh(request);
  if(response&&response.ok)await cache.put(request,response.clone());
  return response;
}
async function precacheFresh(){
  const cache=await openCache();
  await Promise.all(APP_SHELL.map(url=>putFresh(cache,url).catch(()=>null)));
}
async function clearOldCaches(){
  const keys=await caches.keys();
  await Promise.all(keys.filter(key=>key!==CACHE_NAME).map(key=>caches.delete(key)));
}
async function notifyClients(message){
  const clientsList=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  clientsList.forEach(client=>client.postMessage(message));
}

self.addEventListener('install',event=>{
  event.waitUntil(precacheFresh().then(()=>self.skipWaiting()));
});

self.addEventListener('activate',event=>{
  event.waitUntil(
    clearOldCaches()
      .then(()=>self.clients.claim())
      .then(()=>notifyClients({type:'TSB_SW_ACTIVATED',release:RELEASE,cacheName:CACHE_NAME}))
  );
});

self.addEventListener('message',event=>{
  const type=event.data&&event.data.type;
  if(type==='SKIP_WAITING')self.skipWaiting();
  if(type==='TSB_CLEAR_CACHES')event.waitUntil(clearOldCaches());
  if(type==='TSB_FORCE_REFRESH'){
    event.waitUntil(precacheFresh().then(()=>notifyClients({type:'TSB_REFRESH_READY',release:RELEASE})));
  }
});

self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET')return;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin)return;

  if(request.mode==='navigate'){
    event.respondWith(
      fetch(request,{cache:'no-store'})
        .then(response=>{
          const copy=response.clone();
          openCache().then(cache=>cache.put('./index.html',copy));
          return response;
        })
        .catch(()=>caches.match('./index.html'))
    );
    return;
  }

  const isAppAsset=APP_SHELL.some(item=>url.pathname.endsWith(item.replace('./','').split('?')[0]));
  if(isAppAsset){
    event.respondWith(
      fetchFresh(request)
        .then(response=>{
          const copy=response.clone();
          openCache().then(cache=>cache.put(request,copy));
          return response;
        })
        .catch(()=>caches.match(request))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cached=>cached||fetch(request).then(response=>{
      const copy=response.clone();
      openCache().then(cache=>cache.put(request,copy));
      return response;
    }))
  );
});
