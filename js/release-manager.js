// TSB Hub v0.10.1-full-republish — final PWA update authority.
(function(){
  const RELEASE='v0.10.1-full-republish';
  const SW_URL=`./service-worker.js?v=${RELEASE}`;
  let reloading=false;

  async function activateLatest(){
    if(!('serviceWorker' in navigator))return;
    try{
      const registration=await navigator.serviceWorker.register(SW_URL,{updateViaCache:'none'});
      await registration.update();
      if(registration.waiting)registration.waiting.postMessage({type:'SKIP_WAITING'});
      if(registration.active)registration.active.postMessage({type:'TSB_FORCE_REFRESH'});
    }catch(error){
      console.warn('TSB release update failed',error);
    }
  }

  navigator.serviceWorker?.addEventListener('controllerchange',()=>{
    if(reloading)return;
    reloading=true;
    window.location.reload();
  });

  navigator.serviceWorker?.addEventListener('message',event=>{
    if(event.data?.type==='TSB_REFRESH_READY'){
      document.documentElement.dataset.tsbRelease=event.data.release||RELEASE;
    }
  });

  window.addEventListener('load',activateLatest);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)activateLatest()});
  window.addEventListener('pageshow',activateLatest);
  window.TSB_RELEASE=RELEASE;
  window.TSB_FORCE_UPDATE=activateLatest;
})();
