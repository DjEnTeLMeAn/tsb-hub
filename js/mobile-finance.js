// TSB Hub 0.8.26 - mobile finance focus card.
(function(){
  let scheduled=false;
  function qs(s,r=document){return r.querySelector(s)}
  function qsa(s,r=document){return Array.from(r.querySelectorAll(s))}
  function txt(el){return(el&&el.textContent||'').replace(/\s+/g,' ').trim()}
  function val(card){return txt(qs('.stat-value',card))||'—'}
  function findSection(title){return qsa('#tab-finance .card').find(c=>txt(qs('h2',c))===title)||null}
  function focusSection(title){const c=findSection(title);if(!c)return;c.scrollIntoView({behavior:'smooth',block:'center'});c.classList.add('dashboard-target-highlight');setTimeout(()=>c.classList.remove('dashboard-target-highlight'),900);qs('input,textarea,select',c)?.focus({preventScroll:true})}
  function build(){
    const top=qsa('#tab-finance .finance-top-grid .stat-card');
    const day=qsa('#tab-finance .finance-day-summary .stat-card');
    const available=val(top[0]);
    const spent=val(day[0]);
    const card=document.createElement('section');
    card.className='card mobile-finance-focus';
    card.innerHTML=`<div><h2>Деньги на жизнь</h2><p class="muted">Сначала контроль: сколько есть и сколько ушло сегодня.</p></div><div class="finance-life-grid"><div class="finance-life-stat"><span class="muted">Доступно</span><b>${available}</b></div><div class="finance-life-stat"><span class="muted">Сегодня ушло</span><b>${spent}</b></div></div><div class="finance-life-actions"><button class="primary-button" type="button" data-finance-jump="expense">Записать трату</button><button class="ghost-button" type="button" data-finance-jump="balance">Обновить баланс</button></div>`;
    qs('[data-finance-jump="expense"]',card)?.addEventListener('click',()=>focusSection('Траты выбранного дня'));
    qs('[data-finance-jump="balance"]',card)?.addEventListener('click',()=>focusSection('Баланс'));
    return card;
  }
  function enhance(){
    scheduled=false;
    const root=qs('#tab-finance.active');if(!root)return;
    document.body.classList.add('finance-focus-ready');
    qs('.mobile-finance-focus',root)?.remove();
    root.prepend(build());
  }
  function schedule(){if(scheduled)return;scheduled=true;requestAnimationFrame(enhance)}
  document.addEventListener('DOMContentLoaded',schedule);
  window.addEventListener('load',schedule);
  document.addEventListener('click',e=>{if(e.target.closest('[data-tab],[data-tab-target]'))setTimeout(schedule,120)});
})();
