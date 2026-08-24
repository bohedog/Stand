/* ============================================================
   The Ledger — self development tracker
   All data stored locally on-device via localStorage. Nothing
   is sent anywhere. Works fully offline once installed.
   ============================================================ */

const STORAGE_KEY = 'ledger_data_v2';
const GOAL_COLORS = ['#B8892B', '#34513A', '#A34A34', '#4A6FA5', '#7B5EA7', '#8A8A2B', '#B5566E', '#2F7A6B'];
const DAY_MS = 86400000;

function pad2(n) { return n < 10 ? '0' + n : '' + n; }
function fmtDate(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function fmtDDMM(d) { return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}`; }
function todayKey() { return fmtDate(new Date()); }
function parseDateKey(key) { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); }
function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }
function daysBetween(a, b) { return Math.round((a - b) / DAY_MS); }

function mondayOf(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dow = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - dow);
  return d;
}
function isoWeekStorageKey(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${pad2(weekNo)}`;
}
function weekRangeLabel(date) {
  const mon = mondayOf(date);
  const sun = new Date(mon); sun.setDate(sun.getDate() + 6);
  return `${fmtDDMM(mon)} – ${fmtDDMM(sun)}`;
}
function monthKey(date) { return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`; }
function yearKey(date) { return `${date.getFullYear()}`; }

/* ---------------- State ---------------- */
let state = loadState();

function defaultState() {
  return {
    goals: [],
    logs: {},        // { dateKey: { goalId: { text, done, loggedAt } } }
    progress: { daily: {}, weekly: {}, monthly: {}, yearly: {} }, // { key: [{id, text, createdAt}] }
    settings: { remindersOn: false, reminderTime: '09:00', quotesOn: false, lastReminderShown: null, darkMode: false }
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return migrateOld() || defaultState();
    const parsed = JSON.parse(raw);
    const merged = Object.assign(defaultState(), parsed);
    merged.goals = (merged.goals || []).map(g => Object.assign({
      vision: '', breakdown: { daily: [], weekly: [], monthly: [], yearly: [] }
    }, g));
    return merged;
  } catch (e) {
    console.error('Failed to load state', e);
    return defaultState();
  }
}

function migrateOld() {
  try {
    const raw = localStorage.getItem('ledger_data_v1');
    if (!raw) return null;
    const old = JSON.parse(raw);
    const fresh = defaultState();
    fresh.goals = (old.goals || []).map(g => ({
      id: g.id, name: g.name, color: g.color, archived: !!g.archived, createdAt: g.createdAt,
      vision: g.target || '', breakdown: { daily: [], weekly: [], monthly: [], yearly: [] }
    }));
    fresh.logs = old.logs || {};
    fresh.progress.daily = old.dailyPlans || {};
    fresh.settings = Object.assign(fresh.settings, old.settings || {});
    return fresh;
  } catch (e) { return null; }
}

let saveTimer = null;
function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
function saveStateDebounced() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveState, 250);
}

/* ---------------- Navigation ---------------- */
const views = ['today', 'calendar', 'progress', 'stats', 'goals'];
let activeView = 'today';
let lastQuoteDate = null;
let progressScope = 'daily';
let progressCursorDate = new Date();
let calendarBuilt = false;

function switchView(v) {
  activeView = v;
  views.forEach(name => document.getElementById('view-' + name).classList.toggle('active', name === v));
  document.querySelectorAll('nav.tabbar button').forEach(btn => btn.classList.toggle('active', btn.dataset.view === v));
  document.querySelector('main').classList.toggle('cal-mode', v === 'calendar');
  renderActiveView();
}

function renderActiveView() {
  if (activeView === 'today') renderToday();
  if (activeView === 'calendar') renderCalendar();
  if (activeView === 'progress') renderProgress();
  if (activeView === 'stats') renderStats();
  if (activeView === 'goals') renderGoalsPage();
}

/* ---------------- Quotes carousel ---------------- */
function quotesForDay(dateKey) {
  const dayIdx = Math.floor(parseDateKey(dateKey).getTime() / DAY_MS);
  const start = (dayIdx * 5) % QUOTES.length;
  const picks = [];
  for (let i = 0; i < 5; i++) picks.push(QUOTES[(start + i) % QUOTES.length]);
  return picks;
}

function renderQuoteCarousel() {
  const key = todayKey();
  if (lastQuoteDate === key) return;
  lastQuoteDate = key;
  const quotes = quotesForDay(key);
  const carousel = document.getElementById('quote-carousel');
  const dots = document.getElementById('quote-dots');
  carousel.innerHTML = quotes.map(q => `
    <div class="quote-card" style="background-image:url('https://picsum.photos/seed/${encodeURIComponent(q.img)}/700/500')">
      <div class="quote-inner">
        <p class="quote-text">"${escapeHtml(q.text)}"</p>
        <div class="quote-author">— ${escapeHtml(q.author)}</div>
      </div>
    </div>
  `).join('');
  dots.innerHTML = quotes.map((_, i) => `<div class="dot${i === 0 ? ' active' : ''}"></div>`).join('');

  let scrollRAF = null;
  carousel.onscroll = () => {
    if (scrollRAF) return;
    scrollRAF = requestAnimationFrame(() => {
      const idx = Math.round(carousel.scrollLeft / carousel.clientWidth);
      dots.querySelectorAll('.dot').forEach((d, i) => d.classList.toggle('active', i === idx));
      scrollRAF = null;
    });
  };
}

/* ---------------- TODAY VIEW ---------------- */
function renderToday() {
  renderQuoteCarousel();
  renderVisionStrip();
  renderTodayFocus();
  renderWrapCard();
}

function goalGradient(color) {
  return `linear-gradient(135deg, ${color} 0%, ${shadeColor(color, -25)} 100%)`;
}
function shadeColor(hex, percent) {
  const num = parseInt(hex.replace('#', ''), 16);
  let r = (num >> 16) + Math.round(2.55 * percent);
  let g = ((num >> 8) & 0x00FF) + Math.round(2.55 * percent);
  let b = (num & 0x0000FF) + Math.round(2.55 * percent);
  r = Math.max(0, Math.min(255, r)); g = Math.max(0, Math.min(255, g)); b = Math.max(0, Math.min(255, b));
  return `#${(1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1)}`;
}

