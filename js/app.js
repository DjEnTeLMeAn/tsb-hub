const APP_VERSION = '0.8.12-dev';
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

let app = loadData();
let state = {
  selectedDate: toISODate(new Date()),
  calendarMonth: startOfMonth(new Date()),
  activeTab: 'today'
};
let toastTimer = null;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

function createDefaultData() {
  const now = new Date().toISOString();
  return {
    meta: {
      appVersion: APP_VERSION,
      dataVersion: 2,
      createdAt: now,
      lastModified: now,
      lastExported: '',
      deviceId: getOrCreateDeviceId(),
      changeCounter: 0
    },
    tasks: {},
    health: {},
    finance: {},
    financeContext: {
      availableBalance: '',
      savingGoal: '',
      incomes: [],
      obligations: []
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
      return normalizeData(JSON.parse(raw));
    } catch (error) {
      console.warn('Не удалось прочитать новое хранилище, создана пустая база.', error);
    }
  }
  const data = createDefaultData();
  migrateOldLocalStorage(data);
  saveData(data, false);
  return data;
}

function normalizeData(data) {
  const defaults = createDefaultData();
  data = data || {};
  if (!data.meta) data.meta = {};
  return {
    ...defaults,
    ...data,
    meta: { ...defaults.meta, ...(data.meta || {}), appVersion: APP_VERSION, dataVersion: defaults.meta.dataVersion },
    tasks: data.tasks || {},
    health: data.health || {},
    finance: normalizeFinance(data.finance),
    financeContext: normalizeFinanceContext(data.financeContext),
    gptPlans: normalizeGptPlans(data.gptPlans),
    importantDates: Array.isArray(data.importantDates) ? data.importantDates : [],
    settings: { ...defaults.settings, ...(data.settings || {}) },
    archives: data.archives || {}
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
function normalizeFinance(value) {
  if (!value || typeof value !== 'object') return {};
  const result = {};
  Object.entries(value).forEach(([iso, day]) => {
    const expenses = Array.isArray(day?.expenses) ? day.expenses : [];
    result[iso] = {
      expenses: expenses.map(expense => ({
        id: expense.id || uid('exp'),
        amount: normalizeMoneyInput(expense.amount || expense.sum || ''),
        category: normalizeFinanceCategory(expense.category),
        reason: normalizeFinanceReason(expense.reason),
        comment: expense.comment || '',
        time: expense.time || '',
        createdAt: expense.createdAt || new Date().toISOString()
      })).filter(expense => expense.amount)
    };
  });
  return result;
}


function normalizeFinanceContext(value) {
  const defaults = createDefaultData().financeContext;
  const source = value && typeof value === 'object' ? value : {};
  const normalizePlanItem = (item, prefix) => ({
    id: item?.id || uid(prefix),
    amount: normalizeMoneyInput(item?.amount || item?.sum || ''),
    date: /^\d{4}-\d{2}-\d{2}$/.test(item?.date || '') ? item.date : '',
    title: String(item?.title || item?.source || item?.category || '').trim(),
    comment: String(item?.comment || '').trim(),
    createdAt: item?.createdAt || new Date().toISOString()
  });
  return {
    ...defaults,
    ...source,
    availableBalance: normalizeMoneyInput(source.availableBalance || source.balance || ''),
    savingGoal: String(source.savingGoal || '').trim(),
    incomes: Array.isArray(source.incomes) ? source.incomes.map(item => normalizePlanItem(item, 'inc')).filter(item => item.amount || item.title || item.date) : [],
    obligations: Array.isArray(source.obligations) ? source.obligations.map(item => normalizePlanItem(item, 'obl')).filter(item => item.amount || item.title || item.date) : []
  };
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
      ${plan.text ? `<div class="gpt-plan-preview">${nl2br(getPlanPreviewText(getGptAdviceText(kind), kind === 'today' ? 320 : 360))}</div>` : '<div class="empty">План от GPT ещё не вставлен. После отчёта здесь будут ежедневные советы.</div>'}
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

function getFinance(iso = state.selectedDate) {
  if (!app.finance) app.finance = {};
  if (!app.finance[iso]) app.finance[iso] = { expenses: [] };
  if (!Array.isArray(app.finance[iso].expenses)) app.finance[iso].expenses = [];
  return app.finance[iso];
}

function normalizeFinanceCategory(value) {
  return FINANCE_CATEGORIES.some(item => item.value === value) ? value : 'other';
}

function normalizeFinanceReason(value) {
  return FINANCE_REASONS.some(item => item.value === value) ? value : '';
}

function getFinanceCategoryLabel(value) {
  return FINANCE_CATEGORIES.find(item => item.value === value)?.label || 'Другое';
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
  const expenses = getFinance(iso).expenses;
  const sumBy = predicate => expenses.filter(predicate).reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  const total = expenses.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  const food = sumBy(item => item.category === 'food');
  const transport = sumBy(item => item.category === 'transport');
  const impulse = sumBy(item => ['impulse', 'stress', 'tired', 'lazy', 'reward'].includes(item.reason));
  const other = Math.max(0, total - food - transport);
  return { total, food, transport, other, impulse, count: expenses.length };
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
  const balance = Number(context.availableBalance || 0);
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

  if (week.totalSpent > 0) {
    const foodShare = week.totalSpent ? Math.round((week.foodSpent / week.totalSpent) * 100) : 0;
    if (foodShare >= 60 && week.foodSpent >= 1000) {
      insights.push({ tone: 'warn', title: 'Еда занимает большую часть трат недели', text: `За неделю на еду ушло ${formatRub(week.foodSpent)} из ${formatRub(week.totalSpent)} (${foodShare}%). Стоит заранее выбрать простые и недорогие блюда на несколько дней.` });
    } else if (week.foodSpent > 0) {
      insights.push({ tone: 'soft', title: 'Есть база для анализа питания и денег', text: `За неделю: еда ${formatRub(week.foodSpent)}, всего трат ${formatRub(week.totalSpent)}. Данных уже достаточно для более точного недельного плана.` });
    }
  }

  if (week.emotionalCount >= 3 || week.emotionalSpent >= 1000) {
    insights.push({ tone: 'warn', title: 'Повторяются эмоциональные траты', text: `За неделю отмечено ${week.emotionalCount} эмоциональных трат на ${formatRub(week.emotionalSpent)}. Перед следующей покупкой лучше сделать паузу и выбрать более дешёвый способ снять напряжение.` });
  } else if (week.emotionalCount > 0) {
    insights.push({ tone: 'soft', title: 'Эмоциональные траты уже отслеживаются', text: `За неделю таких записей: ${week.emotionalCount}. Продолжай отмечать причины — так будет видно, какие состояния чаще всего ведут к расходам.` });
  }

  if (week.topExpenseDay?.summary?.total >= 1000) {
    insights.push({ tone: 'soft', title: 'Есть день с заметными расходами', text: `${shortDate(week.topExpenseDay.iso)} потрачено ${formatRub(week.topExpenseDay.summary.total)}. Стоит отдельно проверить этот день: задачи, питание, усталость и заметки.` });
  }

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

  if (impulseCount >= 2) {
    insights.push({ tone: 'warn', title: 'Много эмоциональных трат за день', text: `За день отмечено ${impulseCount} эмоциональных трат. Перед следующей покупкой лучше сделать короткую паузу.` });
  }
  if (financeSummary.food >= 700) {
    insights.push({ tone: 'warn', title: 'Еда сегодня заметно тянет бюджет', text: `На еду уже ушло ${formatRub(financeSummary.food)}. Лучше выбрать простой домашний вариант и не усложнять готовку.` });
  }

  if (balance > 0 && weekObligationTotal > 0 && weekObligationTotal > balance) {
    insights.push({ tone: 'critical', title: 'Обязательные расходы выше доступного остатка', text: `На ближайшие 7 дней обязательных расходов: ${formatRub(weekObligationTotal)}, доступно: ${formatRub(balance)}. Нужен осторожный план без лишних покупок.` });
  } else if (balance > 0 && weekObligationTotal > 0 && netAfterPlans < 0) {
    insights.push({ tone: 'critical', title: 'После плановых денег всё равно минус', text: `Баланс + ближайшие поступления − обязательные расходы = ${formatRub(netAfterPlans)}. Нужен максимально осторожный план недели.` });
  } else if (balance > 0 && netAfterPlans <= 0) {
    insights.push({ tone: 'soft', title: 'Деньги нужно вести осторожно', text: nextIncome ? `Ближайшее поступление: ${shortDate(nextIncome.date)} · ${formatRub(nextIncome.amount)}. План лучше строить от обязательных расходов, еды и транспорта до этой даты.` : 'План лучше строить от обязательных расходов, еды и транспорта.' });
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
  const items = getLocalInsights(iso).map(item => `
    <article class="insight-item ${item.tone}">
      <div class="insight-dot" aria-hidden="true"></div>
      <div><h3>${escapeHTML(item.title)}</h3><p>${escapeHTML(item.text)}</p></div>
    </article>
  `).join('');
  return `
    <section class="card insight-card ${compact ? 'compact' : ''}">
      <div class="card-title-row"><div><h2>Локальные подсказки</h2><p class="muted">Короткие сигналы по выбранному дню и неделе.</p></div></div>
      <div class="insight-list">${items}</div>
    </section>
  `;
}

function getLocalInsightsReportText(iso = state.selectedDate) {
  return getLocalInsights(iso).map(item => `  - ${item.title}: ${item.text}`).join('\n') || '  - нет подсказок';
}

function renderCollapsedBlock(title, content, countText = '', options = {}) {
  const body = String(content || '').trim() || '<div class="empty">Пока нет записей.</div>';
  const safeTitle = escapeHTML(title);
  const suffix = countText ? ` · ${escapeHTML(countText)}` : '';
  const openAttr = options.open ? ' open' : '';
  return `<details class="collapsible-list today-details"${openAttr}><summary>${safeTitle}${suffix}</summary>${body}</details>`;
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

function setTab(tab) {
  state.activeTab = tab;
  document.body.dataset.activeTab = tab;
  $$('.tab-button').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
  $$('.tab-page').forEach(page => page.classList.toggle('active', page.id === `tab-${tab}`));
  renderAll();
}

function renderAll() {
  document.body.dataset.activeTab = state.activeTab;
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
    const hasData = (app.tasks[iso]?.length || 0) > 0 || (app.health[iso]?.meals?.length || 0) > 0 || app.health[iso]?.weight || (app.finance?.[iso]?.expenses?.length || 0) > 0;
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

function renderToday() {
  const root = $('#tab-today');
  if (!root) return;
  const health = getHealth();
  const weeklyWeightISO = getWeeklyWeightISO(state.selectedDate);
  const weeklyWeight = getHealth(weeklyWeightISO).weight;
  const progress = getProgress();
  const important = getImportantPreview(3);
  const financeSummary = getFinanceSummary();
  const financeContext = getFinanceContext();
  const nextIncome = getNextIncome();
  const gptPlan = getGptPlan();
  const pastTasks = app.settings.showOverdueOnToday ? getPendingPastTasksHTML() : '';
  const windowDays = Number(app.settings.pastTasksWindowDays || 14);
  const overdueCount = pastTasks ? (pastTasks.match(/class="task-card/g) || []).length : 0;
  const overdueSection = app.settings.showOverdueOnToday ? `
      <div class="card today-list-card">
        <div class="card-title-row"><h2>Незавершённое за прошлые дни</h2><button class="ghost-button small" data-tab-target="settings">Настроить</button></div>
        ${renderCollapsedBlock('Показать незавершённые задачи', `<div class="task-list">${pastTasks || '<div class="empty">Незавершённых задач за выбранный период нет.</div>'}</div>`, overdueCount ? `${overdueCount} · ${windowDays} дн.` : `${windowDays} дн.`)}
      </div>` : '';
  root.innerHTML = `
    <section class="card">
      <div class="card-title-row">
        <div>
          <h2>${state.selectedDate === toISODate(new Date()) ? 'Сегодня' : 'День'} · ${formatHumanDate(state.selectedDate)}</h2>
          <p class="muted">Краткая сводка выбранного дня.</p>
        </div>
      </div>
      <div class="grid-4">
        <div class="stat-card"><div class="muted">Выполнение задач</div><div class="stat-value">${progress.pct}%</div><div class="progress"><span style="width:${progress.pct}%"></span></div></div>
        <div class="stat-card"><div class="muted">Задачи</div><div class="stat-value">${progress.done}/${progress.total}</div></div>
        <div class="stat-card"><div class="muted">Вес недели</div><div class="stat-value">${weeklyWeight ? `${escapeHTML(weeklyWeight)} кг` : '—'}</div><div class="muted">замер: ${shortDate(weeklyWeightISO)}</div></div>
        <div class="stat-card"><div class="muted">Траты</div><div class="stat-value">${formatRub(financeSummary.total)}</div></div>
      </div>
    </section>

    ${renderLocalInsights(state.selectedDate, true)}

    <section class="grid-2">
      <div class="card today-input-card">
        <div class="card-title-row"><h2>Задачи дня</h2><button class="ghost-button small" data-tab-target="plans">Планы</button></div>
        ${renderTaskAddForm(state.selectedDate, 'today')}
        ${renderCollapsedBlock('Показать задачи дня', `<div class="task-list" style="margin-top:12px">${renderTaskList(state.selectedDate, true)}</div>`, `${progress.total}`)}
      </div>
      <div class="card today-input-card">
        <div class="card-title-row"><h2>Питание дня</h2><button class="ghost-button small" data-tab-target="food">Питание</button></div>
        ${renderMealAddForm('today')}
        ${renderCollapsedBlock('Показать питание дня', `<div class="meal-list" style="margin-top:12px">${renderMealList(state.selectedDate)}</div>`, `${health.meals.length}`)}
      </div>
      <div class="card today-input-card today-finance-card">
        <div class="card-title-row"><h2>Финансы дня</h2><button class="ghost-button small" data-tab-target="finance">Финансы</button></div>
        <div class="finance-summary-line">Доступно сейчас: ${financeContext.availableBalance ? formatRub(financeContext.availableBalance) : 'не указано'}${nextIncome ? ` · ближайшее поступление: ${shortDate(nextIncome.date)} — ${formatRub(nextIncome.amount)}` : ''}</div>
        ${renderFinanceQuickForm('today')}
        <div class="finance-summary-line">Потрачено за день: ${formatRub(financeSummary.total)} · еда: ${formatRub(financeSummary.food)} · транспорт: ${formatRub(financeSummary.transport)} · другое: ${formatRub(financeSummary.other)}</div>
        ${renderCollapsedBlock('Показать операции дня', `<div class="finance-list" style="margin-top:12px">${renderFinanceList(state.selectedDate, true)}</div>`, `${financeSummary.count}`)}
      </div>
      ${renderGptAdviceCard('today')}
    </section>

    <section class="grid-2">
      <div class="card today-list-card">
        <div class="card-title-row"><h2>Ближайшие важные даты</h2><button class="ghost-button small" data-tab-target="important">Все</button></div>
        ${renderCollapsedBlock('Показать ближайшие даты', `<div class="important-list">${important || '<div class="empty">Важных дат пока нет.</div>'}</div>`)}
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
    const tasksBlock = `<details class="collapsible-list day-task-details">
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
    ${renderLocalInsights(state.selectedDate, true)}

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


function renderFinance() {
  const root = $('#tab-finance');
  if (!root) return;
  const summary = getFinanceSummary();
  const context = getFinanceContext();
  const nextIncome = getNextIncome();
  const nextObligation = getUpcomingPlanItems(context.obligations, 1)[0] || null;
  root.innerHTML = `
    ${renderGptAdviceCard('finance')}
    ${renderLocalInsights(state.selectedDate, true)}

    <section class="grid-3">
      <div class="stat-card"><div class="muted">Доступно сейчас</div><div class="stat-value">${context.availableBalance ? formatRub(context.availableBalance) : '—'}</div><div class="muted">Финансовая сводка</div></div>
      <div class="stat-card"><div class="muted">Ближайшее поступление</div><div class="stat-value small-stat">${nextIncome ? formatRub(nextIncome.amount) : '—'}</div><div class="muted">${nextIncome ? `${shortDate(nextIncome.date)} · ${escapeHTML(nextIncome.title || 'поступление')}` : 'не указано'}</div></div>
      <div class="stat-card"><div class="muted">Ближайший расход</div><div class="stat-value small-stat">${nextObligation ? formatRub(nextObligation.amount) : '—'}</div><div class="muted">${nextObligation ? `${shortDate(nextObligation.date)} · ${escapeHTML(nextObligation.title || 'расход')}` : 'не указан'}</div></div>
    </section>

    <section class="card">
      <div class="card-title-row">
        <div>
          <h2>Финансовая сводка</h2>
          <p class="muted">Общий контекст для недельного отчёта и финансовых подсказок.</p>
        </div>
        <button class="icon-button help-button" type="button" data-finance-help title="Как заполнять">?</button>
      </div>
      <form class="form-grid finance-context" data-finance-context-form>
        <label>Доступно сейчас, ₽<input name="availableBalance" inputmode="decimal" placeholder="Напр. 12500" value="${escapeHTML(context.availableBalance || '')}"></label>
        <button class="primary-button" type="submit">Сохранить</button>
      </form>
    </section>

    <section class="grid-2">
      <div class="card">
        <div class="card-title-row"><h2>Плановые поступления</h2></div>
        ${renderFinancePlanForm('income')}
        ${renderCollapsedBlock('Показать плановые поступления', `<div class="finance-list">${renderFinancePlanList('income')}</div>`, `${context.incomes.length}`)}
      </div>
      <div class="card">
        <div class="card-title-row"><h2>Обязательные расходы</h2></div>
        ${renderFinancePlanForm('obligation')}
        ${renderCollapsedBlock('Показать обязательные расходы', `<div class="finance-list">${renderFinancePlanList('obligation')}</div>`, `${context.obligations.length}`)}
      </div>
    </section>

    <section class="card">
      <div class="card-title-row">
        <div>
          <h2>Финансовые цели</h2>
          <p class="muted">До трёх целей: сумма, срок и комментарий.</p>
        </div>
      </div>
      ${renderFinanceGoalsForm(context)}
    </section>

    <section class="card">
      <div class="card-title-row">
        <div>
          <h2>Траты выбранного дня</h2>
          <p class="muted">Краткая сводка по выбранной дате.</p>
        </div>
      </div>
      ${renderFinanceDaySummary(summary)}
    </section>
  `;
  bindCommonActions(root);
  bindClick(root, '[data-finance-help]', openFinanceHelpDialog);
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

function renderFinancePlanList(type) {
  const context = getFinanceContext();
  const list = type === 'income' ? context.incomes : context.obligations;
  if (!list.length) return `<div class="empty">${type === 'income' ? 'Поступлений пока нет.' : 'Обязательных расходов пока нет.'}</div>`;
  const sorted = [...list].sort((a, b) => String(a.date || '9999-99-99').localeCompare(String(b.date || '9999-99-99')));
  const renderItem = item => `
      <article class="finance-card">
        <div class="item-top">
          <div>
            <div class="badge-row">
              <span class="badge important">${item.date ? shortDate(item.date) : 'без даты'}</span>
              <span class="badge secondary">${type === 'income' ? 'поступление' : 'обязательный расход'}</span>
            </div>
            <h3>${formatRub(item.amount)}</h3>
            <p class="muted">${escapeHTML(item.title || (type === 'income' ? 'Поступление' : 'Расход'))}${item.comment ? ` · ${escapeHTML(item.comment)}` : ''}</p>
          </div>
          <div class="actions">
            <button class="ghost-button" data-finance-plan-edit="${item.id}" data-plan-type="${type}">Изм.</button>
            <button class="danger-button" data-finance-plan-delete="${item.id}" data-plan-type="${type}">Удал.</button>
          </div>
        </div>
      </article>
    `;
  const cards = sorted.map(renderItem).join('');
  const title = type === 'income' ? 'Список поступлений' : 'Список расходов';
  return `<details class="collapsible-list finance-plan-details"><summary>${title} · ${sorted.length}</summary><div class="finance-list">${cards}</div></details>`;
}

function renderFinanceQuickForm(scope) {
  const now = new Date();
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const categories = FINANCE_CATEGORIES.map(item => `<option value="${item.value}">${item.label}</option>`).join('');
  const reasons = FINANCE_REASONS.map(item => `<option value="${item.value}">${item.label}</option>`).join('');
  return `
    <form class="form-grid finance" data-finance-form data-scope="${scope}">
      <label>Сумма, ₽<input name="amount" required inputmode="decimal" placeholder="Напр. 250"></label>
      <label>Категория<select name="category">${categories}</select></label>
      <label>Причина<select name="reason">${reasons}</select></label>
      <label>Комментарий<input name="comment" placeholder="Необязательно"></label>
      <input name="time" type="hidden" value="${time}">
      <button class="primary-button" type="submit">Добавить</button>
    </form>
    <div class="quick-category-row" aria-label="Быстрые категории">
      ${FINANCE_CATEGORIES.slice(0, 4).map(item => `<button class="ghost-button small" type="button" data-quick-finance-category="${item.value}">+ ${item.label}</button>`).join('')}
    </div>
  `;
}

function renderFinanceList(iso, compact = false) {
  const expenses = [...getFinance(iso).expenses].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  if (!expenses.length) return '<div class="empty">Трат пока нет.</div>';
  const visible = compact ? expenses.slice(0, 4) : expenses;
  return visible.map(expense => renderFinanceCard(expense, compact)).join('') + (compact && expenses.length > 4 ? '<div class="muted finance-summary-line">Показаны последние 4 записи. Полный список во вкладке «Финансы».</div>' : '');
}

function renderFinanceCard(expense, compact = false) {
  const reason = getFinanceReasonLabel(expense.reason);
  return `
    <article class="finance-card">
      <div class="item-top">
        <div>
          <div class="badge-row">
            <span class="badge important">${escapeHTML(getFinanceCategoryLabel(expense.category))}</span>
            ${reason ? `<span class="badge secondary">${escapeHTML(reason)}</span>` : ''}
            <span class="badge">${escapeHTML(expense.time || 'без времени')}</span>
          </div>
          <h3>${formatRub(expense.amount)}</h3>
          ${expense.comment ? `<p class="muted">${escapeHTML(expense.comment)}</p>` : ''}
        </div>
        <div class="actions">
          ${!compact ? `<button class="ghost-button" data-finance-edit="${expense.id}">Изм.</button>` : ''}
          <button class="danger-button" data-finance-delete="${expense.id}">Удал.</button>
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
          <div class="actions"><button class="ghost-button" data-task-move="${task.id}" data-date="${iso}">Перенести</button><button class="ghost-button" data-task-dismiss="${task.id}" data-date="${iso}">Скрыть</button><button class="ghost-button" data-jump-date="${iso}">Открыть день</button></div>
        </div>
      </article>`).join('');
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
  $$('[data-tab-target]', root).forEach(btn => btn.onclick = () => setTab(btn.dataset.tabTarget));
  $$('[data-gpt-advice]', root).forEach(btn => btn.onclick = () => openGptAdviceDialog(btn.dataset.gptAdvice || 'today'));
  $$('[data-jump-date]', root).forEach(btn => btn.onclick = () => setSelectedDate(btn.dataset.jumpDate));
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
        createdAt: new Date().toISOString()
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
      if (task.done) task.failed = false;
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
      getFinance().expenses.push({
        id: uid('exp'),
        amount,
        category: normalizeFinanceCategory(fd.get('category')),
        reason: normalizeFinanceReason(fd.get('reason')),
        comment: String(fd.get('comment') || '').trim(),
        time: fd.get('time') || '',
        createdAt: new Date().toISOString()
      });
      markChanged();
      showToast('Трата добавлена');
    };
  });

  $$('[data-finance-delete]', root).forEach(btn => {
    btn.onclick = async () => {
      if (!await openConfirmDialog('Удалить трату?')) return;
      const day = getFinance();
      day.expenses = day.expenses.filter(expense => expense.id !== btn.dataset.financeDelete);
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
      expense.amount = amount;
      expense.category = normalizeFinanceCategory(result.category);
      expense.reason = normalizeFinanceReason(result.reason);
      expense.comment = String(result.comment || '').trim();
      expense.time = String(result.time || '').trim();
      markChanged();
    };
  });


  $$('[data-finance-context-form]', root).forEach(form => {
    form.onsubmit = event => {
      event.preventDefault();
      const fd = new FormData(form);
      const context = getFinanceContext();
      context.availableBalance = normalizeMoneyInput(fd.get('availableBalance'));
      markChanged();
      showToast('Финансовая сводка сохранена');
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
        createdAt: new Date().toISOString()
      };
      const context = getFinanceContext();
      if (form.dataset.financePlanForm === 'income') context.incomes.push(item);
      else context.obligations.push(item);
      markChanged();
      showToast(form.dataset.financePlanForm === 'income' ? 'Поступление добавлено' : 'Обязательный расход добавлен');
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
  const incomeLines = context.incomes.length
    ? [...context.incomes].sort((a, b) => String(a.date || '9999-99-99').localeCompare(String(b.date || '9999-99-99'))).map(item => `  - ${item.date ? shortDate(item.date) : 'без даты'} · ${formatRub(item.amount)} · ${item.title || 'поступление'}${item.comment ? ` · ${item.comment}` : ''}`).join('\n')
    : '  - не указаны';
  const obligationLines = context.obligations.length
    ? [...context.obligations].sort((a, b) => String(a.date || '9999-99-99').localeCompare(String(b.date || '9999-99-99'))).map(item => `  - ${item.date ? shortDate(item.date) : 'без даты'} · ${formatRub(item.amount)} · ${item.title || 'обязательный расход'}${item.comment ? ` · ${item.comment}` : ''}`).join('\n')
    : '  - не указаны';
  const lines = [`Отчёт TSB Hub за неделю ${shortDate(monday)} — ${shortDate(addDays(monday, 6))}`];
  const goalLines = context.savingGoal ? context.savingGoal.split('\n').map(line => `  - ${line}`).join('\n') : '  - не указано';
  lines.push(`\nФинансовый контекст:\n  Доступно сейчас: ${context.availableBalance ? formatRub(context.availableBalance) : 'не указано'}\n  Финансовые цели:\n${goalLines}\n  Плановые поступления:\n${incomeLines}\n  Обязательные расходы:\n${obligationLines}`);
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
    const mealLines = health.meals.length
      ? health.meals.map(meal => `    - ${meal.time || 'без времени'} · ${meal.name}${meal.amount ? ` (${meal.amount})` : ''}`).join('\n')
      : '    - питания не записано';
    const taskLines = tasks.length
      ? tasks.map(task => `    - [${task.done ? 'x' : ' '}] ${PRIORITIES[task.priority] || 'Важно'}: ${task.text}`).join('\n')
      : '    - задач нет';
    const financeLines = finance.expenses.length
      ? finance.expenses.map(expense => `    - ${expense.time || 'без времени'} · ${getFinanceCategoryLabel(expense.category)} · ${formatRub(expense.amount)}${getFinanceReasonLabel(expense.reason) ? ` · причина: ${getFinanceReasonLabel(expense.reason)}` : ''}${expense.comment ? ` · ${expense.comment}` : ''}`).join('\n')
      : '    - трат не записано';
    lines.push(`\n${WEEKDAY_SHORT[i]} · ${formatHumanDate(iso)}\n  Задачи: ${progress.done}/${progress.total}, выполнение ${progress.pct}%\n${taskLines}\n  Питание:\n${mealLines}\n  Вес: ${health.weight ? `${health.weight} кг` : 'не указан'}\n  Активность: ${health.activityNote || 'не указана'}\n  Заметка: ${health.note || 'нет'}\n  Финансы: всего ${formatRub(financeSummary.total)}, еда ${formatRub(financeSummary.food)}, транспорт ${formatRub(financeSummary.transport)}, другое ${formatRub(financeSummary.other)}, эмоциональные/импульсивные траты ${formatRub(financeSummary.impulse)}\n${financeLines}\n  Локальные подсказки:\n${getLocalInsightsReportText(iso)}`);
  }
  lines.push("\nЗапрос к GPT: проанализируй все данные недели в контексте TSB Hub: задачи, незавершёнку, питание, вес, активность, заметки, локальные подсказки, дневные траты, плановые поступления, обязательные расходы и финансовые цели. Сам оцени финансовую ситуацию пользователя на следующую неделю и объясни вывод по данным. Проверь, где можно сократить расходы без вреда для базовых нужд, отдельно разберись с едой, транспортом, импульсивными/стрессовыми тратами и днями перегруза. Составь план на следующую неделю по дням: деньги, питание, задачи, отдых/нагрузка. Любые идеи по накоплениям и вложениям предлагай только если после обязательных расходов, еды, транспорта и минимального резерва реально остаются свободные деньги. Учитывай несколько финансовых целей и предложи реалистичный месячный доход/накопление, если данных хватает. В конце дай структурированный блок 'План на неделю' и отдельные блоки 'Совет на сегодня', 'Финансовые советы', 'Советы по питанию', 'Советы по задачам', чтобы их можно было вставить обратно в TSB Hub.");
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
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
}


function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // Начиная с 0.7 service worker включён даже в dev-сборках, потому что мы тестируем PWA через GitHub Pages.
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js?v=0.8.12-dev')
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

function setupEvents() {
  $('#prevDayBtn').onclick = () => setSelectedDate(addDays(state.selectedDate, -1));
  $('#nextDayBtn').onclick = () => setSelectedDate(addDays(state.selectedDate, 1));
  $('#todayBtn').onclick = () => setSelectedDate(toISODate(new Date()));
  $('#openCalendarBtn').onclick = () => $('#calendarDialog').showModal();
  $('#closeCalendarBtn').onclick = () => $('#calendarDialog').close();
  $$('.tab-button').forEach(btn => btn.onclick = () => setTab(btn.dataset.tab));

  registerServiceWorker();
}

setupEvents();
renderAll();
