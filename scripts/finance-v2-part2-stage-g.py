from pathlib import Path
import json,re

RELEASE='0.12.0-finance-v2-part2-20260807'
APP_VERSION='0.12.0-finance-v2-part2'
PUBLISHED='2026-08-07T21:18:00+05:00'

APP=Path('js/app.js'); CORE=Path('js/finance-core.js'); INDEX=Path('index.html'); SW=Path('service-worker.js'); UPDATE=Path('js/update-manager.js'); MANIFEST=Path('manifest.json'); VERSION=Path('version.json'); STATIC=Path('tests/app-static.test.cjs'); REG=Path('tests/finance-part2-regression.test.cjs')
app=APP.read_text(); core=CORE.read_text(); index=INDEX.read_text(); sw=SW.read_text(); update=UPDATE.read_text(); static=STATIC.read_text()

def once(s,old,new,label):
    if old not in s: raise RuntimeError(f'missing anchor: {label}')
    if s.count(old)!=1: raise RuntimeError(f'non-unique anchor: {label} ({s.count(old)})')
    return s.replace(old,new,1)

def function_range(source,name):
    token=f'function {name}('; start=source.find(token)
    if start<0: raise RuntimeError(f'Function not found: {name}')
    paren=source.find('(',start); depth=0; quote=None; esc=False; line=False; block=False; i=paren
    while i<len(source):
        c=source[i]; n=source[i+1] if i+1<len(source) else ''
        if line:
            if c=='\n': line=False
            i+=1; continue
        if block:
            if c=='*' and n=='/': block=False; i+=2; continue
            i+=1; continue
        if quote:
            if esc: esc=False; i+=1; continue
            if c=='\\': esc=True; i+=1; continue
            if c==quote: quote=None
            i+=1; continue
        if c=='/' and n=='/': line=True; i+=2; continue
        if c=='/' and n=='*': block=True; i+=2; continue
        if c in ('"',"'",'`'): quote=c; i+=1; continue
        if c=='(': depth+=1
        elif c==')':
            depth-=1
            if depth==0: i+=1; break
        i+=1
    while i<len(source) and source[i].isspace(): i+=1
    if i>=len(source) or source[i]!='{': raise RuntimeError(f'Body not found: {name}')
    bdepth=0; quote=None; esc=False; line=False; block=False
    while i<len(source):
        c=source[i]; n=source[i+1] if i+1<len(source) else ''
        if line:
            if c=='\n': line=False
            i+=1; continue
        if block:
            if c=='*' and n=='/': block=False; i+=2; continue
            i+=1; continue
        if quote:
            if esc: esc=False; i+=1; continue
            if c=='\\': esc=True; i+=1; continue
            if c==quote: quote=None
            i+=1; continue
        if c=='/' and n=='/': line=True; i+=2; continue
        if c=='/' and n=='*': block=True; i+=2; continue
        if c in ('"',"'",'`'): quote=c; i+=1; continue
        if c=='{': bdepth+=1
        elif c=='}':
            bdepth-=1
            if bdepth==0:return start,i+1
        i+=1
    raise RuntimeError(f'End not found: {name}')

# 1) Remove dead Finance v1 binders from bindCommonActions. Current Finance v2 uses its own events/API.
legacy_start=app.find("  $$('[data-quick-finance-category]', root).forEach(btn => {")
legacy_end=app.find("  $$('[data-important-delete]', root).forEach(btn => {",legacy_start)
if legacy_start<0 or legacy_end<0: raise RuntimeError('legacy finance binder block not found')
app=app[:legacy_start]+"  // Finance v2 owns all active finance mutations; legacy Finance v1 binders were removed.\n\n"+app[legacy_end:]