function renderVisionStrip() {
  const strip = document.getElementById('vision-strip');
  const activeGoals = state.goals.filter(g => !g.archived);
  strip.innerHTML = '';
  activeGoals.forEach(g => {
    const card = document.createElement('div');
    card.className = 'vision-card';
    card.style.background = goalGradient(g.color);
    card.innerHTML = `
      <div class="vision-name">${escapeHtml(g.name || 'Untitled goal')}</div>
      <div class="vision-text">${escapeHtml(g.vision || 'No long-term vision set yet — tap to add one.')}</div>
      <div class="vision-edit-hint">Tap to edit ›</div>
    `;
    card.addEventListener('click', () => openGoalSheet(g.id));
    strip.appendChild(card);
  });
  const addCard = document.createElement('div');
  addCard.className = 'vision-card-add';
  addCard.textContent = '+';
  addCard.addEventListener('click', () => openGoalSheet());
  strip.appendChild(addCard);

  document.getElementById('view-today-vision-section').style.display = activeGoals.length === 0 ? 'none' : 'block';
}

function computeGoalStreak(goalId) {
  let streak = 0;
  let cursor = new Date();
  while (true) {
    const k = fmtDate(cursor);
    const entry = state.logs[k] && state.logs[k][goalId];
    if (entry && entry.done) { streak++; cursor.setDate(cursor.getDate() - 1); }
    else break;
  }
  return streak;
}

function renderTodayFocus() {
  const key = todayKey();
  const list = document.getElementById('today-goal-list');
  list.innerHTML = '';
  const activeGoals = state.goals.filter(g => !g.archived);

  if (activeGoals.length === 0) {
    list.innerHTML = `<div class="empty-state">No goals yet. Create your first goal to start logging your grind.<br><button class="btn" onclick="openGoalSheet()">Create a goal</button></div>`;
    return;
  }

  const todaysLog = state.logs[key] || {};
  activeGoals.forEach(g => {
    const entry = todaysLog[g.id];
    const done = entry && entry.done;
    const row = document.createElement('div');
    row.className = 'goal-card';
    row.style.cursor = 'default';
    row.innerHTML = `
      <div class="goal-swatch" style="background:${g.color}"></div>
      <div class="goal-info" data-open="1">
        <div class="goal-name">${escapeHtml(g.name)}</div>
        <div class="goal-meta">${g.breakdown.daily.length ? escapeHtml(g.breakdown.daily.map(i => i.text).join(' · ')) : 'tap to log today'}</div>
        ${entry && entry.text ? `<div class="goal-note-preview">"${escapeHtml(entry.text)}"</div>` : ''}
      </div>
      <button class="goal-log-btn ${done ? 'done' : ''}" data-goal="${g.id}">${done ? '✓' : ''}</button>
    `;
    row.querySelector('.goal-log-btn').addEventListener('click', (e) => { e.stopPropagation(); toggleDone(g.id, key); });
    row.querySelector('[data-open]').addEventListener('click', () => openJournalSheet(g.id, key));
    list.appendChild(row);
  });
}

function toggleDone(goalId, dateKey) {
  if (!state.logs[dateKey]) state.logs[dateKey] = {};
  const existing = state.logs[dateKey][goalId];
  const nowDone = !(existing && existing.done);
  state.logs[dateKey][goalId] = { done: nowDone, text: existing ? existing.text : '', loggedAt: Date.now() };
  saveState();
  patchAfterLogChange(goalId, dateKey);
  if (nowDone) showToast('Logged. Keep the streak alive.');
}

// Updates just the affected button/text in place (Today list, Day sheet, Calendar cell,
// heatmap) instead of rebuilding whole sections — avoids destroying the element the user
// just tapped mid-interaction, which was causing the "first tap doesn't register" bug.
function patchAfterLogChange(goalId, dateKey) {
  const entry = state.logs[dateKey][goalId];
  const done = entry.done, text = entry.text;
  if (dateKey === todayKey()) {
    const g = state.goals.find(x => x.id === goalId);
    const metaDefault = g && g.breakdown.daily.length ? escapeHtml(g.breakdown.daily.map(i => i.text).join(' · ')) : 'tap to log today';
    patchGoalRow('today-goal-list', goalId, done, text, metaDefault);
    renderWrapCard();
  }
  if (document.getElementById('day-sheet-date') && document.getElementById('day-sheet-date').value === dateKey) {
    patchGoalRow('day-sheet-goals', goalId, done, text, 'tap to log what you did');
  }
  updateCalendarDay(dateKey);
}

function patchGoalRow(containerId, goalId, done, text, emptyMetaHtml) {
  const container = document.getElementById(containerId);
  if (!container) return false;
  const btn = container.querySelector(`.goal-log-btn[data-goal="${goalId}"]`);
  if (!btn) return false;
  btn.classList.toggle('done', done);
  btn.textContent = done ? '✓' : '';
  const row = btn.closest('.goal-card');
  const info = row.querySelector('.goal-info');
  const secondary = info.querySelector('.goal-note-preview, .goal-meta');
  if (text) {
    const html = `<div class="goal-note-preview">"${escapeHtml(text)}"</div>`;
    if (secondary) secondary.outerHTML = html; else info.insertAdjacentHTML('beforeend', html);
  } else if (secondary && secondary.classList.contains('goal-note-preview')) {
    secondary.outerHTML = `<div class="goal-meta">${emptyMetaHtml}</div>`;
  }
  return true;
}

