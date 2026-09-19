/**
 * App core — handles navigation, notifications, HITL modal, and shared utilities.
 */

const App = {
  currentModule: 'provider',
  user: null,

  init() {
    this.setupNavigation();
    this.setupHITLModal();
    this.setupAuth();
  },

  setupAuth() {
    document.getElementById('login-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.login();
    });
    document.getElementById('btn-logout').addEventListener('click', () => this.logout());
    this.loadAccountHints();
    this.restoreSession();
  },

  async loadAccountHints() {
    const list = document.getElementById('login-accounts');
    try {
      const accounts = await API.listDemoAccounts();
      list.innerHTML = accounts.map((a) => (
        `<li><code>${App.escapeHTML(a.username)}</code> — ${App.escapeHTML(a.name)} (${App.escapeHTML(a.role)})</li>`
      )).join('');
    } catch (err) {
      list.textContent = 'Could not load demo accounts.';
    }
  },

  async restoreSession() {
    if (!API.getToken()) {
      this.showLogin();
      return;
    }
    try {
      const user = await API.me();
      this.enterApp(user);
    } catch (err) {
      API.setToken('');
      this.showLogin();
    }
  },

  async login() {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    const errBox = document.getElementById('login-error');
    errBox.textContent = '';
    try {
      const result = await API.login(username, password);
      API.setToken(result.token);
      this.enterApp(result.user);
    } catch (err) {
      errBox.textContent = err.message;
    }
  },

  async logout() {
    try {
      await API.logout();
    } catch (err) {
      // Still clear the local session.
    }
    API.setToken('');
    this.user = null;
    this.showLogin();
  },

  showLogin() {
    document.getElementById('login-screen').hidden = false;
    document.getElementById('app-shell').hidden = true;
  },

  enterApp(user) {
    this.user = user;
    document.getElementById('login-screen').hidden = true;
    document.getElementById('app-shell').hidden = false;
    document.getElementById('nav-user-label').textContent = `${user.name} (${user.role})`;
    this.applyRole(user);
    if (window.CareLoop) CareLoop.loadPayers();
  },

  applyRole(user) {
    const allowed = user.tabs || [];
    document.querySelectorAll('.nav-tab').forEach((tab) => {
      const show = allowed.includes(tab.dataset.module);
      tab.hidden = !show;
      tab.classList.toggle('active', false);
    });
    document.querySelectorAll('.module-view').forEach((view) => view.classList.remove('active'));

    const home = allowed.includes('careloop') ? 'careloop'
      : allowed.includes('provider') ? 'provider'
      : allowed[0];
    if (home) this.switchModule(home);
  },

  // ─── Navigation ───────────────────────────────────────
  setupNavigation() {
    const tabs = document.querySelectorAll('.nav-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const module = tab.dataset.module;
        this.switchModule(module);
      });
    });
  },

  switchModule(module) {
    const tab = document.querySelector(`[data-module="${module}"]`);
    if (!tab || tab.hidden) return;

    this.currentModule = module;

    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');

    document.querySelectorAll('.module-view').forEach(v => v.classList.remove('active'));
    const view = document.getElementById(`module-${module}`);
    if (view) view.classList.add('active');
  },

  // ─── Notifications ────────────────────────────────────
  notify(message, type = 'info') {
    const existing = document.querySelector('.notification');
    if (existing) existing.remove();

    const icons = { success: '✓', error: '✕', info: 'ℹ' };
    const el = document.createElement('div');
    el.className = `notification ${type}`;
    el.innerHTML = `<span>${icons[type] || 'ℹ'}</span> ${message}`;
    document.body.appendChild(el);

    setTimeout(() => {
      el.style.animation = 'notif-out 300ms ease forwards';
      setTimeout(() => el.remove(), 300);
    }, 4000);
  },

  // ─── HITL Approval Modal ──────────────────────────────
  _hitlResolve: null,
  _hitlContent: '',

  setupHITLModal() {
    const modal = document.getElementById('hitl-modal');
    const checkbox = document.getElementById('hitl-confirm');
    const approveBtn = document.getElementById('hitl-approve');
    const cancelBtn = document.getElementById('hitl-cancel');

    checkbox.addEventListener('change', () => {
      approveBtn.disabled = !checkbox.checked;
    });

    approveBtn.addEventListener('click', () => {
      modal.classList.remove('visible');
      checkbox.checked = false;
      approveBtn.disabled = true;
      if (this._hitlResolve) {
        this._hitlResolve(true);
        this._hitlResolve = null;
      }
    });

    cancelBtn.addEventListener('click', () => {
      modal.classList.remove('visible');
      checkbox.checked = false;
      approveBtn.disabled = true;
      if (this._hitlResolve) {
        this._hitlResolve(false);
        this._hitlResolve = null;
      }
    });
  },

  /**
   * Show the HITL modal and return a Promise<boolean>.
   * true = approved, false = cancelled.
   */
  requestApproval(documentContent) {
    this._hitlContent = documentContent;
    document.getElementById('hitl-modal').classList.add('visible');
    return new Promise(resolve => {
      this._hitlResolve = resolve;
    });
  },

  // ─── Document Download ────────────────────────────────
  downloadDocument(content, filename) {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    this.notify('Document downloaded successfully.', 'success');
  },

  // ─── Utility ──────────────────────────────────────────
  escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },

  /**
   * Render a lightweight subset of Markdown (headers, bold, hr, bullet/numbered
   * lists, paragraphs) as safe HTML. Generated documents use this formatting;
   * everything is HTML-escaped before any markdown syntax is interpreted.
   */
  renderMarkdown(raw) {
    const lines = this.escapeHTML(raw).split('\n');
    const inline = (text) => text
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');

    let html = '';
    let inList = false;
    const closeList = () => {
      if (inList) { html += '</ul>'; inList = false; }
    };

    for (const rawLine of lines) {
      const line = rawLine.trim();

      if (line === '') {
        closeList();
        continue;
      }

      if (/^(-{3,}|\*{3,})$/.test(line)) {
        closeList();
        html += '<hr>';
        continue;
      }

      const heading = line.match(/^(#{1,4})\s+(.*)$/);
      if (heading) {
        closeList();
        const level = Math.min(heading[1].length + 1, 4);
        html += `<h${level}>${inline(heading[2])}</h${level}>`;
        continue;
      }

      const listItem = line.match(/^[-*]\s+(.*)$/) || line.match(/^\d+\.\s+(.*)$/);
      if (listItem) {
        if (!inList) { html += '<ul>'; inList = true; }
        html += `<li>${inline(listItem[1])}</li>`;
        continue;
      }

      closeList();
      html += `<p>${inline(line)}</p>`;
    }
    closeList();
    return html;
  },

  debounce(fn, delay = 300) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  },
};

// Boot
document.addEventListener('DOMContentLoaded', () => {
  App.init();
  Provider.init();
  Patient.init();
  CareLoop.init();
});