# 2) Replace GPT report so Finance Part2 is the source of truth.
a,b=function_range(app,'buildGptReport')
report=r'''function buildGptReport() {
  const monday = getMondayISO(state.selectedDate);
  const context = getFinanceContext();
  const financeState = getFinanceStateV2();
  const coverage = getFinanceCoverage();
  const accountLines = getFinanceAccounts().length
    ? getFinanceAccounts().map(account => `  - ${account.name}: ${formatRub(getFinanceAccountBalance(account.id))}`).join('\n')
    : '  - нет активных счетов';
  const activeReserves = TSBFinanceCore.getActiveReserves(financeState);
  const reserveLines = activeReserves.length
    ? activeReserves.map(item => `  - ${item.name}: ${formatRub(item.amount)}${item.targetAmount ? ` / цель ${formatRub(item.targetAmount)}` : ''}`).join('\n')
    : '  - нет активных резервов';
  const activeObligations = TSBFinanceCore.getActiveObligations(financeState).sort((x,y)=>String(x.dueDate).localeCompare(String(y.dueDate)));
  const obligationLines = activeObligations.length
    ? activeObligations.map(item => `  - ${shortDate(item.dueDate)} · ${formatRub(item.amount)} · ${item.name}${item.recurrence === 'MONTHLY' ? ' · ежемесячно' : ''}`).join('\n')
    : '  - нет ACTIVE обязательств';
  const plannedIncomeLines = context.incomes?.length
    ? [...context.incomes].sort((x,y)=>String(x.date||'9999-99-99').localeCompare(String(y.date||'9999-99-99'))).map(item => `  - ${item.date ? shortDate(item.date) : 'без даты'} · ${formatRub(item.amount)} · ${item.title || 'ожидаемое поступление'}${item.comment ? ` · ${item.comment}` : ''}`).join('\n')
    : '  - не указаны';
  const recentTransactions = getFinanceTransactions().slice(0,40);
  const operationLines = recentTransactions.length
    ? recentTransactions.map(tx => `  - ${shortDate(tx.date)}${tx.time ? ` ${tx.time}` : ''} · ${tx.type} · ${financeSignedAmount(tx)} · ${financeTypeLabel(tx)}${tx.description ? ` · ${tx.description}` : ''}`).join('\n')
    : '  - операций пока нет';
  const goalLines = context.savingGoal ? context.savingGoal.split('\n').map(line => `  - ${line}`).join('\n') : '  - не указано';
  const legacyReserveLine = financeState.migration?.legacyReserveStatus === 'REVIEW_REQUIRED' && Number(financeState.migration?.legacyReserveAmount) > 0
    ? `\n  Legacy-резерв на проверке (не включён в резервы автоматически): ${formatRub(financeState.migration.legacyReserveAmount)}`
    : '';
  const lines = [`Отчёт TSB Hub за неделю ${shortDate(monday)} — ${shortDate(addDays(monday, 6))}`];
  lines.push(`\nФинансовый контекст Finance v2:\n  Всего на счетах: ${formatRub(coverage.totalAccounts)}\n  В резервах: ${formatRub(coverage.reserved)}\n  Обязательное скоро (${TSBFinanceCore.UPCOMING_OBLIGATION_DAYS} дн.): ${formatRub(coverage.upcoming)}\n  Свободно: ${formatRub(coverage.free)}${legacyReserveLine}\n  Формула: Свободно = счета − активные резервы − ACTIVE обязательства ближайших ${TSBFinanceCore.UPCOMING_OBLIGATION_DAYS} дней.\n  Резервы и обязательства — разные назначения и автоматически друг с другом не связываются.\n  Счета:\n${accountLines}\n  Активные резервы:\n${reserveLines}\n  ACTIVE обязательства:\n${obligationLines}\n  Ожидаемые поступления (legacy; НЕ входят в «Свободно» и не считаются уже существующими деньгами):\n${plannedIncomeLines}\n  Финансовые цели:\n${goalLines}\n  Последние реальные операции:\n${operationLines}`);
  const currentPlan = getGptPlan();
  if (currentPlan.text) lines.push(`\nТекущий план от GPT на эту неделю уже сохранён в приложении:\n${currentPlan.text}`);
  for (let i = 0; i < 7; i += 1) {
    const iso = addDays(monday, i);
    const health = getHealth(iso);
    const tasks = getTasks(iso);
    const progress = getProgress(iso);
    const finance = getFinance(iso);
    const financeSummary = getFinanceSummary(iso);
    const daily = getDailyReport(iso);
    const reportLine = hasDailyReport(iso) ? `самоощущение ${daily.selfScore || '—'}/100, желание действовать ${daily.driveScore || '—'}/100, итог: ${daily.text || 'без текста'}` : 'не заполнен';
    const mealLines = health.meals.length ? health.meals.map(meal => `    - ${meal.time || 'без времени'} · ${meal.name}${meal.amount ? ` (${meal.amount})` : ''}`).join('\n') : '    - питания не записано';
    const taskLines = tasks.length ? tasks.map(task => `    - [${task.done ? 'x' : ' '}] ${PRIORITIES[task.priority] || 'Важно'}: ${task.text}`).join('\n') : '    - задач нет';
    const financeLines = finance.expenses.length ? finance.expenses.map(expense => `    - ${expense.time || 'без времени'} · ${getFinanceCategoryLabel(expense.category)} · ${formatRub(expense.amount)}${expense.comment ? ` · ${expense.comment}` : ''}`).join('\n') : '    - трат не записано';
    lines.push(`\n${WEEKDAY_SHORT[i]} · ${formatHumanDate(iso)}\n  Ежедневный отчёт: ${reportLine}\n  Задачи: ${progress.done}/${progress.total}, выполнение ${progress.pct}%\n${taskLines}\n  Питание:\n${mealLines}\n  Вес: ${health.weight ? `${health.weight} кг` : 'не указан'}\n  Активность: ${health.activityNote || 'не указана'}\n  Заметка: ${health.note || 'нет'}\n  Финансы дня: потрачено ${formatRub(financeSummary.total)}, еда ${formatRub(financeSummary.food)}, транспорт ${formatRub(financeSummary.transport)}, другое ${formatRub(financeSummary.other)}\n${financeLines}\n  Локальные подсказки:\n${getLocalInsightsReportText(iso)}`);
  }
  lines.push("\nЗапрос к GPT: проанализируй неделю по данным TSB Hub. Для финансов используй Finance v2: реальные остатки на счетах, активные резервы, ACTIVE обязательства и вычисленное «Свободно». Не считай ожидаемые поступления уже имеющимися деньгами. Резервы и обязательства сейчас не связаны друг с другом автоматически, поэтому не объединяй их без явных данных. Дай спокойный практический план без морализаторства: что обязательно оплатить, сколько реально свободно, где безопасно сократить расходы, и что можно направить в резервы. Также учти питание, задачи, нагрузку и ежедневные отчёты. В конце дай структурированные блоки 'План на неделю', 'Совет на сегодня', 'Финансовые советы', 'Советы по питанию', 'Советы по задачам'.");
  return lines.join('\n');
}'''
app=app[:a]+report+app[b:]

