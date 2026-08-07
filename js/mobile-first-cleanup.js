// TSB Hub 0.10.6 — trash actions, confirm icons and week-only plans.
(function(){
  'use strict';

  const PRIMARY_TABS=new Set(['today','plans','finance']);
  const TAB_LABELS={today:'Сегодня',plans:'Планы',finance:'Финансы',important:'Важное',sync:'Синхронизация',settings:'Настройки'};
  const TAB_ICONS={today:'●',plans:'✓',finance:'₽',important:'!',sync:'↔',settings:'⚙'};
  const INPUT_SELECTOR='input, textarea, select, [contenteditable="true"]';
  let baselineViewportHeight=0,focusTimer=0,usageTimer=0,patchTimer=0;
  let reportWrapped=false,stableRenderWrapped=false,financeInsightsWrapped=false,plansWeekRerendering=false;

  const qs=(selector,root=document)=>root.querySelector(selector);
  const qsa=(selector,root=document)=>Array.from(root.querySelectorAll(selector));
  const label=tab=>TAB_LABELS[tab]||tab||'Ещё';
  const icon=tab=>TAB_ICONS[tab]||'•';
  const esc=value=>typeof escapeHTML==='function'?escapeHTML(value??''):String(value??'');
  const currentTab=()=>typeof state!=='undefined'&&state?.activeTab?state.activeTab:(document.body.dataset.activeTab||'today');
  const selectedDate=()=>typeof state!=='undefined'&&state?.selectedDate?state.selectedDate:dateISO();
  const dateISO=(d=new Date())=>typeof toISODate==='function'?toISODate(d):d.toISOString().slice(0,10);
  const addLocalDays=(iso,days)=>typeof addDays==='function'?addDays(iso,days):dateISO(new Date(new Date(`${iso}T00:00:00`).getTime()+days*86400000));
  const short=iso=>typeof shortDate==='function'?shortDate(iso):String(iso||'').slice(5);
  const timeHM=(d=new Date())=>`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  const minutesOfDay=(d=new Date())=>d.getHours()*60+d.getMinutes();
  const currentScrollY=()=>window.scrollY||document.documentElement.scrollTop||document.body.scrollTop||0;
  const safeApp=()=>typeof app!=='undefined'&&app?app:null;
  const trashIcon=()=>'<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-2 6h10l-.7 11H7.7L7 9Zm3 2v7h2v-7h-2Zm4 0v7h2v-7h-2Z" fill="currentColor"/></svg>';

  function setButtonLabel(button,tab){button.innerHTML=`<span class="nav-icon">${icon(tab)}</span><span>${label(tab)}</span>`}
  function isInput(node){return Boolean(node?.matches?.(INPUT_SELECTOR))}
  function schedulePatch(delay=40){clearTimeout(patchTimer);patchTimer=setTimeout(patchScreens,delay)}

  function restoreScroll(y,tab){
    const restore=()=>{if(!document.hidden&&currentTab()===tab)window.scrollTo(0,y)};
    restore();requestAnimationFrame(restore);setTimeout(restore,40);
  }

  function wrapStableRerenders(){
    if(stableRenderWrapped||typeof markChanged!=='function')return;
    const original=markChanged;
    markChanged=function(){
      const y=currentScrollY(),tab=currentTab();
      const result=original.apply(this,arguments);
      schedulePatch(0);restoreScroll(y,tab);
      return result;
    };
    stableRenderWrapped=true;
  }

  function softSave(){try{if(typeof saveData==='function')saveData(app,true)}catch(error){console.warn('TSB soft save failed',error)}}

  function viewportHeight(){return Math.round(window.visualViewport?.height||window.innerHeight||0)}
  function initViewportBaseline(){baselineViewportHeight=Math.max(baselineViewportHeight,viewportHeight())}
  function keyboardOpen(){return Boolean(baselineViewportHeight&&baselineViewportHeight-viewportHeight()>90)}
  function showNav(){document.body.classList.remove('nav-input-focus','input-focus')}
  function syncKeyboardNav(){initViewportBaseline();if(isInput(document.activeElement)&&keyboardOpen())document.body.classList.add('nav-input-focus');else if(!keyboardOpen())showNav()}
  function scheduleSync(delay=80){clearTimeout(focusTimer);focusTimer=setTimeout(syncKeyboardNav,delay)}

  function structureMenu(){
    const menu=qs('#mobileTabMenu');if(!menu)return;
    const existing=new Map(qsa('[data-tab-target]',menu).map(btn=>[btn.dataset.tabTarget,btn]));
    menu.innerHTML='';
    [{title:'Дневник',tabs:['important']},{title:'Система',tabs:['settings','sync']}].forEach(group=>{
      const wrap=document.createElement('div');wrap.className='mobile-menu-group';
      const title=document.createElement('div');title.className='mobile-menu-title';title.textContent=group.title;wrap.appendChild(title);
      group.tabs.forEach(tab=>{
        const btn=existing.get(tab)||document.createElement('button');btn.type='button';btn.dataset.tabTarget=tab;btn.hidden=false;btn.textContent=label(tab);
        btn.onclick=()=>{if(typeof setTab==='function')setTab(tab);if(typeof closeMobileTabMenu==='function')closeMobileTabMenu()};
        wrap.appendChild(btn);
      });
      menu.appendChild(wrap);
    });
  }

  function updateMoreState(){
    const tab=document.body.dataset.activeTab||'today',fab=qs('#mobileTabFab'),toggle=qs('#mobileTabToggle'),menu=qs('#mobileTabMenu');
    if(!fab||!toggle)return;
    const secondary=!PRIMARY_TABS.has(tab);fab.classList.toggle('secondary-active',secondary);
    if(secondary){toggle.setAttribute('aria-current','page');toggle.innerHTML=`<span>Ещё</span><span class="more-current">${label(tab)}</span>`}
    else{toggle.removeAttribute('aria-current');toggle.textContent='Ещё'}
    qsa('[data-tab-target]',menu||document.createElement('div')).forEach(btn=>btn.dataset.tabTarget===tab?btn.setAttribute('aria-current','page'):btn.removeAttribute('aria-current'));
  }

  function recordUsageOpen(){
    const data=safeApp();if(!data)return;
    data.appUsage=data.appUsage&&typeof data.appUsage==='object'?data.appUsage:{};
    const now=new Date(),min=minutesOfDay(now),hm=timeHM(now),today=dateISO(now),nightDate=min<240?addLocalDays(today,-1):today;
    const ensure=iso=>data.appUsage[iso]=data.appUsage[iso]||{firstMorningOpen:'',firstMorningAt:'',lastNightOpen:'',lastNightAt:'',lastOpen:'',openCount:0};
    const current=ensure(today);current.lastOpen=now.toISOString();current.openCount=Number(current.openCount||0)+1;
    if(min>=240&&min<=840&&(!current.firstMorningOpen||hm<current.firstMorningOpen)){current.firstMorningOpen=hm;current.firstMorningAt=now.toISOString()}
    if(min>=1200||min<240){const night=ensure(nightDate);if(!night.lastNightOpen||hm>night.lastNightOpen||min<240){night.lastNightOpen=hm;night.lastNightAt=now.toISOString()}}
    softSave();
  }
  function scheduleUsage(delay=500){clearTimeout(usageTimer);usageTimer=setTimeout(recordUsageOpen,delay)}

  function usageForWeekText(){
    const data=safeApp();if(!data?.appUsage)return '';
    const base=typeof getMondayISO==='function'?getMondayISO(selectedDate()):dateISO(),lines=[];
    for(let i=0;i<7;i+=1){const iso=addLocalDays(base,i),u=data.appUsage[iso]||{};lines.push(`  - ${iso}: утро ${u.firstMorningOpen||'—'}, ночь ${u.lastNightOpen||'—'}${u.firstMorningOpen&&u.lastNightOpen?' · сон можно оценивать только примерно по входам в приложение':''}`)}
    return `\nАвто-учёт входов в приложение:\n${lines.join('\n')}\nВажно: это не точный трекер сна. Если приложение открывалось за 2–3 часа до сна или не открывалось утром сразу после пробуждения, оценка сна низкой точности.`;
  }
  function wrapGptReport(){if(reportWrapped||typeof buildGptReport!=='function')return;const original=buildGptReport;buildGptReport=function(){return `${original()}${usageForWeekText()}`};reportWrapped=true}

  function wrapNeutralFinanceInsights(){
    if(financeInsightsWrapped||typeof getLocalInsights!=='function')return;
    const original=getLocalInsights;
    const blocked=new Set(['Финансы дня не закрыты','Есть незакрытые финансовые дни']);
    getLocalInsights=function(){return original.apply(this,arguments).filter(item=>!blocked.has(item?.title))};
    financeInsightsWrapped=true;
  }

  function usageListHTML(){
    const usage=safeApp()?.appUsage||{},today=dateISO(),rows=[];
    for(let i=0;i<7;i+=1){const iso=addLocalDays(today,-i),u=usage[iso]||{},last=u.lastOpen?new Date(u.lastOpen).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}):'';rows.push(`<article class="finance-card usage-log-row"><div class="item-top"><div><div class="badge-row"><span class="badge important">${esc(short(iso))}</span><span class="badge">входов ${Number(u.openCount||0)}</span></div><h3>${esc(u.firstMorningOpen||'—')} → ${esc(u.lastNightOpen||'—')}</h3><p class="muted">утро / ночь${last?` · последний вход ${esc(last)}`:''}</p></div></div></article>`)}
    return rows.join('');
  }
  function patchSettingsUsage(){
    const root=qs('#tab-settings');if(!root)return;
    let card=qs('[data-mf-settings-usage]',root);if(!card){card=document.createElement('section');card.className='card settings-usage-card';card.dataset.mfSettingsUsage='true';root.appendChild(card)}
    card.innerHTML=`<div class="card-title-row"><h2>Автовходы / примерный сон</h2></div><p class="muted">Первый утренний и последний ночной вход записываются автоматически. Это ориентир, а не точный трекер сна.</p><div class="finance-list">${usageListHTML()}</div>`;
  }

  function currentWeightISO(){return typeof getWeeklyWeightISO==='function'?getWeeklyWeightISO(dateISO()):dateISO()}
  function currentWeightValue(){try{return getHealth(currentWeightISO()).weight||''}catch{return ''}}
  function shouldShowWeightPrompt(){const now=new Date();return now.getDay()===1&&!currentWeightValue()}
  function weightFormHTML(prefix){return `<form class="form-grid weight weekly-weight-inline" data-mf-weight-form="${prefix}"><label>Актуальный вес, кг<input name="weight" inputmode="decimal" placeholder="Напр. 110" value="${esc(currentWeightValue())}"></label><button class="primary-button" type="submit">Сохранить вес</button></form>`}
  function bindWeightForms(root=document){qsa('[data-mf-weight-form]',root).forEach(form=>{if(form.dataset.bound)return;form.dataset.bound='1';form.onsubmit=event=>{event.preventDefault();if(typeof getHealth!=='function')return;const value=new FormData(form).get('weight');getHealth(currentWeightISO()).weight=typeof normalizeWeightInput==='function'?(normalizeWeightInput(value)||null):(value||null);if(typeof markChanged==='function')markChanged();else softSave();if(typeof showToast==='function')showToast('Вес сохранён')}})}
  function patchTodayWeight(){const root=qs('#tab-today.active');if(!root||qs('[data-mf-weight-card]',root)||!shouldShowWeightPrompt())return;const card=document.createElement('section');card.className='card today-input-card';card.dataset.mfWeightCard='true';card.innerHTML=`<div class="card-title-row"><h2>Вес недели</h2></div>${weightFormHTML('today')}`;root.prepend(card);bindWeightForms(card)}
  function patchSettingsWeight(){const root=qs('#tab-settings');if(!root||qs('[data-mf-settings-weight]',root))return;const card=document.createElement('section');card.className='card settings-weight-card';card.dataset.mfSettingsWeight='true';card.innerHTML=`<div class="card-title-row"><h2>Вес сейчас</h2></div>${weightFormHTML('settings')}`;root.appendChild(card);bindWeightForms(card)}

  function patchFoodRemoval(){qsa('[data-tab="food"],[data-tab-target="food"]').forEach(el=>{el.hidden=true;el.style.display='none'});const page=qs('#tab-food');if(page)page.hidden=true;if(currentTab()==='food'&&typeof setTab==='function')setTab('today')}
  function patchTodayHeaderButtons(){const root=qs('#tab-today');if(!root)return;qsa('.card-title-row [data-tab-target="plans"],.card-title-row [data-tab-target="finance"],.card-title-row [data-tab-target="food"]',root).forEach(btn=>btn.remove());const line=qs('.today-finance-card .finance-summary-line',root);if(line&&!line.dataset.mfNoAssets){line.textContent=line.textContent.replace(/\s*·\s*активы:[^·]*/i,'');line.dataset.mfNoAssets='1'}}

  function patchPlansWeekOnly(){
    const data=safeApp();if(!data?.settings)return;
    const wasSelectedOnly=Boolean(data.settings.showSelectedDayOnly);
    if(wasSelectedOnly){data.settings.showSelectedDayOnly=false;softSave()}
    const cleanControls=()=>{
      const root=qs('#tab-plans');
      qs('#toggleSelectedDayOnly',root||document)?.remove();
      const setting=qs('#showSelectedDayOnlySetting');
      setting?.closest('.setting-row')?.remove();
      root?.querySelector('.week-grid')?.classList.remove('single-day');
    };
    if(wasSelectedOnly&&currentTab()==='plans'&&typeof renderPlans==='function'&&!plansWeekRerendering){
      plansWeekRerendering=true;
      renderPlans();
      plansWeekRerendering=false;
    }
    cleanControls();
  }

  function patchFinanceNoExpenseState(){
    qsa('[data-finance-no-expenses]').forEach(button=>button.remove());
    qsa('.finance-summary-line').forEach(line=>{if(/без трат|отметка.*трат/i.test(line.textContent||''))line.remove()});
    let changed=false;
    Object.values(safeApp()?.finance||{}).forEach(day=>{if(day?.noExpenses){day.noExpenses=false;changed=true}});
    if(changed&&typeof saveData==='function')saveData(app,true);
  }

  function isoFromDetails(details){return details.dataset.detailsKey?.match(/(\d{4}-\d{2}-\d{2})$/)?.[1]||selectedDate()}
  function exactTodaySummary(details){
    const key=details.dataset.detailsKey||'',iso=isoFromDetails(details);
    if(key.startsWith('today-tasks-')&&typeof getProgress==='function')return `Задачи дня • ${getProgress(iso).total}`;
    if(key.startsWith('today-food-')&&typeof getHealth==='function')return `Питание дня • ${(getHealth(iso).meals||[]).length}`;
    if(key.startsWith('today-finance-')&&typeof getFinanceSummary==='function')return `Финансы дня • ${getFinanceSummary(iso).count}`;
    return '';
  }
  function genericSummary(raw){
    let clean=String(raw||'').replace(/[⌄▾▴▲▼]/g,' ').replace(/^Показать\s+/i,'').replace(/\s+/g,' ').trim();
    const match=clean.match(/^(.*?)[\s·•:]+(\d+(?:\s*[·•]\s*\d+\s*дн\.)?)$/i);
    if(match)return `${match[1].replace(/[\s·•:]+$/g,'').trim()} • ${match[2].replace(/\s*[·•]\s*/g,' · ').trim()}`;
    return clean.replace(/(?:\s*[·•]\s*){2,}/g,' • ').replace(/[\s·•]+$/g,'').trim();
  }
  function patchCollapsibleSummaries(root=document){
    qsa('details.collapsible-list',root).forEach(details=>{
      const summary=details.querySelector(':scope>summary');if(!summary)return;
      const title=exactTodaySummary(details)||genericSummary(summary.querySelector('.mf-summary-title')?.textContent||summary.textContent);
      summary.innerHTML=`<span class="mf-summary-title">${esc(title)}</span><span class="mf-summary-arrow" aria-hidden="true">⌄</span>`;
      summary.dataset.mfCleanSummary='true';
    });
  }

  function patchDailyReportLabels(){const root=qs('#tab-today');if(!root||typeof getDailyReport!=='function')return;const chips=qsa('.daily-report-status .summary-chip',root);if(chips.length<3)return;const report=getDailyReport(selectedDate());chips[0].textContent=`Самоощущение ${report.selfScore||'—'}`;chips[1].textContent=`Желание ${report.driveScore||'—'}`;chips[2].textContent=String(report.text||'').trim()?'Комментарий +':'Комментарий -'}

  function patchActionButtonText(root=document){
    qsa('.actions button,.item-top button,.task-top button',root).forEach(btn=>{
      const text=btn.textContent.trim();
      if(text==='Изм.'||text==='Изменить'){
        btn.title='Изменить';btn.setAttribute('aria-label','Изменить');btn.textContent='✎';btn.classList.add('mf-icon-action');
      }
      if(text==='Удал.'||text==='Удалить'||(text==='×'&&btn.classList.contains('danger-button'))){
        btn.title='Удалить';btn.setAttribute('aria-label','Удалить');btn.innerHTML=trashIcon();btn.classList.add('mf-icon-action','mf-trash-action');
      }
    });
  }

  function taskStateBadge(card){const row=card.querySelector('.badge-row');if(!row)return null;let badge=row.querySelector('.mf-task-state-badge');if(!badge){badge=document.createElement('span');badge.className='badge mf-task-state-badge';row.appendChild(badge)}qsa('.done-badge',row).forEach(el=>{if(el!==badge)el.remove()});return badge}
  function applyTaskState(card,task,button){card.classList.toggle('done',Boolean(task.done));const badge=taskStateBadge(card);if(badge){badge.textContent=task.done?'Выполнено':'Не выполнено';badge.classList.toggle('done-badge',Boolean(task.done));badge.classList.toggle('secondary',!task.done)}if(button){button.textContent='✓';button.title=task.done?'Вернуть задачу в невыполненные':'Отметить задачу выполненной';button.setAttribute('aria-label',button.title);button.setAttribute('aria-pressed',String(Boolean(task.done)));button.classList.toggle('active',Boolean(task.done));button.classList.add('mf-confirm-action')}}
  function refreshTaskSummary(iso){if(typeof getProgress!=='function')return;const p=getProgress(iso);if(iso===selectedDate()){const chips=qsa('#tab-today .today-summary-compact .summary-chip');if(chips[0])chips[0].textContent=`Задачи ${p.done}/${p.total}`;if(chips[1])chips[1].textContent=`Выполнение ${p.pct}%`;const title=qs(`#tab-today details[data-details-key="today-tasks-${iso}"] .mf-summary-title`);if(title)title.textContent=`Задачи дня • ${p.total}`}}
  function toggleTask(button){const iso=button.dataset.date||selectedDate(),task=typeof findTask==='function'?findTask(iso,button.dataset.mfTaskAccept):null;if(!task)return;task.done=!task.done;if(task.done){task.failed=false;task.completedAt=task.completedAt||new Date().toISOString();task.completedForDate=iso;task.completionMode=task.completionMode||'same_day'}else{task.completedAt='';task.completedForDate='';task.completionMode=''}if(typeof saveData==='function')saveData(app,true);const card=button.closest('.task-card');if(card)applyTaskState(card,task,button);refreshTaskSummary(iso);if(typeof showToast==='function')showToast(task.done?'Задача выполнена':'Задача снова активна')}
  function patchTaskControls(root=document){qsa('.task-card',root).forEach(card=>{const checkbox=card.querySelector('input[data-task-toggle]'),existing=card.querySelector('[data-mf-task-accept]'),id=checkbox?.dataset.taskToggle||existing?.dataset.mfTaskAccept,iso=checkbox?.dataset.date||existing?.dataset.date||selectedDate();if(!id)return;if(checkbox)checkbox.remove();const actions=card.querySelector('.actions');if(!actions)return;let button=existing;if(!button){button=document.createElement('button');button.type='button';button.className='ghost-button mf-task-accept mf-icon-action mf-confirm-action';button.dataset.mfTaskAccept=id;button.dataset.date=iso;const edit=actions.querySelector('[data-task-edit]');edit?actions.insertBefore(button,edit):actions.prepend(button)}else button.classList.add('mf-icon-action','mf-confirm-action');button.onclick=event=>{event.preventDefault();event.stopPropagation();toggleTask(button)};const task=typeof findTask==='function'?findTask(iso,id):null;if(task)applyTaskState(card,task,button)})}

  async function editTodayFinance(button){
    if(typeof openEditDialog!=='function'||typeof getFinance!=='function')return;
    const iso=button.dataset.date||selectedDate(),expense=getFinance(iso).expenses.find(item=>item.id===button.dataset.mfFinanceEdit);if(!expense)return;
    const result=await openEditDialog({title:'Изменить трату',fields:[{name:'amount',label:'Сумма, ₽',value:expense.amount||''},{name:'category',label:'Категория',type:'select',value:expense.category,options:FINANCE_CATEGORIES},{name:'comment',label:'Описание',type:'textarea',value:expense.comment||expense.detail||'',placeholder:'Напр. лекарства, врач, продукты домой'},{name:'time',label:'Время',type:'time',value:expense.time||''}],submitText:'Сохранить'});if(!result)return;
    const amount=typeof normalizeMoneyInput==='function'?normalizeMoneyInput(result.amount):String(result.amount||'');if(!amount)return;const oldAmount=typeof moneyNumber==='function'?moneyNumber(expense.amount):Number(expense.amount||0),newAmount=typeof moneyNumber==='function'?moneyNumber(amount):Number(amount||0);expense.amount=amount;expense.category=typeof normalizeFinanceCategory==='function'?normalizeFinanceCategory(result.category):result.category;expense.comment=String(result.comment||'').trim();expense.detail=expense.comment;expense.time=String(result.time||'').trim();expense.updatedAt=new Date().toISOString();if(typeof addAvailableBalance==='function')addAvailableBalance(oldAmount-newAmount);if(typeof getFinanceContext==='function'){const op=getFinanceContext().operations.find(item=>item.sourceId===expense.id&&item.type==='expense');if(op){op.amount=String(-newAmount);op.title=typeof getFinanceCategoryLabel==='function'?getFinanceCategoryLabel(expense.category):expense.category;op.comment=expense.comment}}if(typeof saveData==='function')saveData(app,true);const y=currentScrollY(),tab=currentTab();if(typeof renderToday==='function')renderToday();patchScreens();restoreScroll(y,tab);if(typeof showToast==='function')showToast('Трата изменена');
  }
  function patchTodayFinanceEdit(){const root=qs('#tab-today');if(!root)return;qsa('.today-finance-card .finance-card',root).forEach(card=>{const del=card.querySelector('[data-finance-delete]');if(!del)return;const id=del.dataset.financeDelete;let edit=card.querySelector(`[data-mf-finance-edit="${id}"]`);if(!edit){edit=document.createElement('button');edit.type='button';edit.className='ghost-button mf-icon-action';edit.dataset.mfFinanceEdit=id;edit.dataset.date=selectedDate();edit.title='Изменить и добавить описание';edit.setAttribute('aria-label','Изменить трату');edit.textContent='✎';del.parentElement?.insertBefore(edit,del)}edit.onclick=event=>{event.preventDefault();event.stopPropagation();editTodayFinance(edit)}})}

  function patchScreens(){patchFoodRemoval();patchPlansWeekOnly();patchTodayWeight();patchSettingsWeight();patchSettingsUsage();patchTodayHeaderButtons();patchFinanceNoExpenseState();patchCollapsibleSummaries(document);patchDailyReportLabels();patchTaskControls(document);patchTodayFinanceEdit();patchActionButtonText(document);bindWeightForms(document)}

  function setupInputFocusGuard(){
    initViewportBaseline();
    document.addEventListener('focusin',event=>{if(isInput(event.target)){document.body.classList.add('nav-input-focus');scheduleSync(250)}},true);
    document.addEventListener('focusout',()=>scheduleSync(120),true);
    document.addEventListener('pointerdown',event=>{if(!isInput(event.target))scheduleSync(120)},true);
    window.visualViewport?.addEventListener('resize',()=>scheduleSync(80));window.visualViewport?.addEventListener('scroll',()=>scheduleSync(80));window.addEventListener('resize',()=>scheduleSync(80));
    window.addEventListener('pageshow',()=>{baselineViewportHeight=0;showNav();scheduleSync(120);scheduleUsage(300);schedulePatch(120)});
    document.addEventListener('visibilitychange',()=>{if(!document.hidden){baselineViewportHeight=0;showNav();scheduleSync(120);scheduleUsage(300);schedulePatch(120)}});
  }

  function setup(){
    wrapStableRerenders();wrapNeutralFinanceInsights();
    const data=safeApp();if(data?.settings?.showSelectedDayOnly){data.settings.showSelectedDayOnly=false;softSave()}
    qsa('.tabs .tab-button').forEach(button=>{if(TAB_LABELS[button.dataset.tab])setButtonLabel(button,button.dataset.tab)});
    const toggle=qs('#mobileTabToggle');if(toggle){toggle.textContent='Ещё';toggle.title='Ещё разделы';toggle.setAttribute('aria-label','Ещё разделы приложения')}
    structureMenu();updateMoreState();syncKeyboardNav();wrapGptReport();scheduleUsage();schedulePatch(0);
  }

  document.addEventListener('DOMContentLoaded',()=>{setup();setupInputFocusGuard()});window.addEventListener('load',setup);
  const observer=new MutationObserver(()=>{updateMoreState();schedulePatch(30)});
  if(document.body)observer.observe(document.body,{attributes:true,attributeFilter:['data-active-tab']});else document.addEventListener('DOMContentLoaded',()=>observer.observe(document.body,{attributes:true,attributeFilter:['data-active-tab']}));
})();
