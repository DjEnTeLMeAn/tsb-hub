const APP_VERSION = '0.11.1-finance-v2-part1';
const STORAGE_KEY = 'tsb_hub_data_v1';
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
const APP_TABS = ['today', 'plans', 'food', 'finance', 'important', 'sync', 'settings'];

function getInitialActiveTab() {
  try {
    const savedTab = sessionStorage.getItem(SESSION_TAB_KEY);
    return APP_TABS.includes(savedTab) ? savedTab : 'today';
  } catch (error) {
    return 'today';
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
  expandedSections: {}
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
  let id = localStorage.getItem('tsb_hub_device_id');
  if (!id) {
    id = `device_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    localStorage.setItem('tsb_hub_device_id', id);
  }
  return id;
}

function loadData() {
  const raw = localStorage.getItem(STORAGE_KEY);
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
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function markChanged() {
  saveData(app, true);
  renderAll();
}

function migrateOldLocalStorage(target) {
  let migrated = false;
  const oldTasksRaw = localStorage.getItem(OLD_TSB_KEY);
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

  const oldHealthRaw = localStorage.getItem(OLD_HEALTH_KEY);
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

  const oldSettingsRaw = localStorage.getItem(OLD_HEALTH_SETTINGS_KEY);
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

function setAvailableBalance(value) {
  getFinanceContext().availableBalance = normalizeMoneyInput(value);
}

function addAvailableBalance(delta) {
  const context = getFinanceContext();
  const current = moneyNumber(context.availableBalance);
  const next = Math.round((current + Number(delta || 0)) * 100) / 100;
  context.availableBalance = String(Object.is(next, -0) ? 0 : next);
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

function applyBalanceCorrection(newBalance) {
  const context = getFinanceContext();
  const normalized = normalizeSignedMoneyInput(newBalance);
  if (!normalized) {
    context.availableBalance = '';
    return 0;
  }
  const diff = Math.round((moneyNumber(normalized) - moneyNumber(context.availableBalance)) * 100) / 100;
  context.availableBalance = normalized;
  if (diff !== 0) addFinanceOperation('adjustment', diff, diff < 0 ? 'Корректировка: неуказанные расходы' : 'Корректировка баланса', 'Ручное уточнение доступной суммы', '', state.selectedDate);
  return diff;
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
function applyFinanceMutation(result, message = '') {
  if (!result?.ok) {
    if (typeof showToast === 'function') showToast(result?.error === 'SYSTEM_LOCKED' ? 'Системную операцию нельзя изменить' : 'Не удалось изменить финансы');
    return false;
  }
  setFinanceStateV2(result.finance);
  markChanged();
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
  applyFinanceMutation(TSBFinanceCore.deleteTransaction(getFinanceStateV2(), id), 'Операция удалена');
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
  const context = getFinanceContext();
  const balance = getFinanceTotalBalance();
  const selectedIsFuture = iso > todayISO;
  const selectedIsTodayOrPast = iso <= todayISO;
  const pendingTasks = tasks.filter(task => !task.done && !task.failed && !task.dismissed).length;
  const impulseCount = finance.expenses.filter(item => ['impulse', 'stress', 'tired', 'lazy', 'reward'].includes(item.reason)).length;
  const upcomingObligations = getUpcomingPlanItems(context.obligations, 10);
  const weekObligations = upcomingObligations.filter(item => !item.date || item.date <= addDays(todayISO, 7));
  const weekObligationTotal = weekObligations.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  const upcomingIncomes = getUpcomingPlanItems(context.incomes, 10);
  const weekIncomes = upcomingIncomes.filter(item => !item.date || item.date <= addDays(todayISO, 7));
  const weekIncomeTotal = weekIncomes.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  const nextIncome = getNextIncome();
  const week = getWeekDataSummary(iso);
  const netAfterPlans = balance + weekIncomeTotal - weekObligationTotal;


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
  $$('.tab-button').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === state.activeTab));
  $$('.mobile-tab-menu [data-tab-target]').forEach(btn => btn.classList.toggle('active', btn.dataset.tabTarget === state.activeTab));
  $$('.tab-page').forEach(page => page.classList.toggle('active', page.id === `tab-${state.activeTab}`));
}

function setTab(tab) {
  if (!APP_TABS.includes(tab)) tab = 'today';
  state.activeTab = tab;
  saveActiveTabForSession(tab);
  applyActiveTabToDom();
  renderAll();
}

function renderAll() {
  applyActiveTabToDom();
  $('#selectedDateLabel').textContent = formatHumanDate(state.selectedDate);
  const renderSteps = [
    ['desktopCalendar', () => renderCalendar($('#desktopCalendar'))],
    ['mobileCalendar', () => renderCalendar($('#mobileCalendar'))],
    ['sideImportant', renderSideImportant],
    ['today', renderToday],
    ['plans', renderPlans],
    ['food', renderFood],
    ['finance', renderFinance],
    ['important', renderImportant],
    ['sync', renderSync],
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
        <span class="summary-chip">Выполнение ${progress.pct}%</span>
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

function renderToday() {
  const root = $('#tab-today');
  if (!root) return;
  const health = getHealth();
  const weeklyWeightISO = getWeeklyWeightISO(state.selectedDate);
  const weeklyWeight = getHealth(weeklyWeightISO).weight;
  const progress = getProgress();
  const important = getImportantPreview(3);
  const financeSummary = getFinanceSummary();
  const financeAccount = getDefaultFinanceAccount();
  const financeAccountBalance = financeAccount ? getFinanceAccountBalance(financeAccount.id) : 0;
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
        <div class="card-title-row"><h2>Задачи дня</h2><button class="ghost-button small" data-tab-target="plans">Планы</button></div>
        ${renderTaskAddForm(state.selectedDate, 'today')}
        ${renderCollapsedBlock('Показать задачи дня', `<div class="task-list" style="margin-top:12px">${renderTaskList(state.selectedDate, true)}</div>`, `${progress.total}`, { key: `today-tasks-${state.selectedDate}` })}
      </div>
      <div class="card today-input-card">
        <div class="card-title-row"><h2>Питание дня</h2><button class="ghost-button small" data-tab-target="food">Питание</button></div>
        ${renderMealAddForm('today')}
        ${renderCollapsedBlock('Показать питание дня', `<div class="meal-list" style="margin-top:12px">${renderMealList(state.selectedDate)}</div>`, `${health.meals.length}`, { key: `today-food-${state.selectedDate}` })}
      </div>
      <div class="card today-input-card today-finance-card">
        <div class="card-title-row"><h2>Финансы дня</h2><button class="ghost-button small" data-tab-target="finance">Финансы</button></div>
        <div class="finance-summary-line">${financeAccount ? `${escapeHTML(financeAccount.name)}: ${formatRub(financeAccountBalance)}` : 'Счёт не создан'}</div>
        ${renderFinanceQuickForm('today')}
        <div class="finance-summary-line">Потрачено за день: ${formatRub(financeSummary.total)} · еда: ${formatRub(financeSummary.food)} · транспорт: ${formatRub(financeSummary.transport)} · другое: ${formatRub(financeSummary.other)}</div>
        ${renderFinanceNoExpensesButton(state.selectedDate)}
        ${renderCollapsedBlock('Показать операции дня', `<div class="finance-list" style="margin-top:12px">${renderFinanceList(state.selectedDate, true)}</div>`, `${financeSummary.count}`, { key: `today-finance-${state.selectedDate}` })}
      </div>
      ${renderDailyReportCard()}
    </section>

    <section class="grid-2">
      <div class="card today-list-card">
        <div class="card-title-row"><h2>Ближайшие важные даты</h2><button class="ghost-button small" data-tab-target="important">Все</button></div>
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

function renderFood() {
  const root = $('#tab-food');
  if (!root) return;
  const health = getHealth();
  const weightISO = getWeeklyWeightISO(state.selectedDate);
  const weightHealth = getHealth(weightISO);
  const meals = health.meals.length ? renderMealList(state.selectedDate) : '<div class="empty">Питание за выбранный день пока не записано. Основной быстрый ввод остаётся во вкладке «Сегодня».</div>';
  root.innerHTML = `
    ${renderGptAdviceCard('food')}

    <section class="card">
      <div class="card-title-row">
        <div>
          <h2>Питание · ${formatHumanDate(state.selectedDate)}</h2>
          <p class="muted">Здесь просмотр и точечное изменение записей. Основное заполнение питания — во вкладке «Сегодня».</p>
        </div>
      </div>
      <div class="meal-list" style="margin-top:12px">${meals}</div>
    </section>

    <section class="grid-2">
      <div class="card food-note-card-balanced">
        <div class="card-title-row">
          <div>
            <h2>Вес недели</h2>
            <p class="muted">Вес указывается один раз в неделю. Для выбранной недели день замера: ${shortDate(weightISO)}.</p>
          </div>
        </div>
        <form class="form-grid weight weekly-weight-form" data-weight-form data-weight-date="${weightISO}">
          <label>Вес, кг<input name="weight" type="text" inputmode="decimal" placeholder="Напр. 82.4" value="${escapeHTML(weightHealth.weight || '')}"></label>
          <button class="primary-button" type="submit">Сохранить вес недели</button>
        </form>
      </div>
      <div class="card food-note-card-balanced">
        <div class="card-title-row">
          <div>
            <h2>Заметка дня</h2>
            <p class="muted">Одна заметка по выбранной дате: самочувствие, дела и важные наблюдения.</p>
          </div>
        </div>
        <form data-day-note-form class="sync-box day-note-form">
          <textarea name="note" placeholder="Чем занимался, как себя чувствовал, что важно запомнить">${escapeHTML(health.note || health.activityNote || '')}</textarea>
          <button class="primary-button" type="submit">Сохранить заметку</button>
        </form>
      </div>
    </section>
  `;
  bindCommonActions(root);
  $('[data-weight-form]', root).onsubmit = event => {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const targetDate = event.currentTarget.dataset.weightDate || getWeeklyWeightISO(state.selectedDate);
    const day = getHealth(targetDate);
    day.weight = normalizeWeightInput(fd.get('weight')) || null;
    markChanged();
    showToast('Вес недели сохранён');
  };
  $('[data-day-note-form]', root).onsubmit = event => {
    event.preventDefault();
    getHealth().note = new FormData(event.currentTarget).get('note') || '';
    markChanged();
    showToast('Заметка дня сохранена');
  };
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
  return `<article class="finance-card finance-v2-operation ${financeTransactionTone(transaction)}" data-finance-v2-open="${escapeHTML(transaction.id)}">
    <div class="item-top"><div><div class="badge-row"><span class="badge ${transaction.type === 'EXPENSE' ? 'important' : 'secondary'}">${escapeHTML(financeTypeLabel(transaction))}</span>${transaction.time ? `<span class="badge">${escapeHTML(transaction.time)}</span>` : ''}</div><h3>${financeSignedAmount(transaction)}</h3>${transaction.description ? `<p class="muted">${escapeHTML(transaction.description)}</p>` : ''}${accountText ? `<p class="muted finance-v2-account-note">${escapeHTML(accountText)}</p>` : ''}</div>
    ${compact ? '<span class="finance-v2-chevron">›</span>' : `<div class="actions"><button class="ghost-button" type="button" data-finance-v2-edit="${escapeHTML(transaction.id)}">Изм.</button><button class="danger-button" type="button" data-finance-v2-delete="${escapeHTML(transaction.id)}">Удал.</button></div>`}</div>
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
function bindFinanceV2Screen(root) {
  root.querySelector('[data-finance-v2-account-add]')?.addEventListener('click', () => openFinanceV2AccountDialog());
  root.querySelectorAll('[data-finance-v2-account-edit]').forEach(button => button.onclick = () => openFinanceV2AccountDialog(button.dataset.financeV2AccountEdit));
  root.querySelectorAll('[data-finance-v2-account-archive]').forEach(button => button.onclick = () => archiveFinanceV2Account(button.dataset.financeV2AccountArchive));
  root.querySelector('[data-finance-v2-income-add]')?.addEventListener('click', openFinanceV2IncomeDialog);
  root.querySelector('[data-finance-v2-transfer-add]')?.addEventListener('click', openFinanceV2TransferDialog);
  root.querySelectorAll('[data-finance-v2-open]').forEach(row => row.onclick = event => { if (event.target.closest('button')) return; openFinanceV2TransactionEditor(row.dataset.financeV2Open); });
  root.querySelector('[data-finance-v2-history-open]')?.addEventListener('click', () => { state.financeHistoryOpen = true; renderFinance(); });
}

function ensureFinanceHistoryState() {
  if (!state.financeHistory || typeof state.financeHistory !== 'object') {
    state.financeHistory = { type:'ALL', period:'month', categoryId:'', search:'', dateFrom:'', dateTo:'' };
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
  return getFinanceTransactions({ type:h.type, categoryId:h.categoryId, search:h.search, ...range });
}
function financeHistoryDateLabel(iso) {
  return fromISODate(iso).toLocaleDateString('ru-RU',{day:'numeric',month:'long'});
}
function financeHistorySummaryHTML(rows) {
  const expenses=rows.filter(x=>x.type==='EXPENSE'); const incomes=rows.filter(x=>x.type==='INCOME'); const transfers=rows.filter(x=>x.type==='TRANSFER');
  const expenseSum=expenses.reduce((s,x)=>s+moneyNumber(x.amount),0); const incomeSum=incomes.reduce((s,x)=>s+moneyNumber(x.amount),0); const transferSum=transfers.reduce((s,x)=>s+moneyNumber(x.amount),0);
  const h=ensureFinanceHistoryState();
  let title='Операции'; let value=`${rows.length}`; let note=`${rows.length} операций`;
  if(h.type==='EXPENSE'||h.categoryId){title=h.categoryId ? getFinanceCategoryLabel(h.categoryId) : 'Расходы';value=formatRub(expenseSum);note=`${expenses.length} операций`}
  else if(h.type==='INCOME'){title='Поступления';value=formatRub(incomeSum);note=`${incomes.length} операций`}
  else if(h.type==='TRANSFER'){title='Переводы';value=formatRub(transferSum);note=`${transfers.length} операций`}
  else{title='Итог по фильтру';value=`−${formatRub(expenseSum)} · +${formatRub(incomeSum)}`;note=`${rows.length} операций`}
  return `<div class="finance-v2-filter-summary"><div class="muted">${escapeHTML(title)}</div><div class="finance-v2-filter-total">${value}</div><div class="muted">${escapeHTML(note)}</div></div>`;
}
function financeHistoryGroupsHTML(rows) {
  if(!rows.length)return '<div class="empty">По выбранному фильтру операций нет.</div>';
  const groups={}; rows.forEach(transaction=>{(groups[transaction.date] ||= []).push(transaction)});
  return Object.entries(groups).sort((a,b)=>b[0].localeCompare(a[0])).map(([date,list])=>`<section class="finance-v2-history-day"><h3>${escapeHTML(financeHistoryDateLabel(date))}</h3><div class="finance-list">${list.map(transaction=>renderFinanceV2TransactionRow(transaction,{compact:false})).join('')}</div></section>`).join('');
}
function renderFinanceHistoryV2(root = $('#tab-finance')) {
  if(!root)return;
  const h=ensureFinanceHistoryState(); const rows=financeHistoryTransactions();
  const typeButtons=[['ALL','Все'],['EXPENSE','Расходы'],['INCOME','Поступления'],['TRANSFER','Переводы']].map(([value,label])=>`<button class="ghost-button small ${h.type===value?'active':''}" type="button" data-finance-history-type="${value}">${label}</button>`).join('');
  const periodButtons=[['today','Сегодня'],['7d','7 дней'],['month','Месяц'],['3m','3 месяца'],['custom','Свой период']].map(([value,label])=>`<button class="ghost-button small ${h.period===value?'active':''}" type="button" data-finance-history-period="${value}">${label}</button>`).join('');
  const categories=[{value:'',label:'Все категории'},...getFinanceStateV2().categories.filter(x=>x.active&&!x.archived).map(x=>({value:x.id,label:x.name}))];
  root.innerHTML=`
    <section class="card finance-v2-history-head"><div class="card-title-row"><div><h2>История операций</h2><p class="muted">Одна база расходов, поступлений и переводов.</p></div><button class="ghost-button small" type="button" data-finance-history-back>Назад</button></div>
      <div class="finance-v2-filter-row">${typeButtons}</div><div class="finance-v2-filter-row">${periodButtons}</div>
      ${h.period==='custom'?`<div class="finance-v2-custom-period"><label>От<input type="date" data-finance-history-from value="${escapeHTML(h.dateFrom||'')}"></label><label>До<input type="date" data-finance-history-to value="${escapeHTML(h.dateTo||'')}"></label></div>`:''}
      <form class="finance-v2-history-search" data-finance-history-search-form><select name="categoryId">${financeOptionHTML(categories,h.categoryId)}</select><input name="search" value="${escapeHTML(h.search||'')}" placeholder="Поиск по описанию"><button class="ghost-button" type="submit">Найти</button></form>
      ${financeHistorySummaryHTML(rows)}
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
  root.querySelector('[data-finance-history-search-form]')?.addEventListener('submit',event=>{event.preventDefault();const fd=new FormData(event.currentTarget);const h=ensureFinanceHistoryState();h.categoryId=String(fd.get('categoryId')||'');h.search=String(fd.get('search')||'').trim();renderFinance()});
}

function renderFinance() {
  const root = $('#tab-finance');
  if (!root) return;
  if (state.financeHistoryOpen && typeof renderFinanceHistoryV2 === 'function') { renderFinanceHistoryV2(root); return; }
  const finance = getFinanceStateV2();
  const accounts = getFinanceAccounts();
  const recent = getFinanceTransactions().slice(0, 8);
  root.innerHTML = `
    <section class="card finance-v2-hero">
      <div class="card-title-row"><div><h2>Финансы</h2><p class="muted">Общий баланс всех активных счетов.</p></div></div>
      <div class="finance-v2-total">${formatRub(getFinanceTotalBalance())}</div>
      <div class="finance-v2-primary-actions"><button class="primary-button" type="button" data-finance-v2-income-add>+ Поступление</button><button class="ghost-button" type="button" data-finance-v2-transfer-add>Перевод</button></div>
    </section>

    <section class="card finance-v2-accounts-card">
      <div class="card-title-row"><div><h2>Счета</h2><p class="muted">Обычные траты идут со счёта по умолчанию.</p></div><button class="ghost-button small" type="button" data-finance-v2-account-add>+ Счёт</button></div>
      <div class="finance-v2-accounts">${accounts.map(renderFinanceV2AccountCard).join('') || '<div class="empty">Счетов пока нет.</div>'}</div>
    </section>

    <section class="card finance-v2-recent-card">
      <div class="card-title-row"><div><h2>Последние операции</h2><p class="muted">Последние расходы, поступления и переводы.</p></div></div>
      <div class="finance-list">${recent.length ? recent.map(transaction => renderFinanceV2TransactionRow(transaction)).join('') : '<div class="empty">Операций пока нет.</div>'}</div>
      <button class="ghost-button finance-v2-history-button" type="button" data-finance-v2-history-open>Вся история</button>
    </section>
  `;
  bindFinanceV2Screen(root);
}

function renderFinanceGoalsForm(context) {
  const goals = parseFinanceGoals(context.savingGoal);
  const goalCard = (index) => {
    const goal = goals[index] || {};
    const n = index + 1;
    return `
      <div class="finance-goal-card">
        <div class="finance-goals-head">Цель ${n}</div>
        <label>Что нужно<input name="goalTitle${n}" placeholder="Напр. собрать компьютер" value="${escapeHTML(goal.title || '')}"></label>
        <label>Сумма<input name="goalAmount${n}" placeholder="Напр. 80000 ₽" value="${escapeHTML(goal.amount || '')}"></label>
        <label>Срок<input name="goalTerm${n}" placeholder="Напр. 3–4 месяца / до декабря" value="${escapeHTML(goal.term || '')}"></label>
        <label>Комментарий<input name="goalComment${n}" placeholder="Приоритет, условия, что важно учесть" value="${escapeHTML(goal.comment || '')}"></label>
      </div>
    `;
  };
  return `
    <form class="finance-goals-list" data-finance-goals-form>
      ${[0, 1, 2].map(goalCard).join('')}
      <button class="primary-button" type="submit">Сохранить цели</button>
    </form>
  `;
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

function serializeFinanceGoals(fd) {
  const goals = [];
  for (let n = 1; n <= 3; n += 1) {
    const title = String(fd.get(`goalTitle${n}`) || '').trim();
    const amount = String(fd.get(`goalAmount${n}`) || '').trim();
    const term = String(fd.get(`goalTerm${n}`) || '').trim();
    const comment = String(fd.get(`goalComment${n}`) || '').trim();
    if (!title && !amount && !term && !comment) continue;
    goals.push(`Цель: ${title || 'не указана'}${amount ? ` | Сумма: ${amount}` : ''}${term ? ` | Срок: ${term}` : ''}${comment ? ` | Комментарий: ${comment}` : ''}`);
  }
  return goals.join('\n');
}

function splitFinanceGoals(value) {
  return parseFinanceGoals(value).map(goal => [goal.title, goal.amount, goal.term, goal.comment].filter(Boolean).join(' · '));
}

function renderFinanceNoExpensesButton() {
  return '';
}

function renderFinanceDaySummary(summary) {
  return `
    <div class="finance-day-summary">
      <div class="stat-card"><div class="muted">Потрачено за день</div><div class="stat-value small-stat">${formatRub(summary.total)}</div><div class="muted">Записей: ${summary.count}</div></div>
      <div class="stat-card"><div class="muted">Еда</div><div class="stat-value small-stat">${formatRub(summary.food)}</div></div>
      <div class="stat-card"><div class="muted">Транспорт</div><div class="stat-value small-stat">${formatRub(summary.transport)}</div></div>
      <div class="stat-card"><div class="muted">Другое</div><div class="stat-value small-stat">${formatRub(summary.other)}</div></div>
    </div>`;
}

function renderFinancePlanForm(type) {
  const today = state.selectedDate;
  const titleLabel = type === 'income' ? 'Источник' : 'Что оплатить';
  const placeholder = type === 'income' ? 'З/п, подработка' : 'Аренда, связь, транспорт';
  return `
    <form class="form-grid finance-plan" data-finance-plan-form="${type}">
      <label>Сумма, ₽<input name="amount" required inputmode="decimal" placeholder="Напр. 5000"></label>
      <label>Дата${renderDateControl('date', today)}</label>
      <label>${titleLabel}<input name="title" placeholder="${placeholder}"></label>
      <label>Комментарий<input name="comment" placeholder="Необязательно"></label>
      <button class="primary-button" type="submit">Добавить</button>
    </form>
  `;
}

function getPlanItemStatusText(item, type) {
  if (type === 'income' && item.status === 'received') return 'получено';
  if (type === 'obligation' && item.status === 'paid') return 'оплачено';
  const today = toISODate(new Date());
  if (item.date && item.date < today) return type === 'income' ? 'просрочено' : 'просрочен';
  if (item.date === today) return 'сегодня';
  return 'ожидается';
}

function renderFinancePlanList(type) {
  const context = getFinanceContext();
  const list = type === 'income' ? context.incomes : context.obligations;
  const doneStatus = type === 'income' ? 'received' : 'paid';
  const active = list.filter(item => item.status !== doneStatus);
  if (!active.length) return `<div class="empty">${type === 'income' ? 'Активных поступлений пока нет.' : 'Активных обязательных расходов пока нет.'}</div>`;
  const sorted = [...active].sort((a, b) => String(a.date || '9999-99-99').localeCompare(String(b.date || '9999-99-99')));
  return sorted.map(item => `
      <article class="finance-card">
        <div class="item-top">
          <div>
            <div class="badge-row">
              <span class="badge important">${item.date ? shortDate(item.date) : 'без даты'}</span>
              <span class="badge secondary">${escapeHTML(getPlanItemStatusText(item, type))}</span>
            </div>
            <h3>${type === 'income' ? '+' : '−'}${formatRub(item.amount)}</h3>
            <p class="muted">${escapeHTML(item.title || (type === 'income' ? 'Поступление' : 'Расход'))}${item.comment ? ` · ${escapeHTML(item.comment)}` : ''}</p>
          </div>
          <div class="actions">
            <button class="primary-button" data-finance-plan-complete="${item.id}" data-plan-type="${type}">${type === 'income' ? 'Получено' : 'Оплачено'}</button>
            <button class="ghost-button" data-finance-plan-edit="${item.id}" data-plan-type="${type}">Изм.</button>
            <button class="danger-button" data-finance-plan-delete="${item.id}" data-plan-type="${type}">Удал.</button>
          </div>
        </div>
      </article>
    `).join('');
}

function renderFinanceOperationsHistory() {
  const operations = [...getFinanceContext().operations].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))).slice(0, 80);
  if (!operations.length) return '<div class="empty">История пока пустая.</div>';
  const typeLabel = {
    expense: 'трата',
    income: 'поступление',
    obligation: 'обязательный расход',
    adjustment: 'корректировка'
  };
  return operations.map(op => `
    <article class="finance-card operation-card">
      <div class="item-top">
        <div>
          <div class="badge-row"><span class="badge secondary">${escapeHTML(typeLabel[op.type] || 'операция')}</span><span class="badge">${shortDate(op.date)}</span></div>
          <h3>${moneyNumber(op.amount) > 0 ? '+' : ''}${formatRub(op.amount)}</h3>
          <p class="muted">${escapeHTML(op.title || 'Операция')}${op.comment ? ` · ${escapeHTML(op.comment)}` : ''}</p>
        </div>
        <div class="actions">
          ${op.type === 'adjustment' ? `<button class="danger-button" data-finance-operation-delete="${op.id}">Удал.</button>` : ''}
        </div>
      </div>
    </article>
  `).join('');
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

function openFinanceHelpDialog() {
  openInfoDialog({
    title: 'Как быстро заполнять финансы',
    message: `Заполняй только то, что реально поможет потом получить хороший анализ от GPT.\n\nМинимум: сумма и категория.\nПричина нужна, когда трата связана с состоянием: стресс, усталость, импульс, награда или лень.\nКомментарий нужен только если без него потом будет непонятно, что это было.\n\nПример: 350 ₽ · Еда · Стресс · купил перекус вечером.\n\nНе нужно превращать это в бухгалтерию: банковские счета, чеки и сложные бюджеты здесь специально не добавлены.`
  });
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
  bindClick(root, '#copyDataBtn', () => copyText(JSON.stringify(app, null, 2)));
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
      <label>Приоритет<select name="priority">
        <option value="critical">Критично</option>
        <option value="important" selected>Важно</option>
        <option value="secondary">Второстепенно</option>
      </select></label>
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
          <div>
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
    return `<button class="ghost-button" style="justify-content:flex-start;border-radius:14px;min-height:auto;padding:10px;text-align:left" data-tab-target="important"><span>${escapeHTML(item.title)}<br><span class="muted">${escapeHTML(status.text)} · ${shortDate(item.date)}</span></span></button>`;
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
        priority: fd.get('priority') || 'important',
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

  $$('[data-quick-finance-category]', root).forEach(btn => {
    btn.onclick = () => {
      const form = btn.closest('.card')?.querySelector('[data-finance-form]') || $('[data-finance-form]', root);
      const select = form?.querySelector('select[name="category"]');
      const amount = form?.querySelector('input[name="amount"]');
      if (select) select.value = btn.dataset.quickFinanceCategory;
      if (amount) amount.focus();
    };
  });

  $$('[data-finance-form]', root).forEach(form => {
    form.onsubmit = event => {
      event.preventDefault();
      const fd = new FormData(form);
      const amount = normalizeMoneyInput(fd.get('amount'));
      if (!amount) return;
      const day = getFinance();
      day.noExpenses = false;
      const expense = {
        id: uid('exp'),
        amount,
        category: normalizeFinanceCategory(fd.get('category')),
        reason: normalizeFinanceReason(fd.get('reason')),
        comment: String(fd.get('comment') || '').trim(),
        time: fd.get('time') || '',
        createdAt: new Date().toISOString()
      };
      day.expenses.push(expense);
      addAvailableBalance(-moneyNumber(amount));
      addFinanceOperation('expense', -moneyNumber(amount), getFinanceCategoryLabel(expense.category), expense.comment, expense.id, state.selectedDate);
      markChanged();
      showToast('Трата добавлена');
    };
  });

  $$('[data-finance-delete]', root).forEach(btn => {
    btn.onclick = async () => {
      if (!await openConfirmDialog('Удалить трату?')) return;
      const day = getFinance();
      const expense = day.expenses.find(item => item.id === btn.dataset.financeDelete);
      if (expense) addAvailableBalance(moneyNumber(expense.amount));
      day.expenses = day.expenses.filter(expense => expense.id !== btn.dataset.financeDelete);
      getFinanceContext().operations = getFinanceContext().operations.filter(op => op.sourceId !== btn.dataset.financeDelete);
      markChanged();
    };
  });

  $$('[data-finance-edit]', root).forEach(btn => {
    btn.onclick = async () => {
      const expense = getFinance().expenses.find(item => item.id === btn.dataset.financeEdit);
      if (!expense) return;
      const result = await openEditDialog({
        title: 'Изменить трату',
        fields: [
          { name: 'amount', label: 'Сумма, ₽', value: expense.amount || '', placeholder: 'Напр. 250' },
          { name: 'category', label: 'Категория', type: 'select', value: expense.category, options: FINANCE_CATEGORIES },
          { name: 'reason', label: 'Причина', type: 'select', value: expense.reason || '', options: FINANCE_REASONS },
          { name: 'comment', label: 'Комментарий', value: expense.comment || '', placeholder: 'Необязательно' },
          { name: 'time', label: 'Время', type: 'time', value: expense.time || '' }
        ]
      });
      if (!result) return;
      const amount = normalizeMoneyInput(result.amount);
      if (!amount) return;
      const oldAmount = moneyNumber(expense.amount);
      expense.amount = amount;
      expense.category = normalizeFinanceCategory(result.category);
      expense.reason = normalizeFinanceReason(result.reason);
      expense.comment = String(result.comment || '').trim();
      expense.time = String(result.time || '').trim();
      addAvailableBalance(oldAmount - moneyNumber(amount));
      const op = getFinanceContext().operations.find(item => item.sourceId === expense.id && item.type === 'expense');
      if (op) {
        op.amount = String(-moneyNumber(amount));
        op.title = getFinanceCategoryLabel(expense.category);
        op.comment = expense.comment;
      }
      markChanged();
    };
  });


  $$('[data-finance-context-form]', root).forEach(form => {
    form.onsubmit = event => {
      event.preventDefault();
      const fd = new FormData(form);
      const context = getFinanceContext();
      const diff = applyBalanceCorrection(fd.get('availableBalance'));
      context.reserveBalance = normalizeMoneyInput(fd.get('reserveBalance'));
      markChanged();
      showToast(diff ? `Баланс обновлён: ${diff > 0 ? '+' : ''}${formatRub(diff)}` : 'Баланс сохранён');
    };
  });

  $$('[data-finance-goals-form]', root).forEach(form => {
    form.onsubmit = event => {
      event.preventDefault();
      const context = getFinanceContext();
      context.savingGoal = serializeFinanceGoals(new FormData(form));
      markChanged();
      showToast('Финансовые цели сохранены');
    };
  });

  $$('[data-finance-plan-form]', root).forEach(form => {
    form.onsubmit = event => {
      event.preventDefault();
      const fd = new FormData(form);
      const amount = normalizeMoneyInput(fd.get('amount'));
      if (!amount) return;
      const item = {
        id: uid(form.dataset.financePlanForm === 'income' ? 'inc' : 'obl'),
        amount,
        date: normalizeDateInput(fd.get('date')),
        title: String(fd.get('title') || '').trim(),
        comment: String(fd.get('comment') || '').trim(),
        status: 'planned',
        completedAt: '',
        createdAt: new Date().toISOString()
      };
      const context = getFinanceContext();
      if (form.dataset.financePlanForm === 'income') context.incomes.push(item);
      else context.obligations.push(item);
      markChanged();
      showToast(form.dataset.financePlanForm === 'income' ? 'Поступление добавлено' : 'Обязательный расход добавлен');
    };
  });

  $$('[data-finance-plan-complete]', root).forEach(btn => {
    btn.onclick = () => {
      const context = getFinanceContext();
      const type = btn.dataset.planType;
      const key = type === 'income' ? 'incomes' : 'obligations';
      const item = context[key].find(entry => entry.id === btn.dataset.financePlanComplete);
      if (!item || item.status !== 'planned') return;
      item.status = type === 'income' ? 'received' : 'paid';
      item.completedAt = new Date().toISOString();
      const amount = moneyNumber(item.amount);
      if (type === 'income') {
        addAvailableBalance(amount);
        addFinanceOperation('income', amount, item.title || 'Поступление', item.comment, item.id, item.date || state.selectedDate);
        showToast('Поступление добавлено в баланс');
      } else {
        addAvailableBalance(-amount);
        addFinanceOperation('obligation', -amount, item.title || 'Обязательный расход', item.comment, item.id, item.date || state.selectedDate);
        showToast('Обязательный расход списан');
      }
      markChanged();
    };
  });

  $$('[data-finance-operation-delete]', root).forEach(btn => {
    btn.onclick = async () => {
      const context = getFinanceContext();
      const op = context.operations.find(item => item.id === btn.dataset.financeOperationDelete);
      if (!op || op.type !== 'adjustment') return;
      if (!await openConfirmDialog('Удалить корректировку баланса?')) return;
      addAvailableBalance(-moneyNumber(op.amount));
      context.operations = context.operations.filter(item => item.id !== op.id);
      markChanged();
      showToast('Корректировка удалена');
    };
  });

  $$('[data-finance-plan-delete]', root).forEach(btn => {
    btn.onclick = async () => {
      if (!await openConfirmDialog(btn.dataset.planType === 'income' ? 'Удалить плановое поступление?' : 'Удалить обязательный расход?')) return;
      const context = getFinanceContext();
      const key = btn.dataset.planType === 'income' ? 'incomes' : 'obligations';
      context[key] = context[key].filter(item => item.id !== btn.dataset.financePlanDelete);
      markChanged();
    };
  });

  $$('[data-finance-plan-edit]', root).forEach(btn => {
    btn.onclick = async () => {
      const context = getFinanceContext();
      const key = btn.dataset.planType === 'income' ? 'incomes' : 'obligations';
      const item = context[key].find(entry => entry.id === btn.dataset.financePlanEdit);
      if (!item) return;
      const result = await openEditDialog({
        title: btn.dataset.planType === 'income' ? 'Изменить поступление' : 'Изменить обязательный расход',
        fields: [
          { name: 'amount', label: 'Сумма, ₽', value: item.amount || '', placeholder: 'Напр. 5000' },
          { name: 'date', label: 'Дата', type: 'date', value: item.date || state.selectedDate },
          { name: 'title', label: btn.dataset.planType === 'income' ? 'Источник' : 'Что оплатить', value: item.title || '' },
          { name: 'comment', label: 'Комментарий', value: item.comment || '', placeholder: 'Необязательно' }
        ]
      });
      if (!result) return;
      const amount = normalizeMoneyInput(result.amount);
      if (!amount) return;
      item.amount = amount;
      item.date = normalizeDateInput(result.date);
      item.title = String(result.title || '').trim();
      item.comment = String(result.comment || '').trim();
      markChanged();
    };
  });

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
    const exportObject = normalizeData(JSON.parse(JSON.stringify(app)));
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

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result || '{}'));
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
  app = normalizeData(normalized);
  app.meta.appVersion = APP_VERSION;
  app.meta.lastModified = new Date().toISOString();
  app.meta.changeCounter = Number(app.meta.changeCounter || 0) + 1;
  saveData(app, false);
  renderAll();
  showToast('Данные импортированы');
}

function buildGptReport() {
  const monday = getMondayISO(state.selectedDate);
  const context = getFinanceContext();
  const formatPlan = (items, type) => items.length
    ? [...items].sort((a, b) => String(a.date || '9999-99-99').localeCompare(String(b.date || '9999-99-99'))).map(item => {
        const status = type === 'income'
          ? (item.status === 'received' ? 'получено' : getPlanItemStatusText(item, 'income'))
          : (item.status === 'paid' ? 'оплачено' : getPlanItemStatusText(item, 'obligation'));
        return `  - ${item.date ? shortDate(item.date) : 'без даты'} · ${formatRub(item.amount)} · ${item.title || (type === 'income' ? 'поступление' : 'обязательный расход')} · ${status}${item.comment ? ` · ${item.comment}` : ''}`;
      }).join('\n')
    : '  - не указаны';
  const incomeLines = formatPlan(context.incomes, 'income');
  const obligationLines = formatPlan(context.obligations, 'obligation');
  const operationLines = context.operations.length
    ? context.operations.slice(0, 40).map(op => `  - ${shortDate(op.date)} · ${op.type} · ${moneyNumber(op.amount) > 0 ? '+' : ''}${formatRub(op.amount)} · ${op.title || 'операция'}${op.comment ? ` · ${op.comment}` : ''}`).join('\n')
    : '  - операций пока нет';
  const lines = [`Отчёт TSB Hub за неделю ${shortDate(monday)} — ${shortDate(addDays(monday, 6))}`];
  const goalLines = context.savingGoal ? context.savingGoal.split('\n').map(line => `  - ${line}`).join('\n') : '  - не указано';
  const accountLines = getFinanceAccounts().length ? getFinanceAccounts().map(account => `  - ${account.name}: ${formatRub(getFinanceAccountBalance(account.id))}`).join('\n') : '  - нет активных счетов';
  lines.push(`\nФинансовый контекст:\n  Всего на счетах: ${formatRub(getFinanceTotalBalance())}\
  Счета:\
${accountLines}\n  Legacy-резерв (не включён в счета): ${context.reserveBalance ? formatRub(context.reserveBalance) : 'не указано'}\n  Финансовые цели:\n${goalLines}\n  Плановые поступления:\n${incomeLines}\n  Обязательные расходы:\n${obligationLines}\n  История операций / корректировки:\n${operationLines}`);
  const currentPlan = getGptPlan();
  if (currentPlan.text) {
    lines.push(`\nТекущий план от GPT на эту неделю уже сохранён в приложении:\n${currentPlan.text}`);
  }
  for (let i = 0; i < 7; i += 1) {
    const iso = addDays(monday, i);
    const health = getHealth(iso);
    const tasks = getTasks(iso);
    const progress = getProgress(iso);
    const finance = getFinance(iso);
    const financeSummary = getFinanceSummary(iso);
    const report = getDailyReport(iso);
    const reportLine = hasDailyReport(iso)
      ? `самоощущение ${report.selfScore || '—'}/100, желание действовать ${report.driveScore || '—'}/100, итог: ${report.text || 'без текста'}`
      : 'не заполнен';
    const mealLines = health.meals.length
      ? health.meals.map(meal => `    - ${meal.time || 'без времени'} · ${meal.name}${meal.amount ? ` (${meal.amount})` : ''}`).join('\n')
      : '    - питания не записано';
    const taskLines = tasks.length
      ? tasks.map(task => `    - [${task.done ? 'x' : ' '}] ${PRIORITIES[task.priority] || 'Важно'}: ${task.text}`).join('\n')
      : '    - задач нет';
    const financeLines = finance.expenses.length
      ? finance.expenses.map(expense => `    - ${expense.time || 'без времени'} · ${getFinanceCategoryLabel(expense.category)} · ${formatRub(expense.amount)}${getFinanceReasonLabel(expense.reason) ? ` · причина: ${getFinanceReasonLabel(expense.reason)}` : ''}${expense.comment ? ` · ${expense.comment}` : ''}`).join('\n')
      : (finance.noExpenses ? '    - день отмечен без трат' : '    - трат не записано');
    lines.push(`\n${WEEKDAY_SHORT[i]} · ${formatHumanDate(iso)}\n  Ежедневный отчёт: ${reportLine}\n  Задачи: ${progress.done}/${progress.total}, выполнение ${progress.pct}%\n${taskLines}\n  Питание:\n${mealLines}\n  Вес: ${health.weight ? `${health.weight} кг` : 'не указан'}\n  Активность: ${health.activityNote || 'не указана'}\n  Заметка: ${health.note || 'нет'}\n  Финансы: всего ${formatRub(financeSummary.total)}, еда ${formatRub(financeSummary.food)}, транспорт ${formatRub(financeSummary.transport)}, другое ${formatRub(financeSummary.other)}, эмоциональные/импульсивные траты ${formatRub(financeSummary.impulse)}\n${financeLines}\n  Локальные подсказки:\n${getLocalInsightsReportText(iso)}`);
  }
  lines.push("\nЗапрос к GPT: проанализируй все данные недели в контексте TSB Hub: задачи, незавершёнку, питание, вес, активность, заметки, локальные подсказки, дневные траты, дни без трат, ежедневные отчёты, живой баланс, активы/резерв, операции, корректировки баланса, плановые поступления, обязательные расходы и финансовые цели. Сам оцени финансовую ситуацию пользователя на следующую неделю и объясни вывод по данным. Не дави предупреждениями о нехватке денег: если денег не хватает, дай спокойный практический план без морализаторства. Проверь, где можно сократить расходы без вреда для базовых нужд, отдельно разберись с едой, транспортом, импульсивными/стрессовыми тратами и днями перегруза. Составь план на следующую неделю по дням: деньги, питание, задачи, отдых/нагрузка. Любые идеи по накоплениям и вложениям предлагай только если после обязательных расходов, еды, транспорта и минимального резерва реально остаются свободные деньги. Учитывай несколько финансовых целей и предложи реалистичный месячный доход/накопление, если данных хватает. В конце дай структурированный блок 'План на неделю' и отдельные блоки 'Совет на сегодня', 'Финансовые советы', 'Советы по питанию', 'Советы по задачам', чтобы их можно было вставить обратно в TSB Hub.");
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


function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // Начиная с 0.7 service worker включён даже в dev-сборках, потому что мы тестируем PWA через GitHub Pages.
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js?v=0.8.21-dev')
      .then(registration => {
        registration.addEventListener('updatefound', () => {
          const worker = registration.installing;
          if (!worker) return;
          worker.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) {
              showToast('Доступна новая версия. Обнови страницу.');
            }
          });
        });
      })
      .catch(error => console.warn('Service worker не зарегистрирован:', error));
  });
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
  setupMobileTabMenu();

  registerServiceWorker();
}

setupEvents();
renderAll();
