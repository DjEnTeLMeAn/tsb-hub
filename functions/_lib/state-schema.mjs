const MAX_BYTES = 1024 * 1024;
const MAX_DEPTH = 12;
const MAX_NODES = 20000;
const MAX_BUCKETS = 1000;
const MAX_STRING = 10000;
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const BAD_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const SECRET_KEY = /(?:secret|password|token|apikey|api_key|accesskey|privatekey|credential|passphrase)/i;

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v) &&
  (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const keys = (o, allowed) => {
  if (!plain(o)) return false;
  const names = Object.getOwnPropertyNames(o);
  if (Object.getOwnPropertySymbols(o).length) return false;
  return names.every(k => allowed.has(k) && !BAD_KEYS.has(k) &&
    Object.getOwnPropertyDescriptor(o, k)?.enumerable === true &&
    !Object.getOwnPropertyDescriptor(o, k)?.get && !Object.getOwnPropertyDescriptor(o, k)?.set);
};
const val = (o, k) => has(o, k) ? Object.getOwnPropertyDescriptor(o, k).value : undefined;
const optionalString = (o, k, n) => !has(o, k) || (typeof val(o, k) === 'string' && val(o, k).length <= n);
const optionalBool = (o, k) => !has(o, k) || typeof val(o, k) === 'boolean';
const finite = (o, k, max = 1e12) => !has(o, k) || (typeof val(o, k) === 'number' && Number.isFinite(val(o, k)) && Math.abs(val(o, k)) <= max);
const date = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && (() => {
  const y=Number(v.slice(0,4)), m=Number(v.slice(5,7)), d=Number(v.slice(8,10));
  if (y<1000 || y>9999 || m<1 || m>12 || d<1) return false;
  const leap=(y%4===0 && y%100!==0) || y%400===0;
  const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31]; return d<=days[m-1];
})();
const timestamp = v => typeof v === 'string' && v.length <= 100 && (!v || (() => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) || !date(v.slice(0,10))) return false;
  try { return new Date(v).toISOString() === v; } catch { return false; }
})());
const id = v => typeof v === 'string' && SAFE_ID.test(v) && !BAD_KEYS.has(v);
const ref = (o, k) => !has(o, k) || val(o, k) === null || (typeof val(o, k) === 'string' && (val(o, k) === '' || id(val(o, k))));
const unique = a => { const s = new Set(); for (const x of a) if (has(x, 'id')) { if (!id(val(x, 'id')) || s.has(val(x, 'id'))) return false; s.add(val(x, 'id')); } return true; };
const strings = (o, fields) => fields.every(([k, n]) => optionalString(o, k, n));
const bools = (o, fields) => fields.every(k => optionalBool(o, k));
const objectValues = (o, fn, limit = MAX_BUCKETS) => plain(o) && Object.keys(o).length <= limit && Object.keys(o).every(k => date(k) && fn(val(o, k)));
const arrayOf = (v, limit, fn) => Array.isArray(v) && v.length <= limit && v.every(fn) && unique(v);

