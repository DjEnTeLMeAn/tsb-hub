// TSB Hub 0.9.5 — unified mobile navigation behavior with keyboard recovery.
(function(){
  const PRIMARY_TABS=new Set(['today','plans','finance']);
  const TAB_LABELS={today:'Сегодня',plans:'Планы',finance:'Финансы',food:'Питание',important:'Важное',sync:'Синхронизация',settings:'Настройки'};
  const TAB_ICONS={today:'●',plans:'✓',finance:'₽',food:'🍽',important:'!',sync:'↔',settings:'⚙'};
  const INPUT_SELECTOR='input, textarea, select, [contenteditable="true"]';
  let baselineViewportHeight=0;
  let focusTimer=0;
  function qs(selector,root=document){return root.querySelector(selector)}
  function qsa(selector,root=document){return Array.from(root.querySelectorAll(selector))}
  function label(tab){return TAB_LABELS[tab]||tab||'Ещё'}
  function icon(tab){return TAB_ICONS[tab]||'•'}
  function setButtonLabel(button,tab){button.innerHTML=`<span class="nav-icon">${icon(tab)}</span><span>${label(tab)}</span>`}
  function isInput(node){return Boolean(node&&node.matches&&node.matches(INPUT_SELECTOR))}
  function viewportHeight(){return Math.round(window.visualViewport?.height||window.innerHeight||0)}
  function initViewportBaseline(){baselineViewportHeight=Math.max(baselineViewportHeight,viewportHeight())}
  function keyboardLooksOpen(){const h=viewportHeight();return baselineViewportHeight&&baselineViewportHeight-h>90}
  function hideNavForKeyboard(){document.body.classList.add('nav-input-focus')}
  function showNavAfterKeyboard(){document.body.classList.remove('nav-input-focus');document.body.classList.remove('input-focus')}
  function syncKeyboardNav(){
    initViewportBaseline();
    if(isInput(document.activeElement)&&keyboardLooksOpen())hideNavForKeyboard();
    else if(!keyboardLooksOpen())showNavAfterKeyboard();
  }
  function scheduleSync(delay=80){clearTimeout(focusTimer);focusTimer=setTimeout(syncKeyboardNav,delay)}
  function wireMenuButton(button){button.onclick=()=>{if(typeof setTab==='function')setTab(button.dataset.tabTarget);if(typeof closeMobileTabMenu==='function')closeMobileTabMenu()}}
  function structureMenu(){
    const menu=qs('#mobileTabMenu');
    if(!menu||menu.dataset.structured==='true')return;
    const existing=new Map(qsa('[data-tab-target]',menu).map(btn=>[btn.dataset.tabTarget,btn]));
    menu.innerHTML='';
    const groups=[{title:'Дневник',tabs:['food','important']},{title:'Система',tabs:['settings','sync']}];
    groups.forEach(group=>{
      const wrap=document.createElement('div');wrap.className='mobile-menu-group';
      const title=document.createElement('div');title.className='mobile-menu-title';title.textContent=group.title;wrap.appendChild(title);
      group.tabs.forEach(tab=>{
        const btn=existing.get(tab)||document.createElement('button');
        btn.type='button';btn.dataset.tabTarget=tab;btn.hidden=false;btn.textContent=label(tab);wireMenuButton(btn);wrap.appendChild(btn);
      });
      menu.appendChild(wrap);
    });
    menu.dataset.structured='true';
  }
  function updateMoreState(){
    const activeTab=document.body.dataset.activeTab||'today';
    const fab=qs('#mobileTabFab');const toggle=qs('#mobileTabToggle');const menu=qs('#mobileTabMenu');
    if(!fab||!toggle)return;
    const secondaryActive=!PRIMARY_TABS.has(activeTab);
    fab.classList.toggle('secondary-active',secondaryActive);
    if(secondaryActive){toggle.setAttribute('aria-current','page');toggle.innerHTML=`<span>Ещё</span><span class="more-current">${label(activeTab)}</span>`}
    else{toggle.removeAttribute('aria-current');toggle.textContent='Ещё'}
    if(menu){qsa('[data-tab-target]',menu).forEach(btn=>{const active=btn.dataset.tabTarget===activeTab;if(active)btn.setAttribute('aria-current','page');else btn.removeAttribute('aria-current')})}
  }
  function setupInputFocusGuard(){
    initViewportBaseline();
    document.addEventListener('focusin',event=>{if(isInput(event.target)){hideNavForKeyboard();scheduleSync(250)}},true);
    document.addEventListener('focusout',()=>scheduleSync(120),true);
    document.addEventListener('pointerdown',event=>{if(isInput(event.target))hideNavForKeyboard();else scheduleSync(120)},true);
    document.addEventListener('touchend',event=>{if(!isInput(event.target))scheduleSync(180)},true);
    window.visualViewport?.addEventListener('resize',()=>scheduleSync(80));
    window.visualViewport?.addEventListener('scroll',()=>scheduleSync(80));
    window.addEventListener('resize',()=>scheduleSync(80));
    window.addEventListener('orientationchange',()=>{baselineViewportHeight=0;scheduleSync(300)});
    window.addEventListener('pageshow',()=>{baselineViewportHeight=0;showNavAfterKeyboard();scheduleSync(120)});
    document.addEventListener('visibilitychange',()=>{if(!document.hidden){baselineViewportHeight=0;showNavAfterKeyboard();scheduleSync(120)}});
  }
  function setupMobileFirstCleanup(){
    qsa('.tabs .tab-button').forEach(button=>{const tab=button.dataset.tab;if(TAB_LABELS[tab])setButtonLabel(button,tab)});
    const toggle=qs('#mobileTabToggle');
    if(toggle){toggle.textContent='Ещё';toggle.title='Ещё разделы';toggle.setAttribute('aria-label','Ещё разделы приложения')}
    structureMenu();updateMoreState();syncKeyboardNav();
  }
  document.addEventListener('DOMContentLoaded',()=>{setupMobileFirstCleanup();setupInputFocusGuard()});
  window.addEventListener('load',setupMobileFirstCleanup);
  const observer=new MutationObserver(updateMoreState);
  if(document.body)observer.observe(document.body,{attributes:true,attributeFilter:['data-active-tab']});
  else document.addEventListener('DOMContentLoaded',()=>observer.observe(document.body,{attributes:true,attributeFilter:['data-active-tab']}));
})();
