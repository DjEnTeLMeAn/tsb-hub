from pathlib import Path

CORE=Path('js/finance-core.js')
TEST=Path('tests/finance-core.test.cjs')
core=CORE.read_text()
test=TEST.read_text()

anchor="  function validateTransactionShape(transaction){\n"
if anchor not in core:
    raise RuntimeError('analytics insertion anchor missing')

analytics=r'''  function dateSpanDays(dateFrom,dateTo){
    if(!validDate(dateFrom)||!validDate(dateTo)||dateTo<dateFrom)return 0;
    const [fy,fm,fd]=dateFrom.split('-').map(Number);const [ty,tm,td]=dateTo.split('-').map(Number);
    const start=Date.UTC(fy,fm-1,fd);const end=Date.UTC(ty,tm-1,td);
    return Math.floor((end-start)/86400000)+1;
  }
  function analyticsBounds(rows,dateFrom,dateTo){
    if(validDate(dateFrom)&&validDate(dateTo)&&dateTo>=dateFrom)return {dateFrom,dateTo,days:dateSpanDays(dateFrom,dateTo)};
    const dates=rows.map(item=>item.date).filter(validDate).sort();
    if(!dates.length)return {dateFrom:'',dateTo:'',days:0};
    const from=validDate(dateFrom)?dateFrom:dates[0];const to=validDate(dateTo)?dateTo:dates[dates.length-1];
    return {dateFrom:from,dateTo:to,days:dateSpanDays(from,to)};
  }
  function getAnalyticsSummary(finance,{dateFrom='',dateTo=''}={}){
    const filters={};if(validDate(dateFrom))filters.dateFrom=dateFrom;if(validDate(dateTo))filters.dateTo=dateTo;
    const rows=getTransactions(finance,filters);
    const incomes=rows.filter(item=>item.type===TYPES.INCOME);
    const expenses=rows.filter(item=>item.type===TYPES.EXPENSE);
    const income=roundMoney(incomes.reduce((sum,item)=>sum+positiveMoney(item.amount),0));
    const expense=roundMoney(expenses.reduce((sum,item)=>sum+positiveMoney(item.amount),0));
    const byCategory={};
    expenses.forEach(item=>{
      const id=text(item.categoryId)||'other';
      const bucket=byCategory[id]||(byCategory[id]={categoryId:id,amount:0,count:0});
      bucket.amount=roundMoney(bucket.amount+positiveMoney(item.amount));bucket.count+=1;
    });
    const categoryBreakdown=Object.values(byCategory).map(item=>({...item,share:expense>0?Math.round((item.amount/expense)*1000)/10:0})).sort((a,b)=>b.amount-a.amount||a.categoryId.localeCompare(b.categoryId));
    const bounds=analyticsBounds(rows,dateFrom,dateTo);
    return {
      dateFrom:bounds.dateFrom,dateTo:bounds.dateTo,days:bounds.days,
      income,expense,difference:roundMoney(income-expense),expenseCount:expenses.length,
      averageExpensePerDay:bounds.days?roundMoney(expense/bounds.days):0,
      categoryBreakdown
    };
  }

'''
core=core.replace(anchor,analytics+anchor,1)
old="    getFreeMoney,getObligationCoverage,addDaysISO,addMonthISO,\n"
new="    getFreeMoney,getObligationCoverage,addDaysISO,addMonthISO,dateSpanDays,getAnalyticsSummary,\n"
if old not in core:
    raise RuntimeError('core export anchor missing')
core=core.replace(old,new,1)
CORE.write_text(core)

append=r'''

test('Part3 analytics uses only INCOME and EXPENSE inside the selected period',()=>{
  let f=core.createEmptyFinance('2026-08-01T00:00:00.000Z');
  f=core.createAccount(f,{id:'cash',name:'Cash',isDefault:true},{now:'2026-08-01T00:00:00.000Z'}).finance;
  const add=d=>{const r=core.createTransaction(f,d,{now:`${d.date}T12:00:00.000Z`,idFactory:()=>`t_${Math.random()}`});assert.equal(r.ok,true);f=r.finance};
  add({type:'INCOME',amount:10000,accountId:'cash',incomeTypeId:'personal',date:'2026-08-01'});
  add({type:'EXPENSE',amount:1200,accountId:'cash',categoryId:'food',date:'2026-08-02'});
  add({type:'EXPENSE',amount:800,accountId:'cash',categoryId:'food',date:'2026-08-03'});
  add({type:'EXPENSE',amount:500,accountId:'cash',categoryId:'transport',date:'2026-08-03'});
  add({type:'TRANSFER',amount:300,fromAccountId:'cash',toAccountId:'cash2',date:'2026-08-03'});
  add({type:'ADJUSTMENT',amount:250,accountId:'cash',date:'2026-08-04'});
  add({type:'EXPENSE',amount:999,accountId:'cash',categoryId:'other',date:'2026-07-31'});
  const s=core.getAnalyticsSummary(f,{dateFrom:'2026-08-01',dateTo:'2026-08-04'});
  assert.equal(s.income,10000);
  assert.equal(s.expense,2500);
  assert.equal(s.difference,7500);
  assert.equal(s.expenseCount,3);
  assert.equal(s.days,4);
  assert.equal(s.averageExpensePerDay,625);
  assert.deepEqual(s.categoryBreakdown.map(x=>[x.categoryId,x.amount,x.count,x.share]),[['food',2000,2,80],['transport',500,1,20]]);
});

test('Part3 analytics date span is inclusive and empty periods stay zero',()=>{
  const f=core.createEmptyFinance('2026-08-01T00:00:00.000Z');
  assert.equal(core.dateSpanDays('2026-08-01','2026-08-01'),1);
  assert.equal(core.dateSpanDays('2026-08-01','2026-08-07'),7);
  const s=core.getAnalyticsSummary(f,{dateFrom:'2026-08-01',dateTo:'2026-08-07'});
  assert.deepEqual({income:s.income,expense:s.expense,difference:s.difference,expenseCount:s.expenseCount,average:s.averageExpensePerDay,days:s.days},{income:0,expense:0,difference:0,expenseCount:0,average:0,days:7});
});
'''
if "Part3 analytics uses only INCOME and EXPENSE" not in test:
    test += append
TEST.write_text(test)
print('Finance v2 Part3 stage A applied')