/* ---------------- Journal entry mini-sheet ---------------- */
let journalCtx = null;
function openJournalSheet(goalId, dateKey) {
  const g = state.goals.find(x => x.id === goalId);
  if (!g) return;
  journalCtx = { goalId, dateKey };
  const entry = (state.logs[dateKey] && state.logs[dateKey][goalId]) || { text: '', done: false };
  document.getElementById('journal-sheet-title').textContent = g.name;
  document.getElementById('journal-sheet-date').textContent = parseDateKey(dateKey).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  document.getElementById('journal-text').value = entry.text || '';
  document.getElementById('journal-done-toggle').classList.toggle('on', !!entry.done);
  autoGrow(document.getElementById('journal-text'));
  openSheet('journal-sheet');
}
function saveJournalEntry() {
  if (!journalCtx) return;
  const { goalId, dateKey } = journalCtx;
  const text = document.getElementById('journal-text').value.trim();
  if (!state.logs[dateKey]) state.logs[dateKey] = {};
  const existing = state.logs[dateKey][goalId] || {};
  const done = document.getElementById('journal-done-toggle').classList.contains('on') || !!text;
  state.logs[dateKey][goalId] = { text, done, loggedAt: Date.now() };
  saveState();
  closeSheet('journal-sheet');
  patchAfterLogChange(goalId, dateKey);
  showToast('Saved.');
}
function toggleJournalDone() {
  document.getElementById('journal-done-toggle').classList.toggle('on');
}

/* ---------------- Wrap cards ---------------- */
function generateDailyWrap() {
  const activeGoals = state.goals.filter(g => !g.archived);
  if (activeGoals.length === 0) return null;
  const key = todayKey();
  const log = state.logs[key] || {};
  const doneList = activeGoals.filter(g => log[g.id] && log[g.id].done);
  const total = activeGoals.length;

  let best = null;
  activeGoals.forEach(g => {
    const s = computeGoalStreak(g.id);
    if (s >= 2 && (!best || s > best.streak)) best = { name: g.name, streak: s };
  });

  let msg = `You've logged <b>${doneList.length}/${total}</b> goal${total === 1 ? '' : 's'} today.`;
  if (total > 0 && doneList.length === total) msg += ' Clean sweep — well done.';
  if (best) msg += ` <b>${escapeHtml(best.name)}</b> is on a ${best.streak}-day streak.`;
  const notesCount = Object.values(log).filter(e => e.text && e.text.trim()).length;
  if (notesCount > 0) msg += ` You journaled ${notesCount} note${notesCount === 1 ? '' : 's'} today.`;
  return msg;
}

function renderWrapCard() {
  const box = document.getElementById('today-wrap-box');
  const msg = generateDailyWrap();
  if (!msg) { box.style.display = 'none'; return; }
  box.style.display = 'block';
  box.innerHTML = `<div class="wrap-title">Today's wrap</div><div class="wrap-body">${msg}</div>`;
}

function generateWeeklyWrap() {
  const activeGoals = state.goals.filter(g => !g.archived);
  if (activeGoals.length === 0) return null;
  const mon = mondayOf(new Date());
  const prevMon = new Date(mon); prevMon.setDate(prevMon.getDate() - 7);

  function countInWeek(startMon) {
    let total = 0;
    const perGoal = {};
    for (let i = 0; i < 7; i++) {
      const d = new Date(startMon); d.setDate(d.getDate() + i);
      if (d > new Date()) break;
      const k = fmtDate(d);
      const log = state.logs[k];
      if (!log) continue;
      Object.keys(log).forEach(gid => {
        if (log[gid].done) { total++; perGoal[gid] = (perGoal[gid] || 0) + 1; }
      });
    }
    return { total, perGoal };
  }

  const thisWeek = countInWeek(mon);
  const lastWeek = countInWeek(prevMon);

  let topGoal = null;
  Object.keys(thisWeek.perGoal).forEach(gid => {
    if (!topGoal || thisWeek.perGoal[gid] > topGoal.count) {
      const g = state.goals.find(x => x.id === gid);
      if (g) topGoal = { name: g.name, count: thisWeek.perGoal[gid] };
    }
  });

  let msg = `<b>${thisWeek.total}</b> goal log${thisWeek.total === 1 ? '' : 's'} so far this week`;
  if (lastWeek.total > 0) {
    const delta = Math.round(((thisWeek.total - lastWeek.total) / lastWeek.total) * 100);
    if (delta > 0) msg += `, up <b>${delta}%</b> from last week.`;
    else if (delta < 0) msg += `, down ${Math.abs(delta)}% from last week.`;
    else msg += `, matching last week's pace.`;
  } else { msg += '.'; }
  if (topGoal) msg += ` Most consistent: <b>${escapeHtml(topGoal.name)}</b> (${topGoal.count}x).`;
  return msg;
}

/* ---------------- GOALS PAGE ---------------- */
function renderGoalsPage() {
  const list = document.getElementById('goals-list');
  list.innerHTML = '';
  if (state.goals.length === 0) {
    list.innerHTML = `<div class="empty-state">No goals yet.<br><button class="btn" onclick="openGoalSheet()">Create your first goal</button></div>`;
    return;
  }
  state.goals.forEach(g => {
    const row = document.createElement('div');
    row.className = 'goal-card';
    row.innerHTML = `
      <div class="goal-swatch" style="background:${g.color}"></div>
      <div class="goal-info">
        <div class="goal-name">${escapeHtml(g.name || 'Untitled')}${g.archived ? ' (archived)' : ''}</div>
        <div class="goal-meta">${g.vision ? escapeHtml(g.vision.slice(0, 60)) : 'no vision set'}</div>
      </div>
    `;
    row.addEventListener('click', () => openGoalSheet(g.id));
    list.appendChild(row);
  });
}

/* ---------------- GOAL SHEET (vision + breakdown) ---------------- */
let currentGoalId = null;
let currentBreakdownTab = 'daily';

