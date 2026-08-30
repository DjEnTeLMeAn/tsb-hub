// TSB Hub v0.10.1-full-republish — lightweight phone-first task actions.
(function(){
  const targetMap={task:'#tab-tasks [data-task-add]'};
  let scheduled=false;
  function qs(s,r=document){return r?.querySelector?.(s)||null}
  function qsa(s,r=document){return r?.querySelectorAll?Array.from(r.querySelectorAll(s)):[]}
  function taskCount(){return qsa('#tab-tasks .task-card').length}
  function focusTask(){
    const target=qs(targetMap.task);if(!target)return;
    target.click();
    const form=qs('#tab-tasks [data-task-add-form]');
    const input=qs('input:not([type="hidden"]),textarea,select',form||document);
    if(input)setTimeout(()=>input.focus({preventScroll:true}),250);
  }
  function statusText(){return `${taskCount()} задач на выбранный день`}
  function buildBar(){
    const section=document.createElement('section');
    section.className='card mobile-daily-dashboard';
    section.innerHTML=`<div class="dashboard-actions"><button class="dashboard-action primary" type="button" data-dashboard-jump="task">+ Задача</button></div><p class="muted dashboard-status-line">${statusText()}</p>`;
    qsa('[data-dashboard-jump="task"]',section).forEach(btn=>btn.addEventListener('click',focusTask));
    return section;
  }
  function enhanceTasks(){
    scheduled=false;
    const root=qs('#tab-tasks.active');if(!root)return;
    if(qs('.mobile-daily-dashboard',root)||!qs('[data-task-add]',root))return;
    root.prepend(buildBar());
  }
  function schedule(){if(scheduled)return;scheduled=true;requestAnimationFrame(enhanceTasks)}
  document.addEventListener('DOMContentLoaded',schedule);
  window.addEventListener('load',schedule);
  document.addEventListener('click',e=>{if(e.target?.closest?.('[data-tab],[data-tab-target]'))setTimeout(schedule,120)});
})();