function validate(value) {
  if (!plain(value) || val(value, 'backupType') !== 'full' || val(value, 'formatVersion') !== 1) return false;
  const top = new Set(['backupType','formatVersion','meta','tasks','health','dailyReports','finance','financeContext','gptPlans','importantDates','settings','archives']);
  if (!keys(value, top)) return false;
  const subKeys = new Set(['id','text','done']);
  const validSub = x => keys(x, subKeys) && (!has(x,'id') || id(val(x,'id'))) && optionalString(x,'text',1000) && optionalBool(x,'done');
  const taskKeys = new Set(['id','text','priority','done','failed','dismissed','subtasks','note','createdAt','source']);
  const validTask = x => keys(x, taskKeys) && (!has(x,'id') || id(val(x,'id'))) && strings(x,[['text',2000],['note',2000],['source',200]]) && timestamp(val(x,'createdAt')) && bools(x,['done','failed','dismissed']) && (!has(x,'priority') || !val(x,'priority') || ['critical','important','secondary'].includes(val(x,'priority'))) && (!has(x,'subtasks') || arrayOf(val(x,'subtasks'),100,validSub));
  const buckets = (v, n, fn) => objectValues(v, x => Array.isArray(x) && x.length <= n && x.every(fn) && unique(x));
  if (has(value,'tasks') && !buckets(val(value,'tasks'),500,validTask)) return false;
  const mealKeys = new Set(['id','type','name','amount','time','comment','calories','protein','fat','carbs','createdAt']);
  const validMeal = x => keys(x,mealKeys) && (!has(x,'id') || id(val(x,'id'))) && strings(x,[['type',100],['name',1000],['amount',1000],['time',20],['comment',3000]]) && timestamp(val(x,'createdAt')) && ['calories','protein','fat','carbs'].every(k=>finite(x,k));
  const dayKeys = new Set(['meals','weight','activityNote','note']);
  if (has(value,'health') && !objectValues(val(value,'health'), x => keys(x,dayKeys) && arrayOf(val(x,'meals'),500,validMeal) && strings(x,[['weight',50],['activityNote',3000],['note',3000]]))) return false;
  const reportKeys = new Set(['selfScore','driveScore','text','updatedAt']);
  const score = v => v === undefined || (typeof v === 'string' && ['', '0','25','50','75','100'].includes(v));
  if (has(value,'dailyReports') && !objectValues(val(value,'dailyReports'), x => keys(x,reportKeys) && score(val(x,'selfScore')) && score(val(x,'driveScore')) && optionalString(x,'text',5000) && timestamp(val(x,'updatedAt')))) return false;
  const planKeys = new Set(['text','createdAt','updatedAt']);
  if (has(value,'gptPlans') && !objectValues(val(value,'gptPlans'), x => keys(x,planKeys) && optionalString(x,'text',10000) && timestamp(val(x,'createdAt')) && timestamp(val(x,'updatedAt')))) return false;
  const importantKeys = new Set(['id','title','date','description','status','createdAt','source']);
  if (has(value,'importantDates') && !(Array.isArray(val(value,'importantDates')) && val(value,'importantDates').length<=1000 && val(value,'importantDates').every(x=>keys(x,importantKeys)&&(!has(x,'id')||id(val(x,'id')))&&optionalString(x,'title',1000)&&date(val(x,'date'))&&optionalString(x,'description',5000)&&['active','done','cancelled'].includes(val(x,'status'))&&timestamp(val(x,'createdAt'))&&optionalString(x,'source',200))&&unique(val(value,'importantDates')))) return false;
  const metaKeys = new Set(['appVersion','dataVersion','createdAt','lastModified','lastExported','deviceId','changeCounter']);
  if (has(value,'meta') && !(keys(val(value,'meta'),metaKeys)&&strings(val(value,'meta'),[['appVersion',100]])&&finite(val(value,'meta'),'dataVersion',100)&&finite(val(value,'meta'),'changeCounter',1e9)&&timestamp(val(value,'meta').createdAt)&&timestamp(val(value,'meta').lastModified)&&timestamp(val(value,'meta').lastExported)&&(!has(val(value,'meta'),'deviceId')||id(val(value,'meta').deviceId)))) return false;
  const settingsKeys = new Set(['hideDone','showSelectedDayOnly','showOverdueOnToday','pastTasksWindowDays','theme','migratedFromOldStorage']);
  if (has(value,'settings') && !(keys(val(value,'settings'),settingsKeys)&&bools(val(value,'settings'),['hideDone','showSelectedDayOnly','showOverdueOnToday','migratedFromOldStorage'])&&(!has(val(value,'settings'),'pastTasksWindowDays')||(Number.isInteger(val(value,'settings').pastTasksWindowDays)&&val(value,'settings').pastTasksWindowDays>=0&&val(value,'settings').pastTasksWindowDays<=365))&&(!has(val(value,'settings'),'theme')||['dark','light'].includes(val(value,'settings').theme)))) return false;
  if (has(value,'finance') && !validFinance(val(value,'finance'))) return false;
  if (has(value,'financeContext') && !validContext(val(value,'financeContext'))) return false;
  if (has(value,'archives') && !validArchives(val(value,'archives'))) return false;
  return true;
}

