/**
 * API client — centralized fetch wrapper for all backend calls.
 * Handles loading states, errors, and response parsing.
 */

const API = {
  BASE_URL: '',  // Same origin — served by FastAPI

  /**
   * Generic fetch wrapper with error handling.
   */
  async request(endpoint, options = {}) {
    const url = `${this.BASE_URL}${endpoint}`;
    const config = {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    };

    try {
      const response = await fetch(url, config);

      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
        throw new Error(error.detail || `HTTP ${response.status}`);
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
};