# 3) Release/version hygiene, including the stale direct SW registration query.
app=re.sub(r"const APP_VERSION = '[^']+';",f"const APP_VERSION = '{APP_VERSION}';",app,count=1)
app=app.replace("navigator.serviceWorker.register('./service-worker.js?v=0.8.21-dev')",f"navigator.serviceWorker.register('./service-worker.js?v={RELEASE}')")
old_release_match=re.search(r'data-release="([^"]+)"',index)
if not old_release_match: raise RuntimeError('index release marker missing')
old_release=old_release_match.group(1)
index=index.replace(old_release,RELEASE)
index=re.sub(r'<title>TSB Hub v[^<]+</title>','<title>TSB Hub v0.12.0</title>',index,count=1)
sw=re.sub(r"const RELEASE='[^']+';",f"const RELEASE='{RELEASE}';",sw,count=1)
update=re.sub(r'// TSB Hub v[^\n]+',f'// TSB Hub v0.12.0-finance-v2-part2 — single PWA update authority.',update,count=1)
update=re.sub(r"const RELEASE='[^']+';",f"const RELEASE='{RELEASE}';",update,count=1)
manifest=json.loads(MANIFEST.read_text())
manifest['start_url']=f'./index.html?v={RELEASE}'
manifest['version']=RELEASE
for icon in manifest.get('icons',[]): icon['src']=re.sub(r'\?v=.*$',f'?v={RELEASE}',icon['src'])
VERSION.write_text(json.dumps({'release':RELEASE,'publishedAt':PUBLISHED,'cache':f'tsb-hub-{RELEASE}'},ensure_ascii=False,indent=2)+'\n')
MANIFEST.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')