function validCommon(x, allowed) { return keys(x,allowed)&&id(val(x,'id'))&&optionalString(x,'name',10000)&&bools(x,['active','archived'])&&finite(x,'sortOrder',1e9)&&timestamp(val(x,'createdAt'))&&timestamp(val(x,'updatedAt')); }
function validFinance(f) {
  const fk=new Set(['schemaVersion','migration','accounts','transactions','categories','incomeTypes','reserves','obligations']), ak=new Set(['id','name','type','active','archived','isDefault','sortOrder','createdAt','updatedAt']), nk=new Set(['id','name','active','archived','system','sortOrder','createdAt','updatedAt']), tk=new Set(['id','type','amount','date','time','description','createdAt','updatedAt','accountId','categoryId','incomeTypeId','fromAccountId','toAccountId','systemKind']), rk=new Set(['id','name','amount','targetAmount','active','archived','createdAt','updatedAt','sortOrder']), ok=new Set(['id','name','amount','dueDate','recurrence','status','note','linkedTransactionId','recurrenceParentId','nextObligationId','createdAt','updatedAt']), mk=new Set(['checkpoint','completedAt','part2Checkpoint','part2CompletedAt','legacyReserveStatus','legacyReserveAmount','legacyReserveBalanceStatus','legacyReserveBalanceTransactionId','legacyReserveBalanceRestoredAt','legacyObligationsMigrated','legacyObligationsSkipped']);
  const migration=x=>keys(x,mk)&&strings(x,[['checkpoint',100],['part2Checkpoint',100],['legacyReserveStatus',100],['legacyReserveBalanceStatus',100]])&&timestamp(val(x,'completedAt'))&&timestamp(val(x,'part2CompletedAt'))&&finite(x,'legacyReserveAmount')&&ref(x,'legacyReserveBalanceTransactionId')&&timestamp(val(x,'legacyReserveBalanceRestoredAt'))&&finite(x,'legacyObligationsMigrated',1e6)&&finite(x,'legacyObligationsSkipped',1e6);
  if (!keys(f,fk)||val(f,'schemaVersion')!==3||!migration(val(f,'migration'))) return false;
  const common=(x,k)=>validCommon(x,k);
  if (!arrayOf(val(f,'accounts'),1000,x=>common(x,ak)&&optionalString(x,'type',100)&&optionalBool(x,'isDefault'))) return false;
  if (!arrayOf(val(f,'categories'),1000,x=>common(x,nk)&&optionalBool(x,'system'))) return false;
  if (!arrayOf(val(f,'incomeTypes'),1000,x=>common(x,nk)&&optionalBool(x,'system'))) return false;
  if (!arrayOf(val(f,'transactions'),10000,x=>keys(x,tk)&&id(val(x,'id'))&&['EXPENSE','INCOME','TRANSFER','ADJUSTMENT'].includes(val(x,'type'))&&finite(x,'amount')&&date(val(x,'date'))&&optionalString(x,'time',5)&&optionalString(x,'description',10000)&&timestamp(val(x,'createdAt'))&&timestamp(val(x,'updatedAt'))&&['accountId','categoryId','incomeTypeId','fromAccountId','toAccountId'].every(k=>ref(x,k)))) return false;
  if (!arrayOf(val(f,'reserves'),5000,x=>common(x,rk)&&finite(x,'amount')&&finite(x,'targetAmount')&&optionalString(x,'name',10000))) return false;
  if (!arrayOf(val(f,'obligations'),5000,x=>common(x,ok)&&finite(x,'amount')&&date(val(x,'dueDate'))&&['NONE','MONTHLY'].includes(val(x,'recurrence'))&&['ACTIVE','PAID','CANCELLED'].includes(val(x,'status'))&&optionalString(x,'note',10000)&&ref(x,'linkedTransactionId')&&ref(x,'recurrenceParentId')&&ref(x,'nextObligationId'))) return false;
  const accounts=new Set(val(f,'accounts').map(x=>val(x,'id'))), categories=new Set(val(f,'categories').map(x=>val(x,'id'))), incomes=new Set(val(f,'incomeTypes').map(x=>val(x,'id'))), txns=new Set(val(f,'transactions').map(x=>val(x,'id')));
  for (const t of val(f,'transactions')) { if ((val(t,'accountId') && !accounts.has(val(t,'accountId'))) || (val(t,'categoryId') && !categories.has(val(t,'categoryId'))) || (val(t,'incomeTypeId') && !incomes.has(val(t,'incomeTypeId'))) || (val(t,'fromAccountId') && !accounts.has(val(t,'fromAccountId'))) || (val(t,'toAccountId') && !accounts.has(val(t,'toAccountId'))) || (val(t,'type')==='EXPENSE' && val(t,'categoryId') && !categories.has(val(t,'categoryId'))) || (val(t,'type')==='INCOME' && val(t,'incomeTypeId') && !incomes.has(val(t,'incomeTypeId'))) || (val(t,'type')==='TRANSFER' && (!accounts.has(val(t,'fromAccountId')) || !accounts.has(val(t,'toAccountId')) || val(t,'fromAccountId')===val(t,'toAccountId')))) return false; }
  return val(f,'obligations').every(x=>!val(x,'linkedTransactionId')||txns.has(val(x,'linkedTransactionId')));
}
function validContext(x) { const ck=new Set(['availableBalance','reserveBalance','savingGoal','incomes','obligations','operations','financeV2Legacy']), pk=new Set(['id','amount','date','title','comment','status','completedAt','createdAt']), ok=new Set(['id','type','amount','date','title','comment','sourceId','createdAt']); const p=y=>keys(y,pk)&&id(val(y,'id'))&&optionalString(y,'amount',100)&&(!val(y,'date')||date(val(y,'date')))&&optionalString(y,'title',1000)&&optionalString(y,'comment',3000)&&['planned','received','paid'].includes(val(y,'status'))&&optionalString(y,'completedAt',100)&&timestamp(val(y,'createdAt')); const o=y=>keys(y,ok)&&id(val(y,'id'))&&['expense','income','obligation','adjustment'].includes(val(y,'type'))&&optionalString(y,'amount',100)&&date(val(y,'date'))&&optionalString(y,'title',1000)&&optionalString(y,'comment',3000)&&optionalString(y,'sourceId',128)&&timestamp(val(y,'createdAt')); return keys(x,ck)&&strings(x,[['availableBalance',100],['reserveBalance',100],['savingGoal',1000]])&&optionalBool(x,'financeV2Legacy')&&arrayOf(val(x,'incomes'),1000,p)&&arrayOf(val(x,'obligations'),1000,p)&&arrayOf(val(x,'operations'),2000,o); }
function validArchives(x) { const ak=new Set(['financeV1MigrationBackup']), bk=new Set(['createdAt','finance','financeContext']); if(!keys(x,ak)||!has(x,'financeV1MigrationBackup')) return true; const b=val(x,'financeV1MigrationBackup'); return keys(b,bk)&&timestamp(val(b,'createdAt'))&&(validFinance(val(b,'finance'))||validLegacyFinance(val(b,'finance')))&&validLegacyContext(val(b,'financeContext')); }
function validLegacyFinance(x) { return plain(x)&&Object.keys(x).length<=MAX_BUCKETS&&Object.keys(x).every(k=>date(k)&&keys(val(x,k),new Set(['expenses','noExpenses']))&&arrayOf(val(x,k).expenses,500,item=>keys(item,new Set(['id','amount','sum','category','detail','comment','date','time','createdAt','updatedAt','completedAt']))&&(!has(item,'id')||id(val(item,'id')))&&finite(item,'amount')&&strings(item,[['sum',100],['category',100],['detail',10000],['comment',10000],['time',5]])&&timestamp(val(item,'createdAt'))&&timestamp(val(item,'updatedAt'))&&timestamp(val(item,'completedAt')))); }
function validLegacyContext(x) {
  const allowed=new Set(['availableBalance','reserveBalance','savingGoal','incomes','obligations','operations','financeV2Legacy']);
  const item=y=>plain(y)&&Object.keys(y).length<=20&&Object.keys(y).every(k=>k.length<=128&&!BAD_KEYS.has(k)&&!SECRET_KEY.test(k)&&(!has(y,k)||val(y,k)===null||typeof val(y,k)==='boolean'||(typeof val(y,k)==='string'&&val(y,k).length<=MAX_STRING)||(typeof val(y,k)==='number'&&Number.isFinite(val(y,k))&&Math.abs(val(y,k))<=1e12)));
  const list=(k,n)=>!has(x,k)||(Array.isArray(val(x,k))&&val(x,k).length<=n&&val(x,k).every(item));
  return keys(x,allowed)&&optionalString(x,'availableBalance',100)&&optionalString(x,'reserveBalance',100)&&optionalString(x,'savingGoal',1000)&&optionalBool(x,'financeV2Legacy')&&list('incomes',1000)&&list('obligations',1000)&&list('operations',2000);
}