function openGoalSheet(goalId) {
  let goal;
  let isNew = false;
  if (goalId) {
    goal = state.goals.find(g => g.id === goalId);
  } else {
    goal = { id: uid(), name: '', color: GOAL_COLORS[state.goals.length % GOAL_COLORS.length], archived: false, createdAt: todayKey(), vision: '', breakdown: { daily: [], weekly: [], monthly: [], yearly: [] } };
    state.goals.push(goal);
    saveState();
    isNew = true;
  }
  currentGoalId = goal.id;
  currentBreakdownTab = 'daily';

  document.getElementById('goal-sheet-title').textContent = isNew ? 'New goal' : 'Edit goal';
  document.getElementById('goal-name-input').value = goal.name;
  document.getElementById('goal-vision-input').value = goal.vision || '';
  autoGrow(document.getElementById('goal-vision-input'));

  const colorPicker = document.getElementById('goal-color-picker');
  colorPicker.innerHTML = '';
  GOAL_COLORS.forEach(c => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'color-swatch-btn' + (c === goal.color ? ' selected' : '');
    btn.style.background = c;
    btn.dataset.color = c;
    btn.addEventListener('click', () => {
      colorPicker.querySelectorAll('.color-swatch-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      goal.color = c;
      saveStateDebounced();
    });
    colorPicker.appendChild(btn);
  });

  document.querySelectorAll('.breakdown-tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === 'daily'));
  renderBreakdownPane();

  document.getElementById('goal-delete-btn').style.display = 'block';
  document.getElementById('goal-delete-btn').textContent = goal.archived ? 'Unarchive goal' : 'Archive goal';
  openSheet('goal-sheet');
}

function goalSheetFieldChanged() {
  const goal = state.goals.find(g => g.id === currentGoalId);
  if (!goal) return;
  goal.name = document.getElementById('goal-name-input').value.trim();
  goal.vision = document.getElementById('goal-vision-input').value.trim();
  saveStateDebounced();
}

function closeGoalSheet() {
  const goal = state.goals.find(g => g.id === currentGoalId);
  if (goal && !goal.name.trim() && Object.values(goal.breakdown).every(arr => arr.length === 0) && !goal.vision.trim()) {
    state.goals = state.goals.filter(g => g.id !== currentGoalId);
    saveState();
  } else if (goal) {
    goalSheetFieldChanged();
  }
  closeSheet('goal-sheet');
  renderActiveView();
}

function setBreakdownTab(tab) {
  currentBreakdownTab = tab;
  document.querySelectorAll('.breakdown-tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  renderBreakdownPane();
}

function renderBreakdownPane() {
  const goal = state.goals.find(g => g.id === currentGoalId);
  if (!goal) return;
  const pane = document.getElementById('breakdown-pane');
  pane.innerHTML = '';
  const items = goal.breakdown[currentBreakdownTab];
  items.forEach(item => {
    const row = document.createElement('div');
    row.className = 'breakdown-item';
    row.innerHTML = `<div class="txt">${escapeHtml(item.text)}</div><button class="del">✕</button>`;
    row.querySelector('.del').addEventListener('click', () => {
      goal.breakdown[currentBreakdownTab] = goal.breakdown[currentBreakdownTab].filter(i => i.id !== item.id);
      saveState();
      renderBreakdownPane();
    });
    pane.appendChild(row);
  });
  const placeholders = { daily: 'Add a daily action…', weekly: 'Add a weekly target…', monthly: 'Add a monthly milestone…', yearly: 'Add a yearly milestone…' };
  attachComposer(pane, placeholders[currentBreakdownTab], (text) => {
    goal.breakdown[currentBreakdownTab].push({ id: uid(), text });
    saveState();
    renderBreakdownPane();
    if (currentBreakdownTab === 'daily') renderActiveView();
  });
}

function archiveCurrentGoal() {
  const goal = state.goals.find(g => g.id === currentGoalId);
  if (!goal) return;
  goal.archived = !goal.archived;
  saveState();
  closeSheet('goal-sheet');
  renderActiveView();
}

/* ---------------- Generic composer (expanding + button) ---------------- */
function attachComposer(container, placeholder, onSave) {
  const wrap = document.createElement('div');
  wrap.className = 'composer';
  wrap.innerHTML = `
    <div class="composer-closed">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
      <span>${escapeHtml(placeholder)}</span>
    </div>
  `;
  const closedEl = wrap.querySelector('.composer-closed');
  closedEl.addEventListener('click', () => {
    wrap.innerHTML = `
      <div class="composer-open">
        <textarea class="autogrow" placeholder="${escapeHtml(placeholder)}"></textarea>
        <div class="composer-actions">
          <button class="btn secondary small composer-cancel">Cancel</button>
          <button class="btn small composer-save">Add</button>
        </div>
      </div>
    `;
    const ta = wrap.querySelector('textarea');
    ta.focus();
    autoGrow(ta);
    ta.addEventListener('input', () => autoGrow(ta));
    wrap.querySelector('.composer-save').addEventListener('click', () => {
      const text = ta.value.trim();
      if (text) onSave(text);
      collapse();
    });
    wrap.querySelector('.composer-cancel').addEventListener('click', collapse);
  });
  function collapse() {
    wrap.innerHTML = '';
    const clone = document.createElement('div');
    clone.className = 'composer-closed';
    clone.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg><span>${escapeHtml(placeholder)}</span>`;
    clone.addEventListener('click', () => closedEl.click());
    wrap.appendChild(clone);
    wrap.querySelector('.composer-closed').replaceWith(clone);
  }
  container.appendChild(wrap);
}

/* ---------------- CALENDAR (scrollable) ---------------- */
let calRangeStartYear, calRangeEndYear;

function renderCalendar() {
  renderHeatmap();
  if (calendarBuilt) return;
  calendarBuilt = true;
  const scroll = document.getElementById('cal-scroll');
  const today = new Date();
  calRangeStartYear = today.getFullYear() - 3;
  calRangeEndYear = today.getFullYear() + 1;
  const startMonth = new Date(calRangeStartYear, 0, 1);
  const endMonth = new Date(calRangeEndYear, 11, 1);
  const todayStr = todayKey();

  let html = '';
  let cursor = new Date(startMonth);
  while (cursor <= endMonth) {
    const y = cursor.getFullYear(), m = cursor.getMonth();
    const isCurrentMonth = (y === today.getFullYear() && m === today.getMonth());
    html += `<div class="cal-month-block" data-ym="${y}-${pad2(m + 1)}" data-year="${y}">
      <div class="cal-month-title">${cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}${isCurrentMonth ? '<span class="cur-tag">Today</span>' : ''}</div>
      <div class="cal-grid">`;

    const firstOfMonth = new Date(y, m, 1);
    const startOffset = (firstOfMonth.getDay() + 6) % 7;
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    let cellCount = 0;
    for (let i = 0; i < startOffset; i++) { html += `<div class="cal-cell outside"></div>`; cellCount++; }
    for (let d = 1; d <= daysInMonth; d++) {
      const cellDate = new Date(y, m, d);
      const key = fmtDate(cellDate);
      const isToday = key === todayStr;
      const isFuture = cellDate > today;
      html += `<div class="cal-cell${isToday ? ' today' : ''}${isFuture ? ' future' : ''}" data-date="${key}">
        <div class="daynum">${d}</div>
        <div class="cal-plan-dot" style="display:none"></div>
        <div class="cal-ticks"></div>
      </div>`;
      cellCount++;
    }
    // Trailing filler cells so every month completes its final row (fixes broken box outlines)
    const remainder = cellCount % 7;
    if (remainder !== 0) {
      for (let i = 0; i < 7 - remainder; i++) html += `<div class="cal-cell outside"></div>`;
    }
    html += `</div></div>`;
    cursor.setMonth(cursor.getMonth() + 1);
  }
  scroll.innerHTML = html;

  scroll.querySelectorAll('.cal-cell[data-date]').forEach(cell => {
    paintCalCell(cell, cell.dataset.date);
  });

  scroll.addEventListener('click', (e) => {
    const cell = e.target.closest('.cal-cell[data-date]');
    if (cell) openDaySheet(cell.dataset.date);
  });

  let yearScrollRAF = null;
  scroll.addEventListener('scroll', () => {
    if (yearScrollRAF) return;
    yearScrollRAF = requestAnimationFrame(() => {
      updateVisibleYearLabel();
      yearScrollRAF = null;
    });
  });

  document.getElementById('cal-year-prev').addEventListener('click', () => jumpToYear(-1));
  document.getElementById('cal-year-next').addEventListener('click', () => jumpToYear(1));

  jumpToToday();
}

function jumpToToday() {
  requestAnimationFrame(() => {
    const scroll = document.getElementById('cal-scroll');
    const todayBlock = scroll.querySelector(`[data-date="${todayKey()}"]`);
    if (todayBlock) todayBlock.scrollIntoView({ block: 'center' });
    requestAnimationFrame(updateVisibleYearLabel);
  });
}

let calCurrentYear = null;
function updateVisibleYearLabel() {
  const scroll = document.getElementById('cal-scroll');
  const scrollRect = scroll.getBoundingClientRect();
  const blocks = scroll.querySelectorAll('.cal-month-block');
  let currentYear = calRangeStartYear;
  for (const block of blocks) {
    const rect = block.getBoundingClientRect();
    if (rect.top - scrollRect.top <= 44) currentYear = parseInt(block.dataset.year, 10);
    else break;
  }
  calCurrentYear = currentYear;
  document.getElementById('cal-year-label').textContent = currentYear;
}

function jumpToYear(delta) {
  const base = calCurrentYear || new Date().getFullYear();
  let year = Math.max(calRangeStartYear, Math.min(calRangeEndYear, base + delta));
  const scroll = document.getElementById('cal-scroll');
  const block = scroll.querySelector(`[data-ym="${year}-01"]`) || scroll.querySelector(`[data-year="${year}"]`);
  if (block) block.scrollIntoView({ block: 'start' });
  calCurrentYear = year;
  document.getElementById('cal-year-label').textContent = year;
  requestAnimationFrame(updateVisibleYearLabel);
}

function paintCalCell(cell, key) {
  const dayLog = state.logs[key] || {};
  const ticks = Object.keys(dayLog).filter(gid => dayLog[gid].done).map(gid => {
    const g = state.goals.find(x => x.id === gid);
    return g ? g.color : null;
  }).filter(Boolean);
  cell.querySelector('.cal-ticks').innerHTML = ticks.map(c => `<div class="cal-tick" style="background:${c}"></div>`).join('');
  const hasProgress = (state.progress.daily[key] || []).length > 0;
  cell.querySelector('.cal-plan-dot').style.display = hasProgress ? 'block' : 'none';
}

function updateCalendarDay(key) {
  if (calendarBuilt) {
    const cell = document.querySelector(`#cal-scroll .cal-cell[data-date="${key}"]`);
    if (cell) paintCalCell(cell, key);
  }
  updateHeatmapCell(key);
}

/* ---------------- Contribution heatmap ---------------- */
function heatLevelForDate(key) {
  const activeGoals = state.goals.filter(g => !g.archived);
  if (activeGoals.length === 0) return 0;
  const dayLog = state.logs[key];
  if (!dayLog) return 0;
  const doneCount = activeGoals.filter(g => dayLog[g.id] && dayLog[g.id].done).length;
  const ratio = doneCount / activeGoals.length;
  if (ratio <= 0) return 0;
  if (ratio < 0.34) return 1;
  if (ratio < 0.67) return 2;
  if (ratio < 1) return 3;
  return 4;
}

function renderHeatmap() {
  const grid = document.getElementById('heatmap-grid');
  const monthsRow = document.getElementById('heatmap-months');
  const today = new Date();
  const weeks = 18;
  const todayDow = (today.getDay() + 6) % 7; // Monday=0
  const gridStart = new Date(today);
  gridStart.setDate(gridStart.getDate() - todayDow - (weeks - 1) * 7);

  let html = '';
  let monthLabels = [];
  let lastMonth = null;
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const cellDate = new Date(gridStart);
      cellDate.setDate(cellDate.getDate() + w * 7 + d);
      if (cellDate > today) { html += `<div class="heat-cell hc-empty"></div>`; continue; }
      const key = fmtDate(cellDate);
      const level = heatLevelForDate(key);
      const isToday = key === todayKey();
      if (d === 0) {
        const m = cellDate.getMonth();
        if (m !== lastMonth) { monthLabels.push({ week: w, label: cellDate.toLocaleDateString(undefined, { month: 'short' }) }); lastMonth = m; }
      }
      html += `<div class="heat-cell${level ? ' level-' + level : ''}${isToday ? ' hc-today' : ''}" data-date="${key}" title="${key}"></div>`;
    }
  }
  grid.innerHTML = html;
  monthsRow.innerHTML = monthLabels.map(m => `<span style="position:absolute; left:${m.week * 13}px;">${m.label}</span>`).join('');
  monthsRow.style.position = 'relative';

  grid.querySelectorAll('.heat-cell[data-date]').forEach(cell => {
    cell.addEventListener('click', () => openDaySheet(cell.dataset.date));
  });

  requestAnimationFrame(() => {
    const hs = document.getElementById('heatmap-scroll');
    hs.scrollLeft = hs.scrollWidth;
  });
}

