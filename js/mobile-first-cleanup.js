// TSB Hub 0.9.6 — mobile shell cleanup, usage log, weight prompt, and keyboard recovery.
(function(){
  const PRIMARY_TABS=new Set(['today','plans','finance']);
  const TAB_LABELS={today:'Сегодня',plans:'Планы',finance:'Финансы',important:'Важное',sync:'Синхронизация',settings:'Настройки'};
  const TAB_ICONS={today:'●',plans:'✓',finance:'₽',important:'!',sync:'↔',settings:'⚙'};
  const INPUT_SELECTOR='input, textarea, select, [contenteditable="true"]';
  let baselineViewportHeight=0;
  let focusTimer=0;
  let usageTimer=0;
  let renderPatchTimer=0;
  let reportWrapped=false;
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
  function syncKeyboardNav(){initViewportBaseline();if(isInput(document.activeElement)&&keyboardLooksOpen())hideNavForKeyboard();else if(!keyboardLooksOpen())showNavAfterKeyboard()}
  function scheduleSync(delay=80){clearTimeout(focusTimer);focusTimer=setTimeout(syncKeyboardNav,delay)}
  function safeApp(){return typeof app!=='undefined'&&app?app:null}
  function dateISO(d=new Date()){return typeof toISODate==='function'?toISODate(d):d.toISOString().slice(0,10)}
  function addLocalDays(iso,days){return typeof addDays==='function'?addDays(iso,days):dateISO(new Date(new Date(`${iso}T00:00:00`).getTime()+days*86400000))}
  function timeHM(d=new Date()){return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`}
  function minutesOfDay(d=new Date()){return d.getHours()*60+d.getMinutes()}
  function markSoftSave(){try{if(typeof saveData==='function')saveData(app,true)}catch(e){}}
  function wireMenuButton(button){button.onclick=()=>{if(typeof setTab==='function')setTab(button.dataset.tabTarget);if(typeof closeMobileTabMenu==='function')closeMobileTabMenu()}}
  function structureMenu(){
    const menu=qs('#mobileTabMenu');
    if(!menu)return;
    const existing=new Map(qsa('[data-tab-target]',menu).map(btn=>[btn.dataset.tabTarget,btn]));
    menu.innerHTML='';
    const groups=[{title:'Дневник',tabs:['important']},{title:'Система',tabs:['settings','sync']}];
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
  function recordUsageOpen(){
    const data=safeApp();if(!data)return;
    data.appUsage=data.appUsage&&typeof data.appUsage==='object'?data.appUsage:{};
    const now=new Date(),min=minutesOfDay(now),hm=timeHM(now),today=dateISO(now);
    const nightDate=min<240?addLocalDays(today,-1):today;
    const ensure=iso=>data.appUsage[iso]=data.appUsage[iso]||{firstMorningOpen:'',firstMorningAt:'',lastNightOpen:'',lastNightAt:'',lastOpen:'',openCount:0};
    const todayEntry=ensure(today);todayEntry.lastOpen=now.toISOString();todayEntry.openCount=Number(todayEntry.openCount||0)+1;
    let changed=true;
    if(min>=240&&min<=840){
      if(!todayEntry.firstMorningOpen||hm<todayEntry.firstMorningOpen){todayEntry.firstMorningOpen=hm;todayEntry.firstMorningAt=now.toISOString()}
    }
    if(min>=1200||min<240){
      const entry=ensure(nightDate);
      if(!entry.lastNightOpen||hm>entry.lastNightOpen||min<240){entry.lastNightOpen=hm;entry.lastNightAt=now.toISOString()}
    }
    if(changed)markSoftSave();
  }
  function scheduleUsageRecord(delay=500){clearTimeout(usageTimer);usageTimer=setTimeout(recordUsageOpen,delay)}
  function usageForWeekText(){
    const data=safeApp();if(!data?.appUsage)return '';
    const base=typeof getMondayISO==='function'?getMondayISO(state?.selectedDate||dateISO()):dateISO();
    const lines=[];
    for(let i=0;i<7;i+=1){const iso=addLocalDays(base,i),u=data.appUsage[iso]||{};lines.push(`  - ${iso}: утро ${u.firstMorningOpen||'—'}, ночь ${u.lastNightOpen||'—'}${u.firstMorningOpen&&u.lastNightOpen?' · сон можно оценивать только примерно по входам в приложение':''}`)}
    return `\nАвто-учёт входов в приложение:\n${lines.join('\n')}\nВажно: это не точный трекер сна. Если приложение открывалось за 2–3 часа до сна или не открывалось утром сразу после пробуждения, оценка сна низкой точности.`;
  }
  function wrapGptReport(){
    if(reportWrapped||typeof buildGptReport!=='function')return;
    const original=buildGptReport;
    buildGptReport=function(){return `${original()}${usageForWeekText()}`};
    reportWrapped=true;
  }
  function currentWeightISO(){return typeof getWeeklyWeightISO==='function'?getWeeklyWeightISO(dateISO()):dateISO()}
  function currentWeightValue(){try{return getHealth(currentWeightISO()).weight||''}catch(e){return ''}}
  function shouldShowWeightPrompt(){const now=new Date();if(now.getDay()!==1)return false;return !currentWeightValue()}
  function weightFormHTML(prefix='today'){
    return `<form class="form-grid weight weekly-weight-inline" data-mf-weight-form="${prefix}"><label>Актуальный вес, кг<input name="weight" inputmode="decimal" placeholder="Напр. 110" value="${typeof escapeHTML==='function'?escapeHTML(currentWeightValue()):currentWeightValue()}"></label><button class="primary-button" type="submit">Сохранить вес</button></form>`
  }
  function bindWeightForms(root=document){
    qsa('[data-mf-weight-form]',root).forEach(form=>{if(form.dataset.bound==='true')return;form.dataset.bound='true';form.onsubmit=e=>{e.preventDefault();const data=safeApp();if(!data||typeof getHealth!=='function')return;const fd=new FormData(form);const iso=currentWeightISO();getHealth(iso).weight=typeof normalizeWeightInput==='function'?(normalizeWeightInput(fd.get('weight'))||null):(fd.get('weight')||null);if(typeof markChanged==='function')markChanged();else markSoftSave();if(typeof showToast==='function')showToast('Вес сохранён')}})
  }
  function patchTodayWeight(){
    const root=qs('#tab-today.active');if(!root||qs('[data-mf-weight-card]',root)||!shouldShowWeightPrompt())return;
    const card=document.createElement('section');card.className='card today-input-card';card.dataset.mfWeightCard='true';
    card.innerHTML=`<div class="card-title-row"><h2>Вес недели</h2></div><p class="muted">Появляется по понедельникам. После сохранения прячется до следующей недели.</p>${weightFormHTML('today')}`;
    const anchor=root.querySelector('.today-summary-compact');
    if(anchor&&anchor.nextSibling)root.insertBefore(card,anchor.nextSibling);else root.prepend(card);
    bindWeightForms(card);
  }
  function patchSettingsWeight(){
    const root=qs('#tab-settings');if(!root||qs('[data-mf-settings-weight]',root))return;
    const card=document.createElement('section');card.className='card settings-weight-card';card.dataset.mfSettingsWeight='true';
    card.innerHTML=`<div class="card-title-row"><h2>Вес сейчас</h2></div><p class="muted">Текущий вес хранится по неделям. На главном экране ввод появляется по понедельникам.</p>${weightFormHTML('settings')}`;
    root.appendChild(card);bindWeightForms(card);
  }
  function patchFoodRemoval(){
    qsa('[data-tab="food"],[data-tab-target="food"]').forEach(el=>{el.hidden=true;el.style.display='none'});
    const foodPage=qs('#tab-food');if(foodPage)foodPage.hidden=true;
    if((document.body.dataset.activeTab||state?.activeTab)==='food'&&typeof setTab==='function')setTab('today');
  }
  function patchScreens(){patchFoodRemoval();patchTodayWeight();patchSettingsWeight();bindWeightForms(document)}
  function scheduleScreenPatch(delay=80){clearTimeout(renderPatchTimer);renderPatchTimer=setTimeout(patchScreens,delay)}
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
    window.addEventListener('pageshow',()=>{baselineViewportHeight=0;showNavAfterKeyboard();scheduleSync(120);scheduleUsageRecord(300);scheduleScreenPatch(120)});
    document.addEventListener('visibilitychange',()=>{if(!document.hidden){baselineViewportHeight=0;showNavAfterKeyboard();scheduleSync(120);scheduleUsageRecord(300);scheduleScreenPatch(120)}});
  }
  function setupMobileFirstCleanup(){
    qsa('.tabs .tab-button').forEach(button=>{const tab=button.dataset.tab;if(TAB_LABELS[tab])setButtonLabel(button,tab)});
    const toggle=qs('#mobileTabToggle');
    if(toggle){toggle.textContent='Ещё';toggle.title='Ещё разделы';toggle.setAttribute('aria-label','Ещё разделы приложения')}
    structureMenu();updateMoreState();syncKeyboardNav();wrapGptReport();scheduleUsageRecord();scheduleScreenPatch();
  }
  document.addEventListener('DOMContentLoaded',()=>{setupMobileFirstCleanup();setupInputFocusGuard()});
  window.addEventListener('load',setupMobileFirstCleanup);
  const observer=new MutationObserver(()=>{updateMoreState();scheduleScreenPatch(60)});
  if(document.body)observer.observe(document.body,{attributes:true,attributeFilter:['data-active-tab']});
  else document.addEventListener('DOMContentLoaded',()=>observer.observe(document.body,{attributes:true,attributeFilter:['data-active-tab']}));
})();
