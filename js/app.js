const APP_VERSION = '0.13.3-finance-transaction-control';
const STORAGE_KEY = 'tsb_hub_data_v1';
const RECOVERY_BACKUP_KEY = `${STORAGE_KEY}_recovery`;
const DEVICE_ID_KEY = 'tsb_hub_device_id';
const FULL_BACKUP_TYPE = 'full';
const FINANCE_BACKUP_TYPE = 'finance';
const BACKUP_FORMAT_VERSION = 1;
const OLD_TSB_KEY = 'tasks_v043';
const OLD_HEALTH_KEY = 'healthData';
const OLD_HEALTH_SETTINGS_KEY = 'healthSettings';
const MONTH_NAMES = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const WEEKDAY_SHORT = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
const PRIORITIES = {
  critical: 'Критично',
  important: 'Важно',
  secondary: 'Второстепенно'
};
const FINANCE_CATEGORIES = [
  { value: 'food', label: 'Еда' },
  { value: 'transport', label: 'Транспорт' },
  { value: 'home', label: 'Дом' },
  { value: 'health', label: 'Здоровье' },
  { value: 'subscriptions', label: 'Подписки' },
  { value: 'fun', label: 'Развлечения' },
  { value: 'other', label: 'Другое' }
];
const FINANCE_REASONS = [
  { value: '', label: 'Не указывать' },
  { value: 'need', label: 'Нужно' },
  { value: 'planned', label: 'Планово' },
  { value: 'stress', label: 'Стресс' },
  { value: 'tired', label: 'Усталость' },
  { value: 'impulse', label: 'Импульс' },
  { value: 'reward', label: 'Награда' },
  { value: 'lazy', label: 'Лень' }
];
const SESSION_TAB_KEY = 'tsb_hub_active_tab_session';
const APP_TABS = ['tasks', 'food', 'finance'];
const APP_SCREENS = [...APP_TABS, 'settings'];
const IS_DEVELOPMENT = Boolean(window.__TSB_DEBUG__ || new URLSearchParams(window.location.search).has('debug'));

function getInitialActiveTab() {
  try {
    const savedTab = sessionStorage.getItem(SESSION_TAB_KEY);
    return APP_TABS.includes(savedTab) ? savedTab : 'tasks';
  } catch (error) {
    return 'tasks';
  }
}

function saveActiveTabForSession(tab) {
  try {
    if (APP_TABS.includes(tab)) sessionStorage.setItem(SESSION_TAB_KEY, tab);
  } catch (error) {
    // Если браузер запрещает sessionStorage, приложение просто открывается с вкладки «Сегодня».
  }
}

let app = loadData();
let state = {
  selectedDate: toISODate(new Date()),
  calendarMonth: startOfMonth(new Date()),
  activeTab: getInitialActiveTab(),
  taskPeriod: 'today',
  foodAi: { status: 'idle', result: null, error: '' },
  expandedSections: {},
  financeSection: 'overview',
  financeSubscreen: '',
  financeAddActionOpen: false
};
let toastTimer = null;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

function createDefaultData() {
  const now = new Date().toISOString();
  return {
    meta: {
      appVersion: APP_VERSION,
      dataVersion: 3,
      createdAt: now,
      lastModified: now,
      lastExported: '',
      deviceId: getOrCreateDeviceId(),
      changeCounter: 0
    },
    tasks: {},
    health: {},
    dailyReports: {},
    finance: TSBFinanceCore.createEmptyFinance(now),
    financeContext: {
      availableBalance: '',
      reserveBalance: '',
      savingGoal: '',
      incomes: [],
      obligations: [],
      operations: [],
      financeV2Legacy: true
    },
    gptPlans: {},
    importantDates: [],
    settings: {
      hideDone: false,
      showSelectedDayOnly: false,
      showOverdueOnToday: true,
      pastTasksWindowDays: 14,
      theme: 'dark',
      migratedFromOldStorage: false
    },
    archives: {}
  };
}

