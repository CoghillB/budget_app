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

  const EMOJI_OPTIONS = ['🛒', '🍔', '🏠', '🚗', '🎮', '✈️', '👕', '💊', '📚', '💡', '🎬', '☕', '🐕', '🎁', '💼', '🏋️', '✂️', '🎵', '🍷', '📱'];
  const COLOR_OPTIONS = ['#7c5cff', '#00e0ff', '#ff5cf3', '#2bd99f', '#ffb648', '#ff4d6d', '#ff7a3c', '#5cffb1', '#5c8aff', '#c95cff'];

  // ---------- State ----------
  /**
   * data shape:
   * {
   *   currentMonth: "YYYY-MM",
   *   months: {
   *     "YYYY-MM": {
   *       income: [{id, name, amount}],
   *       categories: [{
   *         id, name, limit, color, icon,
   *         expenses: [{id, name, amount}]
   *       }]
   *     }
   *   }
   * }
   */
  let data = migrate(load());
  let editingCategoryId = null;       // when set, category modal is editing
  let activeExpenseTarget = null;     // {categoryId}
  let viewingMonth = null;            // when viewing historical (read-only)
  let confirmAction = null;
  let syncState = 'local';            // local | connecting | synced | syncing | offline | error
  let suspendPush = false;            // true while applying a remote update

  /**
   * One-time migration: legacy categories may have a `subs` array with
   * their own expenses. Flatten those into the parent's expenses and drop
   * the subs field so existing users don't lose data.
   */
  function migrate(d) {
    if (!d || !d.months) return d;
    for (const key of Object.keys(d.months)) {
      const m = d.months[key];
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
    const month = monthKey(new Date());
    return {
      currentMonth: month,
      months: {
        [month]: { income: [], categories: [] }
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

  function monthKey(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  function monthLabel(key) {
    const [y, m] = key.split('-').map(Number);
    const d = new Date(y, m - 1, 1);
    return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
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

  function getMonth(key = activeMonth()) {
    if (!data.months[key]) data.months[key] = { income: [], categories: [] };
    return data.months[key];
  }

  function activeMonth() {
    return viewingMonth || data.currentMonth;
  }

  function isReadOnly() {
    return viewingMonth !== null && viewingMonth !== data.currentMonth;
  }

  function categorySpent(cat) {
    return (cat.expenses || []).reduce((s, e) => s + (+e.amount || 0), 0);
  }

  function totalIncome(m = getMonth()) {
    return (m.income || []).reduce((s, i) => s + (+i.amount || 0), 0);
  }

  function totalBudget(m = getMonth()) {
    return (m.categories || []).reduce((s, c) => s + (+c.limit || 0), 0);
  }

  function totalSpent(m = getMonth()) {
    return (m.categories || []).reduce((s, c) => s + categorySpent(c), 0);
  }

  // ---------- Rendering ----------
  function render() {
    renderHeader();
    renderDashboard();
    renderIncome();
    renderCategories();
  }

  function renderHeader() {
    const key = activeMonth();
    const isCurrent = key === data.currentMonth;
    document.getElementById('month-name').textContent = monthLabel(key);
    const status = document.getElementById('month-status');
    status.textContent = isCurrent ? 'Active' : 'Viewing';
    status.classList.toggle('viewing', !isCurrent);

    document.getElementById('reset-month').hidden = !isCurrent;
    document.getElementById('unlock-month').hidden = isCurrent;
    document.getElementById('clear-month').hidden = isCurrent;

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
    const m = getMonth();
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
    const m = getMonth();
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
    m.income.forEach((inc, i) => {
      const el = document.createElement('div');
      el.className = 'income-item';
      el.style.animationDelay = `${i * 0.04}s`;
      el.innerHTML = `
        <div>
          <div class="name"></div>
        </div>
        <div style="display:flex;align-items:center;">
          <span class="amount"></span>
          ${isReadOnly() ? '' : '<button class="delete" title="Remove">×</button>'}
        </div>
      `;
      el.querySelector('.name').textContent = inc.name;
      el.querySelector('.amount').textContent = fmt(inc.amount);
      const del = el.querySelector('.delete');
      if (del) del.addEventListener('click', () => removeIncome(inc.id));
      list.appendChild(el);
    });
  }

  function renderCategories() {
    const m = getMonth();
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
            <button data-act="add-expense" title="Add expense">＋</button>
            <button data-act="edit" title="Edit">✎</button>
            <button data-act="delete" title="Delete">🗑</button>
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

    // Recent expenses (chips)
    const recentExpenses = (cat.expenses || []).slice(-3).reverse();
    if (recentExpenses.length) {
      const recent = document.createElement('div');
      recent.className = 'recent';
      recentExpenses.forEach(e => {
        const chip = document.createElement('span');
        chip.className = 'chip';
        const nameSpan = document.createElement('span');
        nameSpan.textContent = e.name;
        const amt = document.createElement('strong');
        amt.textContent = fmt(e.amount);
        chip.appendChild(nameSpan);
        chip.appendChild(amt);
        recent.appendChild(chip);
      });
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
  function addIncome(name, amount) {
    if (isReadOnly()) return;
    const m = getMonth();
    m.income.push({ id: uid(), name, amount: +amount });
    save();
    render();
    fireConfetti(['#10b981', '#34d399', '#06b6d4']);
    toast(`+${fmt(amount)} income added 💸`, 'success');
  }

  function removeIncome(id) {
    if (isReadOnly()) return;
    const m = getMonth();
    m.income = m.income.filter(i => i.id !== id);
    save();
    render();
  }

  function addCategory({ name, limit, color, icon }) {
    if (isReadOnly()) return;
    const m = getMonth();
    m.categories.push({
      id: uid(), name, limit: +limit, color, icon,
      expenses: []
    });
    save();
    render();
    toast(`Category "${name}" added 🎯`, 'success');
  }

  function updateCategory(id, patch) {
    const m = getMonth();
    const c = m.categories.find(c => c.id === id);
    if (!c) return;
    Object.assign(c, patch);
    save();
    render();
  }

  function deleteCategory(id) {
    const m = getMonth();
    const cat = m.categories.find(c => c.id === id);
    m.categories = m.categories.filter(c => c.id !== id);
    save();
    render();
    if (cat) toast(`Removed "${cat.name}"`, 'info');
  }

  function addExpense(categoryId, name, amount) {
    if (isReadOnly()) return;
    const m = getMonth();
    const cat = m.categories.find(c => c.id === categoryId);
    if (!cat) return;
    cat.expenses = cat.expenses || [];
    cat.expenses.push({ id: uid(), name, amount: +amount });
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

  function startNewMonth() {
    const today = new Date();
    let key = monthKey(today);
    // If a month with that key already exists, append a sequence
    if (data.months[key] && key === data.currentMonth) {
      // Roll forward by 1 month
      const [y, m] = key.split('-').map(Number);
      const next = new Date(y, m, 1); // month is 0-based; passing m moves to next month
      key = monthKey(next);
    }
    while (data.months[key]) {
      const [y, m] = key.split('-').map(Number);
      const next = new Date(y, m, 1);
      key = monthKey(next);
    }

    // Carry over category structure with reset spending
    const prev = data.months[data.currentMonth];
    const carriedCategories = (prev?.categories || []).map(c => ({
      id: uid(),
      name: c.name,
      limit: c.limit,
      color: c.color,
      icon: c.icon,
      expenses: []
    }));

    data.months[key] = { income: [], categories: carriedCategories };
    data.currentMonth = key;
    viewingMonth = null;
    save();
    render();
    fireConfetti();
    toast(`New month started: ${monthLabel(key)} 🚀`, 'success');
  }

  /**
   * Make the currently-viewed historical month active again.
   * The previously-active month becomes a regular historical entry — it isn't
   * deleted, so nothing is destroyed by mistake. The user can then delete it
   * separately if it was an empty/accidental month.
   */
  function reactivateMonth() {
    if (!viewingMonth || viewingMonth === data.currentMonth) return;
    const newActive = viewingMonth;
    data.currentMonth = newActive;
    viewingMonth = null;
    save();
    render();
    toast(`${monthLabel(newActive)} is active again 🔓`, 'success');
  }

  /**
   * Reset the currently-viewed historical month: drop income and all
   * expenses, but keep the month entry and its category definitions.
   * Useful for cleaning up an accidental "New Month" without losing the
   * structure of categories you already set up.
   */
  function clearHistoricalMonth() {
    if (!viewingMonth || viewingMonth === data.currentMonth) return;
    const m = data.months[viewingMonth];
    if (!m) return;
    m.income = [];
    (m.categories || []).forEach(c => { c.expenses = []; });
    save();
    render();
    toast(`Cleared ${monthLabel(viewingMonth)}`, 'info');
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
      const cat = getMonth().categories.find(c => c.id === id);
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

  function openExpenseModal(categoryId) {
    if (isReadOnly()) return;
    activeExpenseTarget = { categoryId };
    const modal = document.getElementById('expense-modal');
    const title = document.getElementById('expense-modal-title');
    const cat = getMonth().categories.find(c => c.id === categoryId);
    title.textContent = `Add to ${cat.name}`;
    document.getElementById('exp-name').value = '';
    document.getElementById('exp-amount').value = '';
    modal.hidden = false;
    setTimeout(() => document.getElementById('exp-name').focus(), 50);
  }

  function openIncomeModal() {
    if (isReadOnly()) return;
    document.getElementById('inc-name').value = '';
    document.getElementById('inc-amount').value = '';
    document.getElementById('income-modal').hidden = false;
    setTimeout(() => document.getElementById('inc-name').focus(), 50);
  }

  function openHistoryModal() {
    const list = document.getElementById('history-list');
    list.innerHTML = '';
    const keys = Object.keys(data.months).sort().reverse();
    keys.forEach(k => {
      const m = data.months[k];
      const inc = totalIncome(m);
      const sp = totalSpent(m);
      const saved = inc - sp;
      const item = document.createElement('div');
      item.className = 'history-item' + (k === activeMonth() ? ' current' : '');
      item.innerHTML = `
        <div class="history-month">${monthLabel(k)}${k === data.currentMonth ? ' • Active' : ''}</div>
        <div class="history-stats">
          <div><span>Income</span><span>${fmt(inc)}</span></div>
          <div><span>Spent</span><span>${fmt(sp)}</span></div>
          <div><span>Net</span><span class="${saved >= 0 ? 'saved' : 'over'}">${fmt(saved)}</span></div>
        </div>
      `;
      item.addEventListener('click', () => {
        viewingMonth = k === data.currentMonth ? null : k;
        document.getElementById('history-modal').hidden = true;
        render();
        toast(`Viewing ${monthLabel(k)}${k === data.currentMonth ? ' (active)' : ' (snapshot)'}`, 'info');
      });
      list.appendChild(item);
    });
    if (keys.length === 0) {
      list.innerHTML = '<p class="muted">No months yet.</p>';
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
      toast('Could not start sync. Working offline.', 'error');
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
        data = remote;
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
      toast('Could not join household. Try again.', 'error');
      return false;
    }
  }

  function applyRemote(remoteData) {
    if (!remoteData) return;
    suspendPush = true;
    data = remoteData;
    if (viewingMonth && !data.months[viewingMonth]) viewingMonth = null;
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
      const keys = Object.keys(data.months).sort();
      const cur = activeMonth();
      const idx = keys.indexOf(cur);
      if (idx > 0) {
        viewingMonth = keys[idx - 1] === data.currentMonth ? null : keys[idx - 1];
        render();
      }
    });
    document.getElementById('next-month').addEventListener('click', () => {
      const keys = Object.keys(data.months).sort();
      const cur = activeMonth();
      const idx = keys.indexOf(cur);
      if (idx >= 0 && idx < keys.length - 1) {
        viewingMonth = keys[idx + 1] === data.currentMonth ? null : keys[idx + 1];
        render();
      }
    });
    document.getElementById('reset-month').addEventListener('click', () => {
      confirmDelete('Start a new month?', 'This locks in the current month as history and starts fresh. Your categories carry over with $0 spent.', startNewMonth);
    });
    document.getElementById('unlock-month').addEventListener('click', reactivateMonth);
    document.getElementById('clear-month').addEventListener('click', () => {
      if (!viewingMonth || viewingMonth === data.currentMonth) return;
      const label = monthLabel(viewingMonth);
      confirmDelete(`Clear ${label}?`, 'Income and all expenses for this month will be reset to zero. Your categories stay.', clearHistoricalMonth);
    });
    document.getElementById('history-btn').addEventListener('click', openHistoryModal);

    // Add buttons
    document.getElementById('add-income-btn').addEventListener('click', openIncomeModal);
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

    // Expense form
    document.getElementById('expense-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const name = document.getElementById('exp-name').value.trim();
      const amount = +document.getElementById('exp-amount').value;
      if (!name || amount < 0 || !activeExpenseTarget) return;
      addExpense(activeExpenseTarget.categoryId, name, amount);
      activeExpenseTarget = null;
      closeAllModals();
    });

    // Income form
    document.getElementById('income-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const name = document.getElementById('inc-name').value.trim();
      const amount = +document.getElementById('inc-amount').value;
      if (!name || amount < 0) return;
      addIncome(name, amount);
      closeAllModals();
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

  // ---------- Boot ----------
  function boot() {
    bindEvents();
    render();
    setSyncStatus('local');
    startSync();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
