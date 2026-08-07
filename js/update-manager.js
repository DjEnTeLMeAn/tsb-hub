// TSB Hub v0.13.0-finance-v2-complete — single PWA update authority.
(function(){
  'use strict';
  const RELEASE='0.13.0-finance-v2-complete-20260807';
  const VERSION_URL='./version.json';
  const RELOAD_KEY='tsb_hub_reload_'+RELEASE;
  const nativeRegister='serviceWorker' in navigator?navigator.serviceWorker.register.bind(navigator.serviceWorker):null;
  let activeRelease=RELEASE;
  let registration=null;
  let checking=false;

  function swUrl(release=activeRelease){return `./service-worker.js?v=${encodeURIComponent(release)}`}
  function status(text){document.querySelectorAll('[data-tsb-update-status]').forEach(el=>el.textContent=text)}
  function toast(text){if(typeof window.showToast==='function')window.showToast(text)}

  async function remoteRelease(){
    const response=await fetch(`${VERSION_URL}?t=${Date.now()}`,{cache:'no-store',headers:{'Cache-Control':'no-cache'}});
    if(!response.ok)throw new Error(`version ${response.status}`);
    const data=await response.json();
    return String(data.release||RELEASE);
  }

  async function registerRelease(release=RELEASE){
    if(!nativeRegister)return null;
    activeRelease=release;
    registration=await nativeRegister(swUrl(release),{scope:'./',updateViaCache:'none'});
    await registration.update().catch(()=>null);
    if(registration.waiting)registration.waiting.postMessage({type:'SKIP_WAITING'});
    return registration;
  }

  async function check({manual=false,reload=false}={}){
    if(checking)return;
    checking=true;
    if(manual)status('Проверяю обновления…');
    try{
      const latest=await remoteRelease();
      await registerRelease(latest);
      if(latest!==RELEASE){
        status(`Найдена версия ${latest}`);
        if(registration?.waiting)registration.waiting.postMessage({type:'SKIP_WAITING'});
        if(reload){
          const url=new URL('./index.html',location.href);
          url.searchParams.set('v',latest);
          url.searchParams.set('refresh',Date.now());
          location.replace(url.href);
        }
      }else{
        status(`Актуальная версия: ${RELEASE}`);
        if(manual)toast('Установлена актуальная версия');
      }
    }catch(error){
      console.warn('TSB update check failed',error);
      if(manual){status('Не удалось проверить обновление');toast('Не удалось проверить обновление')}
    }finally{checking=false}
  }

  function interceptOldRegistration(){
    if(!nativeRegister)return;
    try{
      navigator.serviceWorker.register=(url,options={})=>{
        if(String(url||'').includes('service-worker.js'))return nativeRegister(swUrl(activeRelease),{...options,scope:options.scope||'./',updateViaCache:'none'});
        return nativeRegister(url,options);
      };
    }catch(error){console.warn('SW registration interception failed',error)}
  }

  function mountSettings(){
    const root=document.querySelector('#tab-settings');
    if(!root)return;
    let card=root.querySelector('[data-tsb-update-card]');
    if(!card){card=document.createElement('section');card.className='card settings-update-card';card.dataset.tsbUpdateCard='true';root.appendChild(card)}
    if(card.dataset.ready)return;
    card.dataset.ready='true';
    card.innerHTML=`<div class="card-title-row"><h2>Версия приложения</h2></div><p class="muted">Релиз: <strong>${RELEASE}</strong></p><p class="muted" data-tsb-update-status>Автоматическая проверка включена.</p><button class="ghost-button" type="button" data-tsb-force-update>Проверить и обновить</button>`;
    card.querySelector('[data-tsb-force-update]').onclick=()=>check({manual:true,reload:true});
  }

  interceptOldRegistration();

  if('serviceWorker' in navigator){
    navigator.serviceWorker.addEventListener('controllerchange',()=>{
      if(sessionStorage.getItem(RELOAD_KEY))return;
      sessionStorage.setItem(RELOAD_KEY,'1');
      const url=new URL(location.href);
      url.searchParams.set('v',activeRelease);
      url.searchParams.set('sw',Date.now());
      location.replace(url.href);
    });
  }

  document.addEventListener('DOMContentLoaded',()=>{
    mountSettings();
    new MutationObserver(mountSettings).observe(document.body,{childList:true,subtree:true});
    registerRelease(RELEASE).catch(error=>console.warn('TSB SW register failed',error));
  });
  window.addEventListener('pageshow',()=>check());
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)check()});
  setInterval(()=>check(),60000);
  window.TSB_RELEASE=RELEASE;
  window.TSB_FORCE_UPDATE=()=>check({manual:true,reload:true});
})();