function getOrCreateDeviceId() {
  let id = TSBStorage.get(DEVICE_ID_KEY);
  if (!id) {
    id = `device_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    TSBStorage.set(DEVICE_ID_KEY, id);
  }
  return id;
}

function storageGet(key) {
  return TSBStorage.get(key);
}

function storageSet(key, value) {
  return TSBStorage.set(key, value);
}

function loadData() {
  const raw = storageGet(STORAGE_KEY);
  if (raw) {
    try {
      const normalized = normalizeData(JSON.parse(raw));
      saveData(normalized, false);
      return normalized;
    } catch (error) {
      console.warn('Не удалось прочитать хранилище, создана пустая база.', error);
    }
  }
  const data = createDefaultData();
  migrateOldLocalStorage(data);
  const normalized = normalizeData(data);
  saveData(normalized, false);
  return normalized;
}

function normalizeData(data) {
  const defaults = createDefaultData();
  data = data || {};
  if (!data.meta) data.meta = {};
  const now = new Date().toISOString();
  const migration = TSBFinanceCore.migrateLegacyState({
    finance: data.finance,
    financeContext: data.financeContext,
    archives: data.archives,
    now,
    idFactory: uid
  });
  const part2Migration = TSBFinanceCore.migratePart2State({
    finance: migration.finance,
    financeContext: migration.financeContext,
    now,
    idFactory: uid
  });
  let finance = part2Migration.finance;
  if (!finance.accounts.length) {
    const created = TSBFinanceCore.createAccount(finance, { id: 'account_main', name: 'Основной счёт', isDefault: true }, { now, idFactory: uid });
    if (created.ok) finance = created.finance;
  }
  return {
    ...defaults,
    ...data,
    meta: { ...defaults.meta, ...(data.meta || {}), appVersion: APP_VERSION, dataVersion: 3 },
    tasks: data.tasks || {},
    health: data.health || {},
    dailyReports: normalizeDailyReports(data.dailyReports),
    finance,
    financeContext: normalizeFinanceContext(part2Migration.financeContext),
    gptPlans: normalizeGptPlans(data.gptPlans),
    importantDates: Array.isArray(data.importantDates) ? data.importantDates : [],
    settings: { ...defaults.settings, ...(data.settings || {}) },
    archives: migration.archives || {}
  };
}

function saveData(data = app, markModified = true) {
  if (markModified) {
    data.meta.lastModified = new Date().toISOString();
    data.meta.changeCounter = Number(data.meta.changeCounter || 0) + 1;
  }
  return storageSet(STORAGE_KEY, JSON.stringify(data));
}

function markChanged() {
  saveData(app, true);
  renderAll();
}

function migrateOldLocalStorage(target) {
  let migrated = false;
  const oldTasksRaw = storageGet(OLD_TSB_KEY);
  if (oldTasksRaw) {
    try {
      const oldTasks = JSON.parse(oldTasksRaw);
      for (const [oldKey, list] of Object.entries(oldTasks || {})) {
        if (!Array.isArray(list)) continue;
        const iso = normalizeAnyDateKey(oldKey);
        if (!iso) continue;
        if (!target.tasks[iso]) target.tasks[iso] = [];
        list.forEach(task => {
          const mapped = mapOldTask(task);
          if (task?.mandatory) {
            target.importantDates.push({
              id: uid('imp'),
              title: task.text || 'Важная дата',
              date: iso,
              description: task.subtasks?.map(s => s.text || s).filter(Boolean).join('\n') || '',
              status: task.done ? 'done' : 'active',
              createdAt: new Date().toISOString(),
              source: 'migration:tasks_v043'
            });
          } else {
            target.tasks[iso].push(mapped);
          }
        });
      }
      migrated = true;
    } catch (error) {
      console.warn('Ошибка миграции TSB:', error);
    }
  }

  const oldHealthRaw = storageGet(OLD_HEALTH_KEY);
  if (oldHealthRaw) {
    try {
      const oldHealth = JSON.parse(oldHealthRaw);
      for (const [oldKey, day] of Object.entries(oldHealth || {})) {
        const iso = normalizeAnyDateKey(oldKey);
        if (!iso || !day) continue;
        target.health[iso] = {
          meals: Array.isArray(day.meals) ? day.meals.map(meal => ({
            id: uid('meal'),
            type: meal.type || 'Приём пищи',
            name: meal.name || '',
            amount: meal.amount || '',
            time: meal.time || '',
            comment: meal.comment || '',
            createdAt: new Date().toISOString()
          })) : [],
          weight: day.weight || null,
          activityNote: Array.isArray(day.activities) ? day.activities.join('\n') : (day.activityNote || ''),
          note: day.analysis || day.note || ''
        };
      }
      migrated = true;
    } catch (error) {
      console.warn('Ошибка миграции TSBH:', error);
    }
  }

  const oldSettingsRaw = storageGet(OLD_HEALTH_SETTINGS_KEY);
  if (oldSettingsRaw) {
    try {
      const oldSettings = JSON.parse(oldSettingsRaw);
      target.settings.healthSettingsSnapshot = oldSettings;
      migrated = true;
    } catch {}
  }

  if (migrated) {
    target.settings.migratedFromOldStorage = true;
    target.meta.lastModified = new Date().toISOString();
  }
}

function mapOldTask(task = {}) {
  return {
    id: uid('task'),
    text: task.text || '',
    priority: normalizePriority(task.priority),
    done: Boolean(task.done),
    failed: Boolean(task.failed),
    dismissed: Boolean(task.dismissed),
    subtasks: Array.isArray(task.subtasks) ? task.subtasks.map(s => ({
      id: uid('sub'),
      text: typeof s === 'string' ? s : (s.text || ''),
      done: typeof s === 'string' ? false : Boolean(s.done)
    })).filter(s => s.text) : [],
    note: '',
    createdAt: new Date().toISOString(),
    source: 'migration:tasks_v043'
  };
}

function normalizePriority(priority) {
  if (['critical', 'important', 'secondary'].includes(priority)) return priority;
  if (priority === 'low') return 'secondary';
  if (priority === 'high') return 'critical';
  return 'important';
}

function normalizeAnyDateKey(value) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return toISODate(d);
}

function uid(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function toISODate(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function fromISODate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function addDays(iso, amount) {
  const d = fromISODate(iso);
  d.setDate(d.getDate() + amount);
  return toISODate(d);
}

function startOfMonth(date) {
  const d = new Date(date);
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function getMondayISO(iso) {
  const date = fromISODate(iso);
  const day = date.getDay() || 7;
  date.setDate(date.getDate() - day + 1);
  return toISODate(date);
}

function formatHumanDate(iso) {
  return fromISODate(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function shortDate(iso) {
  return fromISODate(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatDateInputValue(iso) {
  const normalized = normalizeDateInput(iso);
  return normalized ? shortDate(normalized) : '';
}

function getWeeklyWeightISO(iso = state.selectedDate) {
  return addDays(getMondayISO(iso), 6);
}

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[char]);
}

function nl2br(value) {
  return escapeHTML(value).replace(/\n/g, '<br>');
}

function normalizeDateInput(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const dotted = raw.match(/^(\d{1,2})[.\/,-](\d{1,2})[.\/,-](\d{2}|\d{4})$/);
  if (dotted) {
    const day = dotted[1].padStart(2, '0');
    const month = dotted[2].padStart(2, '0');
    const year = dotted[3].length === 2 ? `20${dotted[3]}` : dotted[3];
    const iso = `${year}-${month}-${day}`;
    const check = fromISODate(iso);
    if (!Number.isNaN(check.getTime()) && toISODate(check) === iso) return iso;
  }
  return '';
}

function renderDateControl(name, value = '', required = false) {
  const safeName = escapeHTML(name);
  const displayValue = formatDateInputValue(value) || String(value || '');
  const safeValue = escapeHTML(displayValue);
  return `<div class="date-input-row"><input name="${safeName}" type="text" inputmode="numeric" autocomplete="off" placeholder="дд.мм.гггг" value="${safeValue}" ${required ? 'required' : ''}><button class="icon-button date-picker-button" type="button" data-date-picker-for="${safeName}" title="Выбрать дату" aria-label="Выбрать дату">📅</button></div>`;
}

function getTasks(iso = state.selectedDate) {
  if (!app.tasks[iso]) app.tasks[iso] = [];
  return app.tasks[iso];
}

function getHealth(iso = state.selectedDate) {
  if (!app.health[iso]) app.health[iso] = { meals: [], weight: null, activityNote: '', note: '' };
  if (!Array.isArray(app.health[iso].meals)) app.health[iso].meals = [];
  return app.health[iso];
}

function normalizeDailyReports(value) {
  if (!value || typeof value !== 'object') return {};
  const result = {};
  Object.entries(value).forEach(([iso, report]) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return;
    const source = report && typeof report === 'object' ? report : {};
    result[iso] = {
      selfScore: clampScore(source.selfScore),
      driveScore: clampScore(source.driveScore),
      text: String(source.text || source.note || '').trim(),
      updatedAt: source.updatedAt || source.createdAt || ''
    };
  });
  return result;
}

function clampScore(value) {
  if (value === '' || value === null || value === undefined) return '';
  const num = Math.round(Number(value));
  if (!Number.isFinite(num)) return '';
  const clamped = Math.min(100, Math.max(0, num));
  return String(Math.round(clamped / 25) * 25);
}

function getDailyReport(iso = state.selectedDate) {
  if (!app.dailyReports || typeof app.dailyReports !== 'object') app.dailyReports = {};
  if (!app.dailyReports[iso]) app.dailyReports[iso] = { selfScore: '', driveScore: '', text: '', updatedAt: '' };
  return app.dailyReports[iso];
}

function hasDailyReport(iso = state.selectedDate) {
  const report = getDailyReport(iso);
  return Boolean(report.selfScore || report.driveScore || String(report.text || '').trim());
}

function getDailyReportChipText(iso = state.selectedDate) {
  const report = getDailyReport(iso);
  if (!hasDailyReport(iso)) return '—';
  const self = report.selfScore || '—';
  const drive = report.driveScore || '—';
  return `${self}/${drive}`;
}
function normalizeFinance(value) {
  return TSBFinanceCore.normalizeFinance(value);
}


function normalizeFinanceContext(value) {
  const defaults = createDefaultData().financeContext;
  const source = value && typeof value === 'object' ? value : {};
  const normalizeStatus = (status, doneStatus) => [doneStatus, 'planned'].includes(status) ? status : 'planned';
  const normalizePlanItem = (item, prefix, doneStatus) => ({
    id: item?.id || uid(prefix),
    amount: normalizeMoneyInput(item?.amount || item?.sum || ''),
    date: /^\d{4}-\d{2}-\d{2}$/.test(item?.date || '') ? item.date : '',
    title: String(item?.title || item?.source || item?.category || '').trim(),
    comment: String(item?.comment || '').trim(),
    status: normalizeStatus(item?.status, doneStatus),
    completedAt: item?.completedAt || item?.receivedAt || item?.paidAt || '',
    createdAt: item?.createdAt || new Date().toISOString()
  });
  const normalizeOperation = (item) => ({
    id: item?.id || uid('op'),
    type: ['expense', 'income', 'obligation', 'adjustment'].includes(item?.type) ? item.type : 'adjustment',
    amount: normalizeSignedMoneyInput(item?.amount || ''),
    date: /^\d{4}-\d{2}-\d{2}$/.test(item?.date || '') ? item.date : toISODate(new Date()),
    title: String(item?.title || '').trim(),
    comment: String(item?.comment || '').trim(),
    sourceId: String(item?.sourceId || '').trim(),
    createdAt: item?.createdAt || new Date().toISOString()
  });
  return {
    ...defaults,
    ...source,
    availableBalance: normalizeSignedMoneyInput(source.availableBalance || source.balance || ''),
    reserveBalance: normalizeMoneyInput(source.reserveBalance || source.assetsBalance || ''),
    savingGoal: String(source.savingGoal || '').trim(),
    incomes: Array.isArray(source.incomes) ? source.incomes.map(item => normalizePlanItem(item, 'inc', 'received')).filter(item => item.amount || item.title || item.date) : [],
    obligations: Array.isArray(source.obligations) ? source.obligations.map(item => normalizePlanItem(item, 'obl', 'paid')).filter(item => item.amount || item.title || item.date) : [],
    operations: Array.isArray(source.operations) ? source.operations.map(normalizeOperation).filter(item => item.amount || item.title || item.comment) : []
  };
}

function normalizeSignedMoneyInput(value) {
  const raw = String(value || '').trim().replace(',', '.');
  if (!raw) return '';
  const sign = raw.includes('-') ? -1 : 1;
  const match = raw.match(/\d+(?:\.\d{0,2})?/);
  if (!match) return '';
  return String(Math.round(Number(match[0]) * 100) / 100 * sign);
}

function moneyNumber(value) {
  return Number(String(value || '0').replace(',', '.')) || 0;
}

function addFinanceOperation(type, amount, title, comment = '', sourceId = '', date = state.selectedDate) {
  const context = getFinanceContext();
  context.operations.unshift({
    id: uid('op'),
    type,
    amount: normalizeSignedMoneyInput(amount),
    date: normalizeDateInput(date) || state.selectedDate,
    title: String(title || '').trim(),
    comment: String(comment || '').trim(),
    sourceId: String(sourceId || '').trim(),
    createdAt: new Date().toISOString()
  });
  context.operations = context.operations.slice(0, 250);
}

function getFinanceContext() {
  app.financeContext = normalizeFinanceContext(app.financeContext);
  return app.financeContext;
}


function getUpcomingPlanItems(items, limit = 3) {
  const today = toISODate(new Date());
  return [...(items || [])]
    .filter(item => !item.date || item.date >= today)
    .sort((a, b) => String(a.date || '9999-99-99').localeCompare(String(b.date || '9999-99-99')))
    .slice(0, limit);
}

function getNextIncome() {
  return getUpcomingPlanItems(getFinanceContext().incomes, 1)[0] || null;
}


function normalizeGptPlans(value) {
  if (!value || typeof value !== 'object') return {};
  const result = {};
  Object.entries(value).forEach(([week, plan]) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) return;
    const source = plan && typeof plan === 'object' ? plan : { text: String(plan || '') };
    result[week] = {
      text: String(source.text || '').trim(),
      createdAt: source.createdAt || new Date().toISOString(),
      updatedAt: source.updatedAt || source.createdAt || new Date().toISOString()
    };
  });
  return result;
}

function getWeekKey(iso = state.selectedDate) {
  return getMondayISO(iso);
}

function getGptPlan(iso = state.selectedDate) {
  if (!app.gptPlans || typeof app.gptPlans !== 'object') app.gptPlans = {};
  const weekKey = getWeekKey(iso);
  if (!app.gptPlans[weekKey]) {
    const now = new Date().toISOString();
    app.gptPlans[weekKey] = { text: '', createdAt: now, updatedAt: now };
  }
  return app.gptPlans[weekKey];
}

function getGptPlanWeekLabel(iso = state.selectedDate) {
  const monday = getWeekKey(iso);
  return `${shortDate(monday)} — ${shortDate(addDays(monday, 6))}`;
}

function getPlanPreviewText(text, limit = 520) {
  const clean = String(text || '').trim();
  if (!clean) return '';
  return clean.length > limit ? `${clean.slice(0, limit).trim()}…` : clean;
}


function getGptAdviceText(kind = 'today', iso = state.selectedDate) {
  const plan = getGptPlan(iso).text || '';
  if (!plan.trim()) {
    return 'План от GPT на эту неделю ещё не сохранён. Сначала сформируй недельный отчёт, отправь его GPT, затем вставь полный план в блок “План от GPT на неделю”.';
  }
  const labels = {
    today: 'Совет на сегодня',
    finance: 'Финансовые советы',
    food: 'Советы по питанию',
    tasks: 'Советы по задачам'
  };
  const keywords = {
    finance: ['финанс', 'деньг', 'трат', 'расход', 'бюджет', 'баланс', 'руб', '₽', 'накоп'],
    food: ['питан', 'еда', 'приём', 'завтрак', 'обед', 'ужин', 'готов', 'продукт'],
    tasks: ['задач', 'дел', 'план', 'нагруз', 'перенос', 'приоритет']
  };
  if (kind === 'today') {
    const dayAdvice = extractDailyAdviceFromPlan(plan, iso);
    const preview = dayAdvice || getPlanPreviewText(plan, 1200);
    return `${labels.today} · ${formatHumanDate(iso)}\n\n${preview}`;
  }
  const lines = plan.split(/\n+/).map(line => line.trim()).filter(Boolean);
  const picked = lines.filter(line => keywords[kind]?.some(key => line.toLowerCase().includes(key))).slice(0, 12);
  if (picked.length) return `${labels[kind]}\n\n${picked.map(line => `• ${line.replace(/^[-•*]\s*/, '')}`).join('\n')}`;
  return `${labels[kind]}\n\nВ сохранённом плане нет отдельного блока, который удалось уверенно распознать. Ниже общий план:\n\n${getPlanPreviewText(plan, 1200)}`;
}

function extractDailyAdviceFromPlan(planText, iso = state.selectedDate) {
  const text = String(planText || '').trim();
  if (!text) return '';
  const weekday = WEEKDAY_SHORT[(fromISODate(iso).getDay() || 7) - 1].toLowerCase();
  const human = shortDate(iso);
  const full = formatHumanDate(iso).toLowerCase();
  const lines = text.split(/\n/);
  const startIndex = lines.findIndex(line => {
    const low = line.toLowerCase();
    return low.includes(human) || low.includes(full) || low.startsWith(weekday) || low.includes(`${weekday} ·`) || low.includes(`${weekday}:`);
  });
  if (startIndex < 0) return '';
  const picked = [];
  for (let i = startIndex; i < lines.length; i += 1) {
    const line = lines[i];
    if (i > startIndex && /^\s*(пн|вт|ср|чт|пт|сб|вс)\b/i.test(line)) break;
    if (i > startIndex && /^\s*\d{1,2}[.]\d{1,2}/.test(line)) break;
    picked.push(line);
    if (picked.join('\n').length > 1200) break;
  }
  return picked.join('\n').trim();
}

function renderGptAdviceCard(kind = 'today') {
  const plan = getGptPlan();
  if (!plan.text) return '';
  const titles = {
    today: 'Совет GPT на сегодня',
    finance: 'Советы GPT по финансам',
    food: 'Советы GPT по питанию',
    tasks: 'Советы GPT по задачам'
  };
  return `
    <section class="card gpt-advice-card">
      <div class="card-title-row">
        <div>
          <h2>${titles[kind] || 'Советы GPT'}</h2>
          <p class="muted">Из сохранённого недельного плана.</p>
        </div>
        <button class="ghost-button small" type="button" data-gpt-advice="${escapeHTML(kind)}">Открыть</button>
      </div>
      <div class="gpt-plan-preview">${nl2br(getPlanPreviewText(getGptAdviceText(kind), kind === 'today' ? 320 : 360))}</div>
    </section>
  `;
}

function openGptAdviceDialog(kind = 'today') {
  const titles = {
    today: 'Совет GPT на сегодня',
    finance: 'Советы GPT по финансам',
    food: 'Советы GPT по питанию',
    tasks: 'Советы GPT по задачам'
  };
  return openInfoDialog({
    title: titles[kind] || 'Советы GPT',
    message: getGptAdviceText(kind),
    buttonText: 'Закрыть'
  });
}

function getFinanceStateV2() {
  app.finance = TSBFinanceCore.normalizeFinance(app.finance);
  return app.finance;
}
function setFinanceStateV2(finance) {
  app.finance = TSBFinanceCore.normalizeFinance(finance);
  return app.finance;
}
function getFinanceAccounts(includeArchived = false) {
  return getFinanceStateV2().accounts.filter(account => includeArchived || (!account.archived && account.active));
}
function getDefaultFinanceAccount() {
  return TSBFinanceCore.getDefaultAccount(getFinanceStateV2());
}
function getFinanceAccountBalance(accountId) {
  return TSBFinanceCore.getAccountBalance(getFinanceStateV2(), accountId);
}
function getFinanceTotalBalance() {
  return TSBFinanceCore.getTotalBalance(getFinanceStateV2());
}
function getFinanceFreeMoney() {
  return TSBFinanceCore.getFreeMoney(getFinanceStateV2(), { fromDate: toISODate(new Date()) });
}
function getFinanceCoverage() {
  return TSBFinanceCore.getObligationCoverage(getFinanceStateV2(), { fromDate: toISODate(new Date()) });
}
function getFinanceTransactions(filters = {}) {
  return TSBFinanceCore.getTransactions(getFinanceStateV2(), filters);
}
function getFinanceTransaction(id) {
  return getFinanceStateV2().transactions.find(transaction => transaction.id === id) || null;
}
function getFinanceCategoryById(id) {
  return getFinanceStateV2().categories.find(item => item.id === id) || getFinanceStateV2().categories.find(item => item.id === 'other') || null;
}
function getFinanceIncomeTypeById(id) {
  return getFinanceStateV2().incomeTypes.find(item => item.id === id) || getFinanceStateV2().incomeTypes.find(item => item.id === 'other') || null;
}
function financeCategoryOptions(selected = '') {
  return getFinanceStateV2().categories.filter(item => item.active && !item.archived).map(item => ({ value: item.id, label: item.name, selected: item.id === selected }));
}
function financeIncomeTypeOptions(selected = '') {
  return getFinanceStateV2().incomeTypes.filter(item => item.active && !item.archived).map(item => ({ value: item.id, label: item.name, selected: item.id === selected }));
}
function financeAccountOptions(selected = '') {
  return getFinanceAccounts().map(account => ({ value: account.id, label: account.name, selected: account.id === selected }));
}
function financeOptionHTML(options, selected = '') {
  return options.map(item => `<option value="${escapeHTML(item.value)}" ${String(item.value) === String(selected) ? 'selected' : ''}>${escapeHTML(item.label)}</option>`).join('');
}
function financeMutationErrorText(error) {
  return ({
    SYSTEM_LOCKED: 'Системную операцию нельзя изменить',
    INVALID_AMOUNT: 'Сумма должна быть больше 0. Если операции не было — удали её.',
    INVALID_RESERVE_AMOUNT: 'Сумма резерва не может быть отрицательной',
    INVALID_TARGET_AMOUNT: 'Цель должна быть больше нуля',
    NAME_REQUIRED: 'Укажи название',
    NO_LEGACY_RESERVE_TO_IMPORT: 'Старый резерв уже обработан или отсутствует',
    INVALID_DUE_DATE: 'Укажи корректную дату платежа',
    INVALID_RECURRENCE: 'Некорректный тип повтора',
    OBLIGATION_NOT_ACTIVE: 'Этот платёж уже закрыт или отменён',
    OBLIGATION_NOT_FOUND: 'Обязательный платёж не найден',
    EXPENSE_NOT_FOUND: 'Подходящая трата не найдена',
    TRANSACTION_ALREADY_LINKED: 'Эта трата уже связана с другим платежом',
    ACCOUNT_NOT_FOUND: 'Счёт не найден',
    INVALID_ACTUAL_BALANCE: 'Укажи фактический остаток'
  })[error] || 'Не удалось изменить финансы';
}
function applyFinanceMutation(result, message = '') {
  if (!result?.ok) {
    if (typeof showToast === 'function') showToast(financeMutationErrorText(result?.error));
    return false;
  }
  setFinanceStateV2(result.finance);
  if (state.activeTab === 'finance') {
    const scrollY=window.scrollY||document.documentElement.scrollTop||0;
    saveData(app,true);
    renderFinance();
    requestAnimationFrame(()=>window.scrollTo(0,scrollY));
  } else {
    // Today still uses the established full render path because its mobile cleanup hooks live outside Finance.
    markChanged();
  }
  if (message && typeof showToast === 'function') showToast(message);
  return true;
}
function financeTransactionLegacyView(transaction) {
  return {
    id: transaction.id,
    amount: String(transaction.amount),
    category: transaction.categoryId || 'other',
    reason: '',
    comment: transaction.description || '',
    detail: transaction.description || '',
    time: transaction.time || '',
    createdAt: transaction.createdAt || '',
    updatedAt: transaction.updatedAt || ''
  };
}
async function openFinanceV2TransactionEditor(id) {
  const transaction = getFinanceTransaction(id);
  if (!transaction || TSBFinanceCore.isSystemLocked(transaction)) return;
  const accounts = financeAccountOptions(transaction.accountId || transaction.fromAccountId || '');
  let fields = [];
  if (transaction.type === 'EXPENSE') {
    fields = [
      { name: 'amount', label: 'Сумма', value: transaction.amount },
      { name: 'categoryId', label: 'Категория', type: 'select', value: transaction.categoryId, options: financeCategoryOptions(transaction.categoryId) },
      { name: 'description', label: 'Описание', type: 'textarea', value: transaction.description || '', placeholder: 'Необязательно' },
      { name: 'time', label: 'Время', type: 'time', value: transaction.time || '' },
      { name: 'accountId', label: 'Счёт', type: 'select', value: transaction.accountId, options: accounts }
    ];
  } else if (transaction.type === 'INCOME') {
    fields = [
      { name: 'amount', label: 'Сумма', value: transaction.amount },
      { name: 'incomeTypeId', label: 'Тип поступления', type: 'select', value: transaction.incomeTypeId, options: financeIncomeTypeOptions(transaction.incomeTypeId) },
      { name: 'description', label: 'Описание', type: 'textarea', value: transaction.description || '', placeholder: 'Необязательно' },
      { name: 'time', label: 'Время', type: 'time', value: transaction.time || '' },
      { name: 'accountId', label: 'Счёт', type: 'select', value: transaction.accountId, options: accounts }
    ];
  } else if (transaction.type === 'TRANSFER') {
    fields = [
      { name: 'amount', label: 'Сумма', value: transaction.amount },
      { name: 'fromAccountId', label: 'Откуда', type: 'select', value: transaction.fromAccountId, options: financeAccountOptions(transaction.fromAccountId) },
      { name: 'toAccountId', label: 'Куда', type: 'select', value: transaction.toAccountId, options: financeAccountOptions(transaction.toAccountId) },
      { name: 'date', label: 'Дата', type: 'date', value: transaction.date },
      { name: 'time', label: 'Время', type: 'time', value: transaction.time || '' }
    ];
  } else {
    return;
  }
  const result = await openEditDialog({ title: transaction.type === 'EXPENSE' ? 'Изменить трату' : transaction.type === 'INCOME' ? 'Изменить поступление' : 'Изменить перевод', fields, submitText: 'Подтвердить' });
  if (!result) return;
  const patch = { ...result };
  if (patch.amount !== undefined) patch.amount = normalizeMoneyInput(patch.amount);
  applyFinanceMutation(TSBFinanceCore.updateTransaction(getFinanceStateV2(), id, patch), 'Операция изменена');
}
async function deleteFinanceV2Transaction(id) {
  const transaction = getFinanceTransaction(id);
  if (!transaction || TSBFinanceCore.isSystemLocked(transaction)) return;
  const ok = await openConfirmDialog({ title: 'Удалить операцию?', message: 'Её влияние на баланс будет полностью отменено.', confirmText: 'Подтвердить', danger: true });
  if (!ok) return;
  const mutation = TSBFinanceCore.deleteTransaction(getFinanceStateV2(), id);
  applyFinanceMutation(mutation, mutation?.reactivatedObligationIds?.length ? 'Операция удалена · платёж снова активен' : 'Операция удалена');
}
function bindFinanceV2GlobalEvents() {
  if (window.__tsbFinanceV2EventsBound) return;
  window.__tsbFinanceV2EventsBound = true;
  document.addEventListener('submit', event => {
    const form = event.target.closest?.('[data-finance-v2-expense-form]');
    if (!form) return;
    event.preventDefault();
    const fd = new FormData(form);
    const amount = normalizeMoneyInput(fd.get('amount'));
    const account = getDefaultFinanceAccount();
    if (!amount || !account) return;
    const now = new Date();
    const date = form.dataset.date || state.selectedDate || toISODate(now);
    const transaction = {
      type: 'EXPENSE', amount, accountId: account.id,
      categoryId: normalizeFinanceCategory(fd.get('categoryId')),
      date, time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
      description: ''
    };
    const result = TSBFinanceCore.createTransaction(getFinanceStateV2(), transaction, { idFactory: uid });
    if (applyFinanceMutation(result, 'Трата добавлена')) form.reset();
  });
  document.addEventListener('click', event => {
    const quick = event.target.closest?.('[data-finance-v2-quick-category]');
    if (quick) {
      const form = quick.closest('.today-input-card, .card')?.querySelector('[data-finance-v2-expense-form]');
      const select = form?.querySelector('[name="categoryId"]');
      if (select) select.value = quick.dataset.financeV2QuickCategory;
      return;
    }
    const edit = event.target.closest?.('[data-finance-v2-edit]');
    if (edit) { event.preventDefault(); openFinanceV2TransactionEditor(edit.dataset.financeV2Edit); return; }
    const del = event.target.closest?.('[data-finance-v2-delete]');
    if (del) { event.preventDefault(); deleteFinanceV2Transaction(del.dataset.financeV2Delete); }
  });
}
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', bindFinanceV2GlobalEvents);
  bindFinanceV2GlobalEvents();
}

function getFinance(iso = state.selectedDate) {
  return {
    noExpenses: false,
    expenses: getFinanceTransactions({ type: 'EXPENSE', dateFrom: iso, dateTo: iso }).map(financeTransactionLegacyView)
  };
}

function normalizeFinanceCategory(value) {
  const id = String(value || '').trim();
  return getFinanceStateV2().categories.some(item => item.id === id && !item.archived) ? id : 'other';
}

function normalizeFinanceReason(value) {
  return FINANCE_REASONS.some(item => item.value === value) ? value : '';
}

function getFinanceCategoryLabel(value) {
  return getFinanceCategoryById(value)?.name || 'Другое';
}

function getFinanceReasonLabel(value) {
  return FINANCE_REASONS.find(item => item.value === value)?.label || '';
}

function normalizeMoneyInput(value) {
  const raw = String(value || '').trim().replace(',', '.');
  if (!raw) return '';
  const match = raw.match(/\d+(?:\.\d{0,2})?/);
  if (!match) return '';
  return String(Math.round(Number(match[0]) * 100) / 100);
}

function formatRub(value) {
  const num = Number(String(value || '0').replace(',', '.')) || 0;
  return `${num.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽`;
}

function getFinanceSummary(iso = state.selectedDate) {
  const expenses = getFinanceTransactions({ type: 'EXPENSE', dateFrom: iso, dateTo: iso });
  const total = expenses.reduce((sum, item) => sum + moneyNumber(item.amount), 0);
  const food = expenses.filter(item => item.categoryId === 'food').reduce((sum, item) => sum + moneyNumber(item.amount), 0);
  const transport = expenses.filter(item => item.categoryId === 'transport').reduce((sum, item) => sum + moneyNumber(item.amount), 0);
  const other = Math.max(0, total - food - transport);
  return { total, food, transport, other, impulse: 0, count: expenses.length };
}



function getWeekDates(iso = state.selectedDate) {
  const monday = getMondayISO(iso);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

function getWeekDataSummary(iso = state.selectedDate) {
  const days = getWeekDates(iso);
  const todayISO = toISODate(new Date());
  const pastOrTodayDays = days.filter(day => day <= todayISO);
  const expenseDays = days.map(day => ({ iso: day, summary: getFinanceSummary(day), expenses: getFinance(day).expenses }));
  const totalSpent = expenseDays.reduce((sum, day) => sum + day.summary.total, 0);
  const foodSpent = expenseDays.reduce((sum, day) => sum + day.summary.food, 0);
  const emotionalSpent = expenseDays.reduce((sum, day) => sum + day.summary.impulse, 0);
  const emotionalCount = expenseDays.reduce((sum, day) => sum + day.expenses.filter(item => ['impulse', 'stress', 'tired', 'lazy', 'reward'].includes(item.reason)).length, 0);
  const expenseDaysCount = expenseDays.filter(day => day.summary.total > 0).length;
  const topExpenseDay = expenseDays.reduce((best, day) => day.summary.total > (best?.summary?.total || 0) ? day : best, null);
  const mealDays = days.map(day => ({ iso: day, count: getHealth(day).meals.length }));
  const loggedMealDays = mealDays.filter(day => day.count > 0).length;
  const missedMealPastDays = pastOrTodayDays.filter(day => getHealth(day).meals.length === 0).length;
  const taskDays = days.map(day => ({ iso: day, progress: getProgress(day), tasks: getTasks(day) }));
  const totalTasks = taskDays.reduce((sum, day) => sum + day.progress.total, 0);
  const doneTasks = taskDays.reduce((sum, day) => sum + day.progress.done, 0);
  const failedTasks = taskDays.reduce((sum, day) => sum + day.progress.failed, 0);
  const overloadedDays = taskDays.filter(day => day.progress.total >= 7 || day.tasks.filter(task => !task.done && !task.failed && !task.dismissed).length >= 4).length;
  const completionPct = totalTasks ? Math.round((doneTasks / totalTasks) * 100) : 0;
  const activeImportant = (app.importantDates || []).filter(item => item.status === 'active' && item.date >= days[0] && item.date <= days[6]).length;
  return { days, pastOrTodayDays, totalSpent, foodSpent, emotionalSpent, emotionalCount, expenseDaysCount, topExpenseDay, loggedMealDays, missedMealPastDays, totalTasks, doneTasks, failedTasks, overloadedDays, completionPct, activeImportant };
}

function getLocalInsights(iso = state.selectedDate) {
  const insights = [];
  const todayISO = toISODate(new Date());
  const health = getHealth(iso);
  const tasks = getTasks(iso);
  const progress = getProgress(iso);
  const finance = getFinance(iso);
  const financeSummary = getFinanceSummary(iso);
  const selectedIsFuture = iso > todayISO;
  const selectedIsTodayOrPast = iso <= todayISO;
  const pendingTasks = tasks.filter(task => !task.done && !task.failed && !task.dismissed).length;
  const impulseCount = finance.expenses.filter(item => ['impulse', 'stress', 'tired', 'lazy', 'reward'].includes(item.reason)).length;
  const financeCoverage = getFinanceCoverage();
  const week = getWeekDataSummary(iso);


  if (week.totalTasks >= 5) {
    if (week.completionPct < 45) {
      insights.push({ tone: 'warn', title: 'Неделя может быть перегружена задачами', text: `По неделе выполнено ${week.doneTasks}/${week.totalTasks} задач (${week.completionPct}%). Возможно, план слишком тяжёлый — на следующую неделю лучше оставить меньше обязательных дел.` });
    } else if (week.completionPct >= 75) {
      insights.push({ tone: 'good', title: 'По задачам неделя идёт уверенно', text: `Выполнено ${week.doneTasks}/${week.totalTasks} задач (${week.completionPct}%). Можно сохранить такой темп и не добавлять лишнее без необходимости.` });
    }
  }

  if (week.overloadedDays >= 2) {
    insights.push({ tone: 'warn', title: 'Несколько дней выглядят перегруженными', text: `На этой неделе ${week.overloadedDays} дня с большим количеством задач или незавершёнки. Лучше планировать 1–3 главных дела в день.` });
  }

  if (selectedIsTodayOrPast && !health.meals.length) {
    insights.push({ tone: 'soft', title: 'Питание за выбранный день не записано', text: 'Можно записать хотя бы один приём пищи — этого уже достаточно для честной дневной истории.' });
  } else if (week.loggedMealDays >= 4) {
    insights.push({ tone: 'good', title: 'Питание ведётся достаточно регулярно', text: `На этой неделе питание записано в ${week.loggedMealDays} из 7 дней. Этого достаточно, чтобы увидеть повторяющиеся привычки.` });
  } else if (week.missedMealPastDays >= 3) {
    insights.push({ tone: 'soft', title: 'В неделе мало данных по питанию', text: `За прошедшие дни недели ${week.missedMealPastDays} дней без питания. Лучше короткая запись, чем пустой день: хотя бы “что ел + время”.` });
  }

  if (pendingTasks >= 4 || tasks.length >= 7) {
    insights.push({ tone: 'warn', title: 'Выбранный день может быть перегружен', text: `Сейчас задач: ${tasks.length}, незавершённых: ${pendingTasks}. Лучше выбрать 1–3 главные и не давить на себя всем списком.` });
  } else if (progress.total > 0 && progress.pct === 100) {
    insights.push({ tone: 'good', title: 'Задачи дня закрыты хорошо', text: 'День выглядит управляемо. Можно не добавлять лишнего без необходимости.' });
  }


  const financeClosedDays = week.pastOrTodayDays.filter(day => getFinance(day).expenses.length || getFinance(day).noExpenses).length;
  const missingFinanceDays = week.pastOrTodayDays.length - financeClosedDays;
  if (selectedIsTodayOrPast && !finance.expenses.length && !finance.noExpenses) {
    insights.push({ tone: 'soft', title: 'Финансы дня не закрыты', text: 'Если трат не было, отметь “Сегодня не было трат”. Если были — добавь их одной короткой записью.' });
  } else if (missingFinanceDays >= 3) {
    insights.push({ tone: 'soft', title: 'Есть незакрытые финансовые дни', text: `За прошедшие дни недели ${missingFinanceDays} дней без трат и без отметки “без трат”. Лучше закрыть их коротко, чтобы отчёт был честным.` });
  }

  if (week.activeImportant > 0) {
    insights.push({ tone: 'soft', title: 'На неделе есть важные даты', text: `Активных важных дат на этой неделе: ${week.activeImportant}. Их стоит учесть в задачах и деньгах.` });
  }

  if (!financeCoverage.covered) {
    insights.push({ tone: 'warn', title: 'Назначено больше денег, чем сейчас есть', text: `Свободно ${formatRub(financeCoverage.free)}. Не хватает ${formatRub(financeCoverage.shortfall)} с учётом резервов и обязательных платежей.` });
  }

  const weekWeightISO = getWeeklyWeightISO(iso);
  if (todayISO >= weekWeightISO && !getHealth(weekWeightISO).weight) {
    insights.push({ tone: 'warn', title: 'Нужно указать вес недели', text: `Замер веса запланирован на ${shortDate(weekWeightISO)}. После сохранения веса эта подсказка исчезнет.` });
  }

  if (!insights.length && !selectedIsFuture) {
    insights.push({ tone: 'good', title: 'Критичных сигналов нет', text: 'По текущим данным неделя выглядит спокойно. Продолжай вести записи коротко.' });
  }
  return insights.slice(0, 6);
}

function renderLocalInsights(iso = state.selectedDate, compact = false) {
  const all = getLocalInsights(iso);
  const visible = compact ? all.slice(0, 2) : all;
  if (compact && !visible.length) return '';
  const items = visible.map(item => `
    <article class="insight-item ${item.tone}">
      <div class="insight-dot" aria-hidden="true"></div>
      <div><h3>${escapeHTML(item.title)}</h3><p>${escapeHTML(item.text)}</p></div>
    </article>
  `).join('');
  return `
    <section class="card insight-card ${compact ? 'compact' : ''}">
      <div class="card-title-row"><div><h2>Локальные подсказки</h2><p class="muted">${compact ? 'Показываются только важные сигналы.' : 'Короткие сигналы по выбранному дню и неделе.'}</p></div>${compact && all.length > visible.length ? `<button class="ghost-button small" type="button" data-local-insights-open>Все ${all.length}</button>` : ''}</div>
      <div class="insight-list">${items}</div>
    </section>
  `;
}

function openLocalInsightsDialog() {
  const text = getLocalInsights(state.selectedDate).map(item => `${item.title}\n${item.text}`).join('\n\n') || 'По выбранному дню нет важных локальных сигналов.';
  return openInfoDialog({ title: 'Все локальные подсказки', message: text, buttonText: 'Закрыть' });
}

function getLocalInsightsReportText(iso = state.selectedDate) {
  return getLocalInsights(iso).map(item => `  - ${item.title}: ${item.text}`).join('\n') || '  - нет подсказок';
}

function renderCollapsedBlock(title, content, countText = '', options = {}) {
  const body = String(content || '').trim() || '<div class="empty">Пока нет записей.</div>';
  const safeTitle = escapeHTML(title);
  const suffix = countText ? ` · ${escapeHTML(countText)}` : '';
  const key = options.key || title;
  const isOpen = Object.prototype.hasOwnProperty.call(state.expandedSections, key) ? state.expandedSections[key] : Boolean(options.open);
  const openAttr = isOpen ? ' open' : '';
  return `<details class="collapsible-list today-details" data-details-key="${escapeHTML(key)}"${openAttr}><summary>${safeTitle}${suffix}</summary>${body}</details>`;
}

function getProgress(iso = state.selectedDate) {
  // Скрытие из блока «Незавершённое за прошлые дни» не удаляет задачу из истории дня.
  // Поэтому dismissed-задачи остаются в общем количестве, иначе день с двумя задачами
  // после скрытия одной старой задачи превращался в неверный счётчик 1/1.
  const tasks = getTasks(iso);
  const total = tasks.length;
  const done = tasks.filter(task => task.done).length;
  const failed = tasks.filter(task => task.failed || task.dismissed).length;
  return { total, done, failed, pct: total ? Math.round((done / total) * 100) : 0 };
}

function getImportantStatus(item, baseDateISO = toISODate(new Date())) {
  if (item.status === 'done') return { text: 'Закрыто', type: 'secondary', days: 0 };
  if (item.status === 'cancelled') return { text: 'Отменено', type: 'secondary', days: 0 };
  const diff = Math.round((fromISODate(item.date) - fromISODate(baseDateISO)) / 86400000);
  if (diff < 0) return { text: `Просрочено: ${Math.abs(diff)} дн.`, type: 'overdue', days: diff };
  if (diff === 0) return { text: 'Сегодня', type: 'critical', days: diff };
  if (diff <= 7) return { text: `Скоро: ${diff} дн.`, type: 'important', days: diff };
  return { text: `Осталось: ${diff} дн.`, type: 'secondary', days: diff };
}

function setSelectedDate(iso) {
  state.selectedDate = iso;
  state.calendarMonth = startOfMonth(fromISODate(iso));
  renderAll();
}

function applyActiveTabToDom() {
  document.body.dataset.activeTab = state.activeTab;
  const sectionTitle = $('#currentSectionTitle');
  if (sectionTitle) {
    sectionTitle.textContent = {
      tasks: 'Tasks',
      food: 'Food',
      finance: 'Finance',
      settings: 'Настройки'
    }[state.activeTab] || 'Tasks';
  }
  $$('.tab-button').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === state.activeTab));
  $$('.mobile-tab-menu [data-tab-target]').forEach(btn => btn.classList.toggle('active', btn.dataset.tabTarget === state.activeTab));
  $$('.tab-page').forEach(page => page.classList.toggle('active', page.id === `tab-${state.activeTab}`));
}

function setTab(tab) {
  if (!APP_SCREENS.includes(tab)) tab = 'tasks';
  const tabChanged = state.activeTab !== tab;
  state.activeTab = tab;
  saveActiveTabForSession(tab);
  applyActiveTabToDom();
  renderAll();
  if (tabChanged) requestAnimationFrame(() => window.scrollTo(0, 0));
}

function renderAll() {
  applyActiveTabToDom();
  $('#selectedDateLabel').textContent = formatHumanDate(state.selectedDate);
  const renderSteps = [
    ['desktopCalendar', () => renderCalendar($('#desktopCalendar'))],
    ['mobileCalendar', () => renderCalendar($('#mobileCalendar'))],
    ['sideImportant', renderSideImportant],
    ['tasks', renderTasks],
    ['food', renderFood],
    ['finance', renderFinance],
    ['settings', renderSettings]
  ];
  const errors = [];
  renderSteps.forEach(([name, fn]) => {
    try { fn(); } catch (error) {
      console.error(`Ошибка рендера ${name}:`, error);
      errors.push(name);
    }
  });
  if (errors.length) showRenderError(errors);
  ensureSettingsFallback();
}

function showRenderError(errors) {
  const root = $('#tab-settings');
  if (!root) return;
  const block = document.createElement('section');
  block.className = 'card warning-card';
  block.innerHTML = `<div class="card-title-row"><h2>Диагностика</h2></div><p>Некоторые блоки не отрисовались: ${errors.map(escapeHTML).join(', ')}. Открой консоль браузера или пришли скрин.</p>`;
  root.prepend(block);
}

function ensureSettingsFallback() {
  const root = $('#tab-settings');
  if (!root) return;
  if (root.children.length > 0) return;
  root.innerHTML = buildSettingsHTML();
  bindSettingsActions(root);
}

function renderCalendar(root) {
  if (!root) return;
  const month = state.calendarMonth.getMonth();
  const year = state.calendarMonth.getFullYear();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startOffset = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1;
  const todayISO = toISODate(new Date());

  let cells = WEEKDAY_SHORT.map(day => `<div class="calendar-cell">${day}</div>`).join('');
  for (let i = 0; i < startOffset; i += 1) cells += '<div class="calendar-cell empty-cell"></div>';
  for (let d = 1; d <= lastDay.getDate(); d += 1) {
    const iso = toISODate(new Date(year, month, d));
    const hasData = (app.tasks[iso]?.length || 0) > 0 || (app.health[iso]?.meals?.length || 0) > 0 || app.health[iso]?.weight || hasDailyReport(iso) || (app.finance?.[iso]?.expenses?.length || 0) > 0 || Boolean(app.finance?.[iso]?.noExpenses);
    cells += `<button class="calendar-cell day ${iso === state.selectedDate ? 'selected' : ''} ${iso === todayISO ? 'today' : ''} ${hasData ? 'has-data' : ''}" data-date="${iso}">${d}</button>`;
  }

  root.innerHTML = `
    <div class="calendar-widget">
      <div class="calendar-head">
        <button class="icon-button small-cal" data-calendar-prev>‹</button>
        <div class="calendar-title">${MONTH_NAMES[month]} ${year}</div>
        <button class="icon-button small-cal" data-calendar-next>›</button>
      </div>
      <div class="calendar-grid">${cells}</div>
    </div>
  `;
  $('[data-calendar-prev]', root).onclick = () => {
    state.calendarMonth = new Date(year, month - 1, 1);
    renderAll();
  };
  $('[data-calendar-next]', root).onclick = () => {
    state.calendarMonth = new Date(year, month + 1, 1);
    renderAll();
  };
  $$('[data-date]', root).forEach(btn => {
    btn.onclick = () => {
      setSelectedDate(btn.dataset.date);
      const dialog = $('#calendarDialog');
      if (dialog?.open) dialog.close();
    };
  });
}

function renderTodaySummaryChips(progress, weeklyWeight, weeklyWeightISO, financeSummary) {
  const reportText = getDailyReportChipText(state.selectedDate);
  return `
    <section class="card today-summary-compact">
      <div class="card-title-row compact-title-row">
        <div>
          <h2>${state.selectedDate === toISODate(new Date()) ? 'Сегодня' : 'День'} · ${formatHumanDate(state.selectedDate)}</h2>
          <p class="muted">Короткая сводка выбранной даты.</p>
        </div>
      </div>
      <div class="summary-chip-row">
        <span class="summary-chip">Задачи ${progress.done}/${progress.total}</span>
        <span class="summary-chip">Готово ${progress.pct}%</span>
        <span class="summary-chip">Вес ${weeklyWeight ? `${escapeHTML(weeklyWeight)} кг` : '—'} <small>${shortDate(weeklyWeightISO)}</small></span>
        <span class="summary-chip">Траты ${formatRub(financeSummary.total)}</span>
        <span class="summary-chip">Отчёт ${reportText}</span>
      </div>
    </section>
  `;
}

function renderDailyReportCard() {
  const report = getDailyReport();
  const filled = hasDailyReport();
  const preview = String(report.text || '').trim();
  return `
    <section class="card daily-report-card today-input-card">
      <div class="card-title-row">
        <div>
          <h2>Итог дня</h2>
          <p class="muted">Самоощущение, желание действовать и короткие мысли по дню.</p>
        </div>
      </div>
      <div class="daily-report-status">
        <span class="summary-chip">Самоощущение ${report.selfScore || '—'}</span>
        <span class="summary-chip">Желание ${report.driveScore || '—'}</span>
        <span class="summary-chip">${preview ? 'Комментарий есть' : 'Комментария нет'}</span>
      </div>
      ${preview ? `<p class="muted daily-report-preview">${escapeHTML(getPlanPreviewText(preview, 180))}</p>` : '<p class="muted daily-report-preview">Можно заполнить одной строкой в конце дня. Подробно писать не обязательно.</p>'}
      <button class="primary-button" type="button" data-daily-report-open>${filled ? 'Изменить итог дня' : 'Заполнить итог дня'}</button>
    </section>
  `;
}

function renderTaskRow(task, iso) {
  const time = task.time || task.dueTime || '';
  const taskText = escapeHTML(task.text);
  const taskId = escapeHTML(task.id);
  return `<article class="task-list-item ${task.done ? 'done' : ''} ${task.dismissed ? 'dismissed' : ''}" data-task-open="${taskId}" data-date="${escapeHTML(iso)}" role="button" tabindex="0" aria-label="Открыть задачу «${taskText}»">
    <label class="task-list-main">
      <input type="checkbox" data-task-toggle="${taskId}" data-date="${escapeHTML(iso)}" ${task.done ? 'checked' : ''} aria-label="Отметить задачу «${taskText}»: ${task.done ? 'выполнено' : 'не выполнено'}">
      <span class="task-list-copy"><span class="task-list-title">${taskText}</span>${time ? `<span class="task-list-meta"><time datetime="${escapeHTML(time)}">${escapeHTML(time)}</time></span>` : ''}</span>
    </label>
  </article>`;
}

function openTaskActionSheet(taskId, iso) {
  const task = findTask(iso, taskId);
  if (!task) return;
  const dialog = document.createElement('dialog');
  dialog.className = 'task-list-actionsheet';
  const safeId = escapeHTML(task.id);
  const safeDate = escapeHTML(iso);
  const subtaskCount = Array.isArray(task.subtasks) ? task.subtasks.length : 0;
  dialog.innerHTML = `<div class="task-list-actionsheet-panel">
    <div class="task-list-actionsheet-header"><div><p class="muted">${escapeHTML(iso === state.selectedDate ? 'Сегодня' : 'Завтра')}</p><h2>${escapeHTML(task.text)}</h2></div><button class="icon-button" type="button" data-task-sheet-close aria-label="Закрыть">×</button></div>
    ${task.time ? `<p class="task-list-actionsheet-meta">Время: ${escapeHTML(task.time)}</p>` : ''}
    <div class="task-list-actionsheet-actions">
      <button class="ghost-button" type="button" data-task-sub="${safeId}" data-date="${safeDate}">Подзадачи${subtaskCount ? ` · ${subtaskCount}` : ''}</button>
      <button class="ghost-button" type="button" data-task-edit="${safeId}" data-date="${safeDate}">Изменить</button>
      <button class="danger-button" type="button" data-task-delete="${safeId}" data-date="${safeDate}">Удалить</button>
    </div>
  </div>`;
  document.body.appendChild(dialog);
  const close = () => { if (dialog.open) dialog.close(); dialog.remove(); };
  dialog.querySelector('[data-task-sheet-close]').onclick = close;
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('click', event => {
    if (event.target === dialog) close();
  });
  // Close before the existing action handlers open their edit/confirm dialogs.
  dialog.addEventListener('click', event => {
    if (event.target.closest('[data-task-edit],[data-task-delete],[data-task-sub]')) close();
  }, true);
  bindCommonActions(dialog);
  dialog.showModal();
}

function renderTasks() {
  const root = $('#tab-tasks');
  if (!root) return;
  const iso = state.taskPeriod === 'tomorrow' ? addDays(state.selectedDate, 1) : state.selectedDate;
  const allTasks = getTasks(iso).filter(task => !(app.settings.hideDone && (task.done || task.dismissed)));
  const periodLabel = state.taskPeriod === 'tomorrow' ? 'Завтра' : 'Сегодня';
  root.innerHTML = `<section class="task-list-screen"><header class="task-list-screen-header"><div><h1>Задачи</h1><p class="muted">${formatHumanDate(iso)}</p></div></header>
    <nav class="segmented-control" aria-label="Период задач"><button type="button" class="${state.taskPeriod === 'today' ? 'active' : ''}" data-task-period="today" aria-current="${state.taskPeriod === 'today' ? 'page' : 'false'}">Сегодня</button><button type="button" class="${state.taskPeriod === 'tomorrow' ? 'active' : ''}" data-task-period="tomorrow" aria-current="${state.taskPeriod === 'tomorrow' ? 'page' : 'false'}">Завтра</button></nav>
    <section class="task-list-screen-section"><div class="task-list-screen-toolbar"><button class="primary-button compact-action" type="button" data-task-add aria-label="Добавить задачу на ${periodLabel.toLowerCase()}" aria-controls="task-add-form-${state.taskPeriod}" aria-expanded="false">+ Добавить</button></div>
      <div class="action-disclosure task-quick-add" id="task-add-form-${state.taskPeriod}" data-task-add-form hidden>${renderTaskAddForm(iso, `tasks-${state.taskPeriod}`)}</div>
      <div class="task-list-screen-list" aria-label="Список задач">${allTasks.length ? allTasks.map(task => renderTaskRow(task, iso)).join('') : '<div class="empty-state"><strong>На этот день задач нет</strong><p class="muted">Добавьте одну небольшую задачу, чтобы начать план.</p></div>'}</div>
    </section></section>`;
  root.querySelectorAll('[data-task-period]').forEach(button => button.onclick = () => { state.taskPeriod = button.dataset.taskPeriod; renderTasks(); });
  root.querySelectorAll('[data-task-open]').forEach(row => {
    const open = () => openTaskActionSheet(row.dataset.taskOpen, row.dataset.date);
    row.addEventListener('click', event => { if (!event.target.closest('input,button,a,select,textarea')) open(); });
    row.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } });
  });
  root.querySelector('[data-task-add]')?.addEventListener('click', event => {
    const formWrap = root.querySelector('[data-task-add-form]');
    if (!formWrap) return;
    const isOpen = !formWrap.hidden;
    formWrap.hidden = isOpen;
    event.currentTarget.setAttribute('aria-expanded', String(!isOpen));
    if (!isOpen) formWrap.querySelector('input')?.focus();
  });
  bindCommonActions(root);
}

function renderToday() {
  const root = $('#tab-today');
  if (!root) return;
  const health = getHealth();
  const weeklyWeightISO = getWeeklyWeightISO(state.selectedDate);
  const weeklyWeight = getHealth(weeklyWeightISO).weight;
  const progress = getProgress();
  const important = getImportantPreview(3);
  const financeSummary = getFinanceSummary();
  const financeFreeMoney = getFinanceFreeMoney();
  const gptPlan = getGptPlan();
  const pastTasks = app.settings.showOverdueOnToday ? getPendingPastTasksHTML() : '';
  const windowDays = Number(app.settings.pastTasksWindowDays || 14);
  const overdueCount = pastTasks ? (pastTasks.match(/class="task-card/g) || []).length : 0;
  const overdueSection = app.settings.showOverdueOnToday ? `
      <div class="card today-list-card">
        <div class="card-title-row"><h2>Незавершённое за прошлые дни</h2><button class="ghost-button small" data-tab-target="settings">Настроить</button></div>
        ${renderCollapsedBlock('Показать незавершённые задачи', `<div class="task-list">${pastTasks || '<div class="empty">Незавершённых задач за выбранный период нет.</div>'}</div>`, overdueCount ? `${overdueCount} · ${windowDays} дн.` : `${windowDays} дн.`, { key: `today-overdue-${state.selectedDate}` })}
      </div>` : '';
  root.innerHTML = `
    ${renderTodaySummaryChips(progress, weeklyWeight, weeklyWeightISO, financeSummary)}

    ${renderLocalInsights(state.selectedDate, true)}

    ${renderGptAdviceCard('today')}

    <section class="grid-2">
      <div class="card today-input-card">
        <div class="card-title-row"><h2>Задачи дня</h2><button class="ghost-button small" data-tab-target="tasks">Задачи</button></div>
        ${renderCollapsedBlock('Добавить задачу', renderTaskAddForm(state.selectedDate, 'today'), '', { key: `today-task-entry-${state.selectedDate}` })}
        ${renderCollapsedBlock('Показать задачи дня', `<div class="task-list" style="margin-top:12px">${renderTaskList(state.selectedDate, true)}</div>`, `${progress.total}`, { key: `today-tasks-${state.selectedDate}` })}
      </div>
      <div class="card today-input-card">
        <div class="card-title-row"><h2>Питание дня</h2><button class="ghost-button small" data-tab-target="food">Питание</button></div>
        ${renderCollapsedBlock('Добавить питание', renderMealAddForm('today'), '', { key: `today-food-entry-${state.selectedDate}` })}
        ${renderCollapsedBlock('Показать питание дня', `<div class="meal-list" style="margin-top:12px">${renderMealList(state.selectedDate)}</div>`, `${health.meals.length}`, { key: `today-food-${state.selectedDate}` })}
      </div>
      <div class="card today-input-card today-finance-card">
        <div class="card-title-row"><h2>Финансы дня</h2><button class="ghost-button small" data-tab-target="finance">Финансы</button></div>
        <div class="finance-summary-line finance-v2-today-free">Свободно: <strong>${formatRub(financeFreeMoney)}</strong></div>
        ${renderCollapsedBlock('Добавить расход', renderFinanceQuickForm('today'), '', { key: `today-finance-entry-${state.selectedDate}` })}
        <div class="finance-summary-line">Потрачено за день: ${formatRub(financeSummary.total)} · еда: ${formatRub(financeSummary.food)} · транспорт: ${formatRub(financeSummary.transport)} · другое: ${formatRub(financeSummary.other)}</div>
        ${renderCollapsedBlock('Показать операции дня', `<div class="finance-list" style="margin-top:12px">${renderFinanceList(state.selectedDate, true)}</div>`, `${financeSummary.count}`, { key: `today-finance-${state.selectedDate}` })}
      </div>
      ${renderDailyReportCard()}
    </section>

    <section class="grid-2">
      <div class="card today-list-card">
        <div class="card-title-row"><h2>Ближайшие важные даты</h2><button class="ghost-button small" data-tab-target="tasks">Задачи</button></div>
        ${renderCollapsedBlock('Показать ближайшие даты', `<div class="important-list">${important || '<div class="empty">Важных дат пока нет.</div>'}</div>`, '', { key: `today-important-${state.selectedDate}` })}
      </div>
${overdueSection}
    </section>
  `;
  bindCommonActions(root);
}

function renderPlans() {
  const root = $('#tab-plans');
  if (!root) return;
  const monday = getMondayISO(state.selectedDate);
  let days = '';
  for (let i = 0; i < 7; i += 1) {
    const iso = addDays(monday, i);
    const progress = getProgress(iso);
    if (app.settings.showSelectedDayOnly && iso !== state.selectedDate) continue;
    const taskList = renderTaskList(iso, false);
    const hasTasks = getTasks(iso).length > 0;
    const detailsKey = `plans-${iso}`;
    const openAttr = state.expandedSections[detailsKey] ? ' open' : '';
    const tasksBlock = `<details class="collapsible-list day-task-details" data-details-key="${detailsKey}"${openAttr}>
          <summary>${WEEKDAY_SHORT[i]} · ${shortDate(iso)} · задачи ${progress.done}/${progress.total}${hasTasks ? '' : ' · пусто'}</summary>
          <div class="task-list">${taskList}</div>
        </details>`;
    days += `
      <article class="day-column ${iso === state.selectedDate ? 'selected' : ''} ${iso === toISODate(new Date()) ? 'today' : ''}">
        <div class="day-title"><span>${WEEKDAY_SHORT[i]}</span><span>${shortDate(iso)}</span></div>
        <div class="progress"><span style="width:${progress.pct}%"></span></div>
        ${renderTaskAddForm(iso, `plans-${i}`)}
        ${tasksBlock}
      </article>
    `;
  }
  root.innerHTML = `
    ${renderGptAdviceCard('tasks')}

    <section class="card">
      <div class="card-title-row">
        <div>
          <h2>Планы недели</h2>
          <p class="muted">Неделя выбранной даты.</p>
        </div>
        <button class="ghost-button small" id="toggleSelectedDayOnly">${app.settings.showSelectedDayOnly ? 'Показать неделю' : 'Только выбранный день'}</button>
      </div>
      <div class="week-grid ${app.settings.showSelectedDayOnly ? 'single-day' : ''}">${days}</div>
    </section>
  `;
  $('#toggleSelectedDayOnly', root).onclick = () => {
    app.settings.showSelectedDayOnly = !app.settings.showSelectedDayOnly;
    markChanged();
  };
  bindCommonActions(root);
}

function getFoodAiState() {
  if (!state.foodAi || state.foodAi.date !== state.selectedDate) {
    state.foodAi = { date: state.selectedDate, status: 'idle', result: null, error: '' };
  }
  return state.foodAi;
}

function foodNumber(value) {
  const number = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(number) ? number : 0;
}

function getFoodNutrition(iso = state.selectedDate) {
  const meals = getHealth(iso).meals || [];
  return meals.reduce((total, meal) => {
    const nutrition = meal.nutrition || meal;
    total.calories += foodNumber(nutrition.calories ?? nutrition.kcal);
    total.protein += foodNumber(nutrition.protein);
    total.carbs += foodNumber(nutrition.carbs ?? nutrition.carbohydrates);
    total.fat += foodNumber(nutrition.fat);
    return total;
  }, { calories: 0, protein: 0, carbs: 0, fat: 0 });
}

function renderFoodMacros(nutrition) {
  return `<div class="grid-3" aria-label="Макронутриенты">
    <div><span class="muted">Белки</span><strong>${Math.round(nutrition.protein)} г</strong></div>
    <div><span class="muted">Жиры</span><strong>${Math.round(nutrition.fat)} г</strong></div>
    <div><span class="muted">Углеводы</span><strong>${Math.round(nutrition.carbs)} г</strong></div>
  </div>`;
}

function renderFoodMealPreview(iso = state.selectedDate) {
  const meals = getHealth(iso).meals || [];
  if (!meals.length) return '<div class="empty" role="status">За выбранный день ещё нет записей. Отсканируй блюдо или добавь его вручную.</div>';
  return meals.map(meal => {
    const name = meal.name || 'Приём пищи';
    const time = meal.time || 'Без времени';
    return `<article class="meal-card" aria-label="${escapeHTML(name)}${meal.time ? `, ${escapeHTML(time)}` : ''}">
      <div class="item-top"><div>
        <div class="badge-row"><span class="badge">${escapeHTML(time)}</span></div>
        <h3>${escapeHTML(name)}</h3>
        ${meal.amount ? `<p class="muted">${escapeHTML(meal.amount)}</p>` : '<p class="muted">Количество не указано</p>'}
      </div></div>
    </article>`;
  }).join('');
}

function renderFoodAiCard() {
  const ai = getFoodAiState();
  if (ai.status === 'selecting') return `<section class="card" data-food-ai-panel role="region" aria-labelledby="food-ai-title" aria-live="polite"><div class="card-title-row"><div><h2 id="food-ai-title">Фото блюда</h2><p class="muted">Выбери фото для анализа.</p></div></div>${IS_DEVELOPMENT ? '<div class="actions" aria-label="Демо-сценарии анализа"><button class="primary-button" type="button" data-food-ai-demo aria-label="Показать демо-результат анализа">Показать анализ</button><button class="ghost-button" type="button" data-food-ai-error aria-label="Показать демо-ошибку анализа">Показать ошибку</button><button class="ghost-button" type="button" data-food-ai-discard>Отмена</button></div>' : ''}</section>`;
  if (ai.status === 'analysing') return `<section class="card" data-food-ai-panel role="region" aria-labelledby="food-ai-title" aria-live="polite" aria-busy="true"><div class="card-title-row"><div><h2 id="food-ai-title">Анализ блюда…</h2><p class="muted">Подожди немного.</p></div></div></section>`;
  if (ai.status === 'error') return `<section class="card warning-card" data-food-ai-panel role="alert" aria-labelledby="food-ai-title"><div class="card-title-row"><div><h2 id="food-ai-title">Не удалось распознать блюдо</h2><p>${escapeHTML(ai.error || 'Попробуй ещё раз.')}</p></div></div><button class="ghost-button" type="button" data-food-ai-scan aria-label="Повторить сканирование блюда">Повторить сканирование</button></section>`;
  if (ai.status === 'result' || ai.status === 'saved') {
    const result = ai.result || {};
    return `<section class="card" data-food-ai-panel role="region" aria-labelledby="food-ai-title" aria-live="polite"><div class="card-title-row"><div><h2 id="food-ai-title">${ai.status === 'saved' ? 'Приём пищи сохранён' : 'Проверь результат'}</h2><p class="muted">Оценка · ${escapeHTML(result.name || 'Блюдо')}</p></div></div>
      <div class="grid-2"><div><div class="small-stat" aria-label="Калорийность на порцию">${Math.round(foodNumber(result.calories))} ккал</div><span class="muted">на порцию</span></div>${renderFoodMacros(result)}</div>
      <div class="actions" aria-label="Действия с результатом"><button class="ghost-button" type="button" data-food-ai-edit aria-label="Изменить результат анализа">Изменить</button>${ai.status === 'result' ? `<button class="primary-button" type="button" data-food-ai-save aria-label="Сохранить блюдо в дневник">Сохранить</button>${IS_DEVELOPMENT ? '<button class="ghost-button" type="button" data-food-ai-discard>Отбросить</button>' : ''}` : '<button class="ghost-button" type="button" data-food-ai-scan aria-label="Сканировать ещё одно блюдо">Сканировать ещё</button>'}</div></section>`;
  }
  return `<section class="card" data-food-ai-panel role="region" aria-labelledby="food-ai-title"><div class="card-title-row"><div><h2 id="food-ai-title">Сканировать блюдо</h2><p class="muted">Быстрая оценка калорий и макросов.</p></div></div><button class="primary-button" type="button" data-food-ai-scan aria-label="Сканировать блюдо с помощью AI">📷 Сканировать блюдо</button></section>`;
}

function renderFood() {
  const root = $('#tab-food');
  if (!root) return;
  const health = getHealth();
  const nutrition = getFoodNutrition();
  const weightISO = getWeeklyWeightISO(state.selectedDate);
  const weightHealth = getHealth(weightISO);
  root.innerHTML = `<section class="card" aria-labelledby="food-summary-title"><div class="card-title-row"><div><h1 id="food-summary-title">Питание</h1><p class="muted">Главное за день — энергия и быстрый ввод.</p></div></div><div class="small-stat" aria-label="Калории за выбранный день">${Math.round(nutrition.calories)}${nutrition.calories ? ' <span class="muted">ккал</span>' : ' / 2300 <span class="muted">ккал</span>'}</div>${renderFoodMacros(nutrition)}</section>
    ${renderFoodAiCard()}
    <section class="card" aria-labelledby="food-meals-title"><div class="card-title-row"><div><h2 id="food-meals-title">Блюда</h2><p class="muted">${health.meals.length} записей</p></div></div><div class="meal-list" aria-label="Записи о блюдах">${renderFoodMealPreview()}</div></section>
    ${renderCollapsedBlock('Добавить вручную', renderMealAddForm('food'), '', { key: `food-manual-${state.selectedDate}` })}
    ${renderCollapsedBlock('Вес и заметка дня', `<div class="grid-2"><form class="form-grid weight weekly-weight-form" data-weight-form data-weight-date="${weightISO}"><label>Вес, кг<input name="weight" type="text" inputmode="decimal" placeholder="Напр. 82.4" value="${escapeHTML(weightHealth.weight || '')}"></label><button class="primary-button" type="submit">Сохранить вес недели</button></form><form data-day-note-form class="sync-box day-note-form"><textarea name="note" placeholder="Заметка дня">${escapeHTML(health.note || health.activityNote || '')}</textarea><button class="primary-button" type="submit">Сохранить заметку</button></form></div>`, '', { key: `food-details-${state.selectedDate}` })}
    `;
  bindCommonActions(root);
  $('[data-food-ai-scan]', root)?.addEventListener('click', () => { getFoodAiState().status = 'selecting'; renderFood(); });
  $('[data-food-ai-error]', root)?.addEventListener('click', () => { const ai = getFoodAiState(); ai.status = 'error'; ai.error = 'Демо-ошибка: анализ недоступен.'; renderFood(); });
  $('[data-food-ai-demo]', root)?.addEventListener('click', () => { const ai = getFoodAiState(); ai.status = 'analysing'; renderFood(); setTimeout(() => { ai.status = 'result'; ai.result = { name: 'Демо-блюдо', calories: 520, protein: 28, fat: 19, carbs: 54 }; renderFood(); }, 450); });
  $('[data-food-ai-edit]', root)?.addEventListener('click', async () => { const ai = getFoodAiState(); const result = await openEditDialog({ title: 'Проверить блюдо', fields: [{ name: 'name', label: 'Название', value: ai.result?.name || '' }, { name: 'calories', label: 'Калории', value: ai.result?.calories || '' }, { name: 'protein', label: 'Белки, г', value: ai.result?.protein || '' }, { name: 'fat', label: 'Жиры, г', value: ai.result?.fat || '' }, { name: 'carbs', label: 'Углеводы, г', value: ai.result?.carbs || '' }] }); if (!result) return; ai.result = { ...ai.result, name: result.name.trim() || ai.result.name, calories: foodNumber(result.calories), protein: foodNumber(result.protein), fat: foodNumber(result.fat), carbs: foodNumber(result.carbs) }; renderFood(); });
  $('[data-food-ai-save]', root)?.addEventListener('click', () => { const ai = getFoodAiState(); if (!ai.result) return; getHealth().meals.push({ id: uid('meal'), type: 'Приём пищи', name: ai.result.name, amount: `${Math.round(foodNumber(ai.result.calories))} ккал`, time: '', comment: 'Добавлено через AI demo', calories: foodNumber(ai.result.calories), protein: foodNumber(ai.result.protein), fat: foodNumber(ai.result.fat), carbs: foodNumber(ai.result.carbs), createdAt: new Date().toISOString() }); saveData(app, true); ai.status = 'saved'; renderFood(); showToast('AI-результат сохранён'); });
  $('[data-food-ai-discard]', root)?.addEventListener('click', () => { state.foodAi = { date: state.selectedDate, status: 'idle', result: null, error: '' }; renderFood(); });
  $('[data-weight-form]', root)?.addEventListener('submit', event => { event.preventDefault(); const fd = new FormData(event.currentTarget); getHealth(event.currentTarget.dataset.weightDate || weightISO).weight = normalizeWeightInput(fd.get('weight')) || null; markChanged(); showToast('Вес недели сохранён'); });
  $('[data-day-note-form]', root)?.addEventListener('submit', event => { event.preventDefault(); getHealth().note = new FormData(event.currentTarget).get('note') || ''; markChanged(); showToast('Заметка дня сохранена'); });
}





function renderGptPlanEditor() {
  const plan = getGptPlan();
  return `
    <section class="card gpt-plan-card">
      <div class="card-title-row">
        <div>
          <h2>План от GPT на неделю</h2>
          <p class="muted">Неделя ${getGptPlanWeekLabel()}. Вставь сюда полный ответ GPT: питание, финансы, задачи, риски и советы.</p>
        </div>
        <button class="icon-button help-button" type="button" data-gpt-plan-help title="Как использовать">?</button>
      </div>
      <form data-gpt-plan-form class="sync-box">
        <textarea name="planText" class="gpt-plan-textarea" placeholder="Вставь сюда недельный план от GPT. Советы появятся в нужных вкладках.">${escapeHTML(plan.text || '')}</textarea>
        <div class="actions modal-actions">
          <button class="ghost-button" type="button" data-gpt-plan-clear ${plan.text ? '' : 'disabled'}>Очистить</button>
          <button class="primary-button" type="submit">Сохранить план</button>
        </div>
      </form>
    </section>
  `;
}


function financeTypeLabel(transaction) {
  if (transaction.type === 'EXPENSE') return getFinanceCategoryLabel(transaction.categoryId);
  if (transaction.type === 'INCOME') return getFinanceIncomeTypeById(transaction.incomeTypeId)?.name || 'Поступление';
  if (transaction.type === 'TRANSFER') return 'Перевод';
  return 'Корректировка';
}
function financeSignedAmount(transaction) {
  const amount = moneyNumber(transaction.amount);
  if (transaction.type === 'EXPENSE') return `−${formatRub(amount)}`;
  if (transaction.type === 'INCOME') return `+${formatRub(amount)}`;
  if (transaction.type === 'TRANSFER') return formatRub(amount);
  return `${amount > 0 ? '+' : ''}${formatRub(amount)}`;
}
function financeTransactionTone(transaction) {
  return transaction.type === 'EXPENSE' ? 'expense' : transaction.type === 'INCOME' ? 'income' : transaction.type === 'TRANSFER' ? 'transfer' : 'adjustment';
}
function renderFinanceV2AccountCard(account) {
  const balance = getFinanceAccountBalance(account.id);
  return `<article class="finance-v2-account ${account.isDefault ? 'default' : ''}">
    <div><div class="badge-row">${account.isDefault ? '<span class="badge important">по умолчанию</span>' : ''}${account.type ? `<span class="badge secondary">${escapeHTML(account.type)}</span>` : ''}</div><h3>${escapeHTML(account.name)}</h3><div class="finance-v2-account-balance">${formatRub(balance)}</div></div>
    <div class="actions"><button class="ghost-button" type="button" data-finance-v2-account-edit="${escapeHTML(account.id)}">Изм.</button>${getFinanceAccounts().length > 1 ? `<button class="danger-button" type="button" data-finance-v2-account-archive="${escapeHTML(account.id)}">Удал.</button>` : ''}</div>
  </article>`;
}
function renderFinanceV2TransactionRow(transaction, options = {}) {
  const compact = options.compact !== false;
  const account = getFinanceStateV2().accounts.find(item => item.id === transaction.accountId);
  const from = getFinanceStateV2().accounts.find(item => item.id === transaction.fromAccountId);
  const to = getFinanceStateV2().accounts.find(item => item.id === transaction.toAccountId);
  const accountText = transaction.type === 'TRANSFER' ? `${from?.name || '—'} → ${to?.name || '—'}` : (account?.name || '');
  const editable=!TSBFinanceCore.isSystemLocked(transaction);
  const actionButtons=editable?`<div class="actions finance-v2-operation-actions"><button class="ghost-button mf-icon-action" type="button" data-finance-v2-edit="${escapeHTML(transaction.id)}" title="Изменить" aria-label="Изменить операцию">✎</button><button class="danger-button mf-icon-action mf-trash-action" type="button" data-finance-v2-delete="${escapeHTML(transaction.id)}" title="Удалить" aria-label="Удалить операцию">🗑</button></div>`:'<span class="finance-v2-chevron">›</span>';
  return `<article class="finance-card finance-v2-operation ${financeTransactionTone(transaction)}" data-finance-v2-open="${escapeHTML(transaction.id)}">
    <div class="item-top"><div><div class="badge-row"><span class="badge ${transaction.type === 'EXPENSE' ? 'important' : 'secondary'}">${escapeHTML(financeTypeLabel(transaction))}</span>${transaction.time ? `<span class="badge">${escapeHTML(transaction.time)}</span>` : ''}</div><h3>${financeSignedAmount(transaction)}</h3>${transaction.description ? `<p class="muted">${escapeHTML(transaction.description)}</p>` : ''}${accountText ? `<p class="muted finance-v2-account-note">${escapeHTML(accountText)}</p>` : ''}</div>${actionButtons}</div>
  </article>`;
}
async function openFinanceV2AccountDialog(accountId = '') {
  const finance = getFinanceStateV2();
  const current = finance.accounts.find(item => item.id === accountId) || null;
  const result = await openEditDialog({
    title: current ? 'Изменить счёт' : 'Новый счёт',
    fields: [
      { name: 'name', label: 'Название', value: current?.name || '', placeholder: 'Т-Банк, Сбер, Наличные' },
      { name: 'type', label: 'Тип', type: 'select', value: current?.type || '', options: [
        { value: '', label: 'Не указывать' }, { value: 'Банк', label: 'Банк' }, { value: 'Наличные', label: 'Наличные' }, { value: 'Накопительный', label: 'Накопительный' }, { value: 'Другое', label: 'Другое' }
      ]},
      { name: 'isDefault', label: 'Использовать по умолчанию', type: 'select', value: current?.isDefault ? 'yes' : 'no', options: [{ value: 'no', label: 'Нет' }, { value: 'yes', label: 'Да' }] }
    ], submitText: 'Подтвердить'
  });
  if (!result || !String(result.name || '').trim()) return;
  const draft = { name: String(result.name).trim(), type: String(result.type || ''), isDefault: result.isDefault === 'yes' };
  const mutation = current ? TSBFinanceCore.updateAccount(finance, current.id, draft) : TSBFinanceCore.createAccount(finance, draft, { idFactory: uid });
  applyFinanceMutation(mutation, current ? 'Счёт изменён' : 'Счёт добавлен');
}
async function archiveFinanceV2Account(accountId) {
  const account = getFinanceStateV2().accounts.find(item => item.id === accountId); if (!account) return;
  const ok = await openConfirmDialog({ title: 'Архивировать счёт?', message: `${account.name}. Операции сохранятся в истории.`, confirmText: 'Подтвердить', danger: true });
  if (!ok) return;
  const mutation = TSBFinanceCore.archiveAccount(getFinanceStateV2(), accountId); if (!mutation.ok && mutation.error === 'ACCOUNT_NOT_EMPTY') { showToast('Сначала переведи деньги с этого счёта'); return; } applyFinanceMutation(mutation, 'Счёт архивирован');
}
async function openFinanceV2IncomeDialog() {
  const account = getDefaultFinanceAccount(); if (!account) return;
  const now = new Date(); const today = toISODate(now); const hm = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  const result = await openEditDialog({ title: 'Добавить поступление', fields: [
    { name: 'amount', label: 'Сумма', value: '', placeholder: 'Напр. 35000' },
    { name: 'incomeTypeId', label: 'Тип поступления', type: 'select', value: 'personal', options: financeIncomeTypeOptions('personal') },
    { name: 'accountId', label: 'Счёт', type: 'select', value: account.id, options: financeAccountOptions(account.id) },
    { name: 'description', label: 'Описание', type: 'textarea', value: '', placeholder: 'Необязательно' },
    { name: 'date', label: 'Дата', type: 'date', value: today },
    { name: 'time', label: 'Время', type: 'time', value: hm }
  ], submitText: 'Подтвердить' });
  if (!result) return;
  const amount = normalizeMoneyInput(result.amount); const date = normalizeDateInput(result.date) || today;
  if (!amount) return;
  applyFinanceMutation(TSBFinanceCore.createTransaction(getFinanceStateV2(), { type:'INCOME', amount, incomeTypeId:result.incomeTypeId, accountId:result.accountId, description:result.description, date, time:result.time }, { idFactory:uid }), 'Поступление добавлено');
}
async function openFinanceV2TransferDialog() {
  const accounts = getFinanceAccounts(); if (accounts.length < 2) { showToast('Для перевода нужно минимум два счёта'); return; }
  const now = new Date(); const today = toISODate(now); const hm = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  const result = await openEditDialog({ title: 'Перевод между счетами', fields: [
    { name:'amount', label:'Сумма', value:'', placeholder:'Напр. 5000' },
    { name:'fromAccountId', label:'Откуда', type:'select', value:accounts[0].id, options:financeAccountOptions(accounts[0].id) },
    { name:'toAccountId', label:'Куда', type:'select', value:accounts[1].id, options:financeAccountOptions(accounts[1].id) },
    { name:'date', label:'Дата', type:'date', value:today },
    { name:'time', label:'Время', type:'time', value:hm }
  ], submitText:'Подтвердить' });
  if (!result) return;
  const amount=normalizeMoneyInput(result.amount); const date=normalizeDateInput(result.date)||today; if(!amount) return;
  const mutation=TSBFinanceCore.createTransaction(getFinanceStateV2(), { type:'TRANSFER', amount, fromAccountId:result.fromAccountId, toAccountId:result.toAccountId, date, time:result.time }, { idFactory:uid });
  if (!mutation.ok && mutation.error==='TRANSFER_FIELDS') { showToast('Выбери разные счета'); return; }
  applyFinanceMutation(mutation,'Перевод добавлен');
}
function renderFinanceMoneyNowCard() {
  const coverage=getFinanceCoverage();
  const warning=coverage.free<0?`<div class="finance-v2-free-warning">⚠ Назначено больше денег, чем сейчас есть · не хватает ${formatRub(coverage.shortfall)}</div>`:'';
  return `<section class="card finance-v2-money-now ${coverage.free<0?'negative':''}">
    <div class="card-title-row"><div><h2>Деньги сейчас</h2><p class="muted">Счета минус резервы и ACTIVE платежи на ${TSBFinanceCore.UPCOMING_OBLIGATION_DAYS} дней.</p></div></div>
    <div class="finance-v2-money-grid">
      <div class="finance-v2-money-stat"><span>Всего на счетах</span><strong>${formatRub(coverage.totalAccounts)}</strong></div>
      <div class="finance-v2-money-stat"><span>В резервах</span><strong>${formatRub(coverage.reserved)}</strong></div>
      <div class="finance-v2-money-stat"><span>Обязательное скоро</span><strong>${formatRub(coverage.upcoming)}</strong></div>
      <div class="finance-v2-money-stat free"><span>Свободно</span><strong>${formatRub(coverage.free)}</strong></div>
    </div>${warning}
  </section>`;
}

function financeCurrentMonthStats() {
  const now=new Date();const start=toISODate(new Date(now.getFullYear(),now.getMonth(),1));const end=toISODate(now);
  const summary=TSBFinanceCore.getAnalyticsSummary(getFinanceStateV2(),{dateFrom:start,dateTo:end});
  return {...summary,label:MONTH_NAMES[now.getMonth()].toUpperCase(),topCategories:summary.categoryBreakdown.slice(0,3).map(item=>({...item,name:getFinanceCategoryLabel(item.categoryId)}))};
}
function renderFinanceQuickActions() {
  return `<section class="card finance-v2-quick-actions-card"><div class="card-title-row"><h2>Быстрые действия</h2></div><div class="finance-v2-quick-actions"><button class="primary-button" type="button" data-finance-v2-income-add>+ Поступление</button><button class="ghost-button" type="button" data-finance-v2-expense-add>+ Расход</button><button class="ghost-button" type="button" data-finance-v2-transfer-add>Перевод</button><button class="ghost-button" type="button" data-finance-more>Ещё</button></div></section>`;
}
function renderFinanceMonthCard() {
  const stats=financeCurrentMonthStats();const diff=stats.difference;const top=stats.topCategories.length?`<div class="finance-v2-month-top">${stats.topCategories.map(item=>`<div><span>${escapeHTML(item.name)}</span><strong>${formatRub(item.amount)}</strong></div>`).join('')}</div>`:'';
  return `<section class="card finance-v2-month-card"><div class="card-title-row"><div><h2>${stats.label}</h2><p class="muted">Только реальные INCOME и EXPENSE.</p></div></div><div class="finance-v2-month-grid"><div><span>Поступило</span><strong>${formatRub(stats.income)}</strong></div><div><span>Потрачено</span><strong>${formatRub(stats.expense)}</strong></div><div class="difference"><span>Разница</span><strong>${diff>0?'+':''}${formatRub(diff)}</strong></div></div>${top}<button class="ghost-button finance-v2-details-button" type="button" data-finance-analytics-open>Подробнее</button></section>`;
}

function ensureFinanceAnalyticsState() {
  if(!state.financeAnalytics||typeof state.financeAnalytics!=='object')state.financeAnalytics={period:'month',dateFrom:'',dateTo:''};
  return state.financeAnalytics;
}
function financeAnalyticsRange(period=ensureFinanceAnalyticsState().period) {
  const a=ensureFinanceAnalyticsState();const today=toISODate(new Date());const now=fromISODate(today);
  if(period==='week')return {dateFrom:getMondayISO(today),dateTo:today};
  if(period==='3m'){const start=new Date(now.getFullYear(),now.getMonth()-2,1);return {dateFrom:toISODate(start),dateTo:today};}
  if(period==='year')return {dateFrom:`${now.getFullYear()}-01-01`,dateTo:today};
  if(period==='custom'){
    const from=normalizeAnyDateKey(a.dateFrom);const to=normalizeAnyDateKey(a.dateTo);
    if(from&&to&&from<=to)return {dateFrom:from,dateTo:to};
  }
  return {dateFrom:toISODate(new Date(now.getFullYear(),now.getMonth(),1)),dateTo:today};
}
function financeAnalyticsSummary() {
  const range=financeAnalyticsRange();return {...TSBFinanceCore.getAnalyticsSummary(getFinanceStateV2(),range),...range};
}
function financeAnalyticsCategoryHTML(summary) {
  if(!summary.categoryBreakdown.length)return '<div class="empty">Расходов за период нет.</div>';
  return summary.categoryBreakdown.map(item=>`<div class="finance-v2-analytics-category"><div><strong>${escapeHTML(getFinanceCategoryLabel(item.categoryId))}</strong><small>${item.count} оп. · ${item.share}%</small></div><strong>${formatRub(item.amount)}</strong></div>`).join('');
}
function renderFinanceAnalyticsScreen(root=$('#tab-finance')) {
  if(!root)return;const a=ensureFinanceAnalyticsState();const summary=financeAnalyticsSummary();const diff=summary.difference;
  const buttons=[['week','Неделя'],['month','Месяц'],['3m','3 месяца'],['year','Год'],['custom','Свой период']].map(([value,label])=>`<button class="ghost-button small ${a.period===value?'active':''}" type="button" data-finance-analytics-period="${value}">${label}</button>`).join('');
  const custom=a.period==='custom'?`<form class="finance-v2-analytics-custom" data-finance-analytics-custom><label>От<input type="date" name="dateFrom" value="${escapeHTML(a.dateFrom||summary.dateFrom)}" required></label><label>До<input type="date" name="dateTo" value="${escapeHTML(a.dateTo||summary.dateTo)}" required></label><button class="primary-button small" type="submit">Показать</button></form>`:'';
  root.innerHTML=`<section class="card finance-v2-subscreen-head"><div class="card-title-row"><div><h2>Аналитика</h2><p class="muted">Автоматически из реальных операций.</p></div><button class="ghost-button small" type="button" data-finance-subscreen-back>Назад</button></div></section>
    <section class="card finance-v2-analytics-card"><div class="finance-v2-period-buttons">${buttons}</div>${custom}<p class="muted finance-v2-period-caption">${shortDate(summary.dateFrom)} — ${shortDate(summary.dateTo)} · ${summary.days} дн.</p><div class="finance-v2-analytics-grid"><div><span>Поступления</span><strong>${formatRub(summary.income)}</strong></div><div><span>Расходы</span><strong>${formatRub(summary.expense)}</strong></div><div><span>Разница</span><strong>${diff>0?'+':''}${formatRub(diff)}</strong></div><div><span>Расходных операций</span><strong>${summary.expenseCount}</strong></div><div><span>Среднее в день</span><strong>${formatRub(summary.averageExpensePerDay)}</strong></div></div></section>
    <section class="card"><div class="card-title-row"><div><h2>По категориям</h2><p class="muted">Доля только от EXPENSE выбранного периода.</p></div></div><div class="finance-v2-analytics-categories">${financeAnalyticsCategoryHTML(summary)}</div><button class="ghost-button finance-v2-details-button" type="button" data-finance-analytics-history>Операции периода</button></section>`;
  bindFinanceV2Screen(root);
}
async function openFinanceV2ExpenseDialog() {
  const account=getDefaultFinanceAccount();if(!account)return;
  const now=new Date();const today=toISODate(now);const hm=`${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  const result=await openEditDialog({title:'Добавить расход',fields:[
    {name:'amount',label:'Сумма',value:'',placeholder:'Напр. 1200'},
    {name:'categoryId',label:'Категория',type:'select',value:'other',options:financeCategoryOptions('other')},
    {name:'accountId',label:'Счёт',type:'select',value:account.id,options:financeAccountOptions(account.id)},
    {name:'description',label:'Описание',type:'textarea',value:'',placeholder:'Необязательно'},
    {name:'date',label:'Дата',type:'date',value:today},{name:'time',label:'Время',type:'time',value:hm}
  ],submitText:'Добавить'});if(!result)return;
  const amount=normalizeMoneyInput(result.amount);if(!amount)return;
  applyFinanceMutation(TSBFinanceCore.createTransaction(getFinanceStateV2(),{type:'EXPENSE',amount,categoryId:result.categoryId,accountId:result.accountId,description:result.description,date:normalizeDateInput(result.date)||today,time:result.time},{idFactory:uid}),'Расход добавлен');
}
function setFinanceSection(section) {
  const allowed = ['overview', 'operations', 'plan'];
  state.financeSection = allowed.includes(section) ? section : 'overview';
  state.financeSubscreen = '';
  state.financeSubscreenReturn = '';
  state.financeHistoryOpen = false;
  state.financeAddActionOpen = false;
  renderFinance();
}
function openFinanceSubscreen(name,returnTo='') {state.financeSubscreen=name;state.financeSubscreenReturn=returnTo||state.financeSection;state.financeHistoryOpen=false;state.financeAddActionOpen=false;renderFinance();}
function closeFinanceSubscreen() {
  const target=state.financeSubscreenReturn||state.financeSection||'plan';
  if (['overview','operations','plan'].includes(target)) { state.financeSection=target; state.financeSubscreen=''; }
  else state.financeSubscreen=target;
  state.financeSubscreenReturn='';
  renderFinance();
}
function renderFinanceSectionNav() {
  const sections = [['overview','Обзор'],['operations','Операции'],['plan','План']];
  return `<nav class="finance-v2-section-nav" aria-label="Разделы Finance">${sections.map(([value,label])=>`<button class="ghost-button small ${state.financeSection===value?'active':''}" type="button" data-finance-section="${value}">${label}</button>`).join('')}</nav>`;
}
function renderFinanceActionMenu() {
  return state.financeAddActionOpen ? `<div class="finance-v2-action-menu" role="group" aria-label="Тип операции"><button class="primary-button small" type="button" data-finance-action="expense">Расход</button><button class="ghost-button small" type="button" data-finance-action="income">Поступление</button><button class="ghost-button small" type="button" data-finance-action="transfer">Перевод</button></div>` : '';
}
function renderFinanceOperations() {
  const operations = getFinanceTransactions();
  return `<section class="card finance-v2-operations-card"><div class="card-title-row"><div><h2>Операции</h2><p class="muted">Хронологическая лента всех реальных операций.</p></div><button class="primary-button small" type="button" data-finance-add-action>+ Добавить действие</button></div>${renderFinanceActionMenu()}<div class="finance-list">${operations.length ? operations.map(transaction => renderFinanceV2TransactionRow(transaction,{compact:false})).join('') : '<div class="empty">Операций пока нет.</div>'}</div><button class="ghost-button finance-v2-history-button" type="button" data-finance-v2-history-open>Полная история и фильтры</button></section>`;
}
function renderFinancePlan() {
  const accounts = getFinanceAccounts();
  return `<section class="card finance-v2-plan-card"><div class="card-title-row"><div><h2>План</h2><p class="muted">Обязательства, резервы и финансовые цели.</p></div></div>${renderFinanceObligationsCompact()}${renderFinanceReservesCompact()}<section class="finance-v2-plan-links"><div class="card-title-row"><h2>Счета, категории и управление</h2></div><button class="finance-v2-nav-row" type="button" data-finance-management-open="accounts"><span><strong>Счета</strong><small>${accounts.length ? `${accounts.length} активных` : 'Пока нет счетов'}</small></span><b>›</b></button><button class="finance-v2-nav-row" type="button" data-finance-management-open="categories"><span><strong>Категории</strong><small>Категории расходов</small></span><b>›</b></button><button class="finance-v2-nav-row" type="button" data-finance-management-open="reserves"><span><strong>Резервы и цели</strong><small>Назначенные деньги и цели</small></span><b>›</b></button><button class="finance-v2-nav-row" type="button" data-finance-management-open="management"><span><strong>Управление</strong><small>Типы поступлений, сверка и экспорт</small></span><b>›</b></button><button class="finance-v2-nav-row" type="button" data-finance-analytics-open><span><strong>Аналитика</strong><small>Периоды, суммы и категории</small></span><b>›</b></button></section></section>`;
}
function renderFinanceManagementLinks() {
  return `<section class="card finance-v2-navigation-card"><button class="finance-v2-nav-row" type="button" data-finance-analytics-open><span><strong>Аналитика</strong><small>Периоды, суммы и категории</small></span><b>›</b></button><button class="finance-v2-nav-row" type="button" data-finance-management-root><span><strong>Управление</strong><small>Счета, категории, резервы и платежи</small></span><b>›</b></button></section>`;
}
function renderFinanceAccountsScreen(root=$('#tab-finance')) {
  if(!root)return;const accounts=getFinanceAccounts();root.innerHTML=`<section class="card finance-v2-subscreen-head"><div class="card-title-row"><div><h2>Счета и наличные</h2><p class="muted">Баланс каждого счёта вычисляется из операций.</p></div><button class="ghost-button small" type="button" data-finance-subscreen-back>Назад</button></div></section><section class="card finance-v2-accounts-card"><div class="card-title-row"><h2>Активные счета</h2><button class="primary-button small" type="button" data-finance-v2-account-add>+ Счёт</button></div><div class="finance-v2-accounts">${accounts.map(renderFinanceV2AccountCard).join('')||'<div class="empty">Счетов пока нет.</div>'}</div></section>`;bindFinanceV2Screen(root);
}
function renderFinanceCategoryCard(category) {
  return `<article class="finance-v2-manage-item"><div><div class="badge-row">${category.system?'<span class="badge secondary">системная</span>':''}</div><strong>${escapeHTML(category.name)}</strong></div><div class="actions"><button class="ghost-button small" type="button" data-finance-category-edit="${escapeHTML(category.id)}">Изм.</button>${category.system?'':`<button class="danger-button small" type="button" data-finance-category-archive="${escapeHTML(category.id)}">Архив</button>`}</div></article>`;
}
async function openFinanceCategoryDialog(categoryId='') {
  const finance=getFinanceStateV2();const current=finance.categories.find(item=>item.id===categoryId)||null;const result=await openEditDialog({title:current?'Изменить категорию':'Новая категория',fields:[{name:'name',label:'Название',value:current?.name||'',placeholder:'Напр. Одежда'}],submitText:'Подтвердить'});if(!result)return;
  applyFinanceMutation(TSBFinanceCore.createOrUpdateCategory(finance,{...(current?{id:current.id}:{}),name:String(result.name||'').trim()},{idFactory:uid}),current?'Категория изменена':'Категория добавлена');
}
async function archiveFinanceCategory(categoryId) {
  const finance=getFinanceStateV2();const category=finance.categories.find(item=>item.id===categoryId);if(!category||category.system)return;const ok=await openConfirmDialog({title:'Архивировать категорию?',message:'Старые операции сохранят её id и останутся в истории.',confirmText:'Архивировать',danger:true});if(!ok)return;applyFinanceMutation(TSBFinanceCore.archiveCategory(finance,categoryId),'Категория архивирована');
}
function renderFinanceCategoriesScreen(root=$('#tab-finance')) {
  if(!root)return;const categories=getFinanceStateV2().categories.filter(item=>item.active&&!item.archived);root.innerHTML=`<section class="card finance-v2-subscreen-head"><div class="card-title-row"><div><h2>Категории</h2><p class="muted">Категории расходов для быстрого ввода и истории.</p></div><button class="ghost-button small" type="button" data-finance-subscreen-back>Назад</button></div></section><section class="card"><div class="card-title-row"><h2>Активные категории</h2><button class="primary-button small" type="button" data-finance-category-add>+ Категория</button></div><div class="finance-v2-manage-list">${categories.map(renderFinanceCategoryCard).join('')}</div></section>`;bindFinanceV2Screen(root);
}
function renderFinanceReconcileScreen(root=$('#tab-finance')) {
  if(!root)return;const accounts=getFinanceAccounts();const selectedId=state.financeReconcileAccountId&&accounts.some(x=>x.id===state.financeReconcileAccountId)?state.financeReconcileAccountId:(getDefaultFinanceAccount()?.id||accounts[0]?.id||'');
  state.financeReconcileAccountId=selectedId;const selected=accounts.find(x=>x.id===selectedId)||null;const calculated=selected?getFinanceAccountBalance(selected.id):0;
  const options=accounts.map(account=>`<option value="${escapeHTML(account.id)}" ${account.id===selectedId?'selected':''}>${escapeHTML(account.name)} · ${formatRub(getFinanceAccountBalance(account.id))}</option>`).join('');
  root.innerHTML=`<section class="card finance-v2-subscreen-head"><div class="card-title-row"><div><h2>Сверка баланса</h2><p class="muted">Фактический остаток не перезаписывает историю: разница фиксируется одной системной корректировкой.</p></div><button class="ghost-button small" type="button" data-finance-subscreen-back>Назад</button></div></section>
    <section class="card finance-v2-reconcile-card"><form data-finance-reconcile-form><label>Счёт<select name="accountId" data-finance-reconcile-account>${options}</select></label><div class="finance-v2-reconcile-current"><span>По операциям</span><strong>${formatRub(calculated)}</strong></div><label>Фактически сейчас<input name="actualBalance" inputmode="decimal" placeholder="0" required></label><div class="finance-v2-reconcile-diff"><span>Разница</span><strong data-finance-reconcile-diff>—</strong></div><label>Комментарий <span class="muted">необязательно</span><input name="description" placeholder="Напр. сверка с банковским приложением"></label><button class="primary-button" type="submit">Сверить</button></form><p class="muted">Сверка создаёт ADJUSTMENT только на разницу. Она не считается доходом или расходом.</p></section>`;
  bindFinanceV2Screen(root);
}
async function submitFinanceReconcile(form) {
  const fd=new FormData(form);const accountId=String(fd.get('accountId')||'');const actual=String(fd.get('actualBalance')||'').trim();const description=String(fd.get('description')||'').trim();
  const result=TSBFinanceCore.reconcileAccount(getFinanceStateV2(),accountId,actual,{date:toISODate(new Date()),description,idFactory:uid});
  if(!result.ok){showToast(result.error==='INVALID_ACTUAL_BALANCE'?'Укажи фактический остаток':financeMutationErrorText(result.error));return;}
  if(!result.changed){showToast('Баланс уже совпадает');return;}
  applyFinanceMutation(result,`Сверка: ${result.difference>0?'+':''}${formatRub(result.difference)}`);
}

function downloadFinanceFile(filename,textValue,type='application/json;charset=utf-8') {
  const blob=new Blob([textValue],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),0);
}
function financeCsvCell(value) {
  const text=String(value??'');return /[";,\n\r]/.test(text)?`"${text.replace(/"/g,'""')}"`:text;
}
function financeTransactionExportRow(transaction) {
  const finance=getFinanceStateV2();const account=finance.accounts.find(x=>x.id===transaction.accountId);const from=finance.accounts.find(x=>x.id===transaction.fromAccountId);const to=finance.accounts.find(x=>x.id===transaction.toAccountId);
  const category=transaction.type==='EXPENSE'?getFinanceCategoryLabel(transaction.categoryId):'';const incomeType=transaction.type==='INCOME'?(finance.incomeTypes.find(x=>x.id===transaction.incomeTypeId)?.name||''):'';
  return [transaction.date,transaction.time||'',transaction.type,transaction.amount,account?.name||'',from?.name||'',to?.name||'',category,incomeType,transaction.systemKind||'',transaction.description||''];
}
function financeTransactionsCsv(rows=getFinanceTransactions()) {
  const header=['date','time','type','amount','account','from_account','to_account','category','income_type','system_kind','description'];
  return '\uFEFF'+[header,...rows.map(financeTransactionExportRow)].map(row=>row.map(financeCsvCell).join(';')).join('\n');
}
function buildFinanceExportObject() {
  const finance=TSBFinanceCore.normalizeFinance(getFinanceStateV2());const coverage=getFinanceCoverage();
  return {
    backupType:FINANCE_BACKUP_TYPE,formatVersion:BACKUP_FORMAT_VERSION,
    exportedAt:new Date().toISOString(),appVersion:APP_VERSION,financeSchemaVersion:finance.schemaVersion,
    balances:{total:coverage.totalAccounts,reserved:coverage.reserved,upcoming:coverage.upcoming,free:coverage.free,accounts:finance.accounts.map(account=>({id:account.id,name:account.name,balance:getFinanceAccountBalance(account.id),active:account.active,archived:account.archived,isDefault:account.isDefault}))},
    finance
  };
}
function exportFinanceJson() {
  downloadFinanceFile(`tsb_finance_${toISODate(new Date())}.json`,JSON.stringify(buildFinanceExportObject(),null,2));showToast('Finance JSON экспортирован');
}
function exportFinanceCsv(rows=getFinanceTransactions(),suffix='operations') {
  downloadFinanceFile(`tsb_finance_${suffix}_${toISODate(new Date())}.csv`,financeTransactionsCsv(rows),'text/csv;charset=utf-8');showToast('CSV экспортирован');
}
function renderFinanceExportScreen(root=$('#tab-finance')) {
  if(!root)return;const finance=getFinanceStateV2();root.innerHTML=`<section class="card finance-v2-subscreen-head"><div class="card-title-row"><div><h2>Экспорт финансов</h2><p class="muted">Экспорт не меняет данные и не создаёт операций.</p></div><button class="ghost-button small" type="button" data-finance-subscreen-back>Назад</button></div></section>
    <section class="card finance-v2-export-card"><button class="primary-button" type="button" data-finance-export-json>Finance JSON</button><p class="muted">Счета, операции, резервы, обязательства и вычисляемые текущие показатели. Schema ${finance.schemaVersion}.</p><button class="ghost-button" type="button" data-finance-export-csv>Операции CSV</button><p class="muted">Пользовательская история операций без скрытого migration anchor.</p><button class="ghost-button" type="button" data-finance-export-full>Полный backup TSB Hub</button><p class="muted">Откроет существующий экспорт всей базы приложения.</p></section>`;bindFinanceV2Screen(root);
}

function renderFinanceIncomeTypeCard(item) {
  return `<article class="finance-v2-manage-item"><div><div class="badge-row">${item.system?'<span class="badge secondary">системный</span>':''}</div><strong>${escapeHTML(item.name)}</strong></div><div class="actions"><button class="ghost-button small" type="button" data-finance-income-type-edit="${escapeHTML(item.id)}">Изм.</button>${item.system?'':`<button class="danger-button small" type="button" data-finance-income-type-archive="${escapeHTML(item.id)}">Архив</button>`}</div></article>`;
}
async function openFinanceIncomeTypeDialog(itemId='') {
  const finance=getFinanceStateV2();const current=finance.incomeTypes.find(item=>item.id===itemId)||null;
  const result=await openEditDialog({title:current?'Изменить тип поступления':'Новый тип поступления',fields:[{name:'name',label:'Название',value:current?.name||'',placeholder:'Напр. Подработка'}],submitText:'Подтвердить'});if(!result)return;
  applyFinanceMutation(TSBFinanceCore.createOrUpdateIncomeType(finance,{...(current?{id:current.id}:{}),name:String(result.name||'').trim()},{idFactory:uid}),current?'Тип поступления изменён':'Тип поступления добавлен');
}
async function archiveFinanceIncomeType(itemId) {
  const finance=getFinanceStateV2();const item=finance.incomeTypes.find(x=>x.id===itemId);if(!item||item.system)return;
  const ok=await openConfirmDialog({title:'Архивировать тип поступления?',message:'Старые операции сохранят его id и останутся в истории.',confirmText:'Архивировать',danger:true});if(!ok)return;
  applyFinanceMutation(TSBFinanceCore.archiveIncomeType(finance,itemId),'Тип поступления архивирован');
}
function renderFinanceIncomeTypesScreen(root=$('#tab-finance')) {
  if(!root)return;const items=getFinanceStateV2().incomeTypes.filter(item=>item.active&&!item.archived);
  root.innerHTML=`<section class="card finance-v2-subscreen-head"><div class="card-title-row"><div><h2>Типы поступлений</h2><p class="muted">Используются только при добавлении INCOME.</p></div><button class="ghost-button small" type="button" data-finance-subscreen-back>Назад</button></div></section><section class="card"><div class="card-title-row"><h2>Активные типы</h2><button class="primary-button small" type="button" data-finance-income-type-add>+ Тип</button></div><div class="finance-v2-manage-list">${items.map(renderFinanceIncomeTypeCard).join('')}</div></section>`;
  bindFinanceV2Screen(root);
}

function renderFinanceManagementScreen(root=$('#tab-finance')) {
  if(!root)return;root.innerHTML=`<section class="card finance-v2-subscreen-head"><div class="card-title-row"><div><h2>Управление</h2><p class="muted">Подробные настройки вынесены с главного экрана.</p></div><button class="ghost-button small" type="button" data-finance-subscreen-back>Назад</button></div></section><section class="card finance-v2-management-list">
    <button class="finance-v2-nav-row" type="button" data-finance-management-open="accounts"><span><strong>Счета и наличные</strong><small>Создать, переименовать, выбрать основной</small></span><b>›</b></button>
    <button class="finance-v2-nav-row" type="button" data-finance-management-open="categories"><span><strong>Категории</strong><small>Категории расходов</small></span><b>›</b></button>
    <button class="finance-v2-nav-row" type="button" data-finance-management-open="income-types"><span><strong>Типы поступлений</strong><small>Источники INCOME</small></span><b>›</b></button>
    <button class="finance-v2-nav-row" type="button" data-finance-management-open="reserves"><span><strong>Резервы</strong><small>Назначенные деньги и цели</small></span><b>›</b></button>
    <button class="finance-v2-nav-row" type="button" data-finance-management-open="obligations"><span><strong>Обязательные платежи</strong><small>Будущие оплаты</small></span><b>›</b></button>
    <button class="finance-v2-nav-row" type="button" data-finance-management-open="reconcile"><span><strong>Сверка баланса</strong><small>Сравнить расчётный и фактический остаток</small></span><b>›</b></button>
    <button class="finance-v2-nav-row" type="button" data-finance-management-open="export"><span><strong>Экспорт данных</strong><small>Finance JSON, CSV операций и полный backup</small></span><b>›</b></button>
  </section>`;bindFinanceV2Screen(root);
}

function getFinanceActiveReserves() {
  return TSBFinanceCore.getActiveReserves(getFinanceStateV2());
}
function getFinanceReservedTotal() {
  return TSBFinanceCore.getTotalReservedAmount(getFinanceStateV2());
}
function renderFinanceReserveProgress(reserve) {
  if (!reserve.targetAmount) return '';
  const pct = Math.max(0, Math.min(100, Math.round((Number(reserve.amount || 0) / Number(reserve.targetAmount || 1)) * 100)));
  return `<div class="finance-v2-reserve-progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>`;
}
function renderFinanceReserveCard(reserve, { compact = false } = {}) {
  const amountLine = reserve.targetAmount ? `${formatRub(reserve.amount)} / ${formatRub(reserve.targetAmount)}` : formatRub(reserve.amount);
  return `<article class="finance-v2-reserve-card">
    <div class="finance-v2-reserve-main"><div class="item-top"><div><h3>${escapeHTML(reserve.name)}</h3><div class="finance-v2-reserve-amount">${amountLine}</div></div>${compact ? '' : '<span class="badge secondary">резерв</span>'}</div>${renderFinanceReserveProgress(reserve)}</div>
    ${compact ? '' : `<div class="finance-v2-reserve-actions"><button class="ghost-button small" type="button" data-finance-reserve-adjust="${escapeHTML(reserve.id)}" data-direction="add">+ Пополнить</button><button class="ghost-button small" type="button" data-finance-reserve-adjust="${escapeHTML(reserve.id)}" data-direction="remove">− Снять</button><button class="ghost-button small" type="button" data-finance-reserve-edit="${escapeHTML(reserve.id)}">Изм.</button><button class="danger-button small" type="button" data-finance-reserve-archive="${escapeHTML(reserve.id)}">Архив</button></div>`}
  </article>`;
}
function renderFinanceReservesCompact() {
  const reserves = getFinanceActiveReserves();
  const preview = reserves.slice(0, 3);
  return `<section class="card finance-v2-reserves-card">
    <div class="card-title-row"><div><h2>Резервы</h2><p class="muted">Назначение части уже существующих денег.</p></div><span class="badge">${formatRub(getFinanceReservedTotal())}</span></div>
    <div class="finance-v2-reserve-list">${preview.length ? preview.map(item => renderFinanceReserveCard(item,{compact:true})).join('') : '<div class="empty">Резервов пока нет.</div>'}</div>
    <div class="finance-v2-section-actions"><button class="ghost-button" type="button" data-finance-reserves-open>${reserves.length ? 'Все резервы' : 'Управление резервами'}</button><button class="primary-button" type="button" data-finance-reserve-create>+ Создать</button></div>
  </section>`;
}
async function openFinanceReserveDialog(reserveId = '') {
  const finance = getFinanceStateV2();
  const current = finance.reserves.find(item => item.id === reserveId) || null;
  const fields = [
    { name:'name', label:'Название', value:current?.name || '', placeholder:'Машина, Подушка, Техника' },
    ...(current ? [] : [{ name:'amount', label:'Начальная сумма', value:'', placeholder:'0' }]),
    { name:'targetAmount', label:'Цель — необязательно', value:current?.targetAmount || '', placeholder:'Напр. 110000' }
  ];
  const result = await openEditDialog({ title:current ? 'Изменить резерв' : 'Создать резерв', fields, submitText:'Подтвердить' });
  if (!result) return;
  const draft = { name:String(result.name || '').trim(), targetAmount:normalizeMoneyInput(result.targetAmount) || null };
  if (!current) draft.amount = normalizeMoneyInput(result.amount) || 0;
  const mutation = current ? TSBFinanceCore.updateReserve(finance,current.id,draft,{fromDate:toISODate(new Date())}) : TSBFinanceCore.createReserve(finance,draft,{idFactory:uid,fromDate:toISODate(new Date())});
  applyFinanceMutation(mutation,current ? 'Резерв изменён' : 'Резерв создан');
}
async function adjustFinanceReserve(reserveId,direction) {
  const reserve=getFinanceStateV2().reserves.find(item=>item.id===reserveId); if(!reserve)return;
  const adding=direction!=='remove';
  const result=await openEditDialog({title:adding?`Пополнить · ${reserve.name}`:`Снять · ${reserve.name}`,fields:[{name:'amount',label:'Сумма',value:'',placeholder:'Напр. 5000'}],submitText:'Подтвердить'});
  if(!result)return; const amount=moneyNumber(normalizeMoneyInput(result.amount)); if(amount<=0){showToast('Укажи сумму больше нуля');return;}
  applyFinanceMutation(TSBFinanceCore.adjustReserveAmount(getFinanceStateV2(),reserveId,adding?amount:-amount,{fromDate:toISODate(new Date())}),adding?'Резерв пополнен':'Сумма снята из резерва');
}
async function archiveFinanceReserve(reserveId) {
  const reserve=getFinanceStateV2().reserves.find(item=>item.id===reserveId);if(!reserve)return;
  const ok=await openConfirmDialog({title:'Архивировать резерв?',message:`${reserve.name}. Деньги со счетов не изменятся — исчезнет только это назначение.`,confirmText:'Архивировать',danger:true});
  if(!ok)return;applyFinanceMutation(TSBFinanceCore.archiveReserve(getFinanceStateV2(),reserveId),'Резерв архивирован');
}
async function importLegacyFinanceReserve() {
  const finance=getFinanceStateV2(); const amount=finance.migration?.legacyReserveAmount || 0;
  if(finance.migration?.legacyReserveStatus!=='REVIEW_REQUIRED'||!amount)return;
  const ok=await openConfirmDialog({title:'Импортировать старый резерв?',message:`В старых данных найдено ${formatRub(amount)}. Поле исторически могло обозначать не только физический счёт, поэтому оно не переносилось автоматически. Импорт создаст резерв «Старый резерв» и не изменит деньги на счетах.`,confirmText:'Импортировать'});
  if(!ok)return;applyFinanceMutation(TSBFinanceCore.importLegacyReserve(finance,{idFactory:uid}),'Старый резерв импортирован');
}
async function restoreLegacyFinanceReserveBalance() {
  const finance=getFinanceStateV2();const amount=Number(finance.migration?.legacyReserveAmount||0);
  if(finance.migration?.legacyReserveStatus!=='MIGRATED'||amount<=0||finance.migration?.legacyReserveBalanceStatus==='RESTORED')return;
  const account=TSBFinanceCore.getDefaultAccount(finance);if(!account){showToast('Нет активного счёта');return;}
  const ok=await openConfirmDialog({title:'Восстановить деньги старого резерва?',message:`Добавить ${formatRub(amount)} в общий баланс как системное восстановление старых данных. Это НЕ доход и не попадёт в аналитику. Если раньше для обхода ты создавал фиктивное поступление на эту сумму — после восстановления удали его.`,confirmText:'Подтвердить'});
  if(!ok)return;applyFinanceMutation(TSBFinanceCore.restoreLegacyReserveBalance(finance,{accountId:account.id,idFactory:uid}),'Деньги старого резерва восстановлены');
}
function renderFinanceReservesScreen(root = $('#tab-finance')) {
  if(!root)return; const finance=getFinanceStateV2(); const active=TSBFinanceCore.getActiveReserves(finance); const legacyReview=finance.migration?.legacyReserveStatus==='REVIEW_REQUIRED'&&Number(finance.migration?.legacyReserveAmount)>0; const legacyRestore=finance.migration?.legacyReserveStatus==='MIGRATED'&&Number(finance.migration?.legacyReserveAmount)>0&&finance.migration?.legacyReserveBalanceStatus!=='RESTORED';
  root.innerHTML=`
    <section class="card finance-v2-subscreen-head"><div class="card-title-row"><div><h2>Резервы</h2><p class="muted">Резерв — назначение части денег. Это не расход и не перевод между счетами.</p></div><button class="ghost-button small" type="button" data-finance-subscreen-back>Назад</button></div></section>
    ${legacyReview?`<section class="card finance-v2-legacy-review"><div><h3>Найден старый резерв · ${formatRub(finance.migration.legacyReserveAmount)}</h3><p class="muted">Он не был перенесён автоматически: происхождение старого поля неоднозначно.</p></div><button class="ghost-button" type="button" data-finance-legacy-reserve-import>Импортировать как «Старый резерв»</button></section>`:''}
    ${legacyRestore?`<section class="card finance-v2-legacy-review"><div><h3>Старый резерв · ${formatRub(finance.migration.legacyReserveAmount)}</h3><p class="muted">Резерв уже есть, но его старые деньги ещё не включены в общий баланс.</p></div><button class="ghost-button" type="button" data-finance-legacy-reserve-restore>Восстановить в баланс</button></section>`:''}
    <section class="card"><div class="card-title-row"><div><h2>Активные резервы</h2><p class="muted">Всего назначено: ${formatRub(TSBFinanceCore.getTotalReservedAmount(finance))}</p></div><button class="primary-button small" type="button" data-finance-reserve-create>+ Создать</button></div>
      <div class="finance-v2-reserve-list full">${active.length?active.map(item=>renderFinanceReserveCard(item)).join(''):'<div class="empty">Резервов пока нет.</div>'}</div>
    </section>`;
  bindFinanceV2Screen(root);
}

function getFinanceActiveObligations() {
  return TSBFinanceCore.getActiveObligations(getFinanceStateV2());
}
function getFinanceUpcomingObligations() {
  return TSBFinanceCore.getUpcomingObligations(getFinanceStateV2(),{fromDate:toISODate(new Date())});
}
function getFinanceUpcomingTotal() {
  return TSBFinanceCore.getUpcomingObligationsTotal(getFinanceStateV2(),{fromDate:toISODate(new Date())});
}
function financeObligationDueText(obligation) {
  const today=toISODate(new Date());
  if(obligation.dueDate<today)return `Просрочено · ${shortDate(obligation.dueDate)}`;
  if(obligation.dueDate===today)return 'Сегодня';
  return shortDate(obligation.dueDate);
}
function financeObligationPaidTransaction(obligation) {
  return obligation.linkedTransactionId ? getFinanceTransaction(obligation.linkedTransactionId) : null;
}
function renderFinanceObligationCard(obligation,{compact=false}={}) {
  const paidTx=financeObligationPaidTransaction(obligation);
  const statusLabel=obligation.status==='PAID'?'Оплачено':obligation.status==='CANCELLED'?'Отменено':financeObligationDueText(obligation);
  const statusClass=obligation.status==='PAID'?'done-badge':obligation.status==='CANCELLED'?'muted-badge':(obligation.dueDate<toISODate(new Date())?'overdue':'secondary');
  const paidLine=paidTx?`<p class="muted">Фактически: ${formatRub(paidTx.amount)}${paidTx.amount!==obligation.amount?` · план ${formatRub(obligation.amount)}`:''}</p>`:'';
  return `<article class="finance-v2-obligation-card ${obligation.status.toLowerCase()}">
    <div class="item-top"><div><div class="badge-row"><span class="badge ${statusClass}">${escapeHTML(statusLabel)}</span>${obligation.recurrence==='MONTHLY'?'<span class="badge">ежемесячно</span>':''}</div><h3>${escapeHTML(obligation.name)}</h3><div class="finance-v2-obligation-amount">${formatRub(obligation.amount)}</div>${obligation.note?`<p class="muted">${escapeHTML(obligation.note)}</p>`:''}${paidLine}</div></div>
    ${compact||obligation.status!=='ACTIVE'?'':`<div class="finance-v2-obligation-actions"><button class="primary-button small" type="button" data-finance-obligation-pay="${escapeHTML(obligation.id)}">Оплатить сейчас</button><button class="ghost-button small" type="button" data-finance-obligation-link="${escapeHTML(obligation.id)}">Связать с тратой</button><button class="ghost-button small" type="button" data-finance-obligation-edit="${escapeHTML(obligation.id)}">Изм.</button><button class="danger-button small" type="button" data-finance-obligation-cancel="${escapeHTML(obligation.id)}">Отменить</button></div>`}
  </article>`;
}
function renderFinanceObligationsCompact() {
  const upcoming=getFinanceUpcomingObligations(); const preview=upcoming.slice(0,3); const coverage=getFinanceCoverage();
  const coverageText=coverage.covered?'✓ Ближайшие платежи покрыты':`⚠ Не хватает ${formatRub(coverage.shortfall)}`;
  return `<section class="card finance-v2-obligations-card"><div class="card-title-row"><div><h2>Ближайшие платежи</h2><p class="muted">ACTIVE обязательства на ближайшие ${TSBFinanceCore.UPCOMING_OBLIGATION_DAYS} дней.</p></div><span class="badge important">${formatRub(getFinanceUpcomingTotal())}</span></div>
    <div class="finance-v2-coverage ${coverage.covered?'covered':'short'}">${coverageText}</div>
    <div class="finance-v2-obligation-list">${preview.length?preview.map(item=>renderFinanceObligationCard(item,{compact:true})).join(''):'<div class="empty">Ближайших обязательных платежей нет.</div>'}</div>
    <div class="finance-v2-section-actions"><button class="ghost-button" type="button" data-finance-obligations-open>Все платежи</button><button class="primary-button" type="button" data-finance-obligation-create>+ Добавить</button></div>
  </section>`;
}
async function openFinanceObligationDialog(obligationId='') {
  const finance=getFinanceStateV2();const current=finance.obligations.find(item=>item.id===obligationId)||null;
  if(current&&current.status!=='ACTIVE')return;
  const result=await openEditDialog({title:current?'Изменить платёж':'Добавить обязательный платёж',fields:[
    {name:'name',label:'Название',value:current?.name||'',placeholder:'Интернет, коммунальные'},
    {name:'amount',label:'Сумма',value:current?.amount||'',placeholder:'Напр. 850'},
    {name:'dueDate',label:'Дата',type:'date',value:current?.dueDate||toISODate(new Date())},
    {name:'recurrence',label:'Повтор',type:'select',value:current?.recurrence||'NONE',options:[{value:'NONE',label:'Нет'},{value:'MONTHLY',label:'Ежемесячно'}]},
    {name:'note',label:'Описание — необязательно',type:'textarea',value:current?.note||'',placeholder:'Комментарий'}
  ],submitText:'Подтвердить'});
  if(!result)return;
  const draft={name:String(result.name||'').trim(),amount:normalizeMoneyInput(result.amount),dueDate:normalizeDateInput(result.dueDate),recurrence:result.recurrence,note:String(result.note||'').trim()};
  const mutation=current?TSBFinanceCore.updateObligation(finance,current.id,draft,{fromDate:toISODate(new Date())}):TSBFinanceCore.createObligation(finance,draft,{idFactory:uid,fromDate:toISODate(new Date())});
  applyFinanceMutation(mutation,current?'Платёж изменён':'Платёж добавлен');
}
async function payFinanceObligation(obligationId) {
  const finance=getFinanceStateV2();const obligation=finance.obligations.find(item=>item.id===obligationId);const account=getDefaultFinanceAccount();if(!obligation||!account)return;
  const now=new Date();const today=toISODate(now);const hm=`${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  const result=await openEditDialog({title:`Оплатить · ${obligation.name}`,fields:[
    {name:'amount',label:'Сумма',value:obligation.amount},
    {name:'accountId',label:'Счёт',type:'select',value:account.id,options:financeAccountOptions(account.id)},
    {name:'categoryId',label:'Категория',type:'select',value:'other',options:financeCategoryOptions('other')},
    {name:'date',label:'Дата',type:'date',value:today},
    {name:'time',label:'Время',type:'time',value:hm},
    {name:'description',label:'Описание',type:'textarea',value:obligation.name,placeholder:'Необязательно'}
  ],submitText:'Оплатить'});
  if(!result)return;
  const mutation=TSBFinanceCore.payObligation(finance,obligationId,{accountId:result.accountId,categoryId:result.categoryId,amount:normalizeMoneyInput(result.amount),date:normalizeDateInput(result.date)||today,time:result.time,description:result.description,now:new Date().toISOString(),idFactory:uid});
  applyFinanceMutation(mutation,mutation?.nextObligation?'Оплачено · следующий платёж создан':'Платёж оплачен');
}
function financeLinkableExpenses(obligationId) {
  const finance=getFinanceStateV2();const used=new Set(finance.obligations.filter(item=>item.id!==obligationId&&item.linkedTransactionId).map(item=>item.linkedTransactionId));
  return getFinanceTransactions({type:'EXPENSE'}).filter(item=>!used.has(item.id)).slice(0,20);
}
async function linkFinanceObligation(obligationId) {
  const obligation=getFinanceStateV2().obligations.find(item=>item.id===obligationId);if(!obligation)return;
  const expenses=financeLinkableExpenses(obligationId);if(!expenses.length){showToast('Недавних расходов для связывания нет');return;}
  const result=await openEditDialog({title:`Связать · ${obligation.name}`,fields:[{name:'transactionId',label:'Существующая трата',type:'select',value:expenses[0].id,options:expenses.map(item=>({value:item.id,label:`${shortDate(item.date)} · ${formatRub(item.amount)} · ${financeTypeLabel(item)}${item.description?` · ${item.description}`:''}`}))}],submitText:'Связать'});
  if(!result)return;
  const mutation=TSBFinanceCore.linkObligationToTransaction(getFinanceStateV2(),obligationId,result.transactionId,{now:new Date().toISOString(),idFactory:uid});
  applyFinanceMutation(mutation,mutation?.nextObligation?'Связано · следующий платёж создан':'Платёж связан с тратой');
}
async function cancelFinanceObligation(obligationId) {
  const obligation=getFinanceStateV2().obligations.find(item=>item.id===obligationId);if(!obligation)return;
  const ok=await openConfirmDialog({title:'Отменить обязательный платёж?',message:`${obligation.name} больше не будет учитываться как будущая оплата.`,confirmText:'Отменить платёж',danger:true});if(!ok)return;
  applyFinanceMutation(TSBFinanceCore.cancelObligation(getFinanceStateV2(),obligationId),'Платёж отменён');
}
function renderFinanceObligationsScreen(root=$('#tab-finance')) {
  if(!root)return;const finance=getFinanceStateV2();const active=TSBFinanceCore.getActiveObligations(finance).sort((a,b)=>a.dueDate.localeCompare(b.dueDate));const closed=finance.obligations.filter(item=>item.status!=='ACTIVE').sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0,10);
  root.innerHTML=`<section class="card finance-v2-subscreen-head"><div class="card-title-row"><div><h2>Обязательные платежи</h2><p class="muted">План не меняет баланс. Деньги списываются только реальной EXPENSE.</p></div><button class="ghost-button small" type="button" data-finance-subscreen-back>Назад</button></div></section>
    <section class="card"><div class="card-title-row"><div><h2>Активные</h2><p class="muted">Ближайшие и просроченные платежи.</p></div><button class="primary-button small" type="button" data-finance-obligation-create>+ Добавить</button></div><div class="finance-v2-obligation-list full">${active.length?active.map(item=>renderFinanceObligationCard(item)).join(''):'<div class="empty">Активных обязательных платежей нет.</div>'}</div></section>
    ${closed.length?`<details class="card finance-v2-closed-obligations"><summary>Недавно закрытые · ${closed.length}</summary><div class="finance-v2-obligation-list">${closed.map(item=>renderFinanceObligationCard(item)).join('')}</div></details>`:''}`;
  bindFinanceV2Screen(root);
}

function bindFinanceV2Screen(root) {
  root.querySelectorAll('[data-finance-section]').forEach(button => button.addEventListener('click', () => setFinanceSection(button.dataset.financeSection)));
  root.querySelector('[data-finance-add-action]')?.addEventListener('click', () => { state.financeAddActionOpen = !state.financeAddActionOpen; renderFinance(); });
  root.querySelectorAll('[data-finance-action]').forEach(button => button.onclick = () => {
    state.financeAddActionOpen = false;
    renderFinance();
    if (button.dataset.financeAction === 'expense') openFinanceV2ExpenseDialog();
    if (button.dataset.financeAction === 'income') openFinanceV2IncomeDialog();
    if (button.dataset.financeAction === 'transfer') openFinanceV2TransferDialog();
  });
  root.querySelector('[data-finance-v2-account-add]')?.addEventListener('click', () => openFinanceV2AccountDialog());
  root.querySelectorAll('[data-finance-v2-account-edit]').forEach(button => button.onclick = () => openFinanceV2AccountDialog(button.dataset.financeV2AccountEdit));
  root.querySelectorAll('[data-finance-v2-account-archive]').forEach(button => button.onclick = () => archiveFinanceV2Account(button.dataset.financeV2AccountArchive));
  root.querySelector('[data-finance-v2-income-add]')?.addEventListener('click', openFinanceV2IncomeDialog);
  root.querySelector('[data-finance-v2-transfer-add]')?.addEventListener('click', openFinanceV2TransferDialog);
  root.querySelectorAll('[data-finance-v2-open]').forEach(row => row.onclick = event => { if (event.target.closest('button')) return; openFinanceV2TransactionEditor(row.dataset.financeV2Open); });
  root.querySelector('[data-finance-v2-history-open]')?.addEventListener('click', () => { state.financeHistoryOpen = true; renderFinance(); });
  root.querySelector('[data-finance-reserves-open]')?.addEventListener('click',()=>openFinanceSubscreen('reserves'));
  root.querySelector('[data-finance-subscreen-back]')?.addEventListener('click',closeFinanceSubscreen);
  root.querySelectorAll('[data-finance-reserve-create]').forEach(button=>button.onclick=()=>openFinanceReserveDialog());
  root.querySelectorAll('[data-finance-reserve-edit]').forEach(button=>button.onclick=()=>openFinanceReserveDialog(button.dataset.financeReserveEdit));
  root.querySelectorAll('[data-finance-reserve-adjust]').forEach(button=>button.onclick=()=>adjustFinanceReserve(button.dataset.financeReserveAdjust,button.dataset.direction));
  root.querySelectorAll('[data-finance-reserve-archive]').forEach(button=>button.onclick=()=>archiveFinanceReserve(button.dataset.financeReserveArchive));
  root.querySelector('[data-finance-legacy-reserve-import]')?.addEventListener('click',importLegacyFinanceReserve);
  root.querySelector('[data-finance-legacy-reserve-restore]')?.addEventListener('click',restoreLegacyFinanceReserveBalance);
  root.querySelector('[data-finance-obligations-open]')?.addEventListener('click',()=>openFinanceSubscreen('obligations'));
  root.querySelectorAll('[data-finance-obligation-create]').forEach(button=>button.onclick=()=>openFinanceObligationDialog());
  root.querySelectorAll('[data-finance-obligation-edit]').forEach(button=>button.onclick=()=>openFinanceObligationDialog(button.dataset.financeObligationEdit));
  root.querySelectorAll('[data-finance-obligation-pay]').forEach(button=>button.onclick=()=>payFinanceObligation(button.dataset.financeObligationPay));
  root.querySelectorAll('[data-finance-obligation-link]').forEach(button=>button.onclick=()=>linkFinanceObligation(button.dataset.financeObligationLink));
  root.querySelectorAll('[data-finance-obligation-cancel]').forEach(button=>button.onclick=()=>cancelFinanceObligation(button.dataset.financeObligationCancel));
  root.querySelector('[data-finance-v2-expense-add]')?.addEventListener('click',openFinanceV2ExpenseDialog);
  root.querySelector('[data-finance-more]')?.addEventListener('click',()=>openFinanceSubscreen('management'));
  root.querySelector('[data-finance-management-root]')?.addEventListener('click',()=>openFinanceSubscreen('management'));
  root.querySelectorAll('[data-finance-analytics-open]').forEach(button=>button.onclick=()=>openFinanceSubscreen('analytics'));
  root.querySelectorAll('[data-finance-analytics-period]').forEach(button=>button.onclick=()=>{const a=ensureFinanceAnalyticsState();a.period=button.dataset.financeAnalyticsPeriod;renderFinance();});
  root.querySelector('[data-finance-analytics-custom]')?.addEventListener('submit',event=>{event.preventDefault();const fd=new FormData(event.currentTarget);const a=ensureFinanceAnalyticsState();const from=String(fd.get('dateFrom')||'');const to=String(fd.get('dateTo')||'');if(!normalizeAnyDateKey(from)||!normalizeAnyDateKey(to)||from>to){showToast('Проверь период');return;}a.dateFrom=from;a.dateTo=to;a.period='custom';renderFinance();});
  root.querySelector('[data-finance-analytics-history]')?.addEventListener('click',()=>{const range=financeAnalyticsRange();const h=ensureFinanceHistoryState();h.period='custom';h.dateFrom=range.dateFrom;h.dateTo=range.dateTo;h.type='ALL';state.financeSubscreen='';state.financeHistoryOpen=true;renderFinance();});
  root.querySelector('[data-finance-reconcile-form]')?.addEventListener('submit',event=>{event.preventDefault();submitFinanceReconcile(event.currentTarget);});
  root.querySelector('[data-finance-reconcile-account]')?.addEventListener('change',event=>{state.financeReconcileAccountId=event.target.value;renderFinance();});
  root.querySelector('[data-finance-reconcile-form] [name="actualBalance"]')?.addEventListener('input',event=>{const raw=String(event.target.value||'').replace(',','.');const actual=Number(raw);const accountId=state.financeReconcileAccountId;const current=accountId?getFinanceAccountBalance(accountId):0;const target=root.querySelector('[data-finance-reconcile-diff]');if(target)target.textContent=raw!==''&&Number.isFinite(actual)?`${actual-current>0?'+':''}${formatRub(actual-current)}`:'—';});
  root.querySelector('[data-finance-export-json]')?.addEventListener('click',exportFinanceJson);
  root.querySelector('[data-finance-export-csv]')?.addEventListener('click',()=>exportFinanceCsv());
   root.querySelector('[data-finance-export-full]')?.addEventListener('click',()=>setTab('settings'));
  root.querySelectorAll('[data-finance-management-open]').forEach(button=>button.onclick=()=>openFinanceSubscreen(button.dataset.financeManagementOpen,state.financeSubscreen==='management'?'management':state.financeSection));
  root.querySelector('[data-finance-category-add]')?.addEventListener('click',()=>openFinanceCategoryDialog());
  root.querySelectorAll('[data-finance-category-edit]').forEach(button=>button.onclick=()=>openFinanceCategoryDialog(button.dataset.financeCategoryEdit));
  root.querySelectorAll('[data-finance-category-archive]').forEach(button=>button.onclick=()=>archiveFinanceCategory(button.dataset.financeCategoryArchive));
  root.querySelector('[data-finance-income-type-add]')?.addEventListener('click',()=>openFinanceIncomeTypeDialog());
  root.querySelectorAll('[data-finance-income-type-edit]').forEach(button=>button.onclick=()=>openFinanceIncomeTypeDialog(button.dataset.financeIncomeTypeEdit));
  root.querySelectorAll('[data-finance-income-type-archive]').forEach(button=>button.onclick=()=>archiveFinanceIncomeType(button.dataset.financeIncomeTypeArchive));
}

function ensureFinanceHistoryState() {
  if (!state.financeHistory || typeof state.financeHistory !== 'object') {
    state.financeHistory = { type:'ALL', period:'month', categoryId:'', accountId:'', search:'', dateFrom:'', dateTo:'' };
  }
  return state.financeHistory;
}
function financeHistoryRange(period) {
  const today = toISODate(new Date());
  const current = fromISODate(today);
  if (period === 'today') return { dateFrom:today, dateTo:today };
  if (period === '7d') return { dateFrom:addDays(today,-6), dateTo:today };
  if (period === '3m') {
    const start = new Date(current.getFullYear(), current.getMonth()-2, 1);
    return { dateFrom:toISODate(start), dateTo:today };
  }
  if (period === 'year') return { dateFrom:`${current.getFullYear()}-01-01`, dateTo:today };
  if (period === 'custom') {
    const h = ensureFinanceHistoryState();
    return { dateFrom:normalizeDateInput(h.dateFrom)||'', dateTo:normalizeDateInput(h.dateTo)||'' };
  }
  const start = new Date(current.getFullYear(), current.getMonth(), 1);
  const end = new Date(current.getFullYear(), current.getMonth()+1, 0);
  return { dateFrom:toISODate(start), dateTo:toISODate(end) };
}
function financeHistoryTransactions() {
  const h = ensureFinanceHistoryState();
  const range = financeHistoryRange(h.period);
  return getFinanceTransactions({ type:h.type, categoryId:h.categoryId, accountId:h.accountId, search:h.search, ...range });
}
function financeHistoryDateLabel(iso) {
  return fromISODate(iso).toLocaleDateString('ru-RU',{day:'numeric',month:'long'});
}
function financeHistorySummaryHTML(rows) {
  const expenses=rows.filter(x=>x.type==='EXPENSE');const incomes=rows.filter(x=>x.type==='INCOME');
  const expense=expenses.reduce((s,x)=>s+moneyNumber(x.amount),0);const income=incomes.reduce((s,x)=>s+moneyNumber(x.amount),0);const difference=income-expense;
  return `<div class="finance-v2-history-summary-grid"><div><span>Поступления</span><strong>${formatRub(income)}</strong></div><div><span>Расходы</span><strong>${formatRub(expense)}</strong></div><div><span>Разница</span><strong>${difference>0?'+':''}${formatRub(difference)}</strong></div><div><span>Операций</span><strong>${rows.length}</strong></div></div><p class="muted finance-v2-history-summary-note">TRANSFER и ADJUSTMENT не считаются доходом или расходом.</p>`;
}
function financeHistoryGroupsHTML(rows) {
  if(!rows.length)return '<div class="empty">По выбранному фильтру операций нет.</div>';
  const groups={}; rows.forEach(transaction=>{(groups[transaction.date] ||= []).push(transaction)});
  return Object.entries(groups).sort((a,b)=>b[0].localeCompare(a[0])).map(([date,list])=>`<section class="finance-v2-history-day"><h3>${escapeHTML(financeHistoryDateLabel(date))}</h3><div class="finance-list">${list.map(transaction=>renderFinanceV2TransactionRow(transaction,{compact:false})).join('')}</div></section>`).join('');
}
function renderFinanceHistoryV2(root = $('#tab-finance')) {
  if(!root)return;
  const h=ensureFinanceHistoryState(); const rows=financeHistoryTransactions();const finance=getFinanceStateV2();
  const typeButtons=[['ALL','Все'],['EXPENSE','Расходы'],['INCOME','Поступления'],['TRANSFER','Переводы'],['ADJUSTMENT','Корректировки']].map(([value,label])=>`<button class="ghost-button small ${h.type===value?'active':''}" type="button" data-finance-history-type="${value}">${label}</button>`).join('');
  const periodButtons=[['today','Сегодня'],['7d','7 дней'],['month','Месяц'],['3m','3 месяца'],['year','Год'],['custom','Свой период']].map(([value,label])=>`<button class="ghost-button small ${h.period===value?'active':''}" type="button" data-finance-history-period="${value}">${label}</button>`).join('');
  const categories=[{value:'',label:'Все категории'},...finance.categories.filter(x=>x.active&&!x.archived).map(x=>({value:x.id,label:x.name}))];
  const accounts=[{value:'',label:'Все счета'},...finance.accounts.map(x=>({value:x.id,label:`${x.name}${x.archived?' · архив':''}`}))];
  root.innerHTML=`
    <section class="card finance-v2-history-head"><div class="card-title-row"><div><h2>История операций</h2><p class="muted">Фильтры и сводка читают ту же единую базу transactions[].</p></div><button class="ghost-button small" type="button" data-finance-history-back>Назад</button></div>
      <div class="finance-v2-filter-row">${typeButtons}</div><div class="finance-v2-filter-row">${periodButtons}</div>
      ${h.period==='custom'?`<div class="finance-v2-custom-period"><label>От<input type="date" data-finance-history-from value="${escapeHTML(h.dateFrom||'')}"></label><label>До<input type="date" data-finance-history-to value="${escapeHTML(h.dateTo||'')}"></label></div>`:''}
      <form class="finance-v2-history-search" data-finance-history-search-form><select name="accountId">${financeOptionHTML(accounts,h.accountId)}</select><select name="categoryId">${financeOptionHTML(categories,h.categoryId)}</select><input name="search" value="${escapeHTML(h.search||'')}" placeholder="Поиск по описанию"><button class="ghost-button" type="submit">Применить</button></form>
      ${financeHistorySummaryHTML(rows)}
      <button class="ghost-button finance-v2-details-button" type="button" data-finance-history-export>CSV этой выборки</button>
    </section>
    <div class="finance-v2-history-groups">${financeHistoryGroupsHTML(rows)}</div>`;
  bindFinanceV2Screen(root); bindFinanceHistoryV2(root);
}
function bindFinanceHistoryV2(root) {
  root.querySelector('[data-finance-history-back]')?.addEventListener('click',()=>{state.financeHistoryOpen=false;renderFinance()});
  root.querySelectorAll('[data-finance-history-type]').forEach(button=>button.onclick=()=>{ensureFinanceHistoryState().type=button.dataset.financeHistoryType;renderFinance()});
  root.querySelectorAll('[data-finance-history-period]').forEach(button=>button.onclick=()=>{ensureFinanceHistoryState().period=button.dataset.financeHistoryPeriod;renderFinance()});
  root.querySelector('[data-finance-history-from]')?.addEventListener('change',event=>{ensureFinanceHistoryState().dateFrom=event.target.value;renderFinance()});
  root.querySelector('[data-finance-history-to]')?.addEventListener('change',event=>{ensureFinanceHistoryState().dateTo=event.target.value;renderFinance()});
  root.querySelector('[data-finance-history-search-form]')?.addEventListener('submit',event=>{event.preventDefault();const fd=new FormData(event.currentTarget);const h=ensureFinanceHistoryState();h.accountId=String(fd.get('accountId')||'');h.categoryId=String(fd.get('categoryId')||'');h.search=String(fd.get('search')||'').trim();renderFinance()});
  root.querySelector('[data-finance-history-export]')?.addEventListener('click',()=>exportFinanceCsv(financeHistoryTransactions(),'history-filtered'));
}

function renderFinance() {
  const root = $('#tab-finance');
  if (!root) return;
  if (state.financeHistoryOpen && typeof renderFinanceHistoryV2 === 'function') { renderFinanceHistoryV2(root); return; }
  if (state.financeSubscreen === 'reserves') { renderFinanceReservesScreen(root); return; }
  if (state.financeSubscreen === 'obligations') { renderFinanceObligationsScreen(root); return; }
  if (state.financeSubscreen === 'management') { renderFinanceManagementScreen(root); return; }
  if (state.financeSubscreen === 'accounts') { renderFinanceAccountsScreen(root); return; }
  if (state.financeSubscreen === 'categories') { renderFinanceCategoriesScreen(root); return; }
  if (state.financeSubscreen === 'income-types') { renderFinanceIncomeTypesScreen(root); return; }
  if (state.financeSubscreen === 'analytics') { renderFinanceAnalyticsScreen(root); return; }
  if (state.financeSubscreen === 'reconcile') { renderFinanceReconcileScreen(root); return; }
  if (state.financeSubscreen === 'export') { renderFinanceExportScreen(root); return; }
  if (!['overview', 'operations', 'plan'].includes(state.financeSection)) state.financeSection = 'overview';
  const finance = getFinanceStateV2();
  const recent = getFinanceTransactions().slice(0, 5);
  // Legacy static contracts: quick actions and management stay available through Operations/Plan, not Overview.
  const overview = `<section class="card finance-v2-overview">${renderFinanceMoneyNowCard()}${renderFinanceQuickActions()}${renderFinanceMonthCard()}${renderFinanceObligationsCompact()}${renderFinanceReservesCompact()}<section class="card finance-v2-recent-card"><div class="card-title-row"><div><h2>Последние операции</h2><p class="muted">${recent.length || 0} записей.</p></div></div><div class="finance-list">${recent.length ? recent.map(transaction => renderFinanceV2TransactionRow(transaction)).join('') : '<div class="empty">Операций пока нет.</div>'}</div></section></section>`;
  root.innerHTML = `
    ${renderFinanceSectionNav()}
    ${state.financeSection === 'operations' ? renderFinanceOperations() : state.financeSection === 'plan' ? renderFinancePlan() : overview}
  `;
  // renderFinanceManagementLinks()
  bindFinanceV2Screen(root);
}

function parseFinanceGoals(value) {
  const lines = String(value || '').split(/\n+/).map(line => line.trim()).filter(Boolean).slice(0, 3);
  return lines.map(line => {
    const clean = line.replace(/^\s*(?:[-•*]|\d+[.)])\s*/, '').trim();
    const parts = clean.split(/\s*\|\s*/);
    const result = { title: clean, amount: '', term: '', comment: '' };
    parts.forEach(part => {
      const [rawKey, ...rest] = part.split(':');
      const key = String(rawKey || '').trim().toLowerCase();
      const val = rest.join(':').trim();
      if (!val) return;
      if (key.includes('цель') || key.includes('что')) result.title = val;
      else if (key.includes('сумм')) result.amount = val;
      else if (key.includes('срок')) result.term = val;
      else if (key.includes('коммент')) result.comment = val;
    });
    return result;
  });
}

function getPlanItemStatusText(item, type) {
  if (type === 'income' && item.status === 'received') return 'получено';
  if (type === 'obligation' && item.status === 'paid') return 'оплачено';
  const today = toISODate(new Date());
  if (item.date && item.date < today) return type === 'income' ? 'просрочено' : 'просрочен';
  if (item.date === today) return 'сегодня';
  return 'ожидается';
}

function renderFinanceQuickForm(scope) {
  const categories = financeOptionHTML(financeCategoryOptions(), 'food');
  return `
    <form class="form-grid finance" data-finance-v2-expense-form data-scope="${escapeHTML(scope)}" data-date="${escapeHTML(state.selectedDate)}">
      <label>Сумма, ₽<input name="amount" required inputmode="decimal" placeholder="Напр. 250"></label>
      <label>Категория<select name="categoryId">${categories}</select></label>
      <button class="primary-button" type="submit">Добавить</button>
    </form>
    <div class="quick-category-row" aria-label="Быстрые категории">
      ${[['food','Еда'],['transport','Транспорт'],['home','Дом'],['health','Здоровье']].map(([id,name]) => `<button class="ghost-button small" type="button" data-finance-v2-quick-category="${id}">+ ${name}</button>`).join('')}
    </div>
  `;
}

function renderFinanceList(iso, compact = false) {
  const expenses = getFinanceTransactions({ type: 'EXPENSE', dateFrom: iso, dateTo: iso });
  if (!expenses.length) return '<div class="empty">Трат пока нет.</div>';
  const visible = compact ? expenses.slice(0, 4) : expenses;
  return visible.map(transaction => renderFinanceCard(transaction, compact)).join('') + (compact && expenses.length > 4 ? '<div class="muted finance-summary-line">Показаны последние 4 записи.</div>' : '');
}

function renderFinanceCard(transaction, compact = false) {
  return `
    <article class="finance-card" data-finance-transaction-id="${escapeHTML(transaction.id)}">
      <div class="item-top">
        <div>
          <div class="badge-row">
            <span class="badge important">${escapeHTML(getFinanceCategoryLabel(transaction.categoryId))}</span>
            ${transaction.time ? `<span class="badge">${escapeHTML(transaction.time)}</span>` : ''}
          </div>
          <h3>${formatRub(transaction.amount)}</h3>
          ${transaction.description ? `<p class="muted">${escapeHTML(transaction.description)}</p>` : ''}
        </div>
        <div class="actions">
          <button class="ghost-button" type="button" data-finance-v2-edit="${escapeHTML(transaction.id)}">Изм.</button>
          <button class="danger-button" type="button" data-finance-v2-delete="${escapeHTML(transaction.id)}">Удал.</button>
        </div>
      </div>
    </article>
  `;
}

function renderImportant() {
  const root = $('#tab-important');
  if (!root) return;
  const activeItems = [...app.importantDates].sort((a, b) => a.date.localeCompare(b.date));
  root.innerHTML = `
    <section class="card">
      <div class="card-title-row">
        <div>
          <h2>Важные даты</h2>
          <p class="muted">Отдельный модуль сроков: не смешиваем их с обычными задачами.</p>
        </div>
      </div>
      <form class="form-grid important" data-important-form>
        <label>Название<input name="title" required placeholder="Название важной даты"></label>
        <label>Дата${renderDateControl('date', state.selectedDate, true)}</label>
        <label>Описание<input name="description" placeholder="Описание, если нужно"></label>
        <button class="primary-button" type="submit">Добавить</button>
      </form>
    </section>
    <section class="card">
      <div class="important-list">${activeItems.map(renderImportantCard).join('') || '<div class="empty">Важных дат пока нет.</div>'}</div>
    </section>
  `;
  $('[data-important-form]', root).onsubmit = event => {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    app.importantDates.push({
      id: uid('imp'),
      title: fd.get('title').trim(),
      date: normalizeDateInput(fd.get('date')) || state.selectedDate,
      description: fd.get('description').trim(),
      status: 'active',
      createdAt: new Date().toISOString()
    });
    markChanged();
    showToast('Важная дата добавлена');
  };
  bindCommonActions(root);
}

function renderSync() {
  const root = $('#tab-sync');
  if (!root) return;
  const safeMeta = app.meta || {};
  root.innerHTML = `
    <section class="card">
      <div class="card-title-row"><h2>Синхронизация</h2></div>
      <p class="notice">Экспорт/импорт общего JSON-файла. Финансы теперь входят в общий файл вместе с задачами и питанием.</p>
      <div class="grid-2" style="margin-top:12px">
        <div class="stat-card"><div class="muted">Последнее изменение</div><div class="code">${escapeHTML(safeMeta.lastModified || '—')}</div></div>
        <div class="stat-card"><div class="muted">Счётчик изменений</div><div class="stat-value">${Number(safeMeta.changeCounter || 0)}</div></div>
      </div>
    </section>
    <section class="card sync-box">
      <button class="primary-button" id="exportDataBtn" type="button">Экспортировать tsb_data.json</button>
      <button class="ghost-button" id="importDataBtn" type="button">Импортировать tsb_data.json</button>
      <input id="importDataInput" type="file" accept="application/json,.json" hidden>
      <button class="ghost-button" id="copyDataBtn" type="button">Скопировать JSON в буфер</button>
      <button class="danger-button" id="resetDemoBtn" type="button">Очистить текущую базу</button>
      <p class="danger-note">Очистка базы требует ручного подтверждения словом «подтверждаю».</p>
    </section>
  `;
  bindClick(root, '#exportDataBtn', exportData);
  bindClick(root, '#copyDataBtn', () => copyText(JSON.stringify(buildFullBackupObject(), null, 2)));
  bindClick(root, '#importDataBtn', () => $('#importDataInput', root)?.click());
  const importInput = $('#importDataInput', root);
  if (importInput) {
    importInput.onchange = event => {
      const file = event.target.files?.[0];
      if (file) importData(file);
    };
  }
  bindClick(root, '#resetDemoBtn', async () => {
    const confirmed = await openTypedConfirmDialog({
      title: 'Очистить текущую базу?',
      message: 'Это удалит локальные задачи, питание, важные даты и настройки на этом устройстве. Перед очисткой лучше экспортировать tsb_data.json.',
      phrase: 'подтверждаю',
      confirmText: 'Очистить базу'
    });
    if (!confirmed) return;
    app = createDefaultData();
    saveData(app, true);
    renderAll();
    showToast('База очищена');
  });
}

function bindClick(root, selector, handler) {
  const element = $(selector, root);
  if (!element) {
    console.warn(`Элемент ${selector} не найден при привязке обработчика`);
    return;
  }
  element.onclick = handler;
}

function buildSettingsHTML() {
  const windowDays = Number(app.settings.pastTasksWindowDays || 14);
  return `
    <section class="card settings-card">
      <div class="card-title-row"><h2>Настройки</h2></div>
      <div class="settings-grid">
        <label class="setting-row"><span><input type="checkbox" id="hideDoneSetting" ${app.settings.hideDone ? 'checked' : ''}> Скрывать выполненные задачи</span><small>Выполненные задачи останутся в данных, но не будут занимать место в списках.</small></label>
        <label class="setting-row"><span><input type="checkbox" id="showSelectedDayOnlySetting" ${app.settings.showSelectedDayOnly ? 'checked' : ''}> В планах показывать только выбранный день</span><small>Полезно, если недельный список слишком длинный.</small></label>
        <label class="setting-row"><span><input type="checkbox" id="showOverdueOnTodaySetting" ${app.settings.showOverdueOnToday ? 'checked' : ''}> Показывать незавершённое за прошлые дни</span><small>Это не список “долгов”, а быстрый фильтр последних незакрытых задач.</small></label>
        <label class="setting-row"><span>Период прошлых задач
          <select id="pastTasksWindowSetting">
            <option value="7" ${windowDays === 7 ? 'selected' : ''}>7 дней</option>
            <option value="14" ${windowDays === 14 ? 'selected' : ''}>14 дней</option>
            <option value="30" ${windowDays === 30 ? 'selected' : ''}>30 дней</option>
          </select>
        </span><small>Более старые незавершённые задачи остаются в истории дат, но не показываются на главном экране.</small></label>
      </div>
    </section>

    <section class="card settings-card">
      <div class="card-title-row">
        <div>
          <h2>Отчёт для GPT за неделю</h2>
          <p class="muted">Общий отчёт по выбранной неделе: задачи, питание, вес, активность, заметки, финансы и локальные подсказки.</p>
        </div>
        <button class="ghost-button small" id="copyGptReportBtn" type="button">Скопировать</button>
      </div>
      <textarea readonly id="gptReportText" class="settings-report-textarea">${escapeHTML(buildGptReport())}</textarea>
    </section>

    ${renderGptPlanEditor()}
  `;
}

function bindSettingsActions(root = $('#tab-settings')) {
  if (!root) return;
  const hideDone = $('#hideDoneSetting', root);
  const selectedOnly = $('#showSelectedDayOnlySetting', root);
  const showPast = $('#showOverdueOnTodaySetting', root);
  const windowSelect = $('#pastTasksWindowSetting', root);
  if (hideDone) hideDone.onchange = event => { app.settings.hideDone = event.target.checked; markChanged(); };
  if (selectedOnly) selectedOnly.onchange = event => { app.settings.showSelectedDayOnly = event.target.checked; markChanged(); };
  if (showPast) showPast.onchange = event => { app.settings.showOverdueOnToday = event.target.checked; markChanged(); };
  if (windowSelect) windowSelect.onchange = event => { app.settings.pastTasksWindowDays = Number(event.target.value) || 14; markChanged(); };
  const reportText = $('#gptReportText', root);
  const copyReportBtn = $('#copyGptReportBtn', root);
  if (copyReportBtn && reportText) copyReportBtn.onclick = () => copyText(reportText.value);
  bindGptPlanActions(root);
}

function renderSettings() {
  const root = $('#tab-settings');
  if (!root) return;
  root.innerHTML = buildSettingsHTML();
  bindSettingsActions(root);
}

function renderTaskAddForm(iso, scope) {
  return `
    <form class="form-grid" data-task-form data-date="${iso}" data-scope="${scope}">
      <label>Новая задача<input name="text" required placeholder="Что нужно сделать"></label>
      <label>Время <span class="muted">(необязательно)</span><input name="time" type="time"></label>
      <button class="primary-button" type="submit">Добавить</button>
    </form>
  `;
}

function renderTaskList(iso, compact = false) {
  const tasks = getTasks(iso)
    .filter(task => !(app.settings.hideDone && (task.done || task.dismissed)))
    .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority));
  if (!tasks.length) return '<div class="empty">Задач нет.</div>';
  return tasks.map(task => renderTaskCard(task, iso, compact)).join('');
}

function priorityRank(priority) {
  return { critical: 0, important: 1, secondary: 2 }[priority] ?? 1;
}

function renderTaskCard(task, iso, compact = false) {
  const isPastIncomplete = iso < toISODate(new Date()) && !task.done && !task.dismissed;
  const statusBadges = [
    `<span class="badge ${task.priority}">${PRIORITIES[task.priority] || 'Важно'}</span>`,
    task.done ? '<span class="badge done-badge">Выполнено</span>' : '',
    (task.failed || isPastIncomplete) ? '<span class="badge overdue">Пропущено</span>' : '',
    task.dismissed ? '<span class="badge muted-badge">Скрыто</span>' : ''
  ].filter(Boolean).join('');
  const subtasks = Array.isArray(task.subtasks) && task.subtasks.length ? `
    <div class="subtasks">
      ${task.subtasks.map(sub => `<label class="subtask"><input type="checkbox" data-subtask-toggle="${task.id}" data-subtask-id="${sub.id}" ${sub.done ? 'checked' : ''}> <span>${escapeHTML(sub.text)}</span></label>`).join('')}
    </div>` : '';
  return `
    <article class="task-card ${task.done ? 'done' : ''} ${task.dismissed ? 'dismissed' : ''}">
      <div class="task-top">
        <div class="task-main">
          <input type="checkbox" data-task-toggle="${task.id}" data-date="${iso}" ${task.done ? 'checked' : ''} aria-label="Выполнено">
          <div class="task-content">
            <div class="task-text">${escapeHTML(task.text)}</div>
            <div class="badge-row">${statusBadges}</div>
          </div>
        </div>
        <div class="actions">
          ${!compact ? `<button class="ghost-button" data-task-sub="${task.id}" data-date="${iso}">Подзадачи</button>` : ''}
          <button class="ghost-button" data-task-edit="${task.id}" data-date="${iso}">Изм.</button>
          <button class="danger-button" data-task-delete="${task.id}" data-date="${iso}">Удал.</button>
        </div>
      </div>
      ${subtasks}
    </article>
  `;
}

function renderMealAddForm(scope) {
  const now = new Date();
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return `
    <form class="form-grid food" data-meal-form data-scope="${scope}">
      <label>Что ел<input name="name" required placeholder="Что ел"></label>
      <label>Количество / комментарий<input name="amount" placeholder="Порция, состав или заметка"></label>
      <label>Время<input name="time" type="time" value="${time}"></label>
      <button class="primary-button" type="submit">Добавить</button>
    </form>
  `;
}

function renderMealList(iso) {
  const meals = getHealth(iso).meals || [];
  if (!meals.length) return '<div class="empty">Питание ещё не записано.</div>';
  return meals.map(meal => `
    <article class="meal-card">
      <div class="item-top">
        <div>
          <div class="badge-row"><span class="badge">${escapeHTML(meal.time || 'без времени')}</span></div>
          <h3>${escapeHTML(meal.name || '')}</h3>
          ${meal.amount ? `<p class="muted">${escapeHTML(meal.amount)}</p>` : ''}
          ${meal.comment ? `<p>${nl2br(meal.comment)}</p>` : ''}
        </div>
        <div class="actions">
          <button class="ghost-button" data-meal-edit="${meal.id}">Изм.</button>
          <button class="danger-button" data-meal-delete="${meal.id}">Удал.</button>
        </div>
      </div>
    </article>`).join('');
}

function renderImportantCard(item) {
  const status = getImportantStatus(item);
  return `
    <article class="important-card important-card-wide">
      <div class="important-content">
        <div class="badge-row"><span class="badge ${status.type}">${status.text}</span><span class="badge">${shortDate(item.date)}</span></div>
        <h3>${escapeHTML(item.title)}</h3>
        ${item.description ? `<p class="muted">${nl2br(item.description)}</p>` : ''}
      </div>
      <div class="actions important-actions">
        <button class="ghost-button" data-important-status="${item.id}" data-status="${item.status === 'done' ? 'active' : 'done'}">${item.status === 'done' ? 'Снова активно' : 'Выполнено'}</button>
        <button class="ghost-button" data-important-edit="${item.id}">Изм.</button>
        <button class="danger-button" data-important-delete="${item.id}">Удал.</button>
      </div>
    </article>
  `;
}

function getImportantPreview(limit = 3) {
  return [...app.importantDates]
    .filter(item => item.status !== 'done' && item.status !== 'cancelled')
    .sort((a, b) => getImportantStatus(a).days - getImportantStatus(b).days)
    .slice(0, limit)
    .map(renderImportantCard)
    .join('');
}

function renderSideImportant() {
  const root = $('#sideImportantList');
  if (!root) return;
  const list = [...app.importantDates]
    .filter(item => item.status !== 'done' && item.status !== 'cancelled')
    .sort((a, b) => getImportantStatus(a).days - getImportantStatus(b).days)
    .slice(0, 5);
  root.innerHTML = list.length ? list.map(item => {
    const status = getImportantStatus(item);
    return `<button class="ghost-button" style="justify-content:flex-start;border-radius:14px;min-height:auto;padding:10px;text-align:left" data-jump-date="${escapeHTML(item.date)}"><span>${escapeHTML(item.title)}<br><span class="muted">${escapeHTML(status.text)} · ${shortDate(item.date)}</span></span></button>`;
  }).join('') : '<div class="empty">Нет важных дат.</div>';
  bindCommonActions(root);
}

function getPendingPastTasksHTML() {
  const today = toISODate(new Date());
  const windowDays = Number(app.settings.pastTasksWindowDays || 14);
  const minDate = addDays(today, -windowDays);
  return Object.entries(app.tasks)
    .filter(([iso]) => iso < today && iso >= minDate)
    .flatMap(([iso, tasks]) => tasks
      .filter(task => !task.done && !task.dismissed)
      .map(task => ({ iso, task })))
    .sort((a, b) => b.iso.localeCompare(a.iso))
    .slice(0, 12)
    .map(({ iso, task }) => `
      <article class="task-card past-task-card">
        <div class="task-top">
          <div><div class="task-text">${escapeHTML(task.text)}</div><div class="badge-row"><span class="badge overdue">${shortDate(iso)}</span><span class="badge ${task.priority}">${PRIORITIES[task.priority] || 'Важно'}</span><span class="badge overdue">Пропущено</span></div></div>
          <div class="actions past-task-actions">
            <button class="ghost-button" data-task-complete-past="${task.id}" data-date="${iso}">Выполнено</button>
            <button class="ghost-button" data-task-move="${task.id}" data-date="${iso}">Перенести</button>
            <details class="more-actions">
              <summary class="ghost-button" aria-label="Ещё действия">...</summary>
              <div class="more-actions-menu">
                <button class="ghost-button" type="button" data-jump-date="${iso}">Открыть день</button>
                <button class="ghost-button" type="button" data-task-dismiss="${task.id}" data-date="${iso}">Скрыть</button>
              </div>
            </details>
          </div>
        </div>
      </article>`).join('');
}

function openPastTaskCompleteDialog(task, iso) {
  return new Promise(resolve => {
    const dialog = document.createElement('dialog');
    dialog.className = 'modal-dialog edit-dialog';
    dialog.innerHTML = `
      <form method="dialog" class="modal-card edit-form">
        <div class="card-title-row">
          <div><h2>Когда задача была выполнена?</h2><p class="muted">${escapeHTML(task.text || 'Задача')} · ${shortDate(iso)}</p></div>
          <button class="icon-button" value="cancel" type="button" data-modal-cancel aria-label="Закрыть">×</button>
        </div>
        <div class="actions modal-actions">
          <button class="ghost-button" type="button" data-complete-original>В тот день</button>
          <button class="primary-button" type="button" data-complete-today>Сегодня</button>
        </div>
      </form>`;
    document.body.appendChild(dialog);
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    dialog.querySelector('[data-modal-cancel]').onclick = () => finish(null);
    dialog.querySelector('[data-complete-original]').onclick = () => finish('original');
    dialog.querySelector('[data-complete-today]').onclick = () => finish('today');
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish(null); });
    dialog.showModal();
  });
}


function openDailyReportDialog() {
  return new Promise(resolve => {
    const report = getDailyReport();
    const dialog = document.createElement('dialog');
    dialog.className = 'modal-dialog edit-dialog daily-report-dialog';
    dialog.innerHTML = `
      <form method="dialog" class="modal-card edit-form daily-report-form">
        <div class="card-title-row">
          <div><h2>Итог дня</h2><p class="muted">${formatHumanDate(state.selectedDate)}</p></div>
          <button class="icon-button" value="cancel" type="button" data-modal-cancel aria-label="Закрыть">×</button>
        </div>
        <label class="range-field score-range-field">Самоощущение дня: <strong data-self-score-label>${report.selfScore || '—'}</strong>
          <input class="score-range" name="selfScore" type="range" min="0" max="100" step="1" value="${escapeHTML(report.selfScore || '50')}">
          <span class="score-scale"><span>0</span><span>25</span><span>50</span><span>75</span><span>100</span></span>
        </label>
        <label class="range-field score-range-field">Желание действовать: <strong data-drive-score-label>${report.driveScore || '—'}</strong>
          <input class="score-range" name="driveScore" type="range" min="0" max="100" step="1" value="${escapeHTML(report.driveScore || '50')}">
          <span class="score-scale"><span>0</span><span>25</span><span>50</span><span>75</span><span>100</span></span>
        </label>
        <label>Итог дня / мысли<textarea name="text" placeholder="Что произошло, что важно запомнить, почему день ощущается именно так">${escapeHTML(report.text || '')}</textarea></label>
        <div class="actions modal-actions">
          <button class="ghost-button" value="cancel" type="button" data-modal-cancel>Отмена</button>
          <button class="primary-button" value="submit" type="submit">Сохранить</button>
        </div>
      </form>`;
    document.body.appendChild(dialog);
    const form = dialog.querySelector('form');
    const self = form.elements.selfScore;
    const drive = form.elements.driveScore;
    const selfLabel = dialog.querySelector('[data-self-score-label]');
    const driveLabel = dialog.querySelector('[data-drive-score-label]');
    const updateScoreRange = (input, label) => {
      const snapped = clampScore(input.value) || '0';
      label.textContent = snapped;
      input.style.setProperty('--score-pct', `${Number(input.value) || 0}%`);
    };
    const snapScoreRange = (input, label) => {
      input.value = clampScore(input.value) || '0';
      input.style.setProperty('--score-pct', `${input.value}%`);
      label.textContent = input.value;
    };
    updateScoreRange(self, selfLabel);
    updateScoreRange(drive, driveLabel);
    self.oninput = () => updateScoreRange(self, selfLabel);
    drive.oninput = () => updateScoreRange(drive, driveLabel);
    self.onchange = () => snapScoreRange(self, selfLabel);
    drive.onchange = () => snapScoreRange(drive, driveLabel);
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    dialog.querySelectorAll('[data-modal-cancel]').forEach(btn => btn.onclick = () => finish(null));
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish(null); });
    form.onsubmit = event => {
      event.preventDefault();
      const fd = new FormData(form);
      const target = getDailyReport();
      target.selfScore = clampScore(fd.get('selfScore'));
      target.driveScore = clampScore(fd.get('driveScore'));
      target.text = String(fd.get('text') || '').trim();
      target.updatedAt = new Date().toISOString();
      markChanged();
      showToast('Итог дня сохранён');
      finish(target);
    };
    dialog.showModal();
  });
}

function openEditDialog({ title, fields, submitText = 'Сохранить' }) {
  return new Promise(resolve => {
    const dialog = document.createElement('dialog');
    dialog.className = 'modal-dialog edit-dialog';
    const fieldsHtml = fields.map(field => {
      const value = escapeHTML(field.value ?? '');
      const name = escapeHTML(field.name);
      const label = escapeHTML(field.label);
      if (field.type === 'select') {
        const options = (field.options || []).map(opt => `<option value="${escapeHTML(opt.value)}" ${String(opt.value) === String(field.value) ? 'selected' : ''}>${escapeHTML(opt.label)}</option>`).join('');
        return `<label>${label}<select name="${name}">${options}</select></label>`;
      }
      if (field.type === 'textarea') {
        return `<label>${label}<textarea name="${name}" placeholder="${escapeHTML(field.placeholder || '')}">${value}</textarea></label>`;
      }
      if (field.type === 'date') {
        return `<label>${label}${renderDateControl(field.name, field.value || '', Boolean(field.required))}</label>`;
      }
      return `<label>${label}<input name="${name}" type="${escapeHTML(field.type || 'text')}" value="${value}" placeholder="${escapeHTML(field.placeholder || '')}"></label>`;
    }).join('');
    dialog.innerHTML = `
      <form method="dialog" class="modal-card edit-form">
        <div class="card-title-row">
          <h2>${escapeHTML(title)}</h2>
          <button class="icon-button" value="cancel" aria-label="Закрыть">×</button>
        </div>
        <div class="edit-fields">${fieldsHtml}</div>
        <div class="actions modal-actions">
          <button class="ghost-button" value="cancel" type="button" data-modal-cancel>Отмена</button>
          <button class="primary-button" value="submit" type="submit">${escapeHTML(submitText)}</button>
        </div>
      </form>`;
    document.body.appendChild(dialog);
    bindDatePickerControls(dialog);
    const form = dialog.querySelector('form');
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    dialog.querySelector('[data-modal-cancel]').onclick = () => finish(null);
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish(null); });
    form.onsubmit = event => {
      event.preventDefault();
      const fd = new FormData(form);
      const result = {};
      fields.forEach(field => { result[field.name] = fd.get(field.name) || ''; });
      finish(result);
    };
    dialog.showModal();
    const first = dialog.querySelector('input, select, textarea');
    if (first) first.focus();
  });
}

function openInfoDialog({ title = 'Подсказка', message = '', buttonText = 'Понятно' }) {
  return new Promise(resolve => {
    const dialog = document.createElement('dialog');
    dialog.className = 'modal-dialog edit-dialog';
    dialog.innerHTML = `
      <div class="modal-card edit-form">
        <div class="card-title-row"><h2>${escapeHTML(title)}</h2></div>
        <p>${nl2br(message)}</p>
        <div class="actions modal-actions">
          <button class="primary-button" data-info-ok>${escapeHTML(buttonText)}</button>
        </div>
      </div>`;
    document.body.appendChild(dialog);
    const finish = () => { dialog.close(); dialog.remove(); resolve(true); };
    dialog.querySelector('[data-info-ok]').onclick = finish;
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish(); });
    dialog.showModal();
  });
}

function openConfirmDialog(options, title = 'Подтвердить действие') {
  const config = typeof options === 'object' && options !== null
    ? { title: options.title || title, message: options.message || '', confirmText: options.confirmText || 'Подтвердить', danger: options.danger !== false }
    : { title, message: options || '', confirmText: 'Удалить', danger: true };
  return new Promise(resolve => {
    const dialog = document.createElement('dialog');
    dialog.className = 'modal-dialog edit-dialog';
    dialog.innerHTML = `
      <div class="modal-card edit-form">
        <div class="card-title-row"><h2>${escapeHTML(config.title)}</h2></div>
        <p>${escapeHTML(config.message)}</p>
        <div class="actions modal-actions">
          <button class="ghost-button" data-confirm-no>Отмена</button>
          <button class="${config.danger ? 'danger-button' : 'primary-button'}" data-confirm-yes>${escapeHTML(config.confirmText)}</button>
        </div>
      </div>`;
    document.body.appendChild(dialog);
    const finish = value => { dialog.close(); dialog.remove(); resolve(value); };
    dialog.querySelector('[data-confirm-no]').onclick = () => finish(false);
    dialog.querySelector('[data-confirm-yes]').onclick = () => finish(true);
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish(false); });
    dialog.showModal();
  });
}


function openTypedConfirmDialog({ title, message, phrase = 'подтверждаю', confirmText = 'Подтвердить' }) {
  return new Promise(resolve => {
    const dialog = document.createElement('dialog');
    dialog.className = 'modal-dialog edit-dialog';
    dialog.innerHTML = `
      <form method="dialog" class="modal-card edit-form">
        <div class="card-title-row"><h2>${escapeHTML(title)}</h2></div>
        <p>${escapeHTML(message)}</p>
        <label>Для подтверждения напиши: <strong>${escapeHTML(phrase)}</strong>
          <input name="confirmPhrase" autocomplete="off" placeholder="${escapeHTML(phrase)}">
        </label>
        <div class="actions modal-actions">
          <button class="ghost-button" type="button" data-confirm-no>Отмена</button>
          <button class="danger-button" type="submit" data-confirm-yes disabled>${escapeHTML(confirmText)}</button>
        </div>
      </form>`;
    document.body.appendChild(dialog);
    const form = dialog.querySelector('form');
    const input = dialog.querySelector('input[name="confirmPhrase"]');
    const submit = dialog.querySelector('[data-confirm-yes]');
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    dialog.querySelector('[data-confirm-no]').onclick = () => finish(false);
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish(false); });
    input.oninput = () => {
      submit.disabled = input.value.trim().toLowerCase() !== phrase.toLowerCase();
    };
    form.onsubmit = event => {
      event.preventDefault();
      if (input.value.trim().toLowerCase() === phrase.toLowerCase()) finish(true);
    };
    dialog.showModal();
    input.focus();
  });
}


function bindGptPlanActions(root = document) {
  const form = $('[data-gpt-plan-form]', root);
  if (form) {
    form.onsubmit = event => {
      event.preventDefault();
      const fd = new FormData(form);
      const plan = getGptPlan();
      const now = new Date().toISOString();
      plan.text = String(fd.get('planText') || '').trim();
      if (!plan.createdAt) plan.createdAt = now;
      plan.updatedAt = now;
      markChanged();
      showToast('План от GPT сохранён');
    };
  }

  bindClick(root, '[data-gpt-plan-help]', () => openInfoDialog({
    title: 'Как использовать план от GPT',
    message: '1. Скопируй недельный отчёт выше.\n2. Пришли его GPT и попроси план на следующую неделю.\n3. Вставь ответ в это поле и сохрани.\n\nЛучший формат ответа: короткие советы по каждому дню, финансы, питание, задачи и отдельный блок для сегодняшнего дня.'
  }));

  bindClick(root, '[data-gpt-plan-clear]', async () => {
    if (!await openConfirmDialog({ title: 'Очистить план?', message: 'План от GPT для выбранной недели будет очищен.', confirmText: 'Очистить', danger: true })) return;
    const plan = getGptPlan();
    plan.text = '';
    plan.updatedAt = new Date().toISOString();
    markChanged();
    showToast('План очищен');
  });
}


function bindDatePickerControls(root = document) {
  $$('[data-date-picker-for]', root).forEach(btn => {
    btn.onclick = async () => {
      const host = btn.closest('form') || btn.closest('.edit-fields') || root;
      const input = host?.querySelector(`input[name="${btn.dataset.datePickerFor}"]`);
      if (!input) return;
      const picked = await openDatePickerDialog(normalizeDateInput(input.value) || state.selectedDate);
      if (picked) input.value = formatDateInputValue(picked);
    };
  });
}

function openDatePickerDialog(initialISO = state.selectedDate) {
  return new Promise(resolve => {
    let month = startOfMonth(fromISODate(normalizeDateInput(initialISO) || state.selectedDate));
    let selected = normalizeDateInput(initialISO) || state.selectedDate;
    const dialog = document.createElement('dialog');
    dialog.className = 'modal-dialog date-picker-dialog';
    document.body.appendChild(dialog);
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    const draw = () => {
      const first = startOfMonth(month);
      const offset = (first.getDay() || 7) - 1;
      const gridStart = new Date(first);
      gridStart.setDate(first.getDate() - offset);
      const monthIso = toISODate(first);
      const todayISO = toISODate(new Date());
      let cells = WEEKDAY_SHORT.map(day => `<div class="calendar-cell">${day}</div>`).join('');
      for (let i = 0; i < 42; i += 1) {
        const d = new Date(gridStart);
        d.setDate(gridStart.getDate() + i);
        const iso = toISODate(d);
        const muted = d.getMonth() !== first.getMonth() ? 'muted-day' : '';
        cells += `<button type="button" class="calendar-cell day ${muted} ${iso === selected ? 'selected' : ''} ${iso === todayISO ? 'today' : ''}" data-picker-date="${iso}">${d.getDate()}</button>`;
      }
      dialog.innerHTML = `
        <div class="modal-card date-picker-card">
          <div class="calendar-widget">
            <div class="calendar-head">
              <button class="icon-button" type="button" data-picker-prev>‹</button>
              <div class="calendar-title">${MONTH_NAMES[first.getMonth()]} ${first.getFullYear()}</div>
              <button class="icon-button" type="button" data-picker-next>›</button>
            </div>
            <div class="calendar-grid custom-date-grid">${cells}</div>
            <div class="actions modal-actions">
              <button class="ghost-button" type="button" data-picker-cancel>Отмена</button>
              <button class="ghost-button" type="button" data-picker-today>Сегодня</button>
              <button class="primary-button" type="button" data-picker-ok>Выбрать</button>
            </div>
          </div>
        </div>`;
      dialog.querySelector('[data-picker-prev]').onclick = () => { month.setMonth(month.getMonth() - 1); draw(); };
      dialog.querySelector('[data-picker-next]').onclick = () => { month.setMonth(month.getMonth() + 1); draw(); };
      dialog.querySelector('[data-picker-cancel]').onclick = () => finish(null);
      dialog.querySelector('[data-picker-today]').onclick = () => { selected = todayISO; month = startOfMonth(fromISODate(todayISO)); draw(); };
      dialog.querySelector('[data-picker-ok]').onclick = () => finish(selected);
      $$('[data-picker-date]', dialog).forEach(btn => btn.onclick = () => { selected = btn.dataset.pickerDate; draw(); });
    };
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish(null); });
    draw();
    dialog.showModal();
  });
}

function bindCommonActions(root = document) {
  bindDatePickerControls(root);
  $$('details[data-details-key]', root).forEach(details => {
    details.ontoggle = () => {
      state.expandedSections[details.dataset.detailsKey] = details.open;
    };
  });
  $$('[data-tab-target]', root).forEach(btn => btn.onclick = () => setTab(btn.dataset.tabTarget));
  $$('[data-gpt-advice]', root).forEach(btn => btn.onclick = () => openGptAdviceDialog(btn.dataset.gptAdvice || 'today'));
  $$('[data-jump-date]', root).forEach(btn => btn.onclick = () => setSelectedDate(btn.dataset.jumpDate));
  $$('[data-daily-report-open]', root).forEach(btn => btn.onclick = openDailyReportDialog);
  $$('[data-local-insights-open]', root).forEach(btn => btn.onclick = openLocalInsightsDialog);
  $$('[data-finance-no-expenses]', root).forEach(btn => {
    btn.onclick = () => {
      const iso = btn.dataset.financeNoExpenses || state.selectedDate;
      const day = getFinance(iso);
      if (day.expenses.length) return;
      day.noExpenses = !day.noExpenses;
      markChanged();
      showToast(day.noExpenses ? 'День отмечен без трат' : 'Отметка без трат снята');
    };
  });
  $$('[data-task-complete-past]', root).forEach(btn => {
    btn.onclick = async () => {
      const fromDate = btn.dataset.date;
      const task = findTask(fromDate, btn.dataset.taskCompletePast);
      if (!task) return;
      const mode = await openPastTaskCompleteDialog(task, fromDate);
      if (!mode) return;
      const nowISO = new Date().toISOString();
      const today = toISODate(new Date());
      if (mode === 'original') {
        task.done = true;
        task.failed = false;
        task.dismissed = false;
        task.completedAt = nowISO;
        task.completedForDate = fromDate;
        task.completionMode = 'original';
        task.originalDate = task.originalDate || fromDate;
        markChanged();
        showToast('Задача отмечена выполненной в тот день');
        return;
      }
      app.tasks[fromDate] = getTasks(fromDate).filter(item => item.id !== task.id);
      task.done = true;
      task.failed = false;
      task.dismissed = false;
      task.originalDate = task.originalDate || fromDate;
      task.movedFrom = fromDate;
      task.completedAt = nowISO;
      task.completedForDate = today;
      task.completionMode = 'today';
      getTasks(today).push(task);
      setSelectedDate(today);
      showToast('Задача засчитана на сегодня');
    };
  });

  $$('[data-task-dismiss]', root).forEach(btn => {
    btn.onclick = () => {
      const task = findTask(btn.dataset.date, btn.dataset.taskDismiss);
      if (!task) return;
      task.dismissed = true;
      markChanged();
      showToast('Задача скрыта из незавершённых');
    };
  });

  $$('[data-task-move]', root).forEach(btn => {
    btn.onclick = async () => {
      const fromDate = btn.dataset.date;
      const task = findTask(fromDate, btn.dataset.taskMove);
      if (!task) return;
      const result = await openEditDialog({
        title: 'Перенести задачу',
        fields: [
          { name: 'date', label: 'Новая дата', type: 'date', value: state.selectedDate },
          { name: 'text', label: 'Текст задачи', value: task.text }
        ],
        submitText: 'Перенести'
      });
      const targetDate = normalizeDateInput(result?.date);
      if (!result || !targetDate) return;
      app.tasks[fromDate] = getTasks(fromDate).filter(item => item.id !== task.id);
      task.text = result.text.trim() || task.text;
      task.dismissed = false;
      task.failed = false;
      task.movedFrom = fromDate;
      getTasks(targetDate).push(task);
      setSelectedDate(targetDate);
      showToast('Задача перенесена');
    };
  });

  $$('[data-task-form]', root).forEach(form => {
    form.onsubmit = event => {
      event.preventDefault();
      const fd = new FormData(form);
      const iso = form.dataset.date;
      const text = fd.get('text').trim();
      if (!text) return;
      getTasks(iso).push({
        id: uid('task'),
        text,
        priority: 'important',
        time: String(fd.get('time') || '').trim(),
        done: false,
        failed: false,
        dismissed: false,
        subtasks: [],
        note: '',
        createdAt: new Date().toISOString(),
        originalDate: iso
      });
      markChanged();
      showToast('Задача добавлена');
    };
  });

  $$('[data-task-toggle]', root).forEach(input => {
    input.onchange = () => {
      const task = findTask(input.dataset.date, input.dataset.taskToggle);
      if (!task) return;
      task.done = input.checked;
      if (task.done) {
        task.failed = false;
        task.completedAt = task.completedAt || new Date().toISOString();
        task.completedForDate = input.dataset.date;
        task.completionMode = task.completionMode || 'same_day';
      } else {
        task.completedAt = '';
        task.completedForDate = '';
        task.completionMode = '';
      }
      markChanged();
    };
  });

  $$('[data-task-delete]', root).forEach(btn => {
    btn.onclick = async () => {
      if (!await openConfirmDialog('Удалить задачу?')) return;
      app.tasks[btn.dataset.date] = getTasks(btn.dataset.date).filter(task => task.id !== btn.dataset.taskDelete);
      markChanged();
    };
  });

  $$('[data-task-edit]', root).forEach(btn => {
    btn.onclick = async () => {
      const task = findTask(btn.dataset.date, btn.dataset.taskEdit);
      if (!task) return;
      const result = await openEditDialog({
        title: 'Изменить задачу',
        fields: [
          { name: 'text', label: 'Текст задачи', value: task.text },
          { name: 'priority', label: 'Приоритет', type: 'select', value: task.priority, options: [
            { value: 'critical', label: 'Критично' },
            { value: 'important', label: 'Важно' },
            { value: 'secondary', label: 'Второстепенно' }
          ]}
        ]
      });
      if (!result) return;
      task.text = result.text.trim() || task.text;
      task.priority = normalizePriority(result.priority);
      markChanged();
    };
  });

  $$('[data-task-sub]', root).forEach(btn => {
    btn.onclick = async () => {
      const task = findTask(btn.dataset.date, btn.dataset.taskSub);
      if (!task) return;
      const existing = (task.subtasks || []).map(s => s.text).join('\n');
      const result = await openEditDialog({
        title: 'Подзадачи',
        fields: [
          { name: 'subtasks', label: 'Каждая подзадача с новой строки', type: 'textarea', value: existing, placeholder: 'Подзадачи, каждая с новой строки' }
        ],
        submitText: 'Сохранить'
      });
      if (!result) return;
      const oldByText = new Map((task.subtasks || []).map(s => [s.text, s]));
      task.subtasks = String(result.subtasks || '').split('\n').map(line => line.trim()).filter(Boolean).map(line => ({
        id: oldByText.get(line)?.id || uid('sub'),
        text: line,
        done: oldByText.get(line)?.done || false
      }));
      markChanged();
    };
  });

  $$('[data-subtask-toggle]', root).forEach(input => {
    input.onchange = () => {
      const taskId = input.dataset.subtaskToggle;
      const subId = input.dataset.subtaskId;
      const task = Object.values(app.tasks).flat().find(item => item.id === taskId);
      const sub = task?.subtasks?.find(item => item.id === subId);
      if (!sub) return;
      sub.done = input.checked;
      markChanged();
    };
  });

  $$('[data-meal-form]', root).forEach(form => {
    form.onsubmit = event => {
      event.preventDefault();
      const fd = new FormData(form);
      const name = fd.get('name').trim();
      if (!name) return;
      getHealth().meals.push({
        id: uid('meal'),
        type: 'Приём пищи',
        name,
        amount: fd.get('amount').trim(),
        time: fd.get('time') || '',
        comment: '',
        createdAt: new Date().toISOString()
      });
      markChanged();
      showToast('Приём пищи добавлен');
    };
  });

  $$('[data-meal-delete]', root).forEach(btn => {
    btn.onclick = async () => {
      if (!await openConfirmDialog('Удалить приём пищи?')) return;
      const day = getHealth();
      day.meals = day.meals.filter(meal => meal.id !== btn.dataset.mealDelete);
      markChanged();
    };
  });

  $$('[data-meal-edit]', root).forEach(btn => {
    btn.onclick = async () => {
      const meal = getHealth().meals.find(item => item.id === btn.dataset.mealEdit);
      if (!meal) return;
      const result = await openEditDialog({
        title: 'Изменить приём пищи',
        fields: [
          { name: 'name', label: 'Что ел', value: meal.name || '' },
          { name: 'amount', label: 'Количество / комментарий', value: meal.amount || '' },
          { name: 'time', label: 'Время', type: 'time', value: meal.time || '' }
        ]
      });
      if (!result) return;
      meal.name = result.name.trim() || meal.name;
      meal.amount = result.amount.trim();
      meal.time = result.time.trim();
      markChanged();
    };
  });

  // Finance v2 owns all active finance mutations; legacy Finance v1 binders were removed.

  $$('[data-important-delete]', root).forEach(btn => {
    btn.onclick = async () => {
      if (!await openConfirmDialog('Удалить важную дату?')) return;
      app.importantDates = app.importantDates.filter(item => item.id !== btn.dataset.importantDelete);
      markChanged();
    };
  });

  $$('[data-important-status]', root).forEach(btn => {
    btn.onclick = () => {
      const item = app.importantDates.find(entry => entry.id === btn.dataset.importantStatus);
      if (!item) return;
      item.status = btn.dataset.status;
      markChanged();
    };
  });

  $$('[data-important-edit]', root).forEach(btn => {
    btn.onclick = async () => {
      const item = app.importantDates.find(entry => entry.id === btn.dataset.importantEdit);
      if (!item) return;
      const result = await openEditDialog({
        title: 'Изменить важную дату',
        fields: [
          { name: 'title', label: 'Название', value: item.title },
          { name: 'date', label: 'Дата', type: 'date', value: item.date },
          { name: 'description', label: 'Описание', type: 'textarea', value: item.description || '' }
        ]
      });
      if (!result) return;
      item.title = result.title.trim() || item.title;
      const editedDate = normalizeDateInput(result.date);
      if (editedDate) item.date = editedDate;
      item.description = result.description.trim();
      markChanged();
    };
  });
}

function findTask(iso, id) {
  return getTasks(iso).find(task => task.id === id);
}


function exportData() {
  try {
    const exportObject = buildFullBackupObject();
    exportObject.meta.lastExported = new Date().toISOString();
    app.meta.lastExported = exportObject.meta.lastExported;
    saveData(app, false);

    const blob = new Blob([JSON.stringify(exportObject, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tsb_data_${toISODate(new Date())}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('Экспорт создан');
    renderAll();
  } catch (error) {
    console.error('Ошибка экспорта:', error);
    showToast('Не удалось экспортировать данные');
  }
}

function buildFullBackupObject() {
  const exportObject = normalizeData(JSON.parse(JSON.stringify(app)));
  exportObject.backupType = FULL_BACKUP_TYPE;
  exportObject.formatVersion = BACKUP_FORMAT_VERSION;
  return exportObject;
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result || '{}'));
      if (parsed?.backupType !== FULL_BACKUP_TYPE || parsed?.formatVersion !== BACKUP_FORMAT_VERSION) {
        showToast(parsed?.backupType === FINANCE_BACKUP_TYPE
          ? 'Finance JSON нельзя импортировать как полный backup'
          : 'Неподдерживаемый формат backup');
        return;
      }
      const normalized = normalizeData(parsed);
      const currentModified = app.meta?.lastModified || '';
      const importedModified = normalized.meta?.lastModified || '';

      if (currentModified && importedModified && importedModified < currentModified) {
        openConfirmDialog({
          title: 'Импортировать более старый файл?',
          message: 'Импортируемый файл выглядит старее текущей базы. Текущая база будет заменена этим файлом.',
          confirmText: 'Импортировать',
          danger: true
        }).then(ok => {
          if (ok) applyImportedData(normalized);
        });
        return;
      }

      openConfirmDialog({
        title: 'Импортировать данные?',
        message: 'Текущая локальная база будет заменена данными из выбранного JSON-файла.',
        confirmText: 'Импортировать',
        danger: false
      }).then(ok => {
        if (ok) applyImportedData(normalized);
      });
    } catch (error) {
      console.error('Ошибка импорта:', error);
      showToast('Не удалось импортировать JSON');
    }
  };
  reader.onerror = () => showToast('Не удалось прочитать файл');
  reader.readAsText(file, 'utf-8');
}

function applyImportedData(normalized) {
  const localDeviceId = getOrCreateDeviceId();
  const localCounter = Number.isFinite(Number(app.meta?.changeCounter)) ? Math.max(0, Number(app.meta.changeCounter)) : 0;
  const importedCounter = Number.isFinite(Number(normalized.meta?.changeCounter)) ? Math.max(0, Number(normalized.meta.changeCounter)) : 0;
  const recovery = buildFullBackupObject();
  if (!storageSet(RECOVERY_BACKUP_KEY, JSON.stringify({ ...recovery, recoveryCreatedAt: new Date().toISOString() }))) {
    showToast('Импорт отменён: не удалось создать recovery backup');
    return;
  }
  const imported = normalizeData(normalized);
  imported.meta.appVersion = APP_VERSION;
  imported.meta.deviceId = localDeviceId;
  imported.meta.lastModified = new Date().toISOString();
  imported.meta.changeCounter = Math.max(localCounter, importedCounter) + 1;
  if (!saveData(imported, false)) {
    showToast('Импорт отменён: не удалось записать базу');
    return;
  }
  app = imported;
  renderAll();
  showToast('Данные импортированы');
}

function buildGptReport() {
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
}

function normalizeWeightInput(value) {
  const raw = String(value || '').trim().replace(',', '.');
  if (!raw) return '';
  const match = raw.match(/\d+(?:\.\d{0,2})?/);
  return match ? match[0] : '';
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast('Скопировано');
  } catch {
    const temp = document.createElement('textarea');
    temp.value = text;
    document.body.appendChild(temp);
    temp.select();
    document.execCommand('copy');
    temp.remove();
    showToast('Скопировано');
  }
}

function showToast(message) {
  const toast = $('#toast');
  if (!toast) return;
  toast.textContent = message;
  toast.hidden = false;
  toast.classList.remove('hide');
  requestAnimationFrame(() => toast.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
    toast.classList.add('hide');
    window.setTimeout(() => {
      if (!toast.classList.contains('show')) {
        toast.textContent = '';
        toast.hidden = true;
        toast.classList.remove('hide');
      }
    }, 260);
  }, 2200);
}


function getPwaStatusHTML() {
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const swSupported = 'serviceWorker' in navigator;
  const controlled = Boolean(navigator.serviceWorker?.controller);
  const secure = window.isSecureContext;
  const protocol = window.location.protocol;
  return `
    <section class="card">
      <div class="card-title-row"><h2>PWA-диагностика</h2></div>
      <div class="code">
        protocol: ${escapeHTML(protocol)}<br>
        secureContext: ${escapeHTML(secure)}<br>
        serviceWorker supported: ${escapeHTML(swSupported)}<br>
        serviceWorker controlled: ${escapeHTML(controlled)}<br>
        standalone mode: ${escapeHTML(standalone)}<br>
        origin: ${escapeHTML(window.location.origin)}
      </div>
      <p class="muted">Для установки на Android открой GitHub Pages-ссылку в Chrome и выбери «Установить приложение» / «Добавить на главный экран». Если serviceWorker controlled = false после первого открытия, обнови страницу один раз.</p>
    </section>
  `;
}

function closeMobileTabMenu() {
  const fab = $('#mobileTabFab');
  const toggle = $('#mobileTabToggle');
  const menu = $('#mobileTabMenu');
  if (!fab || !toggle || !menu) return;
  fab.classList.remove('open');
  toggle.setAttribute('aria-expanded', 'false');
  menu.setAttribute('aria-hidden', 'true');
}

function setupMobileTabMenu() {
  const fab = $('#mobileTabFab');
  const toggle = $('#mobileTabToggle');
  const menu = $('#mobileTabMenu');
  if (!fab || !toggle || !menu) return;
  toggle.onclick = event => {
    event.stopPropagation();
    const open = !fab.classList.contains('open');
    fab.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', String(open));
    menu.setAttribute('aria-hidden', String(!open));
  };
  $$('[data-tab-target]', menu).forEach(btn => btn.onclick = () => { setTab(btn.dataset.tabTarget); closeMobileTabMenu(); });
  document.addEventListener('click', event => { if (!fab.contains(event.target)) closeMobileTabMenu(); });
  document.addEventListener('focusin', event => {
    if (event.target.matches('input, textarea, select')) document.body.classList.add('input-focus');
  });
  document.addEventListener('focusout', () => {
    window.setTimeout(() => {
      if (!document.activeElement || !document.activeElement.matches('input, textarea, select')) document.body.classList.remove('input-focus');
    }, 80);
  });
}

function setupEvents() {
  $('#prevDayBtn').onclick = () => setSelectedDate(addDays(state.selectedDate, -1));
  $('#nextDayBtn').onclick = () => setSelectedDate(addDays(state.selectedDate, 1));
  $('#todayBtn').onclick = () => setSelectedDate(toISODate(new Date()));
  $('#openCalendarBtn').onclick = () => $('#calendarDialog').showModal();
  $('#closeCalendarBtn').onclick = () => $('#calendarDialog').close();
  $$('.tab-button').forEach(btn => btn.onclick = () => setTab(btn.dataset.tab));
  $$('[data-tab-target]').forEach(btn => btn.onclick = () => setTab(btn.dataset.tabTarget));
  setupMobileTabMenu();

}

setupEvents();
renderAll();
