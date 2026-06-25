// TSB Hub 0.8.24 — lightweight phone-first quick actions.
(function(){
  const targetMap={task:'Задачи дня',food:'Питание дня',finance:'Финансы дня',report:'Итог дня'};
  let scheduled=false;
  function qs(s,r=document){return r.querySelector(s)}
  function qsa(s,r=document){return Array.from(r.querySelectorAll(s))}
  function text(el){return(el&&el.textContent||'').trim()}
  function findCard(kind){const title=targetMap[kind];return qsa('#tab-today .card').find(card=>text(qs('h2',card))===title)||null}
  function focusCard(kind){
    const card=findCard(kind);if(!card)return;
    card.classList.add('dashboard-target-highlight');
    card.scrollIntoView({behavior:'smooth',block:'center'});
    setTimeout(()=>card.classList.remove('dashboard-target-highlight'),900);
    if(kind==='report'){qs('[data-daily-report-open]',card)?.click();return}
    const input=qs('input:not([type="hidden"]),textarea,select',card);
    if(input)setTimeout(()=>input.focus({preventScroll:true}),250);
  }
  function statusText(){
    const chips=qsa('#tab-today>.today-summary-compact .summary-chip').slice(0,3).map(text).filter(Boolean);
    return chips.join(' · ')||'Быстрые записи на выбранный день';
  }
  function buildBar(){
    const section=document.createElement('section');
    section.className='card mobile-daily-dashboard';
    section.innerHTML=`<div class="dashboard-actions"><button class="dashboard-action primary" type="button" data-dashboard-jump="task">+ Задача</button><button class="dashboard-action primary" type="button" data-dashboard-jump="finance">₽ Трата</button><button class="dashboard-action" type="button" data-dashboard-jump="food">Еда</button><button class="dashboard-action" type="button" data-dashboard-jump="report">Итог</button></div><p class="muted dashboard-status-line">${statusText()}</p>`;
    qsa('[data-dashboard-jump]',section).forEach(btn=>btn.addEventListener('click',()=>focusCard(btn.dataset.dashboardJump)));
    return section;
  }
  function enhanceToday(){
    scheduled=false;
    const root=qs('#tab-today.active');if(!root)return;
    if(qs('.mobile-daily-dashboard',root))return;
    root.prepend(buildBar());
  }
  function schedule(){if(scheduled)return;scheduled=true;requestAnimationFrame(enhanceToday)}
  document.addEventListener('DOMContentLoaded',schedule);
  window.addEventListener('load',schedule);
  document.addEventListener('click',e=>{if(e.target.closest('[data-tab],[data-tab-target]'))setTimeout(schedule,120)});
})();
