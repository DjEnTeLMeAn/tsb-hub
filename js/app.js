const APP_VERSION = '0.7.1-dev';
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
      dataVersion: 1,
      createdAt: now,
      lastModified: now,
      lastExported: '',
      deviceId: getOrCreateDeviceId(),
      changeCounter: 0
    },
    tasks: {},
    health: {},
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
  data.meta.appVersion = APP_VERSION;
  return {
    ...defaults,
    ...data,
    meta: { ...defaults.meta, ...(data.meta || {}) },
    tasks: data.tasks || {},
    health: data.health || {},
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
  return fromISODate(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

function shortDate(iso) {
  return fromISODate(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
}

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[char]);
}

function nl2br(value) {
  return escapeHTML(value).replace(/\n/g, '<br>');
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

function getProgress(iso = state.selectedDate) {
  const tasks = getTasks(iso).filter(task => !task.dismissed);
  const total = tasks.length;
  const done = tasks.filter(task => task.done).length;
  const failed = tasks.filter(task => task.failed).length;
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
    const hasData = (app.tasks[iso]?.length || 0) > 0 || (app.health[iso]?.meals?.length || 0) > 0 || app.health[iso]?.weight;
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
  const progress = getProgress();
  const important = getImportantPreview(3);
  const pastTasks = app.settings.showOverdueOnToday ? getPendingPastTasksHTML() : '';
  const windowDays = Number(app.settings.pastTasksWindowDays || 14);
  const overdueSection = app.settings.showOverdueOnToday ? `
      <div class="card">
        <div class="card-title-row"><h2>Незавершённое за прошлые дни</h2><button class="ghost-button small" data-tab-target="settings">Настроить</button></div>
        <p class="muted block-hint">Показываются только последние ${windowDays} дн. Старые задачи остаются в истории своих дат и не давят на главный экран.</p>
        <div class="task-list">${pastTasks || '<div class="empty">Незавершённых задач за выбранный период нет.</div>'}</div>
      </div>` : '';
  root.innerHTML = `
    <section class="card">
      <div class="card-title-row">
        <div>
          <h2>${state.selectedDate === toISODate(new Date()) ? 'Сегодня' : 'День'} · ${formatHumanDate(state.selectedDate)}</h2>
          <p class="muted">Главный экран выбранной даты: задачи, питание, вес и ближайшие сроки.</p>
        </div>
      </div>
      <div class="grid-3">
        <div class="stat-card"><div class="muted">Выполнение задач</div><div class="stat-value">${progress.pct}%</div><div class="progress"><span style="width:${progress.pct}%"></span></div></div>
        <div class="stat-card"><div class="muted">Задачи</div><div class="stat-value">${progress.done}/${progress.total}</div></div>
        <div class="stat-card"><div class="muted">Вес</div><div class="stat-value">${health.weight ? `${escapeHTML(health.weight)} кг` : '—'}</div></div>
      </div>
    </section>

    <section class="grid-2">
      <div class="card">
        <div class="card-title-row"><h2>Задачи дня</h2><button class="ghost-button small" data-tab-target="plans">Планы</button></div>
        ${renderTaskAddForm(state.selectedDate, 'today')}
        <div class="task-list" style="margin-top:12px">${renderTaskList(state.selectedDate, true)}</div>
      </div>
      <div class="card">
        <div class="card-title-row"><h2>Питание дня</h2><button class="ghost-button small" data-tab-target="food">Питание</button></div>
        ${renderMealAddForm('today')}
        <div class="meal-list" style="margin-top:12px">${renderMealList(state.selectedDate)}</div>
      </div>
    </section>

    <section class="grid-2">
      <div class="card">
        <div class="card-title-row"><h2>Ближайшие важные даты</h2><button class="ghost-button small" data-tab-target="important">Все</button></div>
        <div class="important-list">${important || '<div class="empty">Важных дат пока нет.</div>'}</div>
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
    const date = fromISODate(iso);
    const progress = getProgress(iso);
    if (app.settings.showSelectedDayOnly && iso !== state.selectedDate) continue;
    days += `
      <article class="day-column ${iso === state.selectedDate ? 'selected' : ''} ${iso === toISODate(new Date()) ? 'today' : ''}">
        <div class="day-title"><span>${WEEKDAY_SHORT[i]}</span><span>${shortDate(iso)}</span></div>
        <div class="progress"><span style="width:${progress.pct}%"></span></div>
        ${renderTaskAddForm(iso, `plans-${i}`)}
        <div class="task-list">${renderTaskList(iso, false)}</div>
      </article>
    `;
  }
  root.innerHTML = `
    <section class="card">
      <div class="card-title-row">
        <div>
          <h2>Планы недели</h2>
          <p class="muted">Неделя выбранной даты. Календарь сверху меняет выбранный день и неделю.</p>
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
  root.innerHTML = `
    <section class="card">
      <div class="card-title-row">
        <div>
          <h2>Питание · ${formatHumanDate(state.selectedDate)}</h2>
          <p class="muted">В 0.5 переносим только базу: приёмы пищи, вес и простую заметку активности.</p>
        </div>
      </div>
      ${renderMealAddForm('food')}
      <div class="meal-list" style="margin-top:12px">${renderMealList(state.selectedDate)}</div>
    </section>

    <section class="grid-2">
      <div class="card">
        <div class="card-title-row"><h2>Вес и активность</h2></div>
        <form class="form-grid weight" data-weight-form>
          <label>Вес, кг<input name="weight" type="text" inputmode="decimal" placeholder="Вес, кг" value="${escapeHTML(health.weight || '')}"></label>
          <label>Активность / заметка дня<input name="activityNote" placeholder="Заметка об активности" value="${escapeHTML(health.activityNote || '')}"></label>
          <button class="primary-button" type="submit">Сохранить</button>
        </form>
      </div>
      <div class="card">
        <div class="card-title-row"><h2>Заметка дня</h2></div>
        <form data-day-note-form class="sync-box">
          <textarea name="note" placeholder="Заметка о дне, самочувствии или активности">${escapeHTML(health.note || '')}</textarea>
          <button class="primary-button" type="submit">Сохранить заметку</button>
        </form>
      </div>
    </section>

    <section class="card">
      <div class="card-title-row"><div><h2>Отчёт для GPT за неделю</h2><p class="muted">Неделя выбранной даты. Позже добавим переключатель день/неделя.</p></div><button class="ghost-button small" id="copyGptReportBtn">Скопировать</button></div>
      <textarea readonly id="gptReportText">${escapeHTML(buildGptReport())}</textarea>
    </section>
  `;
  bindCommonActions(root);
  $('[data-weight-form]', root).onsubmit = event => {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const day = getHealth();
    day.weight = normalizeWeightInput(fd.get('weight')) || null;
    day.activityNote = fd.get('activityNote') || '';
    markChanged();
    showToast('Вес и активность сохранены');
  };
  $('[data-day-note-form]', root).onsubmit = event => {
    event.preventDefault();
    getHealth().note = new FormData(event.currentTarget).get('note') || '';
    markChanged();
    showToast('Заметка дня сохранена');
  };
  $('#copyGptReportBtn', root).onclick = () => copyText($('#gptReportText', root).value);
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
        <label>Дата<input name="date" type="date" required value="${state.selectedDate}"></label>
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
      date: fd.get('date'),
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
      <p class="notice">В 0.5 это базовый экспорт/импорт общего файла. Проверки конфликтов и Syncthing-режим будут усилены в 0.9.</p>
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
    <section class="card">
      <div class="card-title-row"><h2>Внешний вид</h2></div>
      <p class="muted">В 0.6–0.7 фиксируем рабочую структуру и PWA-обвязку. Цвета, иконки, скругления и плотность интерфейса дальше меняются через дизайн-токены, без переписывания логики вкладок.</p>
    </section>
    <section class="card">
      <div class="card-title-row"><h2>Диагностика версии</h2></div>
      <div class="code">
        HTML/CSS/JS: ${escapeHTML(APP_VERSION)}<br>
        appVersion в данных: ${escapeHTML(app.meta.appVersion)}<br>
        dataVersion: ${escapeHTML(app.meta.dataVersion)}<br>
        lastModified: ${escapeHTML(app.meta.lastModified || '—')}<br>
        changeCounter: ${escapeHTML(app.meta.changeCounter)}<br>
        deviceId: ${escapeHTML(app.meta.deviceId)}<br>
        migratedFromOldStorage: ${escapeHTML(app.settings.migratedFromOldStorage)}
      </div>
    </section>
    ${getPwaStatusHTML()}
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
      <label>Тип<select name="type">
        <option>Завтрак</option><option>Обед</option><option>Ужин</option><option>Перекус</option><option>Другое</option>
      </select></label>
      <label>Что ел<input name="name" required placeholder="Что ел"></label>
      <label>Количество<input name="amount" placeholder="Количество / порция"></label>
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
          <div class="badge-row"><span class="badge important">${escapeHTML(meal.type || 'Приём пищи')}</span><span class="badge">${escapeHTML(meal.time || 'без времени')}</span></div>
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

function openConfirmDialog(message, title = 'Подтвердить действие') {
  return new Promise(resolve => {
    const dialog = document.createElement('dialog');
    dialog.className = 'modal-dialog edit-dialog';
    dialog.innerHTML = `
      <div class="modal-card edit-form">
        <div class="card-title-row"><h2>${escapeHTML(title)}</h2></div>
        <p>${escapeHTML(message)}</p>
        <div class="actions modal-actions">
          <button class="ghost-button" data-confirm-no>Отмена</button>
          <button class="danger-button" data-confirm-yes>Удалить</button>
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

function bindCommonActions(root = document) {
  $$('[data-tab-target]', root).forEach(btn => btn.onclick = () => setTab(btn.dataset.tabTarget));
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
      if (!result || !/^\d{4}-\d{2}-\d{2}$/.test(result.date)) return;
      app.tasks[fromDate] = getTasks(fromDate).filter(item => item.id !== task.id);
      task.text = result.text.trim() || task.text;
      task.dismissed = false;
      task.failed = false;
      task.movedFrom = fromDate;
      getTasks(result.date).push(task);
      setSelectedDate(result.date);
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
      getHealth().meals.push({
        id: uid('meal'),
        type: fd.get('type') || 'Приём пищи',
        name: fd.get('name').trim(),
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
          { name: 'type', label: 'Тип', type: 'select', value: meal.type || 'Завтрак', options: ['Завтрак','Обед','Ужин','Перекус','Другое'].map(value => ({ value, label: value })) },
          { name: 'name', label: 'Что ел', value: meal.name || '' },
          { name: 'amount', label: 'Количество / комментарий', value: meal.amount || '' },
          { name: 'time', label: 'Время', type: 'time', value: meal.time || '' }
        ]
      });
      if (!result) return;
      meal.type = result.type || meal.type;
      meal.name = result.name.trim() || meal.name;
      meal.amount = result.amount.trim();
      meal.time = result.time.trim();
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
      if (/^\d{4}-\d{2}-\d{2}$/.test(result.date)) item.date = result.date;
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
  const lines = [`Отчёт TSB Hub за неделю ${shortDate(monday)} — ${shortDate(addDays(monday, 6))}`];
  for (let i = 0; i < 7; i += 1) {
    const iso = addDays(monday, i);
    const health = getHealth(iso);
    const tasks = getTasks(iso);
    const progress = getProgress(iso);
    const mealLines = health.meals.length
      ? health.meals.map(meal => `    - ${meal.time || 'без времени'} · ${meal.type}: ${meal.name}${meal.amount ? ` (${meal.amount})` : ''}`).join('\n')
      : '    - питания не записано';
    const taskLines = tasks.length
      ? tasks.map(task => `    - [${task.done ? 'x' : ' '}] ${PRIORITIES[task.priority] || 'Важно'}: ${task.text}`).join('\n')
      : '    - задач нет';
    lines.push(`\n${WEEKDAY_SHORT[i]} · ${formatHumanDate(iso)}\n  Задачи: ${progress.done}/${progress.total}, выполнение ${progress.pct}%\n${taskLines}\n  Питание:\n${mealLines}\n  Вес: ${health.weight ? `${health.weight} кг` : 'не указан'}\n  Активность: ${health.activityNote || 'не указана'}\n  Заметка: ${health.note || 'нет'}`);
  }
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
    navigator.serviceWorker.register('./service-worker.js?v=0.7.1-dev')
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