function cloneCanonical(input) {
  let nodes=0;
  const clone=(v, depth) => { if(++nodes>MAX_NODES||depth>MAX_DEPTH) throw new Error('state bounds'); if(v===null||typeof v==='boolean'||typeof v==='string') { if(typeof v==='string'&&v.length>MAX_STRING) throw new Error('string bound'); return v; } if(typeof v==='number') { if(!Number.isFinite(v)) throw new Error('non-json number'); return v; } if(Array.isArray(v)) { if(v.length>MAX_NODES) throw new Error('array bound'); const a=[]; for(let i=0;i<v.length;i++){if(!has(v,i))throw new Error('sparse array'); a.push(clone(Object.getOwnPropertyDescriptor(v,String(i)).value,depth+1));} return a; } if(!plain(v)) throw new Error('non-plain object'); const out=Object.create(null); for(const k of Object.getOwnPropertyNames(v)){if(BAD_KEYS.has(k)||SECRET_KEY.test(k))throw new Error('forbidden key'); const d=Object.getOwnPropertyDescriptor(v,k); if(!d.enumerable||d.get||d.set)throw new Error('accessor'); out[k]=clone(d.value,depth+1);} if(Object.getOwnPropertySymbols(v).length)throw new Error('symbol'); return out; };
  return clone(input,0);
}
function stringify(v) { if(v===null)return 'null'; if(typeof v==='string')return JSON.stringify(v); if(typeof v==='boolean')return v?'true':'false'; if(typeof v==='number')return JSON.stringify(v); if(Array.isArray(v))return '['+v.map(stringify).join(',')+']'; return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stringify(v[k])).join(',')+'}'; }
function freeze(v) { Object.freeze(v); if(v&&typeof v==='object') { for(const k of Object.keys(v)) if(v[k]&&typeof v[k]==='object'&&!Object.isFrozen(v[k])) freeze(v[k]); } return v; }

export async function validateAndCanonicalizeState(value) {
  const state=cloneCanonical(value); if(!validate(state)) throw new Error('invalid full state'); const payloadJson=stringify(state); const bytes=new TextEncoder().encode(payloadJson); if(bytes.byteLength>MAX_BYTES) throw new Error('payload exceeds 1 MiB'); const digest=await globalThis.crypto.subtle.digest('SHA-256',bytes); const payloadSha256=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join(''); return Object.freeze({state:freeze(state),payloadJson,payloadSha256,byteLength:bytes.byteLength});
}
