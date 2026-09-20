/**
 * API client — centralized fetch wrapper for all backend calls.
 * Handles loading states, errors, and response parsing.
 */

const API = {
  BASE_URL: '',  // Same origin — served by FastAPI
  TOKEN_KEY: 'careloop_token',

  getToken() {
    return localStorage.getItem(this.TOKEN_KEY) || '';
  },

  setToken(token) {
    if (token) localStorage.setItem(this.TOKEN_KEY, token);
    else localStorage.removeItem(this.TOKEN_KEY);
  },

  /**
   * Generic fetch wrapper with error handling.
   */
  async request(endpoint, options = {}) {
    const url = `${this.BASE_URL}${endpoint}`;
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    const token = this.getToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    const config = {
      ...options,
      headers,
      credentials: 'same-origin',
    };

    try {
      const response = await fetch(url, config);

      if (response.status === 401 && !endpoint.includes('/login')) {
        this.setToken('');
        if (window.App && typeof App.showLogin === 'function') {
          App.showLogin();
        }
      }

      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
        const detail = error.detail;
        const message = Array.isArray(detail) ? detail.map((d) => d.msg || d).join('; ') : (detail || `HTTP ${response.status}`);
        throw new Error(message);
      }

      return await response.json();
    } catch (err) {
      if (err.message === 'Failed to fetch') {
        throw new Error('Cannot connect to server. Is the backend running?');
      }
      throw err;
    }
  },

  /**
   * GET request.
   */
  async get(endpoint) {
    return this.request(endpoint, { method: 'GET' });
  },

  /**
   * POST request with JSON body.
   */
  async post(endpoint, data) {
    return this.request(endpoint, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  // --- Specific API calls ---

  searchICD10(query) {
    return this.get(`/api/codes/icd10?q=${encodeURIComponent(query)}`);
  },

  searchCPT(query) {
    return this.get(`/api/codes/cpt?q=${encodeURIComponent(query)}`);
  },

  getDenialReasons() {
    return this.get('/api/codes/denial-reasons');
  },

  getNationalStats() {
    return this.get('/api/national-stats');
  },

  getRiskScore(data) {
    return this.post('/api/risk-score', data);
  },

  generatePA(data) {
    return this.post('/api/generate-pa', data);
  },

  parseDenial(denialText) {
    return this.post('/api/parse-denial', { denial_text: denialText });
  },

  generateAppeal(data) {
    return this.post('/api/generate-appeal', data);
  },

  generateDemand(data) {
    return this.post('/api/generate-demand', data);
  },

  listPayers() {
    return this.get('/api/careloop/payers');
  },

  getCoverage() {
    return this.get('/api/careloop/coverage');
  },

  demoEnv() {
    return this.get('/api/careloop/demo-env');
  },

  resetCoverage() {
    return this.post('/api/careloop/coverage/reset', {});
  },

  saveCoverage(data) {
    return this.post('/api/careloop/coverage', data);
  },

  scanCoverage(data) {
    return this.post('/api/careloop/coverage/scan', data);
  },

  confirmCoverage(data) {
    return this.post('/api/careloop/coverage/confirm', data);
  },

  saveCoverageIntake(data) {
    return this.post('/api/careloop/coverage/intake', data);
  },

  guessVisitCost(data) {
    return this.post('/api/careloop/coverage/visit-guess', data);
  },

  claimAcceptance(data) {
    return this.post('/api/careloop/coverage/claim-acceptance', data);
  },

  searchNetwork(specialty, zip) {
    const params = new URLSearchParams();
    if (specialty) params.set('specialty', specialty);
    if (zip) params.set('zip', zip);
    return this.get(`/api/careloop/network?${params.toString()}`);
  },

  listDemoAccounts() {
    return this.get('/api/careloop/auth/accounts');
  },

  login(username, password) {
    return this.post('/api/careloop/login', { username, password });
  },

  logout() {
    return this.post('/api/careloop/logout', {});
  },

  me() {
    return this.get('/api/careloop/me');
  },

  // --- CareLoop scribe (Stream C) ---

  getScribeFixture(demo) {
    if (demo) return this.get(`/api/careloop/scribe/fixture?demo=${encodeURIComponent(demo)}`);
    return this.get('/api/careloop/scribe/fixture');
  },

  listScribeDemos() {
    return this.get('/api/careloop/scribe/demos');
  },

  draftScribe(data) {
    return this.post('/api/careloop/scribe/draft', data);
  },

  approveScribe(encounter) {
    return this.post('/api/careloop/scribe/approve', { encounter });
  },

  summarizeScribe(data) {
    return this.post('/api/careloop/scribe/summarize', data);
  },

  async downloadHistoryPdf(markdown, title = 'CareLoop history packet') {
    const url = `${this.BASE_URL}/api/careloop/history/pdf`;
    const headers = { 'Content-Type': 'application/json' };
    const token = this.getToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ markdown, title }),
      credentials: 'same-origin',
    });
    if (response.status === 401) {
      this.setToken('');
      if (window.App && typeof App.showLogin === 'function') App.showLogin();
    }
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
      const detail = error.detail;
      const message = Array.isArray(detail) ? detail.map((d) => d.msg || d).join('; ') : (detail || `HTTP ${response.status}`);
      throw new Error(message);
    }
    const blob = await response.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'careloop-history.pdf';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },

  async extractImage(file) {
    const url = `${this.BASE_URL}/api/careloop/extract-image`;
    const headers = {};
    const token = this.getToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    const form = new FormData();
    form.append('file', file);

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: form,
      credentials: 'same-origin',
    });
    if (response.status === 401) {
      this.setToken('');
      if (window.App && typeof App.showLogin === 'function') App.showLogin();
    }
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
      const detail = error.detail;
      const message = Array.isArray(detail) ? detail.map((d) => d.msg || d).join('; ') : (detail || `HTTP ${response.status}`);
      throw new Error(message);
    }
    return response.json();
  },

  async transcribeScribeAudio(file) {
    const url = `${this.BASE_URL}/api/careloop/scribe/transcribe`;
    const headers = {};
    const token = this.getToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    const form = new FormData();
    form.append('file', file);

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: form,
      credentials: 'same-origin',
    });
    if (response.status === 401) {
      this.setToken('');
      if (window.App && typeof App.showLogin === 'function') App.showLogin();
    }
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
      const detail = error.detail;
      const message = Array.isArray(detail) ? detail.map((d) => d.msg || d).join('; ') : (detail || `HTTP ${response.status}`);
      throw new Error(message);
    }
    return response.json();
  },
};