function updateHeatmapCell(key) {
  const cell = document.querySelector(`#heatmap-grid .heat-cell[data-date="${key}"]`);
  if (!cell) return;
  const level = heatLevelForDate(key);
  cell.className = 'heat-cell' + (level ? ' level-' + level : '') + (key === todayKey() ? ' hc-today' : '');
}

/* ---------------- DAY SHEET ---------------- */
function openDaySheet(key) {
  const d = parseDateKey(key);
  document.getElementById('day-sheet-title').textContent = d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  document.getElementById('day-sheet-date').value = key;

  const goalsBox = document.getElementById('day-sheet-goals');
  goalsBox.innerHTML = '';
  const dayLog = state.logs[key] || {};
  const relevantGoals = state.goals.filter(g => !g.archived || dayLog[g.id]);
  if (relevantGoals.length === 0) {
    goalsBox.innerHTML = `<div class="empty-state">No goals to log against this day.</div>`;
  } else {
    relevantGoals.forEach(g => {
      const entry = dayLog[g.id] || { text: '', done: false };
      const row = document.createElement('div');
      row.className = 'goal-card';
      row.style.cursor = 'default';
      row.innerHTML = `
        <div class="goal-swatch" style="background:${g.color}"></div>
        <div class="goal-info" data-open="1">
          <div class="goal-name">${escapeHtml(g.name)}</div>
          ${entry.text ? `<div class="goal-note-preview">"${escapeHtml(entry.text)}"</div>` : `<div class="goal-meta">tap to log what you did</div>`}
        </div>
        <button class="goal-log-btn ${entry.done ? 'done' : ''}" data-goal="${g.id}">${entry.done ? '✓' : ''}</button>
      `;
      row.querySelector('.goal-log-btn').addEventListener('click', (e) => { e.stopPropagation(); toggleDone(g.id, key); });
      row.querySelector('[data-open]').addEventListener('click', () => openJournalSheet(g.id, key));
      goalsBox.appendChild(row);
    });
  }

  const progressBox = document.getElementById('day-sheet-progress');
  progressBox.innerHTML = '';
  const items = state.progress.daily[key] || [];
  items.slice().reverse().forEach(item => progressBox.appendChild(renderProgressItem(item, 'daily', key)));
  attachComposer(progressBox, 'Add a note — what did you do today?', (text) => {
    if (!state.progress.daily[key]) state.progress.daily[key] = [];
    state.progress.daily[key].push({ id: uid(), text, createdAt: Date.now() });
    saveState();
    updateCalendarDay(key);
    openDaySheet(key);
  });

  openSheet('day-sheet');
}


