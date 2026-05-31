/* ===========================================================
   Budget Quest — vanilla JS, localStorage-backed budget tracker
   with optional Firebase sync for cross-device household sharing.
   =========================================================== */

import * as sync from './sync.js';
import { firebaseConfig } from './firebase-config.js';

(() => {
  'use strict';

  const STORAGE_KEY = 'budget-quest:v1';
  const HOUSEHOLD_KEY = 'budget-quest:household';

  const HH_ADJ = ['mint', 'cobalt', 'crimson', 'amber', 'lilac', 'jade', 'frost', 'velvet', 'neon', 'solar', 'plum', 'coral', 'opal', 'rose', 'sage'];
  const HH_NOUN = ['fox', 'tiger', 'otter', 'finch', 'orca', 'lynx', 'wren', 'koi', 'badger', 'falcon', 'panda', 'moth', 'crane', 'sloth', 'puma'];

  const EMOJI_OPTIONS = [
    // Food & dining
    '🛒', '🥦', '🍔', '🍽️', '☕', '🍷', '🍕',
    // Home
    '🏠', '💡', '🧹', '🌱', '🔧', '🛋️',
    // Transport
    '🚗', '⛽', '🚌', '✈️', '🅿️',
    // Kids & education
    '👶', '🧸', '🎓', '📚', '✏️',
    // Shopping & clothes
    '👕', '🛍️', '💍',
    // Health & beauty
    '💊', '🏥', '💄', '💇',
    // Entertainment & hobbies
    '🎮', '🎬', '📺', '🎵', '⚽', '🏋️', '🎨',
    // Pets
    '🐕', '🐾',
    // Gifts & holidays
    '🎁', '❤️', '🎄',
    // Work & tech
    '💼', '💻', '📱',
    // Finance & bills
    '🏦', '🧾', '💸', '☂️'
  ];
  const COLOR_OPTIONS = [
    '#6366f1', '#818cf8', '#3b82f6', '#0ea5e9',
    '#06b6d4', '#14b8a6', '#10b981', '#84cc16',
    '#eab308', '#f59e0b', '#f97316', '#ef4444',
    '#f43f5e', '#ec4899', '#d946ef', '#a855f7',
    '#8b5cf6', '#64748b'
  ];

  // ---------- State ----------
  /**
   * data shape:
   * {
   *   currentPeriod: "YYYY-MM-DD",       // start date of the active pay period
   *   periods: {
   *     "YYYY-MM-DD": {                  // each period keyed by its start date
   *       income: [{id, name, amount, note, recurring}],
   *       categories: [{
   *         id, name, limit, color, icon,
   *         expenses: [{id, name, amount, note, recurring}]
   *       }]
   *     }
   *   }
   * }
   */
  let data = migrate(load());
  let editingCategoryId = null;       // when set, category modal is editing
  let activeExpenseTarget = null;     // {categoryId, expenseId?} — expenseId set means edit mode
  let editingIncomeId = null;         // income modal: id when editing, null when adding
  let listingCategoryId = null;       // category whose all-expenses modal is open
  let viewingPeriod = null;            // when viewing a non-active period (read-only)
  let confirmAction = null;
  let syncState = 'local';            // local | connecting | synced | syncing | offline | error
  let suspendPush = false;            // true while applying a remote update

  /**
   * One-time migrations:
   * 1. Flatten legacy sub-budget expenses into the parent category.
   * 2. Convert older bucket names ('months' or short-lived 'cycles')
   *    over to the current 'periods' shape, with date-based keys
   *    (YYYY-MM-DD). Legacy month keys ('YYYY-MM') assume a 1st-of-month
   *    start so every expense stays in the right bucket.
   */
  function migrate(d) {
    if (!d) return d;
    // months → periods
    if (d.months && !d.periods) {
      d.periods = {};
      for (const key of Object.keys(d.months)) {
        const dateKey = key.length === 7 ? `${key}-01` : key;
        d.periods[dateKey] = d.months[key];
      }
      delete d.months;
    }
    // cycles → periods (in case someone tested an interim build)
    if (d.cycles && !d.periods) {
      d.periods = d.cycles;
      delete d.cycles;
    }
    if (d.currentMonth && !d.currentPeriod) {
      d.currentPeriod = d.currentMonth.length === 7 ? `${d.currentMonth}-01` : d.currentMonth;
      delete d.currentMonth;
    }
    if (d.currentCycle && !d.currentPeriod) {
      d.currentPeriod = d.currentCycle;
      delete d.currentCycle;
    }
    // Sub-budget flattening
    for (const key of Object.keys(d.periods || {})) {
      const m = d.periods[key];
      for (const cat of (m.categories || [])) {
        if (Array.isArray(cat.subs) && cat.subs.length) {
          cat.expenses = cat.expenses || [];
          for (const sub of cat.subs) {
            for (const e of (sub.expenses || [])) {
              cat.expenses.push({ id: uid(), name: `${sub.name}: ${e.name}`, amount: e.amount });
            }
          }
        }
        delete cat.subs;
      }
    }
    return d;
  }

  // ---------- Storage ----------
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { console.warn('Failed to load saved data', e); }
    const start = todayPeriodKey();
    return {
      currentPeriod: start,
      periods: {
        [start]: { income: [], categories: [] }
      }
    };
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) { console.warn('Failed to save', e); }
    if (!suspendPush && sync.getCurrentCode()) {
      sync.pushLocal(data);
    }
  }

  // ---------- Helpers ----------
  function uid() { return Math.random().toString(36).slice(2, 10); }

  function periodKey(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function todayPeriodKey() {
    return periodKey(new Date());
  }

  function parsePeriodKey(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  /**
   * Days elapsed from a period's start to today (whole calendar days).
   */
  function daysSincePeriodStart(key) {
    const start = parsePeriodKey(key);
    const now = new Date();
    const startMs = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
    const nowMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return Math.floor((nowMs - startMs) / 86400000);
  }

  /**
   * A period is overdue once we're past its 28-day window. Only the active
   * period can be "overdue" — past periods are already locked in history.
   */
  function isPeriodOverdue(key) {
    return key === data.currentPeriod && daysSincePeriodStart(key) >= 28;
  }

  /**
   * Render a period as a roughly-4-week range starting from its paycheck
   * date. If it's the *active* period and we're past the 28-day window,
   * flip the end to "present" so the label honestly signals "you're
   * overdue for a reset."
   */
  function periodLabel(key) {
    const start = parsePeriodKey(key);
    const now = new Date().getFullYear();
    const sOpts = { month: 'short', day: 'numeric' };
    if (start.getFullYear() !== now) sOpts.year = 'numeric';
    const startStr = start.toLocaleDateString(undefined, sOpts);

    if (isPeriodOverdue(key)) {
      return `${startStr} – present`;
    }
    const end = new Date(start);
    end.setDate(end.getDate() + 27);
    const eOpts = { month: 'short', day: 'numeric' };
    if (end.getFullYear() !== now) eOpts.year = 'numeric';
    return `${startStr} – ${end.toLocaleDateString(undefined, eOpts)}`;
  }

  function fmt(n) {
    if (!isFinite(n)) n = 0;
    const sign = n < 0 ? '-' : '';
    const abs = Math.abs(n);
    return sign + '$' + abs.toLocaleString(undefined, {
      minimumFractionDigits: abs % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2
    });
  }

  function getPeriod(key = activePeriod()) {
    if (!data.periods[key]) data.periods[key] = { income: [], categories: [] };
    return data.periods[key];
  }

  function activePeriod() {
    return viewingPeriod || data.currentPeriod;
  }

  function isReadOnly() {
    return viewingPeriod !== null && viewingPeriod !== data.currentPeriod;
  }

  function categorySpent(cat) {
    return (cat.expenses || []).reduce((s, e) => s + (+e.amount || 0), 0);
  }

  function totalIncome(m = getPeriod()) {
    return (m.income || []).reduce((s, i) => s + (+i.amount || 0), 0);
  }

  function totalBudget(m = getPeriod()) {
    return (m.categories || []).reduce((s, c) => s + (+c.limit || 0), 0);
  }

  function totalSpent(m = getPeriod()) {
    return (m.categories || []).reduce((s, c) => s + categorySpent(c), 0);
  }

  // ---------- Rendering ----------
  function render() {
    renderHeader();
    renderOverdueBanner();
    renderDashboard();
    renderChart();
    renderIncome();
    renderCategories();
  }

  function renderOverdueBanner() {
    const banner = document.getElementById('overdue-banner');
    if (!banner) return;
    // Only nudge on the active period — past periods being "overdue"
    // is meaningless since they've already been replaced.
    if (viewingPeriod || !isPeriodOverdue(data.currentPeriod)) {
      banner.hidden = true;
      return;
    }
    const days = daysSincePeriodStart(data.currentPeriod);
    const text = document.getElementById('overdue-text');
    text.textContent = `It's been ${days} days since your last paycheck — time to start a new pay period?`;
    banner.hidden = false;
  }

  function renderChart() {
    const m = getPeriod();
    const section = document.getElementById('breakdown-section');
    const container = document.getElementById('chart-container');
    const slices = (m.categories || [])
      .map(c => ({ id: c.id, name: c.name, color: c.color || '#7c5cff', icon: c.icon, value: categorySpent(c) }))
      .filter(s => s.value > 0);

    const total = slices.reduce((s, x) => s + x.value, 0);
    if (total <= 0) {
      section.hidden = true;
      container.innerHTML = '';
      return;
    }
    section.hidden = false;
    slices.sort((a, b) => b.value - a.value);

    const r = 80;
    const stroke = 26;
    const cx = 100, cy = 100;
    const circumference = 2 * Math.PI * r;
    let dashOffset = 0;
    const segments = slices.map(s => {
      const fraction = s.value / total;
      const length = fraction * circumference;
      const seg = {
        ...s,
        fraction,
        length,
        offset: dashOffset
      };
      dashOffset += length;
      return seg;
    });

    const segMarkup = segments.map(seg => `
      <circle class="donut-segment"
              cx="${cx}" cy="${cy}" r="${r}"
              stroke="${seg.color}"
              stroke-dasharray="${seg.length.toFixed(2)} ${(circumference - seg.length).toFixed(2)}"
              stroke-dashoffset="${(-seg.offset).toFixed(2)}"
              transform="rotate(-90 ${cx} ${cy})"></circle>
    `).join('');

    const legendMarkup = segments.map(seg => `
      <div class="donut-legend-item" data-cat="${seg.id}">
        <span class="swatch" style="background: ${seg.color}"></span>
        <span class="legend-name">${seg.icon ? seg.icon + ' ' : ''}${escapeHtml(seg.name)}</span>
        <span><span class="legend-amount">${fmt(seg.value)}</span><span class="legend-pct">${Math.round(seg.fraction * 100)}%</span></span>
      </div>
    `).join('');

    container.innerHTML = `
      <div class="donut-wrap">
        <svg class="donut-svg" viewBox="0 0 200 200" aria-hidden="true">
          <circle class="donut-track" cx="${cx}" cy="${cy}" r="${r}"></circle>
          ${segMarkup}
        </svg>
        <div class="donut-center">
          <div>
            <div class="donut-total">${fmt(total)}</div>
            <div class="donut-label">Spent this period</div>
          </div>
        </div>
      </div>
      <div class="donut-legend">${legendMarkup}</div>
    `;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function renderHeader() {
    const key = activePeriod();
    const isCurrent = key === data.currentPeriod;
    document.getElementById('month-name').textContent = periodLabel(key);
    const status = document.getElementById('month-status');
    status.textContent = isCurrent ? 'Active' : 'Viewing';
    status.classList.toggle('viewing', !isCurrent);

    document.getElementById('reset-month').hidden = !isCurrent;
    document.getElementById('unlock-month').hidden = isCurrent;
    // Clear is available on both active and historical months — sometimes you
    // just want to wipe the current month's data without archiving it.
    document.getElementById('clear-month').hidden = false;

    // Disable add buttons when read-only
    const ro = isReadOnly();
    document.getElementById('add-income-btn').disabled = ro;
    document.getElementById('add-category-btn').disabled = ro;
    document.getElementById('add-income-btn').style.opacity = ro ? 0.5 : 1;
    document.getElementById('add-category-btn').style.opacity = ro ? 0.5 : 1;
    document.getElementById('add-income-btn').style.pointerEvents = ro ? 'none' : '';
    document.getElementById('add-category-btn').style.pointerEvents = ro ? 'none' : '';
  }

  function renderDashboard() {
    const m = getPeriod();
    const income = totalIncome(m);
    const budget = totalBudget(m);
    const spent = totalSpent(m);
    const remaining = income - spent;

    document.getElementById('stat-income').textContent = fmt(income);
    document.getElementById('stat-budget').textContent = fmt(budget);
    document.getElementById('stat-spent').textContent = fmt(spent);
    const remEl = document.getElementById('stat-remaining');
    remEl.textContent = fmt(remaining);
    remEl.style.color = remaining < 0 ? 'var(--bad)' : remaining > 0 ? 'var(--good)' : 'var(--ink)';
  }

  function renderIncome() {
    const m = getPeriod();
    const list = document.getElementById('income-list');
    list.innerHTML = '';
    if (!m.income || m.income.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-row';
      empty.textContent = 'No income yet — add a paycheck or side hustle.';
      empty.style.gridColumn = '1 / -1';
      list.appendChild(empty);
      return;
    }
    const ro = isReadOnly();
    m.income.forEach((inc, i) => {
      const el = document.createElement('div');
      el.className = 'income-item';
      el.style.animationDelay = `${i * 0.04}s`;
      const recurring = inc.recurring ? '<span class="recurring-icon" title="Recurring">🔁</span>' : '';
      el.innerHTML = `
        <div class="name-block">
          <div class="name">${recurring}<span class="inc-name-text"></span></div>
        </div>
        <div style="display:flex;align-items:center;">
          <span class="amount"></span>
        </div>
      `;
      el.querySelector('.inc-name-text').textContent = inc.name;
      el.querySelector('.amount').textContent = fmt(inc.amount);
      if (!ro) {
        el.style.cursor = 'pointer';
        el.addEventListener('click', () => openIncomeModal(inc.id));
      }
      list.appendChild(el);
    });
  }

  function renderCategories() {
    const m = getPeriod();
    const grid = document.getElementById('categories-grid');
    const empty = document.getElementById('empty-state');
    grid.innerHTML = '';

    if (!m.categories || m.categories.length === 0) {
      empty.hidden = false;
      return;
    }
    empty.hidden = true;

    m.categories.forEach((cat, idx) => {
      const card = renderCategoryCard(cat, idx);
      grid.appendChild(card);
    });
  }

  function renderCategoryCard(cat, idx) {
    const spent = categorySpent(cat);
    const limit = +cat.limit || 0;
    const pct = limit > 0 ? (spent / limit) * 100 : 0;
    const over = spent > limit && limit > 0;
    const warn = !over && pct >= 80;

    const card = document.createElement('div');
    card.className = 'category-card' + (over ? ' over' : '');
    card.style.setProperty('--cat-color', cat.color || '#7c5cff');
    card.style.animationDelay = `${idx * 0.05}s`;

    const ro = isReadOnly();
    card.innerHTML = `
      <div class="cat-head">
        <div class="cat-icon"></div>
        <div class="cat-title">
          <span class="cat-name"></span>
          <span class="cat-amounts"></span>
        </div>
        <div class="cat-actions">
          ${ro ? '' : `
            <button class="cat-add-btn" data-act="add-expense" title="Add expense">
              <span class="plus">＋</span><span class="cat-add-label">Expense</span>
            </button>
            <button class="cat-icon-btn" data-act="edit" title="Edit category" aria-label="Edit category">✎</button>
            <button class="cat-icon-btn" data-act="delete" title="Delete category" aria-label="Delete category">🗑</button>
          `}
        </div>
      </div>
      <div class="bar ${over ? 'over' : warn ? 'warn' : ''}">
        <div class="bar-fill" style="width: ${Math.min(pct, 100)}%"></div>
      </div>
      <div class="bar-meta">
        <span><span class="pct">${Math.round(pct)}%</span> of limit</span>
        <span>
          ${over ? `<span class="over-tag">OVER ${fmt(spent - limit)}</span>` : ''}
        </span>
      </div>
    `;

    card.querySelector('.cat-icon').textContent = cat.icon || '🛒';
    card.querySelector('.cat-name').textContent = cat.name;
    card.querySelector('.cat-amounts').textContent = `${fmt(spent)} of ${fmt(limit)}`;

    // Recent expenses (clickable chips). Show last 3 + "View all" if more.
    const allExpenses = cat.expenses || [];
    const recentExpenses = allExpenses.slice(-3).reverse();
    if (recentExpenses.length) {
      const recent = document.createElement('div');
      recent.className = 'recent';
      recentExpenses.forEach(e => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'chip chip-clickable';
        chip.title = e.note ? `${e.name} — ${e.note}` : e.name;
        const recurring = e.recurring ? '<span class="recurring-icon">🔁</span> ' : '';
        chip.innerHTML = `${recurring}<span></span><strong></strong>`;
        chip.querySelectorAll('span')[recurring ? 1 : 0].textContent = e.name;
        chip.querySelector('strong').textContent = fmt(e.amount);
        if (!ro) chip.addEventListener('click', () => openExpenseModal(cat.id, e.id));
        recent.appendChild(chip);
      });
      if (allExpenses.length > 3) {
        const more = document.createElement('button');
        more.type = 'button';
        more.className = 'chip chip-more';
        more.textContent = `View all (${allExpenses.length})`;
        more.addEventListener('click', () => openExpenseListModal(cat.id));
        recent.appendChild(more);
      }
      card.appendChild(recent);
    }

    // Bind actions
    card.querySelectorAll('.cat-actions button').forEach(btn => {
      btn.addEventListener('click', () => {
        const act = btn.dataset.act;
        if (act === 'add-expense') openExpenseModal(cat.id);
        else if (act === 'edit') openCategoryModal(cat.id);
        else if (act === 'delete') confirmDelete(`Delete "${cat.name}"?`, 'All its expenses will be removed too.', () => deleteCategory(cat.id));
      });
    });

    return card;
  }

  // ---------- Mutations ----------
  function addIncome({ name, amount, note, recurring }) {
    if (isReadOnly()) return;
    const m = getPeriod();
    m.income.push({
      id: uid(),
      name,
      amount: +amount,
      note: note || '',
      recurring: !!recurring
    });
    save();
    render();
    fireConfetti(['#10b981', '#34d399', '#06b6d4']);
    toast(`+${fmt(amount)} income added 💸`, 'success');
  }

  function updateIncome(id, patch) {
    if (isReadOnly()) return;
    const m = getPeriod();
    const inc = (m.income || []).find(i => i.id === id);
    if (!inc) return;
    Object.assign(inc, patch);
    save();
    render();
  }

  function removeIncome(id) {
    if (isReadOnly()) return;
    const m = getPeriod();
    m.income = m.income.filter(i => i.id !== id);
    save();
    render();
  }

  function addCategory({ name, limit, color, icon }) {
    if (isReadOnly()) return;
    const m = getPeriod();
    m.categories.push({
      id: uid(), name, limit: +limit, color, icon,
      expenses: []
    });
    save();
    render();
    toast(`Category "${name}" added 🎯`, 'success');
  }

  function updateCategory(id, patch) {
    const m = getPeriod();
    const c = m.categories.find(c => c.id === id);
    if (!c) return;
    Object.assign(c, patch);
    save();
    render();
  }

  function deleteCategory(id) {
    const m = getPeriod();
    const cat = m.categories.find(c => c.id === id);
    m.categories = m.categories.filter(c => c.id !== id);
    save();
    render();
    if (cat) toast(`Removed "${cat.name}"`, 'info');
  }

  function addExpense(categoryId, { name, amount, note, recurring }) {
    if (isReadOnly()) return;
    const m = getPeriod();
    const cat = m.categories.find(c => c.id === categoryId);
    if (!cat) return;
    cat.expenses = cat.expenses || [];
    cat.expenses.push({
      id: uid(),
      name,
      amount: +amount,
      note: note || '',
      recurring: !!recurring
    });
    save();
    render();

    // Visual feedback if went over
    const limit = +cat.limit || 0;
    const spent = categorySpent(cat);
    if (spent > limit && limit > 0) {
      shakeViewport();
      toast(`⚠️ Over budget on "${cat.name}" by ${fmt(spent - limit)}`, 'error');
    } else if (limit > 0 && spent / limit >= 0.8) {
      toast(`Watch out — "${cat.name}" at ${Math.round(spent / limit * 100)}%`, 'info');
    }
  }

  function updateExpense(categoryId, expenseId, patch) {
    if (isReadOnly()) return;
    const m = getPeriod();
    const cat = m.categories.find(c => c.id === categoryId);
    if (!cat) return;
    const exp = (cat.expenses || []).find(e => e.id === expenseId);
    if (!exp) return;
    Object.assign(exp, patch);
    save();
    render();
  }

  function deleteExpense(categoryId, expenseId) {
    if (isReadOnly()) return;
    const m = getPeriod();
    const cat = m.categories.find(c => c.id === categoryId);
    if (!cat) return;
    cat.expenses = (cat.expenses || []).filter(e => e.id !== expenseId);
    save();
    render();
    toast('Expense removed', 'info');
  }

  function startNewPeriod() {
    // The new period starts today (when the user actually got paid). If
    // they click twice in the same day, roll forward a day at a time
    // until we find an unused date — clicking twice the same day is rare
    // but we don't want to silently lose the second click.
    const d = new Date();
    let key = periodKey(d);
    while (data.periods[key]) {
      d.setDate(d.getDate() + 1);
      key = periodKey(d);
    }

    // Carry over category structure with reset spending — but recurring
    // expenses get auto-copied into the new period so things like rent and
    // subscriptions don't have to be re-entered every period.
    const prev = data.periods[data.currentPeriod];
    const carriedCategories = (prev?.categories || []).map(c => ({
      id: uid(),
      name: c.name,
      limit: c.limit,
      color: c.color,
      icon: c.icon,
      expenses: (c.expenses || [])
        .filter(e => e.recurring)
        .map(e => ({ id: uid(), name: e.name, amount: e.amount, note: e.note || '', recurring: true }))
    }));

    // Carry over recurring income too.
    const carriedIncome = (prev?.income || [])
      .filter(i => i.recurring)
      .map(i => ({ id: uid(), name: i.name, amount: i.amount, note: i.note || '', recurring: true }));

    data.periods[key] = { income: carriedIncome, categories: carriedCategories };
    data.currentPeriod = key;
    viewingPeriod = null;
    save();
    render();
    fireConfetti();
    const recurringCount = carriedIncome.length + carriedCategories.reduce((s, c) => s + c.expenses.length, 0);
    const note = recurringCount > 0 ? ` (${recurringCount} recurring auto-added 🔁)` : '';
    toast(`New period started: ${periodLabel(key)}${note} 🚀`, 'success');
  }

  /**
   * Make the currently-viewed historical month active again.
   * The previously-active month becomes a regular historical entry — it isn't
   * deleted, so nothing is destroyed by mistake. The user can then delete it
   * separately if it was an empty/accidental month.
   */
  function reactivatePeriod() {
    if (!viewingPeriod || viewingPeriod === data.currentPeriod) return;
    const newActive = viewingPeriod;
    data.currentPeriod = newActive;
    viewingPeriod = null;
    save();
    render();
    toast(`${periodLabel(newActive)} is active again 🔓`, 'success');
  }

  /**
   * Reset whichever month is currently being viewed (active or historical):
   * drop income and all expenses, but keep the month entry and its category
   * definitions. Useful for "I messed up, start this month over without
   * archiving it" or for cleaning up an accidental new month.
   */
  function clearPeriod() {
    const key = activePeriod();
    const m = data.periods[key];
    if (!m) return;
    m.income = [];
    (m.categories || []).forEach(c => { c.expenses = []; });
    save();
    render();
    toast(`Cleared ${periodLabel(key)} 🧹`, 'info');
  }

  // ---------- Modals ----------
  function openCategoryModal(id = null) {
    if (isReadOnly()) return;
    editingCategoryId = id;
    const modal = document.getElementById('category-modal');
    const title = document.getElementById('category-modal-title');
    const nameInput = document.getElementById('cat-name');
    const limitInput = document.getElementById('cat-limit');
    const iconInput = document.getElementById('cat-icon');
    const colorInput = document.getElementById('cat-color');

    if (id) {
      const cat = getPeriod().categories.find(c => c.id === id);
      title.textContent = 'Edit Category';
      nameInput.value = cat.name;
      limitInput.value = cat.limit;
      iconInput.value = cat.icon || '🛒';
      colorInput.value = cat.color || '#7c5cff';
    } else {
      title.textContent = 'New Category';
      nameInput.value = '';
      limitInput.value = '';
      iconInput.value = '🛒';
      colorInput.value = '#7c5cff';
    }
    paintEmojiGrid(iconInput.value);
    paintColorGrid(colorInput.value);
    modal.hidden = false;
    setTimeout(() => nameInput.focus(), 50);
  }

  function paintEmojiGrid(active) {
    const grid = document.getElementById('emoji-grid');
    grid.innerHTML = '';
    EMOJI_OPTIONS.forEach(em => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = em;
      if (em === active) b.classList.add('active');
      b.addEventListener('click', () => {
        document.getElementById('cat-icon').value = em;
        grid.querySelectorAll('button').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
      });
      grid.appendChild(b);
    });
  }

  function paintColorGrid(active) {
    const grid = document.getElementById('color-grid');
    grid.innerHTML = '';
    COLOR_OPTIONS.forEach(col => {
      const b = document.createElement('button');
      b.type = 'button';
      b.style.background = col;
      if (col === active) b.classList.add('active');
      b.addEventListener('click', () => {
        document.getElementById('cat-color').value = col;
        grid.querySelectorAll('button').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
      });
      grid.appendChild(b);
    });
  }

  function openExpenseModal(categoryId, expenseId) {
    if (isReadOnly()) return;
    const cat = getPeriod().categories.find(c => c.id === categoryId);
    if (!cat) return;
    activeExpenseTarget = { categoryId, expenseId: expenseId || null };

    const modal = document.getElementById('expense-modal');
    const title = document.getElementById('expense-modal-title');
    const nameEl = document.getElementById('exp-name');
    const amountEl = document.getElementById('exp-amount');
    const noteEl = document.getElementById('exp-note');
    const recurringEl = document.getElementById('exp-recurring');
    const saveBtn = document.getElementById('exp-save-btn');
    const deleteBtn = document.getElementById('exp-delete-btn');

    if (expenseId) {
      const exp = (cat.expenses || []).find(e => e.id === expenseId);
      if (!exp) return;
      title.textContent = `Edit · ${cat.name}`;
      nameEl.value = exp.name || '';
      amountEl.value = exp.amount;
      noteEl.value = exp.note || '';
      recurringEl.checked = !!exp.recurring;
      saveBtn.textContent = 'Save';
      deleteBtn.hidden = false;
    } else {
      title.textContent = `Add to ${cat.name}`;
      nameEl.value = '';
      amountEl.value = '';
      noteEl.value = '';
      recurringEl.checked = false;
      saveBtn.textContent = 'Add';
      deleteBtn.hidden = true;
    }
    modal.hidden = false;
    setTimeout(() => nameEl.focus(), 50);
  }

  function openIncomeModal(incomeId) {
    if (isReadOnly()) return;
    editingIncomeId = incomeId || null;

    const title = document.getElementById('income-modal-title');
    const nameEl = document.getElementById('inc-name');
    const amountEl = document.getElementById('inc-amount');
    const noteEl = document.getElementById('inc-note');
    const recurringEl = document.getElementById('inc-recurring');
    const saveBtn = document.getElementById('inc-save-btn');
    const deleteBtn = document.getElementById('inc-delete-btn');

    if (incomeId) {
      const inc = (getPeriod().income || []).find(i => i.id === incomeId);
      if (!inc) return;
      title.textContent = 'Edit Income';
      nameEl.value = inc.name || '';
      amountEl.value = inc.amount;
      noteEl.value = inc.note || '';
      recurringEl.checked = !!inc.recurring;
      saveBtn.textContent = 'Save';
      deleteBtn.hidden = false;
    } else {
      title.textContent = 'Add Income';
      nameEl.value = '';
      amountEl.value = '';
      noteEl.value = '';
      recurringEl.checked = false;
      saveBtn.textContent = 'Add';
      deleteBtn.hidden = true;
    }
    document.getElementById('income-modal').hidden = false;
    setTimeout(() => nameEl.focus(), 50);
  }

  function openExpenseListModal(categoryId) {
    listingCategoryId = categoryId;
    const cat = getPeriod().categories.find(c => c.id === categoryId);
    if (!cat) return;
    const title = document.getElementById('expense-list-title');
    const body = document.getElementById('expense-list-body');
    const ro = isReadOnly();
    title.textContent = `${cat.icon || '🛒'}  ${cat.name} expenses`;
    const expenses = [...(cat.expenses || [])].reverse();
    if (expenses.length === 0) {
      body.innerHTML = '<div class="empty-row">No expenses yet for this category.</div>';
    } else {
      body.innerHTML = '';
      expenses.forEach(e => {
        const row = document.createElement('div');
        row.className = 'expense-row';
        const recurring = e.recurring ? '<span class="recurring-icon" title="Recurring">🔁</span>' : '';
        const note = e.note ? `<div class="expense-note"></div>` : '';
        row.innerHTML = `
          <div class="expense-main">
            <div class="expense-name">${recurring}<span class="exp-name-text"></span></div>
            ${note}
          </div>
          <div class="expense-amount"></div>
        `;
        row.querySelector('.exp-name-text').textContent = e.name;
        row.querySelector('.expense-amount').textContent = fmt(e.amount);
        if (e.note) row.querySelector('.expense-note').textContent = e.note;
        if (!ro) {
          row.addEventListener('click', () => {
            document.getElementById('expense-list-modal').hidden = true;
            openExpenseModal(categoryId, e.id);
          });
        } else {
          row.style.cursor = 'default';
        }
        body.appendChild(row);
      });
    }
    document.getElementById('expense-list-modal').hidden = false;
  }

  function openHistoryModal() {
    const list = document.getElementById('history-list');
    list.innerHTML = '';
    const keys = Object.keys(data.periods).sort().reverse();
    keys.forEach(k => {
      const m = data.periods[k];
      const inc = totalIncome(m);
      const sp = totalSpent(m);
      const saved = inc - sp;
      const item = document.createElement('div');
      item.className = 'history-item' + (k === activePeriod() ? ' current' : '');
      item.innerHTML = `
        <div class="history-month">${periodLabel(k)}${k === data.currentPeriod ? ' • Active' : ''}</div>
        <div class="history-stats">
          <div><span>Income</span><span>${fmt(inc)}</span></div>
          <div><span>Spent</span><span>${fmt(sp)}</span></div>
          <div><span>Net</span><span class="${saved >= 0 ? 'saved' : 'over'}">${fmt(saved)}</span></div>
        </div>
      `;
      item.addEventListener('click', () => {
        viewingPeriod = k === data.currentPeriod ? null : k;
        document.getElementById('history-modal').hidden = true;
        render();
        toast(`Viewing ${periodLabel(k)}${k === data.currentPeriod ? ' (active)' : ' (snapshot)'}`, 'info');
      });
      list.appendChild(item);
    });
    if (keys.length === 0) {
      list.innerHTML = '<p class="muted">No periods yet.</p>';
    }
    document.getElementById('history-modal').hidden = false;
  }

  function confirmDelete(title, msg, fn) {
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').textContent = msg;
    confirmAction = fn;
    document.getElementById('confirm-modal').hidden = false;
  }

  function closeAllModals() {
    document.querySelectorAll('.modal').forEach(m => m.hidden = true);
  }

  // ---------- Effects ----------
  function fireConfetti(palette) {
    const colors = palette || ['#6366f1', '#f43f5e', '#10b981', '#f59e0b', '#06b6d4'];
    const layer = document.getElementById('confetti-layer');
    const count = 60;
    for (let i = 0; i < count; i++) {
      const piece = document.createElement('div');
      piece.className = 'confetti';
      piece.style.left = Math.random() * 100 + 'vw';
      piece.style.background = colors[Math.floor(Math.random() * colors.length)];
      piece.style.animationDuration = (1.6 + Math.random() * 1.5) + 's';
      piece.style.animationDelay = Math.random() * 0.4 + 's';
      piece.style.transform = `rotate(${Math.random() * 360}deg)`;
      piece.style.width = (6 + Math.random() * 6) + 'px';
      piece.style.height = (10 + Math.random() * 10) + 'px';
      layer.appendChild(piece);
      setTimeout(() => piece.remove(), 3500);
    }
  }

  function shakeViewport() {
    const main = document.querySelector('main');
    main.style.animation = 'none';
    void main.offsetWidth;
    main.style.animation = 'shake 0.5s ease';
  }

  function toast(message, kind = 'info') {
    const c = document.getElementById('toast-container');
    const t = document.createElement('div');
    t.className = 'toast ' + kind;
    t.textContent = message;
    c.appendChild(t);
    setTimeout(() => t.remove(), 3200);
  }

  // ---------- Sync ----------
  function generateHouseholdCode() {
    const a = HH_ADJ[Math.floor(Math.random() * HH_ADJ.length)];
    const n = HH_NOUN[Math.floor(Math.random() * HH_NOUN.length)];
    const num = Math.floor(Math.random() * 90 + 10);
    return `${a}-${n}-${num}`;
  }

  function setSyncStatus(s) {
    syncState = s;
    const el = document.getElementById('sync-indicator');
    if (!el) return;
    el.classList.remove('local', 'connecting', 'syncing', 'synced', 'offline', 'error');
    el.classList.add(s);
    const labels = {
      local: 'Local',
      connecting: 'Connecting…',
      syncing: 'Syncing…',
      synced: 'Synced',
      offline: 'Offline',
      error: 'Sync error'
    };
    el.querySelector('.sync-label').textContent = labels[s] || s;
    const code = sync.getCurrentCode();
    el.title = code ? `Household: ${code}` : 'Set up household sync';
  }

  async function startSync() {
    if (!sync.isConfigured(firebaseConfig)) {
      setSyncStatus('local');
      return;
    }
    try {
      await sync.init(firebaseConfig);
      sync.onStatus(setSyncStatus);
      const savedCode = localStorage.getItem(HOUSEHOLD_KEY);
      if (savedCode && sync.isValidCode(savedCode)) {
        await joinHousehold(savedCode, /* silent */ true);
      } else {
        // First run: prompt for household
        openHouseholdModal();
      }
    } catch (e) {
      console.warn('Sync init failed', e);
      setSyncStatus('error');
      const detail = e?.code || e?.message || 'unknown';
      toast(`Sync init failed: ${detail}`, 'error');
    }
  }

  async function joinHousehold(code, silent = false) {
    code = (code || '').trim().toLowerCase();
    if (!sync.isValidCode(code)) {
      toast('Code must be 6+ characters (letters, numbers, dashes).', 'error');
      return false;
    }
    setSyncStatus('connecting');
    try {
      const remote = await sync.joinHousehold(code, applyRemote);
      localStorage.setItem(HOUSEHOLD_KEY, code);
      if (remote) {
        suspendPush = true;
        data = migrate(remote);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        suspendPush = false;
        render();
        if (!silent) toast(`Joined household "${code}" 🤝`, 'success');
      } else {
        // New / empty household — push local state to seed it
        sync.pushLocal(data);
        if (!silent) toast(`Household "${code}" created. Share the code!`, 'success');
      }
      setSyncStatus('synced');
      return true;
    } catch (e) {
      console.warn('joinHousehold failed', e);
      setSyncStatus('error');
      const detail = e?.code || e?.message || 'unknown';
      toast(`Could not join household: ${detail}`, 'error');
      return false;
    }
  }

  function applyRemote(remoteData) {
    if (!remoteData) return;
    suspendPush = true;
    // Remote payloads from older clients may still use the legacy
    // months/cycles shape — run migration before using.
    data = migrate(remoteData);
    if (viewingPeriod && !data.periods[viewingPeriod]) viewingPeriod = null;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    suspendPush = false;
    render();
    toast('Updated from your household 🔄', 'info');
  }

  function disconnectSync() {
    sync.disconnect();
    localStorage.removeItem(HOUSEHOLD_KEY);
    setSyncStatus('local');
    toast('Disconnected. Using local-only mode.', 'info');
  }

  // ---------- Household & sync modals ----------
  function openHouseholdModal() {
    if (!sync.isConfigured(firebaseConfig)) {
      toast('Sync isn\'t set up. See README for Firebase steps.', 'info');
      return;
    }
    const modal = document.getElementById('household-modal');
    // Reset to "Create" tab
    modal.querySelectorAll('.hh-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'create'));
    modal.querySelectorAll('.hh-pane').forEach(p => p.hidden = p.dataset.pane !== 'create');
    document.getElementById('hh-suggested-code').textContent = generateHouseholdCode();
    document.getElementById('hh-join-code').value = '';
    modal.hidden = false;
  }

  function openSyncModal() {
    if (!sync.isConfigured(firebaseConfig)) {
      // Bring up the setup pointer
      const body = document.getElementById('sync-status-body');
      body.innerHTML = `
        <p class="muted">Sync isn't configured yet. Open <code>firebase-config.js</code> and follow the steps in <code>README.md</code>.</p>
      `;
      document.getElementById('sync-disconnect-btn').style.display = 'none';
      document.getElementById('sync-change-btn').style.display = 'none';
      document.getElementById('sync-modal').hidden = false;
      return;
    }
    const code = sync.getCurrentCode();
    const body = document.getElementById('sync-status-body');
    if (code) {
      body.innerHTML = `
        <div class="sync-status-row">
          <span class="label">Status</span>
          <span class="value" id="sync-status-text">${syncState}</span>
        </div>
        <div class="sync-status-row">
          <span class="label">Household</span>
          <span class="value"><code id="sync-current-code">${code}</code></span>
        </div>
        <div class="sync-status-row">
          <button type="button" class="ghost-btn" id="sync-copy-btn" style="width:100%;">📋 Copy code to share</button>
        </div>
      `;
      document.getElementById('sync-disconnect-btn').style.display = '';
      document.getElementById('sync-change-btn').style.display = '';
      document.getElementById('sync-copy-btn').addEventListener('click', () => {
        navigator.clipboard.writeText(code).then(() => toast('Code copied 📋', 'success'));
      });
    } else {
      body.innerHTML = `<p class="muted">Not connected to a household yet.</p>`;
      document.getElementById('sync-disconnect-btn').style.display = 'none';
      document.getElementById('sync-change-btn').textContent = 'Set up sync';
      document.getElementById('sync-change-btn').style.display = '';
    }
    document.getElementById('sync-modal').hidden = false;
  }

  // ---------- Wire up events ----------
  function bindEvents() {
    // Month switcher
    document.getElementById('prev-month').addEventListener('click', () => {
      const keys = Object.keys(data.periods).sort();
      const cur = activePeriod();
      const idx = keys.indexOf(cur);
      if (idx > 0) {
        viewingPeriod = keys[idx - 1] === data.currentPeriod ? null : keys[idx - 1];
        render();
      }
    });
    document.getElementById('next-month').addEventListener('click', () => {
      const keys = Object.keys(data.periods).sort();
      const cur = activePeriod();
      const idx = keys.indexOf(cur);
      if (idx >= 0 && idx < keys.length - 1) {
        viewingPeriod = keys[idx + 1] === data.currentPeriod ? null : keys[idx + 1];
        render();
      }
    });
    const newPeriodPrompt = () => confirmDelete(
      'Start a new pay period?',
      'This locks in the current period as history and starts a fresh one today. Categories carry over with $0 spent; anything marked 🔁 Recurring auto-copies in.',
      startNewPeriod
    );
    document.getElementById('reset-month').addEventListener('click', newPeriodPrompt);
    document.getElementById('overdue-action').addEventListener('click', newPeriodPrompt);
    document.getElementById('unlock-month').addEventListener('click', reactivatePeriod);
    document.getElementById('clear-month').addEventListener('click', () => {
      const label = periodLabel(activePeriod());
      confirmDelete(`Clear ${label}?`, 'Income and all expenses for this period will be reset to zero. Your categories stay.', clearPeriod);
    });
    document.getElementById('history-btn').addEventListener('click', openHistoryModal);

    // Add buttons
    document.getElementById('add-income-btn').addEventListener('click', () => openIncomeModal());
    document.getElementById('add-category-btn').addEventListener('click', () => openCategoryModal());

    // Modal close-on-backdrop / × / Esc
    document.querySelectorAll('.modal [data-close]').forEach(el => {
      el.addEventListener('click', closeAllModals);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeAllModals();
    });

    // Category form
    document.getElementById('category-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const name = document.getElementById('cat-name').value.trim();
      const limit = +document.getElementById('cat-limit').value;
      const icon = document.getElementById('cat-icon').value;
      const color = document.getElementById('cat-color').value;
      if (!name || limit < 0) return;
      if (editingCategoryId) {
        updateCategory(editingCategoryId, { name, limit, icon, color });
      } else {
        addCategory({ name, limit, icon, color });
      }
      editingCategoryId = null;
      closeAllModals();
    });

    // Expense form (add OR edit)
    document.getElementById('expense-form').addEventListener('submit', (e) => {
      e.preventDefault();
      if (!activeExpenseTarget) return;
      const name = document.getElementById('exp-name').value.trim();
      const amount = +document.getElementById('exp-amount').value;
      const note = document.getElementById('exp-note').value.trim();
      const recurring = document.getElementById('exp-recurring').checked;
      if (!name || amount < 0) return;
      const { categoryId, expenseId } = activeExpenseTarget;
      if (expenseId) {
        updateExpense(categoryId, expenseId, { name, amount: +amount, note, recurring });
      } else {
        addExpense(categoryId, { name, amount, note, recurring });
      }
      activeExpenseTarget = null;
      closeAllModals();
    });

    document.getElementById('exp-delete-btn').addEventListener('click', () => {
      if (!activeExpenseTarget || !activeExpenseTarget.expenseId) return;
      const { categoryId, expenseId } = activeExpenseTarget;
      activeExpenseTarget = null;
      closeAllModals();
      deleteExpense(categoryId, expenseId);
    });

    // Income form (add OR edit)
    document.getElementById('income-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const name = document.getElementById('inc-name').value.trim();
      const amount = +document.getElementById('inc-amount').value;
      const note = document.getElementById('inc-note').value.trim();
      const recurring = document.getElementById('inc-recurring').checked;
      if (!name || amount < 0) return;
      if (editingIncomeId) {
        updateIncome(editingIncomeId, { name, amount: +amount, note, recurring });
      } else {
        addIncome({ name, amount, note, recurring });
      }
      editingIncomeId = null;
      closeAllModals();
    });

    document.getElementById('inc-delete-btn').addEventListener('click', () => {
      if (!editingIncomeId) return;
      const id = editingIncomeId;
      editingIncomeId = null;
      closeAllModals();
      removeIncome(id);
      toast('Income removed', 'info');
    });

    // Confirm modal
    document.getElementById('confirm-ok').addEventListener('click', () => {
      if (typeof confirmAction === 'function') confirmAction();
      confirmAction = null;
      closeAllModals();
    });

    // Sync indicator click
    document.getElementById('sync-indicator').addEventListener('click', openSyncModal);

    // Household modal: tab switch
    document.querySelectorAll('#household-modal .hh-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.tab;
        document.querySelectorAll('#household-modal .hh-tab').forEach(t => t.classList.toggle('active', t === tab));
        document.querySelectorAll('#household-modal .hh-pane').forEach(p => p.hidden = p.dataset.pane !== target);
      });
    });

    // Household modal: regen code
    document.getElementById('hh-regen').addEventListener('click', () => {
      document.getElementById('hh-suggested-code').textContent = generateHouseholdCode();
    });

    // Household modal: copy code
    document.getElementById('hh-copy').addEventListener('click', () => {
      const code = document.getElementById('hh-suggested-code').textContent;
      navigator.clipboard.writeText(code).then(() => toast('Code copied 📋', 'success'));
    });

    // Household modal: create
    document.getElementById('hh-create-btn').addEventListener('click', async () => {
      const code = document.getElementById('hh-suggested-code').textContent;
      const ok = await joinHousehold(code);
      if (ok) closeAllModals();
    });

    // Household modal: join
    document.getElementById('hh-join-btn').addEventListener('click', async () => {
      const code = document.getElementById('hh-join-code').value;
      const ok = await joinHousehold(code);
      if (ok) closeAllModals();
    });
    document.getElementById('hh-join-code').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('hh-join-btn').click();
    });

    // Household modal: skip
    document.getElementById('hh-skip').addEventListener('click', () => {
      setSyncStatus('local');
      closeAllModals();
    });

    // Sync modal actions
    document.getElementById('sync-disconnect-btn').addEventListener('click', () => {
      closeAllModals();
      confirmDelete('Disconnect from household?', 'Your local data stays. You can rejoin any time.', disconnectSync);
    });
    document.getElementById('sync-change-btn').addEventListener('click', () => {
      closeAllModals();
      openHouseholdModal();
    });
  }

  // ---------- Theme (dark / light) ----------
  const THEME_KEY = 'budget-quest:theme';

  function preferredTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    const tc = document.querySelector('meta[name="theme-color"]');
    if (tc) tc.content = theme === 'dark' ? '#0e0e11' : '#6366f1';
    const btn = document.getElementById('theme-toggle');
    if (btn) {
      btn.textContent = theme === 'dark' ? '☀️' : '🌙';
      btn.title = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
    }
  }

  function toggleTheme() {
    const next = (document.documentElement.dataset.theme === 'dark') ? 'light' : 'dark';
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
  }

  function setupTheme() {
    applyTheme(preferredTheme());
    document.getElementById('theme-toggle').addEventListener('click', toggleTheme);
    // Track system preference changes only when user hasn't picked explicitly.
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      if (!localStorage.getItem(THEME_KEY)) applyTheme(e.matches ? 'dark' : 'light');
    });
  }

  // ---------- PWA install + offline ----------
  let deferredInstall = null;

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true;
  }

  function isIosSafari() {
    const ua = navigator.userAgent;
    const ios = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
    const safari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
    return ios && safari;
  }

  function setupPWA() {
    // Register the service worker (offline + install eligibility).
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./service-worker.js').catch((err) => {
        console.warn('Service worker registration failed', err);
      });
    }

    // Don't offer install if already running as an installed app.
    if (isStandalone()) return;

    const installBtn = document.getElementById('install-btn');

    // Chrome / Edge / Android: capture the prompt event, show our button.
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredInstall = e;
      installBtn.hidden = false;
    });

    // iOS Safari has no beforeinstallprompt — show the button so we can
    // open a friendly instructions modal when tapped.
    if (isIosSafari()) installBtn.hidden = false;

    installBtn.addEventListener('click', async () => {
      if (deferredInstall) {
        deferredInstall.prompt();
        const { outcome } = await deferredInstall.userChoice;
        deferredInstall = null;
        installBtn.hidden = true;
        if (outcome === 'accepted') {
          fireConfetti();
          toast('Installed! 🎉', 'success');
        }
      } else {
        document.getElementById('install-modal').hidden = false;
      }
    });

    window.addEventListener('appinstalled', () => {
      installBtn.hidden = true;
      deferredInstall = null;
      toast('Installed! 🎉', 'success');
    });
  }

  // ---------- Boot ----------
  function boot() {
    setupTheme();
    bindEvents();
    render();
    setSyncStatus('local');
    startSync();
    setupPWA();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
