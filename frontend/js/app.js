/**
 * App core — handles navigation, notifications, HITL modal, and shared utilities.
 */

const App = {
  currentModule: 'provider',

  init() {
    this.setupNavigation();
    this.setupHITLModal();
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
    this.currentModule = module;

    // Update tabs
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    document.querySelector(`[data-module="${module}"]`).classList.add('active');

    // Update views
    document.querySelectorAll('.module-view').forEach(v => v.classList.remove('active'));
    document.getElementById(`module-${module}`).classList.add('active');
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
});
