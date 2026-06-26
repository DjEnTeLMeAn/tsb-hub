// TSB Hub 0.9.3 — unified mobile navigation behavior.
(function(){
  const PRIMARY_TABS=new Set(['today','plans','finance']);
  const TAB_LABELS={today:'Сегодня',plans:'Планы',finance:'Финансы',food:'Питание',important:'Важное',sync:'Синхронизация',settings:'Настройки'};
  const TAB_ICONS={today:'●',plans:'✓',finance:'₽',food:'🍽',important:'!',sync:'↔',settings:'⚙'};
  function qs(selector,root=document){return root.querySelector(selector)}
  function qsa(selector,root=document){return Array.from(root.querySelectorAll(selector))}
  function label(tab){return TAB_LABELS[tab]||tab||'Ещё'}
  function icon(tab){return TAB_ICONS[tab]||'•'}
  function setButtonLabel(button,tab){button.innerHTML=`<span class="nav-icon">${icon(tab)}</span><span>${label(tab)}</span>`}
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
    const selector='input, textarea, select, [contenteditable="true"]';
    document.addEventListener('focusin',event=>{if(event.target.matches(selector))document.body.classList.add('nav-input-focus')},true);
    document.addEventListener('focusout',()=>{setTimeout(()=>{if(!document.activeElement||!document.activeElement.matches(selector))document.body.classList.remove('nav-input-focus')},180)},true);
    window.visualViewport?.addEventListener('resize',()=>{if(document.activeElement?.matches(selector))document.body.classList.add('nav-input-focus')});
  }
  function setupMobileFirstCleanup(){
    qsa('.tabs .tab-button').forEach(button=>{const tab=button.dataset.tab;if(TAB_LABELS[tab])setButtonLabel(button,tab)});
    const toggle=qs('#mobileTabToggle');
    if(toggle){toggle.textContent='Ещё';toggle.title='Ещё разделы';toggle.setAttribute('aria-label','Ещё разделы приложения')}
    structureMenu();updateMoreState();
  }
  document.addEventListener('DOMContentLoaded',()=>{setupMobileFirstCleanup();setupInputFocusGuard()});
  window.addEventListener('load',setupMobileFirstCleanup);
  const observer=new MutationObserver(updateMoreState);
  if(document.body)observer.observe(document.body,{attributes:true,attributeFilter:['data-active-tab']});
  else document.addEventListener('DOMContentLoaded',()=>observer.observe(document.body,{attributes:true,attributeFilter:['data-active-tab']}));
})();