/* ---------------- PROGRESS TAB (daily/weekly/monthly/yearly) ---------------- */
function renderProgressItem(item, scope, key) {
  const row = document.createElement('div');
  row.className = 'progress-item';
  const time = new Date(item.createdAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  row.innerHTML = `<div class="txt">${escapeHtml(item.text)}<div class="ts">${time}</div></div><button class="del">✕</button>`;
  row.querySelector('.del').addEventListener('click', () => {
    state.progress[scope][key] = state.progress[scope][key].filter(i => i.id !== item.id);
    saveState();
    if (activeView === 'progress') renderProgress();
    updateCalendarDay(key);
  });
  return row;
}

function setProgressScope(scope) {
  progressScope = scope;
  document.querySelectorAll('.progress-scope-tabs button').forEach(b => b.classList.toggle('active', b.dataset.scope === scope));
  renderProgress();
}

function shiftProgressCursor(delta) {
  const d = new Date(progressCursorDate);
  if (progressScope === 'daily') d.setDate(d.getDate() + delta);
  if (progressScope === 'weekly') d.setDate(d.getDate() + delta * 7);
  if (progressScope === 'monthly') d.setMonth(d.getMonth() + delta);
  if (progressScope === 'yearly') d.setFullYear(d.getFullYear() + delta);
  progressCursorDate = d;
  renderProgress();
}

function renderProgress() {
  const isDaily = progressScope === 'daily';
  document.getElementById('day-strip-wrap').style.display = isDaily ? 'block' : 'none';
  document.getElementById('progress-arrow-header').style.display = isDaily ? 'none' : 'flex';

  let key, items, title;
  if (progressScope === 'daily') {
    key = fmtDate(progressCursorDate);
    title = progressCursorDate.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
    items = state.progress.daily[key] || [];
  } else if (progressScope === 'weekly') {
    key = isoWeekStorageKey(progressCursorDate);
    title = weekRangeLabel(progressCursorDate);
    items = state.progress.weekly[key] || [];
  } else if (progressScope === 'monthly') {
    key = monthKey(progressCursorDate);
    title = progressCursorDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    items = state.progress.monthly[key] || [];
  } else {
    key = yearKey(progressCursorDate);
    title = key;
    items = state.progress.yearly[key] || [];
  }

  if (isDaily) {
    document.getElementById('day-strip-label').textContent = title;
    renderDayStrip();
  } else {
    document.getElementById('progress-period-label').textContent = title;
  }
  document.getElementById('progress-current-key').value = key;

  const list = document.getElementById('progress-items-list');
  list.innerHTML = '';
  items.slice().reverse().forEach(item => list.appendChild(renderProgressItem(item, progressScope, key)));

  const composerHost = document.getElementById('progress-composer-host');
  composerHost.innerHTML = '';
  const placeholders = { daily: "What did you do today?", weekly: "What's the target this week?", monthly: "What's the milestone this month?", yearly: "What's the vision for this year?" };
  attachComposer(composerHost, placeholders[progressScope], (text) => {
    if (!state.progress[progressScope][key]) state.progress[progressScope][key] = [];
    state.progress[progressScope][key].push({ id: uid(), text, createdAt: Date.now() });
    saveState();
    renderProgress();
    if (progressScope === 'daily') updateCalendarDay(key);
  });
}

// Draggable Sun–Sat (and beyond) day picker for the daily Progress scope,
// replacing single-day prev/next arrow clicks.
function renderDayStrip() {
  const strip = document.getElementById('day-strip');
  const selectedKey = fmtDate(progressCursorDate);
  const base = new Date(); base.setDate(base.getDate() - 45);
  let html = '';
  for (let i = 0; i < 60; i++) {
    const d = new Date(base); d.setDate(d.getDate() + i);
    const key = fmtDate(d);
    const isSel = key === selectedKey;
    const isToday = key === todayKey();
    const hasEntries = (state.progress.daily[key] || []).length > 0;
    html += `<button class="day-pill${isSel ? ' selected' : ''}${isToday ? ' is-today' : ''}${hasEntries ? ' has-entries' : ''}" data-date="${key}">
      <div class="dp-dow">${d.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 1)}</div>
      <div class="dp-num">${d.getDate()}</div>
    </button>`;
  }
  strip.innerHTML = html;
  strip.querySelectorAll('.day-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      progressCursorDate = parseDateKey(btn.dataset.date);
      renderProgress();
    });
  });
  requestAnimationFrame(() => {
    const sel = strip.querySelector('.day-pill.selected');
    if (sel) sel.scrollIntoView({ inline: 'center', block: 'nearest' });
  });
}

