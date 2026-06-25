// TSB Hub 0.8.23 — phone-first dashboard enhancer.
(function(){
  const targetMap={task:'Задачи дня',food:'Питание дня',finance:'Финансы дня',report:'Итог дня'};
  function qs(s,r=document){return r.querySelector(s)}
  function qsa(s,r=document){return Array.from(r.querySelectorAll(s))}
  function text(el){return (el&&el.textContent||'').trim()}
  function findCard(kind){
    const title=targetMap[kind];
    return qsa('#tab-today .card').find(card=>text(qs('h2',card))===title)||null;
  }
  function focusCard(kind){
    const card=findCard(kind);
    if(!card)return;
    card.classList.add('dashboard-target-highlight');
    card.scrollIntoView({behavior:'smooth',block:'center'});
    setTimeout(()=>card.classList.remove('dashboard-target-highlight'),1300);
    if(kind==='report'){
      qs('[data-daily-report-open]',card)?.click();
      return;
    }
    const input=qs('input:not([type="hidden"]), textarea, select',card);
    if(input)setTimeout(()=>input.focus({preventScroll:true}),350);
  }
  function getStatusHTML(){
    const chips=qsa('#tab-today>.today-summary-compact .summary-chip').slice(0,4);
    if(!chips.length)return '<span class="summary-chip">Данные дня загружаются</span>';
    return chips.map(chip=>`<span class="summary-chip">${chip.innerHTML}</span>`).join('');
  }
  function buildDashboard(){
    const label=text(qs('#selectedDateLabel'))||'Выбранный день';
    const section=document.createElement('section');
    section.className='card mobile-daily-dashboard';
    section.innerHTML=`
      <div class="dashboard-head">
        <div><h2>Быстрый ввод</h2><p class="muted">Главное для телефона: добавь запись в 1 касание.</p></div>
        <span class="dashboard-date-chip">${label}</span>
      </div>
      <div class="dashboard-actions">
        <button class="dashboard-action primary" type="button" data-dashboard-jump="task"><span>＋</span><small>Задача</small></button>
        <button class="dashboard-action primary" type="button" data-dashboard-jump="finance"><span>₽</span><small>Трата</small></button>
        <button class="dashboard-action" type="button" data-dashboard-jump="food"><span>🍽</span><small>Еда</small></button>
        <button class="dashboard-action" type="button" data-dashboard-jump="report"><span>✓</span><small>Итог</small></button>
      </div>
      <div class="dashboard-mini-status">${getStatusHTML()}</div>`;
    qsa('[data-dashboard-jump]',section).forEach(btn=>btn.addEventListener('click',()=>focusCard(btn.dataset.dashboardJump)));
    return section;
  }
  function enhanceToday(){
    const root=qs('#tab-today.active');
    if(!root)return;
    const old=qs('.mobile-daily-dashboard',root);
    if(old)old.remove();
    root.prepend(buildDashboard());
  }
  function schedule(){requestAnimationFrame(enhanceToday)}
  document.addEventListener('DOMContentLoaded',schedule);
  window.addEventListener('load',schedule);
  const obs=new MutationObserver(schedule);
  document.addEventListener('DOMContentLoaded',()=>{const root=qs('#tab-today');if(root)obs.observe(root,{childList:true,subtree:false});});
  document.addEventListener('click',e=>{if(e.target.closest('[data-tab],[data-tab-target]'))setTimeout(schedule,120);});
})();