# 4) Update static checks for the final Part2 release and architecture.
static=re.sub(r"assert\.ok\(app\.includes\(\"const APP_VERSION = '[^']+'\"\),'app version mismatch'\);",f"assert.ok(app.includes(\"const APP_VERSION = '{APP_VERSION}'\"),'app version mismatch');",static,count=1)
static=re.sub(r"assert\.ok\(index\.includes\('[^']*finance-v2-part1[^']*'\),'release shell mismatch'\);",f"assert.ok(index.includes('{RELEASE}'),'release shell mismatch');",static,count=1)
static=static.replace("assert.ok(reportFn.includes('Legacy-резерв'),'legacy reserve must be explicitly labeled');","assert.ok(reportFn.includes('getFinanceCoverage()'),'GPT report must use Part2 coverage');\nassert.ok(reportFn.includes('getActiveReserves'),'GPT report must include active reserves');\nassert.ok(reportFn.includes('getActiveObligations'),'GPT report must include active obligations');\nassert.ok(reportFn.includes('НЕ входят в «Свободно»'),'planned income must be marked as non-existing money');")
static += r'''

// Finance v2 Part2 final architecture and release hygiene.
assert.equal(app.includes("$$('[data-finance-form]', root)"),false,'legacy Finance v1 expense binder remains');
assert.equal(app.includes("$$('[data-finance-context-form]', root)"),false,'legacy balance context binder remains');
assert.equal(app.includes("$$('[data-finance-plan-complete]', root)"),false,'legacy plan completion binder remains');
assert.equal(index.includes('finance-module-v2.js'),false,'Finance Part2 override module must not exist');
assert.equal(fs.existsSync('js/finance-module-v2.js'),false,'Finance Part2 override file must not exist');
assert.ok(app.includes(`service-worker.js?v=${RELEASE}`),'direct service worker registration must use current release');
assert.ok(sw.includes(`const RELEASE='${RELEASE}'`),'service worker release mismatch');
const manifest=JSON.parse(fs.readFileSync('manifest.json','utf8'));
const version=JSON.parse(fs.readFileSync('version.json','utf8'));
assert.equal(manifest.version,RELEASE,'manifest release mismatch');
assert.equal(version.release,RELEASE,'version.json release mismatch');
const financeRenderStart=app.indexOf('function renderFinance()');
const financeRenderEnd=app.indexOf('function ',financeRenderStart+20);
const financeRender=app.slice(financeRenderStart,financeRenderEnd>financeRenderStart?financeRenderEnd:app.length);
const ordered=['renderFinanceMoneyNowCard()','renderFinanceQuickActions()','renderFinanceMonthCard()','renderFinanceObligationsCompact()','renderFinanceReservesCompact()','Последние операции','renderFinanceManagementLinks()'];
let last=-1;for(const marker of ordered){const pos=financeRender.indexOf(marker);assert.ok(pos>last,`Finance main order broken at ${marker}`);last=pos;}
'''.replace('${RELEASE}',RELEASE)
STATIC.write_text(static)