/* ---------------- STATS ---------------- */
function renderStats() {
  const activeGoals = state.goals.filter(g => !g.archived);
  const allDateKeys = Object.keys(state.logs).filter(k => Object.values(state.logs[k]).some(v => v.done));

  const grindDays = allDateKeys.length;
  const firstGoalDate = state.goals.length ? state.goals.reduce((min, g) => g.createdAt < min ? g.createdAt : min, state.goals[0].createdAt) : todayKey();
  const daysSinceStart = Math.max(1, daysBetween(parseDateKey(todayKey()), parseDateKey(firstGoalDate)) + 1);
  const overallPct = Math.round((grindDays / daysSinceStart) * 100);

  let streak = 0, cursor = new Date();
  while (true) {
    const k = fmtDate(cursor);
    const dayLog = state.logs[k];
    if (dayLog && Object.values(dayLog).some(v => v.done)) { streak++; cursor.setDate(cursor.getDate() - 1); }
    else break;
  }

  const sortedKeys = allDateKeys.slice().sort();
  let longest = 0, run = 0, prevDate = null;
  sortedKeys.forEach(k => {
    const d = parseDateKey(k);
    if (prevDate && daysBetween(d, prevDate) === 1) run++;
    else run = 1;
    longest = Math.max(longest, run);
    prevDate = d;
  });

  document.getElementById('stat-overall-pct').textContent = state.goals.length ? overallPct + '%' : '—';
  document.getElementById('stat-streak').textContent = streak;
  document.getElementById('stat-longest').textContent = longest;
  document.getElementById('stat-total-days').textContent = grindDays;

  const mon = mondayOf(new Date());
  const prevMon = new Date(mon); prevMon.setDate(prevMon.getDate() - 7);
  function weekTotal(startMon) {
    let t = 0;
    for (let i = 0; i < 7; i++) {
      const d = new Date(startMon); d.setDate(d.getDate() + i);
      if (d > new Date()) break;
      const k = fmtDate(d);
      const log = state.logs[k];
      if (log) t += Object.values(log).filter(v => v.done).length;
    }
    return t;
  }
  const thisWeekTotal = weekTotal(mon);
  const lastWeekTotal = weekTotal(prevMon);

  const insightsBox = document.getElementById('stats-insights');
  insightsBox.innerHTML = '';
  const rows = [];
  rows.push(['This week vs last week', lastWeekTotal > 0 ? `${thisWeekTotal} vs ${lastWeekTotal}` : `${thisWeekTotal} logs so far`]);

  if (activeGoals.length > 0) {
    const goalPcts = activeGoals.map(g => {
      const goalDaysSince = Math.max(1, daysBetween(parseDateKey(todayKey()), parseDateKey(g.createdAt)) + 1);
      const hitDays = allDateKeys.filter(k => state.logs[k][g.id] && state.logs[k][g.id].done).length;
      return { name: g.name, pct: Math.min(100, Math.round((hitDays / goalDaysSince) * 100)) };
    });
    goalPcts.sort((a, b) => b.pct - a.pct);
    if (goalPcts.length > 0) rows.push(['Most consistent', `${goalPcts[0].name} · ${goalPcts[0].pct}%`]);
    if (goalPcts.length > 1) rows.push(['Needs attention', `${goalPcts[goalPcts.length - 1].name} · ${goalPcts[goalPcts.length - 1].pct}%`]);
  }
  rows.push(['Total goals tracked', `${state.goals.length}`]);

  rows.forEach(([label, val]) => {
    const r = document.createElement('div');
    r.className = 'insight-row';
    r.innerHTML = `<div class="label">${escapeHtml(label)}</div><div class="val">${escapeHtml(val)}</div>`;
    insightsBox.appendChild(r);
  });

  const perGoalBox = document.getElementById('per-goal-stats');
  perGoalBox.innerHTML = '';
  if (activeGoals.length === 0) {
    perGoalBox.innerHTML = `<div class="empty-state">Create goals and start logging to see analytics.</div>`;
  } else {
    activeGoals.forEach(g => {
      const goalDaysSince = Math.max(1, daysBetween(parseDateKey(todayKey()), parseDateKey(g.createdAt)) + 1);
      const hitDays = allDateKeys.filter(k => state.logs[k][g.id] && state.logs[k][g.id].done).length;
      const pct = Math.min(100, Math.round((hitDays / goalDaysSince) * 100));
      const row = document.createElement('div');
      row.className = 'goal-analytics-row';
      row.innerHTML = `
        <div class="goal-analytics-top">
          <div class="name"><span class="goal-swatch" style="background:${g.color}"></span>${escapeHtml(g.name)}</div>
          <div class="pct">${pct}% · ${hitDays}d</div>
        </div>
        <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${g.color}"></div></div>
      `;
      perGoalBox.appendChild(row);
    });
  }

  const wrapBox = document.getElementById('stats-wrap-box');
  const wrapMsg = generateWeeklyWrap();
  if (wrapMsg) {
    wrapBox.style.display = 'block';
    wrapBox.innerHTML = `<div class="wrap-title">This week's wrap</div><div class="wrap-body">${wrapMsg}</div>`;
  } else { wrapBox.style.display = 'none'; }
}

