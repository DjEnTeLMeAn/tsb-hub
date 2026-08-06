// TSB Hub 0.10.3 — stable task controls, clean summaries and editable quick finance.
(function(){
  'use strict';

  const PRIMARY_TABS=new Set(['today','plans','finance']);
  const TAB_LABELS={today:'Сегодня',plans:'Планы',finance:'Финансы',important:'Важное',sync:'Синхронизация',settings:'Настройки'};
  const TAB_ICONS={today:'●',plans:'✓',finance:'₽',important:'!',sync:'↔',settings:'⚙'};
  const INPUT_SELECTOR='input, textarea, select, [contenteditable="true"]';

  let baselineViewportHeight=0;
  let focusTimer=0;
  let usageTimer=0;
  let renderPatchTimer=0;
  let reportWrapped=false;
  let stableRenderWrapped=false;

  function qs(selector,root=document){return root.querySelector(selector)}
  function qsa(selector,root=document){return Array.from(root.querySelectorAll(selector))}
  function label(tab){return TAB_LABELS[tab]||tab||'Ещё'}
  function icon(tab){return TAB_ICONS[tab]||'•'}
  function setButtonLabel(button,tab){button.innerHTML=`<span class="nav-icon">${icon(tab)}</span><span>${label(tab)}</span>`}
  function isInput(node){return Boolean(node&&node.matches&&node.matches(INPUT_SELECTOR))}
  function safeApp(){return typeof app!=='undefined'&&app?app:null}
  function esc(value){return typeof escapeHTML==='function'?escapeHTML(value??''):String(value??'')}
  function dateISO(d=new Date()){return typeof toISODate==='function'?toISODate(d):d.toISOString().slice(0,10)}
  function addLocalDays(iso,days){return typeof addDays==='function'?addDays(iso,days):dateISO(new Date(new Date(`${iso}T00:00:00`).getTime()+days*86400000))}
  function short(iso){return typeof shortDate==='function'?shortDate(iso):String(iso||'').slice(5)}
  function timeHM(d=new Date()){return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`}
  function minutesOfDay(d=new Date()){return d.getHours()*60+d.getMinutes()}
  function currentScrollY(){return window.scrollY||document.documentElement.scrollTop||document.body.scrollTop||0}

  function restoreScroll(y,tab){
    const shouldRestore=()=>!document.hidden&&(!window.state||state.activeTab===tab);
    const doRestore=()=>{if(shouldRestore())window.scrollTo(0,y)};
    doRestore();
    requestAnimationFrame(doRestore);
    setTimeout(doRestore,40);
  }

  function scheduleScreenPatch(delay=60){
    clearTimeout(renderPatchTimer);
    renderPatchTimer=setTimeout(patchScreens,delay);
  }

  function wrapStableRerenders(){
    if(stableRenderWrapped||typeof markChanged!=='function')return;
    const original=markChanged;
    markChanged=function(){
      const y=currentScrollY();
      const tab=window.state?.activeTab||document.body.dataset.activeTab||'';
      const result=original.apply(this,arguments);
      scheduleScreenPatch(0);
      restoreScroll(y,tab);
      return result;
    };
    stableRenderWrapped=true;
  }

  function markSoftSave(){
    try{if(typeof saveData==='function')saveData(app,true)}catch(error){console.warn('TSB soft save failed',error)}
  }

  function viewportHeight(){return Math.round(window.visualViewport?.height||window.innerHeight||0)}
  function initViewportBaseline(){baselineViewportHeight=Math.max(baselineViewportHeight,viewportHeight())}
  function keyboardLooksOpen(){const h=viewportHeight();return Boolean(baselineViewportHeight&&baselineViewportHeight-h>90)}
  function hideNavForKeyboard(){document.body.classList.add('nav-input-focus')}
  function showNavAfterKeyboard(){document.body.classList.remove('nav-input-focus','input-focus')}
  function syncKeyboardNav(){
    initViewportBaseline();
    if(isInput(document.activeElement)&&keyboardLooksOpen())hideNavForKeyboard();
    else if(!keyboardLooksOpen())showNavAfterKeyboard();
  }
  function scheduleSync(delay=80){clearTimeout(focusTimer);focusTimer=setTimeout(syncKeyboardNav,delay)}

  function wireMenuButton(button){
    button.onclick=()=>{
      if(typeof setTab==='function')setTab(button.dataset.tabTarget);
      if(typeof closeMobileTabMenu==='function')closeMobileTabMenu();
    };
  }

  function structureMenu(){
    const menu=qs('#mobileTabMenu');
    if(!menu)return;
    const existing=new Map(qsa('[data-tab-target]',menu).map(btn=>[btn.dataset.tabTarget,btn]));
    menu.innerHTML='';
    const groups=[{title:'Дневник',tabs:['important']},{title:'Система',tabs:['settings','sync']}];
    groups.forEach(group=>{
      const wrap=document.createElement('div');
      wrap.className='mobile-menu-group';
      const title=document.createElement('div');
      title.className='mobile-menu-title';
      title.textContent=group.title;
      wrap.appendChild(title);
      group.tabs.forEach(tab=>{
        const btn=existing.get(tab)||document.createElement('button');
        btn.type='button';
        btn.dataset.tabTarget=tab;
        btn.hidden=false;
        btn.textContent=label(tab);
        wireMenuButton(btn);
        wrap.appendChild(btn);
      });
      menu.appendChild(wrap);
    });
    menu.dataset.structured='true';
  }

  function updateMoreState(){
    const activeTab=document.body.dataset.activeTab||'today';
    const fab=qs('#mobileTabFab');
    const toggle=qs('#mobileTabToggle');
    const menu=qs('#mobileTabMenu');
    if(!fab||!toggle)return;
    const secondaryActive=!PRIMARY_TABS.has(activeTab);
    fab.classList.toggle('secondary-active',secondaryActive);
    if(secondaryActive){
      toggle.setAttribute('aria-current','page');
      toggle.innerHTML=`<span>Ещё</span><span class="more-current">${label(activeTab)}</span>`;
    }else{
      toggle.removeAttribute('aria-current');
      toggle.textContent='Ещё';
    }
    if(menu){
      qsa('[data-tab-target]',menu).forEach(btn=>{
        const active=btn.dataset.tabTarget===activeTab;
        if(active)btn.setAttribute('aria-current','page');
        else btn.removeAttribute('aria-current');
      });
    }
  }

  function recordUsageOpen(){
    const data=safeApp();
    if(!data)return;
    data.appUsage=data.appUsage&&typeof data.appUsage==='object'?data.appUsage:{};
    const now=new Date();
    const min=minutesOfDay(now);
    const hm=timeHM(now);
    const today=dateISO(now);
    const nightDate=min<240?addLocalDays(today,-1):today;
    const ensure=iso=>data.appUsage[iso]=data.appUsage[iso]||{
      firstMorningOpen:'',firstMorningAt:'',lastNightOpen:'',lastNightAt:'',lastOpen:'',openCount:0
    };
    const todayEntry=ensure(today);
    todayEntry.lastOpen=now.toISOString();
    todayEntry.openCount=Number(todayEntry.openCount||0)+1;
    if(min>=240&&min<=840&&(!todayEntry.firstMorningOpen||hm<todayEntry.firstMorningOpen)){
      todayEntry.firstMorningOpen=hm;
      todayEntry.firstMorningAt=now.toISOString();
    }
    if(min>=1200||min<240){
      const entry=ensure(nightDate);
      if(!entry.lastNightOpen||hm>entry.lastNightOpen||min<240){
        entry.lastNightOpen=hm;
        entry.lastNightAt=now.toISOString();
      }
    }
    markSoftSave();
  }

  function scheduleUsageRecord(delay=500){
    clearTimeout(usageTimer);
    usageTimer=setTimeout(recordUsageOpen,delay);
  }

  function usageForWeekText(){
    const data=safeApp();
    if(!data?.appUsage)return '';
    const base=typeof getMondayISO==='function'?getMondayISO(state?.selectedDate||dateISO()):dateISO();
    const lines=[];
    for(let i=0;i<7;i+=1){
      const iso=addLocalDays(base,i);
      const usage=data.appUsage[iso]||{};
      lines.push(`  - ${iso}: утро ${usage.firstMorningOpen||'—'}, ночь ${usage.lastNightOpen||'—'}${usage.firstMorningOpen&&usage.lastNightOpen?' · сон можно оценивать только примерно по входам в приложение':''}`);
    }
    return `\nАвто-учёт входов в приложение:\n${lines.join('\n')}\nВажно: это не точный трекер сна. Если приложение открывалось за 2–3 часа до сна или не открывалось утром сразу после пробуждения, оценка сна низкой точности.`;
  }

  function usageListHTML(){
    const usage=safeApp()?.appUsage||{};
    const today=dateISO();
    const rows=[];
    for(let i=0;i<7;i+=1){
      const iso=addLocalDays(today,-i);
      const entry=usage[iso]||{};
      const last=entry.lastOpen?new Date(entry.lastOpen).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}):'';
      rows.push(`<article class="finance-card usage-log-row"><div class="item-top"><div><div class="badge-row"><span class="badge important">${esc(short(iso))}</span><span class="badge">входов ${Number(entry.openCount||0)}</span></div><h3>${esc(entry.firstMorningOpen||'—')} → ${esc(entry.lastNightOpen||'—')}</h3><p class="muted">утро / ночь${last?` · последний вход ${esc(last)}`:''}</p></div></div></article>`);
    }
    return rows.join('');
  }

  function patchSettingsUsage(){
    const root=qs('#tab-settings');
    if(!root)return;
    let card=qs('[data-mf-settings-usage]',root);
    if(!card){
      card=document.createElement('section');
      card.className='card settings-usage-card';
      card.dataset.mfSettingsUsage='true';
      root.appendChild(card);
    }
    card.innerHTML=`<div class="card-title-row"><h2>Автовходы / примерный сон</h2></div><p class="muted">Первый утренний и последний ночной вход записываются автоматически. Это ориентир, а не точный трекер сна.</p><div class="finance-list">${usageListHTML()}</div>`;
  }

  function wrapGptReport(){
    if(reportWrapped||typeof buildGptReport!=='function')return;
    const original=buildGptReport;
    buildGptReport=function(){return `${original()}${usageForWeekText()}`};
    reportWrapped=true;
  }

  function currentWeightISO(){return typeof getWeeklyWeightISO==='function'?getWeeklyWeightISO(dateISO()):dateISO()}
  function currentWeightValue(){try{return getHealth(currentWeightISO()).weight||''}catch(error){return ''}}
  function shouldShowWeightPrompt(){const now=new Date();return now.getDay()===1&&!currentWeightValue()}
  function weightFormHTML(prefix='today'){
    return `<form class="form-grid weight weekly-weight-inline" data-mf-weight-form="${prefix}"><label>Актуальный вес, кг<input name="weight" inputmode="decimal" placeholder="Напр. 110" value="${esc(currentWeightValue())}"></label><button class="primary-button" type="submit">Сохранить вес</button></form>`;
  }

  function bindWeightForms(root=document){
    qsa('[data-mf-weight-form]',root).forEach(form=>{
      if(form.dataset.bound==='true')return;
      form.dataset.bound='true';
      form.onsubmit=event=>{
        event.preventDefault();
        if(!safeApp()||typeof getHealth!=='function')return;
        const fd=new FormData(form);
        const iso=currentWeightISO();
        getHealth(iso).weight=typeof normalizeWeightInput==='function'?(normalizeWeightInput(fd.get('weight'))||null):(fd.get('weight')||null);
        if(typeof markChanged==='function')markChanged();
        else markSoftSave();
        if(typeof showToast==='function')showToast('Вес сохранён');
      };
    });
  }

  function patchTodayWeight(){
    const root=qs('#tab-today.active');
    if(!root||qs('[data-mf-weight-card]',root)||!shouldShowWeightPrompt())return;
    const card=document.createElement('section');
    card.className='card today-input-card';
    card.dataset.mfWeightCard='true';
    card.innerHTML=`<div class="card-title-row"><h2>Вес недели</h2></div><p class="muted">Появляется по понедельникам и прячется после сохранения.</p>${weightFormHTML('today')}`;
    const anchor=root.querySelector('.today-summary-compact');
    if(anchor&&anchor.nextSibling)root.insertBefore(card,anchor.nextSibling);
    else root.prepend(card);
    bindWeightForms(card);
  }

  function patchSettingsWeight(){
    const root=qs('#tab-settings');
    if(!root||qs('[data-mf-settings-weight]',root))return;
    const card=document.createElement('section');
    card.className='card settings-weight-card';
    card.dataset.mfSettingsWeight='true';
    card.innerHTML=`<div class="card-title-row"><h2>Вес сейчас</h2></div><p class="muted">Текущий вес хранится по неделям. На главном экране ввод появляется по понедельникам.</p>${weightFormHTML('settings')}`;
    root.appendChild(card);
    bindWeightForms(card);
  }

  function patchFoodRemoval(){
    qsa('[data-tab="food"],[data-tab-target="food"]').forEach(el=>{
      el.hidden=true;
      el.style.display='none';
    });
    const foodPage=qs('#tab-food');
    if(foodPage)foodPage.hidden=true;
    if((document.body.dataset.activeTab||state?.activeTab)==='food'&&typeof setTab==='function')setTab('today');
  }

  function patchTodayHeaderButtons(){
    const root=qs('#tab-today');
    if(!root)return;
    qsa('.card-title-row [data-tab-target="plans"],.card-title-row [data-tab-target="finance"],.card-title-row [data-tab-target="food"]',root).forEach(btn=>btn.remove());
    const financeLine=qs('.today-finance-card .finance-summary-line',root);
    if(financeLine&&!financeLine.dataset.mfNoAssets){
      financeLine.textContent=financeLine.textContent.replace(/\s*·\s*активы:[^·]*/i,'');
      financeLine.dataset.mfNoAssets='true';
    }
  }

  function normalizeCollapseTitle(raw){
    let clean=String(raw||'').replace(/[⌄▾▴▲▼]/g,' ').replace(/\s+/g,' ').trim();
    clean=clean.replace(/^Показать\s+/i,'');
    clean=clean
      .replace(/^задачи дня/i,'Задачи дня')
      .replace(/^питание дня/i,'Питание дня')
      .replace(/^операции дня/i,'Финансы дня')
      .replace(/^ближайшие даты/i,'Ближайшие даты')
      .replace(/^незавершённые задачи/i,'Незавершённые задачи');
    if(!clean)return '';

    const countMatch=clean.match(/(\d+(?:\s*[·•]\s*\d+\s*дн\.)?)\s*$/i);
    if(countMatch){
      const count=countMatch[1].replace(/\s*[·•]\s*/g,' · ').trim();
      const titlePart=clean.slice(0,countMatch.index).replace(/[\s·•:]+$/g,'').trim();
      return titlePart?`${titlePart} • ${count}`:count;
    }

    return clean.replace(/(?:\s*[·•]\s*){2,}/g,' · ').replace(/[\s·•]+$/g,'').trim();
  }

  function patchCollapsibleSummaries(root=document){
    qsa('details.collapsible-list>summary,.collapsible-list>summary',root).forEach(summary=>{
      const titleNode=summary.querySelector('.mf-summary-title');
      const clean=normalizeCollapseTitle(titleNode?.textContent||summary.textContent);
      if(!clean)return;
      const wasOpen=Boolean(summary.parentElement?.open);
      summary.innerHTML=`<span class="mf-summary-title">${esc(clean)}</span><span class="mf-summary-arrow" aria-hidden="true">⌄</span>`;
      summary.dataset.mfCleanSummary='true';
      if(summary.parentElement)summary.parentElement.open=wasOpen;
    });
  }

  function patchDailyReportLabels(){
    const root=qs('#tab-today');
    if(!root||typeof getDailyReport!=='function')return;
    const chips=qsa('.daily-report-status .summary-chip',root);
    if(chips.length<3)return;
    const report=getDailyReport(state?.selectedDate);
    chips[0].textContent=`Самоощущение ${report.selfScore||'—'}`;
    chips[1].textContent=`Желание ${report.driveScore||'—'}`;
    chips[2].textContent=String(report.text||'').trim()?'Комментарий +':'Комментарий -';
  }

  function patchActionButtonText(root=document){
    qsa('.actions button,.item-top button,.task-top button',root).forEach(btn=>{
      const text=btn.textContent.trim();
      if(text==='Изм.'||text==='Изменить'){
        btn.title='Изменить';
        btn.setAttribute('aria-label','Изменить');
        btn.textContent='✎';
        btn.classList.add('mf-icon-action');
      }
      if(text==='Удал.'||text==='Удалить'){
        btn.title='Удалить';
        btn.setAttribute('aria-label','Удалить');
        btn.textContent='×';
        btn.classList.add('mf-icon-action');
      }
    });
  }

  function taskStateBadge(card){
    const row=card.querySelector('.badge-row');
    if(!row)return null;
    let badge=row.querySelector('.mf-task-state-badge');
    if(!badge){
      badge=document.createElement('span');
      badge.className='badge mf-task-state-badge';
      row.appendChild(badge);
    }
    qsa('.done-badge',row).forEach(el=>{if(el!==badge)el.remove()});
    return badge;
  }

  function applyTaskState(card,task,button){
    card.classList.toggle('done',Boolean(task.done));
    const badge=taskStateBadge(card);
    if(badge){
      badge.textContent=task.done?'Выполнено':'Не выполнено';
      badge.classList.toggle('done-badge',Boolean(task.done));
      badge.classList.toggle('secondary',!task.done);
    }
    if(button){
      button.textContent=task.done?'Вернуть':'Принять';
      button.title=task.done?'Вернуть задачу в невыполненные':'Принять задачу как выполненную';
      button.setAttribute('aria-pressed',String(Boolean(task.done)));
      button.classList.toggle('active',Boolean(task.done));
    }
  }

  function refreshTaskSummary(iso){
    if(typeof getProgress!=='function')return;
    const progress=getProgress(iso);
    if(iso===state?.selectedDate){
      const chips=qsa('#tab-today .today-summary-compact .summary-chip');
      if(chips[0])chips[0].textContent=`Задачи ${progress.done}/${progress.total}`;
      if(chips[1])chips[1].textContent=`Выполнение ${progress.pct}%`;
    }
    qsa(`details[data-details-key="plans-${iso}"]>summary .mf-summary-title`).forEach(title=>{
      title.textContent=title.textContent.replace(/задачи\s+\d+\/\d+/i,`задачи ${progress.done}/${progress.total}`);
    });
    qsa(`details[data-details-key="plans-${iso}"]`).forEach(details=>{
      const bar=details.closest('.day-column')?.querySelector('.progress span');
      if(bar)bar.style.width=`${progress.pct}%`;
    });
  }

  function toggleTaskWithoutRerender(button){
    const iso=button.dataset.date||state?.selectedDate;
    const id=button.dataset.mfTaskAccept;
    const task=typeof findTask==='function'?findTask(iso,id):null;
    if(!task)return;
    task.done=!task.done;
    if(task.done){
      task.failed=false;
      task.completedAt=task.completedAt||new Date().toISOString();
      task.completedForDate=iso;
      task.completionMode=task.completionMode||'same_day';
    }else{
      task.completedAt='';
      task.completedForDate='';
      task.completionMode='';
    }
    if(typeof saveData==='function')saveData(app,true);
    const card=button.closest('.task-card');
    if(card)applyTaskState(card,task,button);
    refreshTaskSummary(iso);
    if(typeof showToast==='function')showToast(task.done?'Задача выполнена':'Задача снова активна');
  }

  function patchTaskControls(root=document){
    qsa('.task-card',root).forEach(card=>{
      const checkbox=card.querySelector('input[data-task-toggle]');
      const existingButton=card.querySelector('[data-mf-task-accept]');
      const id=checkbox?.dataset.taskToggle||existingButton?.dataset.mfTaskAccept;
      const iso=checkbox?.dataset.date||existingButton?.dataset.date||state?.selectedDate;
      if(!id)return;
      if(checkbox)checkbox.remove();

      const actions=card.querySelector('.actions');
      if(!actions)return;
      let button=existingButton;
      if(!button){
        button=document.createElement('button');
        button.type='button';
        button.className='ghost-button mf-task-accept';
        button.dataset.mfTaskAccept=id;
        button.dataset.date=iso;
        const edit=actions.querySelector('[data-task-edit]');
        if(edit)actions.insertBefore(button,edit);
        else actions.prepend(button);
      }
      button.onclick=event=>{
        event.preventDefault();
        event.stopPropagation();
        toggleTaskWithoutRerender(button);
      };
      const task=typeof findTask==='function'?findTask(iso,id):null;
      if(task)applyTaskState(card,task,button);
    });
  }

  async function editTodayFinance(button){
    if(typeof openEditDialog!=='function'||typeof getFinance!=='function')return;
    const iso=button.dataset.date||state?.selectedDate;
    const day=getFinance(iso);
    const expense=day.expenses.find(item=>item.id===button.dataset.mfFinanceEdit);
    if(!expense)return;

    const result=await openEditDialog({
      title:'Изменить трату',
      fields:[
        {name:'amount',label:'Сумма, ₽',value:expense.amount||'',placeholder:'Напр. 250'},
        {name:'category',label:'Категория',type:'select',value:expense.category,options:FINANCE_CATEGORIES},
        {name:'comment',label:'Описание',type:'textarea',value:expense.comment||expense.detail||'',placeholder:'Напр. лекарства, врач, продукты домой'},
        {name:'time',label:'Время',type:'time',value:expense.time||''}
      ],
      submitText:'Сохранить'
    });
    if(!result)return;

    const amount=typeof normalizeMoneyInput==='function'?normalizeMoneyInput(result.amount):String(result.amount||'');
    if(!amount)return;
    const oldAmount=typeof moneyNumber==='function'?moneyNumber(expense.amount):Number(expense.amount||0);
    const newAmount=typeof moneyNumber==='function'?moneyNumber(amount):Number(amount||0);
    expense.amount=amount;
    expense.category=typeof normalizeFinanceCategory==='function'?normalizeFinanceCategory(result.category):result.category;
    expense.comment=String(result.comment||'').trim();
    expense.detail=expense.comment;
    expense.time=String(result.time||'').trim();
    expense.updatedAt=new Date().toISOString();

    if(typeof addAvailableBalance==='function')addAvailableBalance(oldAmount-newAmount);
    if(typeof getFinanceContext==='function'){
      const operation=getFinanceContext().operations.find(item=>item.sourceId===expense.id&&item.type==='expense');
      if(operation){
        operation.amount=String(-newAmount);
        operation.title=typeof getFinanceCategoryLabel==='function'?getFinanceCategoryLabel(expense.category):expense.category;
        operation.comment=expense.comment;
      }
    }
    if(typeof saveData==='function')saveData(app,true);

    const y=currentScrollY();
    if(typeof renderToday==='function')renderToday();
    patchScreens();
    restoreScroll(y,state?.activeTab||'today');
    if(typeof showToast==='function')showToast('Трата изменена');
  }

  function patchTodayFinanceEdit(){
    const root=qs('#tab-today');
    if(!root)return;
    qsa('.today-finance-card .finance-card',root).forEach(card=>{
      const deleteButton=card.querySelector('[data-finance-delete]');
      if(!deleteButton)return;
      const id=deleteButton.dataset.financeDelete;
      let editButton=qsa('[data-mf-finance-edit]',card).find(btn=>btn.dataset.mfFinanceEdit===id);
      if(!editButton){
        editButton=document.createElement('button');
        editButton.type='button';
        editButton.className='ghost-button mf-icon-action';
        editButton.dataset.mfFinanceEdit=id;
        editButton.dataset.date=state?.selectedDate||dateISO();
        editButton.title='Изменить и добавить описание';
        editButton.setAttribute('aria-label','Изменить трату');
        editButton.textContent='✎';
        deleteButton.parentElement?.insertBefore(editButton,deleteButton);
      }
      editButton.onclick=event=>{
        event.preventDefault();
        event.stopPropagation();
        editTodayFinance(editButton);
      };
    });
  }

  function patchScreens(){
    patchFoodRemoval();
    patchTodayWeight();
    patchSettingsWeight();
    patchSettingsUsage();
    patchTodayHeaderButtons();
    patchCollapsibleSummaries(document);
    patchDailyReportLabels();
    patchTaskControls(document);
    patchTodayFinanceEdit();
    patchActionButtonText(document);
    bindWeightForms(document);
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
    window.addEventListener('pageshow',()=>{
      baselineViewportHeight=0;
      showNavAfterKeyboard();
      scheduleSync(120);
      scheduleUsageRecord(300);
      scheduleScreenPatch(120);
    });
    document.addEventListener('visibilitychange',()=>{
      if(!document.hidden){
        baselineViewportHeight=0;
        showNavAfterKeyboard();
        scheduleSync(120);
        scheduleUsageRecord(300);
        scheduleScreenPatch(120);
      }
    });
  }

  function setupMobileFirstCleanup(){
    wrapStableRerenders();
    qsa('.tabs .tab-button').forEach(button=>{
      const tab=button.dataset.tab;
      if(TAB_LABELS[tab])setButtonLabel(button,tab);
    });
    const toggle=qs('#mobileTabToggle');
    if(toggle){
      toggle.textContent='Ещё';
      toggle.title='Ещё разделы';
      toggle.setAttribute('aria-label','Ещё разделы приложения');
    }
    structureMenu();
    updateMoreState();
    syncKeyboardNav();
    wrapGptReport();
    scheduleUsageRecord();
    scheduleScreenPatch(0);
  }

  document.addEventListener('DOMContentLoaded',()=>{
    setupMobileFirstCleanup();
    setupInputFocusGuard();
  });
  window.addEventListener('load',setupMobileFirstCleanup);

  const observer=new MutationObserver(()=>{
    updateMoreState();
    scheduleScreenPatch(40);
  });
  if(document.body)observer.observe(document.body,{attributes:true,attributeFilter:['data-active-tab']});
  else document.addEventListener('DOMContentLoaded',()=>observer.observe(document.body,{attributes:true,attributeFilter:['data-active-tab']}));
})();
