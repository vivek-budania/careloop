/**
 * Provider Module — PA generation form, code autocomplete, risk scoring.
 */

const Provider = {
  selectedICD10: null,
  selectedCPT: null,
  urgency: 'standard',
  generatedPA: '',

  init() {
    this.setupAutocomplete('icd10-search', 'icd10-dropdown', 'icd10', (code) => {
      this.selectedICD10 = code;
      this.renderSelectedCode('icd10-selected', code);
    });

    this.setupAutocomplete('cpt-search', 'cpt-dropdown', 'cpt', (code) => {
      this.selectedCPT = code;
      this.renderSelectedCode('cpt-selected', code);
    });

    this.setupUrgency();
    this.setupButtons();
  },

  // ─── Autocomplete ─────────────────────────────────────
  setupAutocomplete(inputId, dropdownId, type, onSelect) {
    const input = document.getElementById(inputId);
    const dropdown = document.getElementById(dropdownId);

    const search = App.debounce(async (query) => {
      if (query.length < 2) {
        dropdown.classList.remove('visible');
        return;
      }

      try {
        const results = type === 'icd10'
          ? await API.searchICD10(query)
          : await API.searchCPT(query);

        if (results.length === 0) {
          dropdown.classList.remove('visible');
          return;
        }

        dropdown.innerHTML = results.slice(0, 15).map(code => `
          <div class="autocomplete-item" data-code='${JSON.stringify(code).replace(/'/g, "&#39;")}'>
            <span class="autocomplete-item-code">${App.escapeHTML(code.code)}</span>
            <span class="autocomplete-item-desc">${App.escapeHTML(code.description)}</span>
            <span class="autocomplete-item-cat">${App.escapeHTML(code.category)}</span>
          </div>
        `).join('');

        dropdown.classList.add('visible');

        dropdown.querySelectorAll('.autocomplete-item').forEach(item => {
          item.addEventListener('click', () => {
            const code = JSON.parse(item.dataset.code);
            input.value = `${code.code} — ${code.description}`;
            dropdown.classList.remove('visible');
            onSelect(code);
          });
        });
      } catch (err) {
        App.notify('Failed to search codes: ' + err.message, 'error');
      }
    }, 250);

    input.addEventListener('input', (e) => search(e.target.value));

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.autocomplete-wrapper')) {
        dropdown.classList.remove('visible');
      }
    });
  },

  renderSelectedCode(containerId, code) {
    const container = document.getElementById(containerId);
    container.innerHTML = `
      <div class="selected-code-chip">
        <span class="chip-code">${App.escapeHTML(code.code)}</span>
        <span>—</span>
        <span>${App.escapeHTML(code.description)}</span>
      </div>
    `;
  },

  // ─── Urgency ──────────────────────────────────────────
  setupUrgency() {
    document.querySelectorAll('.urgency-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        document.querySelectorAll('.urgency-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        this.urgency = pill.dataset.urgency;
      });
    });
  },

  // ─── Button handlers ─────────────────────────────────
  setupButtons() {
    document.getElementById('btn-check-risk').addEventListener('click', () => this.checkRisk());
    document.getElementById('btn-generate-pa').addEventListener('click', () => this.generatePA());
    document.getElementById('btn-approve-pa').addEventListener('click', () => this.approvePA());
  },

  // ─── Risk Score ───────────────────────────────────────
  async checkRisk() {
    if (!this.selectedICD10 || !this.selectedCPT) {
      App.notify('Please select both an ICD-10 and CPT code first.', 'error');
      return;
    }

    try {
      const result = await API.getRiskScore({
        icd10_code: this.selectedICD10.code,
        cpt_code: this.selectedCPT.code,
        has_prior_auth: document.getElementById('has-prior-auth').checked,
        has_clinical_notes: document.getElementById('has-clinical-notes').checked,
        is_emergency: document.getElementById('is-emergency').checked,
      });

      this.renderRiskScore(result);
    } catch (err) {
      App.notify('Risk score failed: ' + err.message, 'error');
    }
  },

  renderRiskScore(result) {
    const container = document.getElementById('risk-score-content');

    // Calculate gauge rotation (0-270 degrees mapped to 0-100 score)
    const rotation = (result.score / 100) * 270;

    container.innerHTML = `
      <div class="risk-gauge-container">
        <div class="risk-gauge">
          <div class="risk-gauge-bg"></div>
          <div class="risk-gauge-fill" style="
            border-top-color: ${result.color};
            border-right-color: ${result.color};
            transform: rotate(225deg);
            clip-path: none;
          " id="gauge-fill"></div>
          <div class="risk-gauge-value" style="color: ${result.color}">${result.score}</div>
        </div>
        <div class="risk-gauge-label" style="color: ${result.color}">${result.risk_level} RISK</div>
      </div>

      ${result.factors.length > 0 ? `
        <h3 style="margin: var(--space-md) 0 var(--space-sm); font-size: 0.85rem; color: var(--text-secondary);">
          ⚠️ Risk Factors
        </h3>
        <ul class="risk-factors">
          ${result.factors.map(f => `
            <li class="risk-factor-item">
              <span class="risk-factor-icon">▸</span>
              <span>${App.escapeHTML(f)}</span>
            </li>
          `).join('')}
        </ul>
      ` : ''}

      ${result.recommendations.length > 0 ? `
        <h3 style="margin: var(--space-lg) 0 var(--space-sm); font-size: 0.85rem; color: var(--text-secondary);">
          💡 Recommendations
        </h3>
        ${result.recommendations.map(r => `
          <div class="recommendation-item">
            <span class="recommendation-icon">→</span>
            <span>${App.escapeHTML(r)}</span>
          </div>
        `).join('')}
      ` : ''}
    `;

    // Animate the gauge fill
    requestAnimationFrame(() => {
      const fill = document.getElementById('gauge-fill');
      if (fill) {
        fill.style.transform = `rotate(${225 + rotation}deg)`;
      }
    });
  },

  // ─── PA Generation ────────────────────────────────────
  async generatePA() {
    if (!this.selectedICD10 || !this.selectedCPT) {
      App.notify('Please select both an ICD-10 and CPT code.', 'error');
      return;
    }

    const context = document.getElementById('clinical-context').value.trim();
    if (!context) {
      App.notify('Please provide clinical context.', 'error');
      return;
    }

    // Show loading
    const resultCard = document.getElementById('pa-result-card');
    const loading = document.getElementById('pa-loading');
    const docEl = document.getElementById('pa-document');
    const approveBtn = document.getElementById('btn-approve-pa');
    const warningsEl = document.getElementById('pa-warnings');

    resultCard.style.display = 'block';
    loading.classList.add('visible');
    docEl.textContent = '';
    approveBtn.style.display = 'none';
    warningsEl.innerHTML = '';

    try {
      const result = await API.generatePA({
        patient_age: parseInt(document.getElementById('patient-age').value) || null,
        patient_sex: document.getElementById('patient-sex').value || null,
        icd10_code: this.selectedICD10.code,
        icd10_description: this.selectedICD10.description,
        cpt_code: this.selectedCPT.code,
        cpt_description: this.selectedCPT.description,
        clinical_context: context,
        urgency: this.urgency,
      });

      loading.classList.remove('visible');
      this.generatedPA = result.content;
      docEl.innerHTML = App.renderMarkdown(result.content);
      approveBtn.style.display = 'inline-flex';

      if (result.warnings && result.warnings.length > 0) {
        warningsEl.innerHTML = result.warnings.map(w => `
          <div class="warning-banner">
            <span class="warning-icon">⚠️</span>
            <span>${App.escapeHTML(w)}</span>
          </div>
        `).join('');
      }

      App.notify('PA letter generated. Please review before approving.', 'info');

      // Scroll to result
      resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });

    } catch (err) {
      loading.classList.remove('visible');
      docEl.textContent = 'Generation failed. Please try again.';
      App.notify('PA generation failed: ' + err.message, 'error');
    }
  },

  // ─── PA Approval ──────────────────────────────────────
  async approvePA() {
    const approved = await App.requestApproval(this.generatedPA);
    if (approved) {
      App.downloadDocument(this.generatedPA, 'prior_authorization_request.txt');
    }
  },
};