# 5) Explicit Part2 regression suite covering remaining required scenarios.
REG.write_text(r'''const test=require('node:test');
const assert=require('node:assert/strict');
const core=require('../js/finance-core.js');

function funded(amount=10000){
  let f=core.createEmptyFinance('2026-08-07T00:00:00.000Z');
  f=core.createAccount(f,{id:'card',name:'Карта',isDefault:true}).finance;
  f=core.createAccount(f,{id:'cash',name:'Наличные'}).finance;
  f=core.createTransaction(f,{id:'fund',type:'ADJUSTMENT',amount,accountId:'card',date:'2026-08-07'}).finance;
  return f;
}

test('Part2 reload preserves reserves obligations balances and freeMoney',()=>{
  let f=funded(20000);
  f=core.createReserve(f,{id:'r1',name:'Машина',amount:5000,targetAmount:110000},{fromDate:'2026-08-07'}).finance;
  f=core.createObligation(f,{id:'o1',name:'Интернет',amount:850,dueDate:'2026-08-12'},{fromDate:'2026-08-07'}).finance;
  const before={total:core.getTotalBalance(f),reserved:core.getTotalReservedAmount(f),upcoming:core.getUpcomingObligationsTotal(f,{fromDate:'2026-08-07'}),free:core.getFreeMoney(f,{fromDate:'2026-08-07'})};
  const reload=core.normalizeFinance(JSON.parse(JSON.stringify(f)),'2026-08-07T20:00:00.000Z');
  assert.equal(reload.reserves.length,1);assert.equal(reload.obligations.length,1);
  assert.deepEqual({total:core.getTotalBalance(reload),reserved:core.getTotalReservedAmount(reload),upcoming:core.getUpcomingObligationsTotal(reload,{fromDate:'2026-08-07'}),free:core.getFreeMoney(reload,{fromDate:'2026-08-07'})},before);
});

test('30-day upcoming window counts overdue and near ACTIVE, but not far PAID or CANCELLED',()=>{
  let f=funded(30000);
  const rows=[
    {id:'overdue',name:'Просрочено',amount:100,dueDate:'2026-08-01'},
    {id:'near',name:'Скоро',amount:200,dueDate:'2026-09-06'},
    {id:'far',name:'Далеко',amount:300,dueDate:'2026-09-07'}
  ];
  for(const row of rows)f=core.createObligation(f,row,{fromDate:'2026-08-07'}).finance;
  f.obligations.find(x=>x.id==='far').status='CANCELLED';
  f.obligations.push(core.normalizeObligation({id:'paid',name:'Оплаченное',amount:400,dueDate:'2026-08-10',status:'PAID'},f.obligations.length));
  assert.deepEqual(core.getUpcomingObligations(f,{fromDate:'2026-08-07'}).map(x=>x.id),['overdue','near']);
  assert.equal(core.getUpcomingObligationsTotal(f,{fromDate:'2026-08-07'}),300);
});

test('historical inconsistent state may be negative and coverage reports shortfall instead of breaking',()=>{
  let f=funded(1000);
  f.reserves=[core.normalizeReserve({id:'legacy-r',name:'Старый',amount:1200},0)];
  f.obligations=[core.normalizeObligation({id:'legacy-o',name:'Счёт',amount:500,dueDate:'2026-08-10',status:'ACTIVE'},0)];
  const coverage=core.getObligationCoverage(f,{fromDate:'2026-08-07'});
  assert.equal(coverage.free,-700);assert.equal(coverage.covered,false);assert.equal(coverage.shortfall,700);
});

test('legacy planned income survives Part2 migration and never changes total or free money',()=>{
  let f=funded(5000);const context={reserveBalance:'',obligations:[],incomes:[{id:'future-income',amount:'10000',date:'2026-08-20',status:'planned',title:'Будущая зарплата'}]};
  const beforeTotal=core.getTotalBalance(f);const beforeFree=core.getFreeMoney(f,{fromDate:'2026-08-07'});
  const r=core.migratePart2State({finance:f,financeContext:context,now:'2026-08-07T20:00:00.000Z'});
  assert.deepEqual(r.financeContext.incomes,context.incomes);assert.equal(core.getTotalBalance(r.finance),beforeTotal);assert.equal(core.getFreeMoney(r.finance,{fromDate:'2026-08-07'}),beforeFree);
});

test('paid legacy obligation never becomes ACTIVE in Part2 migration',()=>{
  let f=funded(5000);const context={reserveBalance:'',incomes:[],obligations:[{id:'paid-old',title:'Уже оплачено',amount:'500',date:'2026-08-05',status:'paid'},{id:'planned-old',title:'Будущее',amount:'600',date:'2026-08-15',status:'planned'}]};
  const r=core.migratePart2State({finance:f,financeContext:context,now:'2026-08-07T20:00:00.000Z'});
  assert.equal(r.finance.obligations.some(x=>x.id==='paid-old'),false);assert.equal(r.finance.obligations.filter(x=>x.status==='ACTIVE').length,1);assert.equal(r.finance.obligations[0].id,'planned-old');
});

test('INCOME edit and delete regression remains correct with Part2 collections present',()=>{
  let f=funded(1000);f=core.createReserve(f,{id:'r1',name:'Подушка',amount:100},{fromDate:'2026-08-07'}).finance;f=core.createObligation(f,{id:'o1',name:'Связь',amount:100,dueDate:'2026-08-20'},{fromDate:'2026-08-07'}).finance;
  f=core.createTransaction(f,{id:'income',type:'INCOME',amount:500,accountId:'card',incomeTypeId:'personal',date:'2026-08-07'}).finance;assert.equal(core.getTotalBalance(f),1500);
  let r=core.updateTransaction(f,'income',{amount:700});assert.equal(r.ok,true);f=r.finance;assert.equal(core.getTotalBalance(f),1700);assert.equal(f.reserves.length,1);assert.equal(f.obligations.length,1);
  r=core.deleteTransaction(f,'income');assert.equal(r.ok,true);f=r.finance;assert.equal(core.getTotalBalance(f),1000);assert.equal(f.reserves.length,1);assert.equal(f.obligations.length,1);
});

test('TRANSFER remains zero-sum after Part2 state is populated',()=>{
  let f=funded(10000);f=core.createReserve(f,{id:'r1',name:'Машина',amount:2000},{fromDate:'2026-08-07'}).finance;f=core.createObligation(f,{id:'o1',name:'Платёж',amount:500,dueDate:'2026-08-20'},{fromDate:'2026-08-07'}).finance;
  const total=core.getTotalBalance(f);const free=core.getFreeMoney(f,{fromDate:'2026-08-07'});f=core.createTransaction(f,{id:'move2',type:'TRANSFER',amount:3000,fromAccountId:'card',toAccountId:'cash',date:'2026-08-07'}).finance;
  assert.equal(core.getTotalBalance(f),total);assert.equal(core.getFreeMoney(f,{fromDate:'2026-08-07'}),free);assert.equal(core.getAccountBalance(f,'card'),7000);assert.equal(core.getAccountBalance(f,'cash'),3000);
});

test('linked obligation actual amount may differ from plan without rewriting planned amount',()=>{
  let f=funded(10000);f=core.createObligation(f,{id:'o',name:'Интернет',amount:850,dueDate:'2026-08-12'},{fromDate:'2026-08-07'}).finance;f=core.createTransaction(f,{id:'expense',type:'EXPENSE',amount:900,accountId:'card',categoryId:'home',date:'2026-08-12'}).finance;
  f=core.linkObligationToTransaction(f,'o','expense',{now:'2026-08-12T10:00:00.000Z'}).finance;assert.equal(f.obligations.find(x=>x.id==='o').amount,850);
  f=core.updateTransaction(f,'expense',{amount:950},{now:'2026-08-12T11:00:00.000Z'}).finance;assert.equal(f.obligations.find(x=>x.id==='o').amount,850);assert.equal(f.transactions.find(x=>x.id==='expense').amount,950);
});

test('category management keeps history-compatible ids and archives custom category only',()=>{
  let f=funded();let r=core.createOrUpdateCategory(f,{id:'clothes',name:'Одежда'},{now:'2026-08-07T10:00:00.000Z'});assert.equal(r.ok,true);f=r.finance;
  f=core.createTransaction(f,{id:'e-cat',type:'EXPENSE',amount:100,accountId:'card',categoryId:'clothes',date:'2026-08-07'}).finance;
  r=core.archiveCategory(f,'clothes',{now:'2026-08-07T11:00:00.000Z'});assert.equal(r.ok,true);f=r.finance;assert.equal(f.categories.find(x=>x.id==='clothes').archived,true);assert.equal(f.transactions.find(x=>x.id==='e-cat').categoryId,'clothes');
});

test('full JSON roundtrip preserves all Part2 indicators after payment and transfer',()=>{
  let f=funded(25000);f=core.createReserve(f,{id:'r1',name:'Техника',amount:3000,targetAmount:20000},{fromDate:'2026-08-07'}).finance;f=core.createObligation(f,{id:'o1',name:'Коммунальные',amount:6500,dueDate:'2026-08-15'},{fromDate:'2026-08-07'}).finance;
  f=core.createTransaction(f,{id:'move',type:'TRANSFER',amount:2000,fromAccountId:'card',toAccountId:'cash',date:'2026-08-08'}).finance;f=core.payObligation(f,'o1',{accountId:'card',categoryId:'home',date:'2026-08-15',now:'2026-08-15T10:00:00.000Z',idFactory:p=>`${p}_roundtrip`}).finance;
  const snap={total:core.getTotalBalance(f),card:core.getAccountBalance(f,'card'),cash:core.getAccountBalance(f,'cash'),reserved:core.getTotalReservedAmount(f),upcoming:core.getUpcomingObligationsTotal(f,{fromDate:'2026-08-15'}),free:core.getFreeMoney(f,{fromDate:'2026-08-15'}),tx:f.transactions.length,ob:f.obligations.length};
  const reload=core.normalizeFinance(JSON.parse(JSON.stringify(f)),'2026-08-15T20:00:00.000Z');const after={total:core.getTotalBalance(reload),card:core.getAccountBalance(reload,'card'),cash:core.getAccountBalance(reload,'cash'),reserved:core.getTotalReservedAmount(reload),upcoming:core.getUpcomingObligationsTotal(reload,{fromDate:'2026-08-15'}),free:core.getFreeMoney(reload,{fromDate:'2026-08-15'}),tx:reload.transactions.length,ob:reload.obligations.length};assert.deepEqual(after,snap);
});
''')

APP.write_text(app); INDEX.write_text(index); SW.write_text(sw); UPDATE.write_text(update)
print('Finance v2 Part2 stage G finalization applied')
