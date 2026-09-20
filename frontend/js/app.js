/**
 * App core — HITL modal, toasts, shared utilities.
 * Patient shell lives in careloop.js. Letter drafts live at /letters.
 */

const App = {
  currentModule: 'careloop',
  user: null,
  page: document.body?.dataset?.page || 'careloop',

  showLogin() {
    if (window.CareLoop && typeof CareLoop.renderLogin === 'function') {
      CareLoop.renderLogin();
      return;
    }
    API.setToken('');
  },

  init() {
    this.setupHITLModal();
    if (this.page === 'letters') {
      this.setupLettersNav();
      this.restoreLettersSession();
      return;
    }
    if (window.CareLoop) CareLoop.init();
  },

  setupLettersNav() {
    document.querySelectorAll('#app-shell .nav-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('#app-shell .nav-tab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        document.querySelectorAll('.module-view').forEach((v) => v.classList.remove('active'));
        const view = document.getElementById(`module-${tab.dataset.module}`);
        if (view) view.classList.add('active');
      });
    });
    const provider = document.getElementById('module-provider');
    if (provider) provider.classList.add('active');
  },

  async restoreLettersSession() {
    if (!API.getToken()) return;
    try {
      const user = await API.me();
      this.user = user;
      const label = document.getElementById('nav-user-label');
      if (label) label.textContent = `${user.name} · letter drafts (HITL)`;
    } catch (err) {
      API.setToken('');
    }
  },

  notify(message, type = 'info') {
    const toast = document.getElementById('toast');
    if (toast) {
      toast.textContent = message;
      toast.classList.add('show');
      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
      return;
    }

    const existing = document.querySelector('.notification');
    if (existing) existing.remove();
    const icons = { success: '✓', error: '✕', info: 'ℹ' };
    const el = document.createElement('div');
    el.className = `notification ${type}`;
    el.innerHTML = `<span>${icons[type] || 'ℹ'}</span> ${this.escapeHTML(message)}`;
    document.body.appendChild(el);
    setTimeout(() => {
      el.style.animation = 'notif-out 300ms ease forwards';
      setTimeout(() => el.remove(), 300);
    }, 4000);
  },

  _hitlResolve: null,
  _hitlContent: '',

  setupHITLModal() {
    const modal = document.getElementById('hitl-modal');
    if (!modal) return;
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

  requestApproval(documentContent) {
    this._hitlContent = documentContent;
    const modal = document.getElementById('hitl-modal');
    if (!modal) {
      this.notify('Human review is required before downloading a generated letter.', 'error');
      return Promise.resolve(false);
    }
    modal.classList.add('visible');
    return new Promise((resolve) => {
      this._hitlResolve = resolve;
    });
  },

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

  escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  },

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

function bootApp() {
  if (App._booted) return;
  App._booted = true;
  App.init();
  if (App.page === 'letters') {
    if (typeof Provider !== 'undefined') Provider.init();
    if (typeof Patient !== 'undefined') Patient.init();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootApp);
} else {
  bootApp();
}
