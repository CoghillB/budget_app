/* ===========================================================
   Budget Quest — vanilla JS, localStorage-backed budget tracker
   =========================================================== */

(() => {
  'use strict';

  const STORAGE_KEY = 'budget-quest:v1';

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
   *         expenses: [{id, name, amount}],
   *         subs: [{id, name, limit, expenses: [...]}]
   *       }]
   *     }
   *   }
   * }
   */
  let data = load();
  let editingCategoryId = null;       // when set, category modal is editing
  let activeExpenseTarget = null;     // {categoryId, subId|null}
  let activeSubCategoryId = null;     // for sub-budget modal
  let viewingMonth = null;            // when viewing historical (read-only)
  let confirmAction = null;

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
    let total = (cat.expenses || []).reduce((s, e) => s + (+e.amount || 0), 0);
    (cat.subs || []).forEach(sub => {
      total += (sub.expenses || []).reduce((s, e) => s + (+e.amount || 0), 0);
    });
    return total;
  }

  function subSpent(sub) {
    return (sub.expenses || []).reduce((s, e) => s + (+e.amount || 0), 0);
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
    document.getElementById('month-name').textContent = monthLabel(key);
    const status = document.getElementById('month-status');
    if (key === data.currentMonth) {
      status.textContent = 'Active';
    } else {
      status.textContent = 'Viewing';
    }

    const resetBtn = document.getElementById('reset-month');
    const isCurrent = key === data.currentMonth;
    resetBtn.style.display = isCurrent ? '' : 'none';

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
      <div class="subs-container"></div>
    `;

    card.querySelector('.cat-icon').textContent = cat.icon || '🛒';
    card.querySelector('.cat-name').textContent = cat.name;
    card.querySelector('.cat-amounts').textContent = `${fmt(spent)} of ${fmt(limit)}`;

    // Sub-budgets
    const subsContainer = card.querySelector('.subs-container');
    if ((cat.subs && cat.subs.length) || !ro) {
      const subs = document.createElement('div');
      subs.className = 'subs';
      (cat.subs || []).forEach(sub => subs.appendChild(renderSub(cat, sub)));
      if (!ro) {
        const add = document.createElement('button');
        add.className = 'cat-add-sub';
        add.textContent = '+ Add Sub-Budget';
        add.addEventListener('click', () => openSubModal(cat.id));
        subs.appendChild(add);
      }
      subsContainer.appendChild(subs);
    }

    // Recent direct expenses (chips)
    const direct = (cat.expenses || []).slice(-3).reverse();
    if (direct.length) {
      const recent = document.createElement('div');
      recent.className = 'recent';
      direct.forEach(e => {
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
        if (act === 'add-expense') openExpenseModal(cat.id, null);
        else if (act === 'edit') openCategoryModal(cat.id);
        else if (act === 'delete') confirmDelete(`Delete "${cat.name}"?`, 'All expenses & sub-budgets in this category will be removed.', () => deleteCategory(cat.id));
      });
    });

    return card;
  }

  function renderSub(cat, sub) {
    const spent = subSpent(sub);
    const limit = +sub.limit || 0;
    const pct = limit > 0 ? (spent / limit) * 100 : 0;
    const over = spent > limit && limit > 0;
    const warn = !over && pct >= 80;

    const el = document.createElement('div');
    el.className = 'sub';
    const ro = isReadOnly();
    el.innerHTML = `
      <div class="sub-head">
        <div>
          <div class="sub-name"></div>
          <div class="sub-amounts"></div>
        </div>
        <div class="sub-actions">
          ${ro ? '' : `
            <button data-act="add">+ exp</button>
            <button data-act="del">×</button>
          `}
        </div>
      </div>
      <div class="bar ${over ? 'over' : warn ? 'warn' : ''}">
        <div class="bar-fill" style="width: ${Math.min(pct, 100)}%"></div>
      </div>
    `;
    el.querySelector('.sub-name').textContent = sub.name;
    el.querySelector('.sub-amounts').textContent =
      `${fmt(spent)} / ${fmt(limit)} · ${Math.round(pct)}%${over ? ' · OVER ' + fmt(spent - limit) : ''}`;

    el.querySelectorAll('.sub-actions button').forEach(b => {
      b.addEventListener('click', () => {
        if (b.dataset.act === 'add') openExpenseModal(cat.id, sub.id);
        else if (b.dataset.act === 'del') confirmDelete(`Delete sub-budget "${sub.name}"?`, 'Its expenses will be removed.', () => deleteSub(cat.id, sub.id));
      });
    });
    return el;
  }

  // ---------- Mutations ----------
  function addIncome(name, amount) {
    if (isReadOnly()) return;
    const m = getMonth();
    m.income.push({ id: uid(), name, amount: +amount });
    save();
    render();
    fireConfetti(['#2bd99f', '#5cffb1', '#00e0ff']);
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
      expenses: [], subs: []
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

  function addExpense(categoryId, subId, name, amount) {
    if (isReadOnly()) return;
    const m = getMonth();
    const cat = m.categories.find(c => c.id === categoryId);
    if (!cat) return;
    const expense = { id: uid(), name, amount: +amount };
    if (subId) {
      const sub = (cat.subs || []).find(s => s.id === subId);
      if (!sub) return;
      sub.expenses = sub.expenses || [];
      sub.expenses.push(expense);
    } else {
      cat.expenses = cat.expenses || [];
      cat.expenses.push(expense);
    }
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

  function addSub(categoryId, name, limit) {
    if (isReadOnly()) return;
    const m = getMonth();
    const cat = m.categories.find(c => c.id === categoryId);
    if (!cat) return;
    cat.subs = cat.subs || [];
    cat.subs.push({ id: uid(), name, limit: +limit, expenses: [] });
    save();
    render();
  }

  function deleteSub(categoryId, subId) {
    const m = getMonth();
    const cat = m.categories.find(c => c.id === categoryId);
    if (!cat) return;
    cat.subs = (cat.subs || []).filter(s => s.id !== subId);
    save();
    render();
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
      expenses: [],
      subs: (c.subs || []).map(s => ({
        id: uid(),
        name: s.name,
        limit: s.limit,
        expenses: []
      }))
    }));

    data.months[key] = { income: [], categories: carriedCategories };
    data.currentMonth = key;
    viewingMonth = null;
    save();
    render();
    fireConfetti();
    toast(`New month started: ${monthLabel(key)} 🚀`, 'success');
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

  function openExpenseModal(categoryId, subId) {
    if (isReadOnly()) return;
    activeExpenseTarget = { categoryId, subId };
    const modal = document.getElementById('expense-modal');
    const title = document.getElementById('expense-modal-title');
    const cat = getMonth().categories.find(c => c.id === categoryId);
    if (subId) {
      const sub = cat.subs.find(s => s.id === subId);
      title.textContent = `Add to ${cat.name} › ${sub.name}`;
    } else {
      title.textContent = `Add to ${cat.name}`;
    }
    document.getElementById('exp-name').value = '';
    document.getElementById('exp-amount').value = '';
    modal.hidden = false;
    setTimeout(() => document.getElementById('exp-name').focus(), 50);
  }

  function openSubModal(categoryId) {
    if (isReadOnly()) return;
    activeSubCategoryId = categoryId;
    document.getElementById('sub-name').value = '';
    document.getElementById('sub-limit').value = '';
    document.getElementById('sub-modal').hidden = false;
    setTimeout(() => document.getElementById('sub-name').focus(), 50);
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
    const colors = palette || ['#7c5cff', '#00e0ff', '#ff5cf3', '#2bd99f', '#ffb648'];
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

  // ---------- Particle background ----------
  function initBackground() {
    const canvas = document.getElementById('bg-canvas');
    const ctx = canvas.getContext('2d');
    let w, h;
    const dots = [];
    const COUNT = 40;

    function resize() {
      w = canvas.width = window.innerWidth * window.devicePixelRatio;
      h = canvas.height = window.innerHeight * window.devicePixelRatio;
    }
    window.addEventListener('resize', resize);
    resize();

    for (let i = 0; i < COUNT; i++) {
      dots.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.3 * window.devicePixelRatio,
        vy: (Math.random() - 0.5) * 0.3 * window.devicePixelRatio,
        r: (1 + Math.random() * 2) * window.devicePixelRatio,
        c: Math.random() > 0.5 ? 'rgba(124, 92, 255, 0.55)' : 'rgba(0, 224, 255, 0.45)'
      });
    }

    function tick() {
      ctx.clearRect(0, 0, w, h);
      // connections
      for (let i = 0; i < dots.length; i++) {
        for (let j = i + 1; j < dots.length; j++) {
          const a = dots[i], b = dots[j];
          const dx = a.x - b.x, dy = a.y - b.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          const max = 140 * window.devicePixelRatio;
          if (d < max) {
            ctx.strokeStyle = `rgba(124, 92, 255, ${0.18 * (1 - d / max)})`;
            ctx.lineWidth = 1 * window.devicePixelRatio;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }
      // dots
      for (const d of dots) {
        d.x += d.vx; d.y += d.vy;
        if (d.x < 0 || d.x > w) d.vx *= -1;
        if (d.y < 0 || d.y > h) d.vy *= -1;
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.fillStyle = d.c;
        ctx.fill();
      }
      requestAnimationFrame(tick);
    }
    tick();
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
      addExpense(activeExpenseTarget.categoryId, activeExpenseTarget.subId, name, amount);
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

    // Sub-budget form
    document.getElementById('sub-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const name = document.getElementById('sub-name').value.trim();
      const limit = +document.getElementById('sub-limit').value;
      if (!name || limit < 0 || !activeSubCategoryId) return;
      addSub(activeSubCategoryId, name, limit);
      activeSubCategoryId = null;
      closeAllModals();
    });

    // Confirm modal
    document.getElementById('confirm-ok').addEventListener('click', () => {
      if (typeof confirmAction === 'function') confirmAction();
      confirmAction = null;
      closeAllModals();
    });
  }

  // ---------- Boot ----------
  function boot() {
    bindEvents();
    initBackground();
    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