/* ---------------- Sheets ---------------- */
function openSheet(id) { document.getElementById('backdrop').classList.add('open'); document.getElementById(id).classList.add('open'); }
function closeSheet(id) {
  document.getElementById(id).classList.remove('open');
  const anyOpen = Array.from(document.querySelectorAll('.sheet')).some(s => s.classList.contains('open'));
  if (!anyOpen) document.getElementById('backdrop').classList.remove('open');
}
function closeAllSheets() {
  if (document.getElementById('goal-sheet').classList.contains('open')) { closeGoalSheet(); return; }
  document.querySelectorAll('.sheet').forEach(s => s.classList.remove('open'));
  document.getElementById('backdrop').classList.remove('open');
}

/* ---------------- Toast ---------------- */
let toastTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

/* ---------------- Settings / notifications ---------------- */
function renderSettings() {
  document.getElementById('reminder-toggle').classList.toggle('on', state.settings.remindersOn);
  document.getElementById('reminder-time-input').value = state.settings.reminderTime;
  document.getElementById('quotes-toggle').classList.toggle('on', state.settings.quotesOn);
  document.getElementById('darkmode-toggle').classList.toggle('on', state.settings.darkMode);
}
function applyTheme() {
  document.documentElement.setAttribute('data-theme', state.settings.darkMode ? 'dark' : 'light');
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) metaTheme.setAttribute('content', state.settings.darkMode ? '#16151A' : '#1B1A17');
}
function toggleDarkMode() {
  state.settings.darkMode = !state.settings.darkMode;
  saveState();
  applyTheme();
  renderSettings();
}
async function toggleReminders() {
  if (!state.settings.remindersOn) {
    if (!('Notification' in window)) { showToast('Notifications not supported in this browser.'); return; }
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { showToast('Notification permission denied.'); return; }
  }
  state.settings.remindersOn = !state.settings.remindersOn;
  saveState();
  renderSettings();
}
function toggleQuotesNotif() { state.settings.quotesOn = !state.settings.quotesOn; saveState(); renderSettings(); }
function checkAndFireReminder() {
  if (!state.settings.remindersOn) return;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const now = new Date();
  const [h, m] = state.settings.reminderTime.split(':').map(Number);
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
  const key = todayKey();
  if (now >= target && state.settings.lastReminderShown !== key) {
    const q = state.settings.quotesOn ? quotesForDay(key)[0] : null;
    const body = q ? `${q.text} — ${q.author}` : "Time to log today's progress in The Ledger.";
    try { new Notification('Stand', { body, icon: 'icons/icon-192.png' }); } catch (e) {}
    state.settings.lastReminderShown = key;
    saveState();
  }
}

/* ---------------- Utility ---------------- */
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function autoGrow(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = (el.scrollHeight) + 'px';
}

/* ---------------- Init ---------------- */
function init() {
  applyTheme();
  document.getElementById('header-date').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  document.querySelectorAll('nav.tabbar button').forEach(btn => btn.addEventListener('click', () => switchView(btn.dataset.view)));

  document.getElementById('fab-btn').addEventListener('click', () => {
    if (activeView === 'goals' || activeView === 'today') openGoalSheet();
    else if (activeView === 'calendar') openDaySheet(todayKey());
    else if (activeView === 'progress') { /* composer already visible */ }
  });

  document.getElementById('backdrop').addEventListener('click', closeAllSheets);
  document.querySelectorAll('[data-close-sheet]').forEach(btn => btn.addEventListener('click', () => {
    if (btn.dataset.closeSheet === 'goal-sheet') closeGoalSheet();
    else closeSheet(btn.dataset.closeSheet);
  }));

  document.getElementById('goal-name-input').addEventListener('input', goalSheetFieldChanged);
  document.getElementById('goal-vision-input').addEventListener('input', (e) => { autoGrow(e.target); goalSheetFieldChanged(); });
  document.getElementById('goal-delete-btn').addEventListener('click', archiveCurrentGoal);
  document.querySelectorAll('.breakdown-tabs button').forEach(btn => btn.addEventListener('click', () => setBreakdownTab(btn.dataset.tab)));

  document.getElementById('journal-save-btn').addEventListener('click', saveJournalEntry);
  document.getElementById('journal-done-toggle').addEventListener('click', toggleJournalDone);
  document.getElementById('journal-text').addEventListener('input', (e) => autoGrow(e.target));

  document.querySelectorAll('.progress-scope-tabs button').forEach(btn => btn.addEventListener('click', () => setProgressScope(btn.dataset.scope)));
  document.getElementById('progress-prev').addEventListener('click', () => shiftProgressCursor(-1));
  document.getElementById('progress-next').addEventListener('click', () => shiftProgressCursor(1));

  document.getElementById('settings-btn').addEventListener('click', () => { renderSettings(); openSheet('settings-sheet'); });
  document.getElementById('reminder-toggle').addEventListener('click', toggleReminders);
  document.getElementById('darkmode-toggle').addEventListener('click', toggleDarkMode);
  document.getElementById('quotes-toggle').addEventListener('click', toggleQuotesNotif);
  document.getElementById('reminder-time-input').addEventListener('change', e => { state.settings.reminderTime = e.target.value; saveState(); });

  document.getElementById('export-btn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'ledger-backup.json';
    a.click();
  });

  switchView('today');
  setInterval(checkAndFireReminder, 60000);
  checkAndFireReminder();

  // Robust autosave: persist on every visibility/lifecycle change, not just on data mutation.
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveState(); });
  window.addEventListener('pagehide', saveState);
  window.addEventListener('beforeunload', saveState);
  setInterval(saveState, 30000);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

document.addEventListener('DOMContentLoaded', init);
